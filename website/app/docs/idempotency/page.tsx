import { CodeBlock } from "../../../components/code-block";
import { SequenceDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Idempotency keys",
  description:
    "Make unsafe POST/PUT/PATCH/DELETE requests safely retryable with the built-in, dependency-free idempotency() middleware: request fingerprinting, response replay, in-flight 409 conflicts, and a pluggable IdempotencyStore mirroring SessionStore.",
  path: "/docs/idempotency",
  keywords: [
    "idempotency key",
    "Idempotency-Key header",
    "idempotent requests",
    "DaloyJS idempotency",
    "safe retries",
    "payment idempotency",
    "response replay",
    "IdempotencyStore",
    "exactly-once",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Idempotency keys</h1>
      <p>
        Network retries are a fact of life on serverless platforms, behind load
        balancers, and on flaky mobile connections. For unsafe methods (
        <code>POST</code>, <code>PUT</code>, <code>PATCH</code>,{" "}
        <code>DELETE</code>) a blind retry can charge a card twice or create a
        duplicate order. The <code>idempotency()</code> middleware gives those
        requests an exactly-once guarantee: the client sends a unique{" "}
        <code>Idempotency-Key</code> header, and DaloyJS makes sure the side
        effect runs at most once no matter how many times the request is
        replayed.
      </p>
      <p>
        It is <strong>built-in and dependency-free</strong>, built on Web Crypto
        and the Web-standard <code>Request</code>/<code>Response</code>, so it
        runs unchanged on Node, Bun, Deno, and Cloudflare Workers.
        The behavior mirrors the IETF <em>Idempotency-Key HTTP Header Field</em>{" "}
        draft and the conventions used by major payment processors.
      </p>

      <h2 id="quick-start">Quick start</h2>
      <p>
        Mount <code>idempotency()</code> ahead of the routes that need
        exactly-once semantics. That is all: clients opt in per request by
        sending an <code>Idempotency-Key</code> header.
      </p>
      <CodeBlock
        code={`import { App, idempotency } from "@daloyjs/core";
import { z } from "zod";

const app = new App();

// Safe retries for the whole write surface.
app.use(idempotency({ ttlSeconds: 86_400 }));

app.route({
  method: "POST",
  path: "/charges",
  operationId: "createCharge",
  request: { body: z.object({ amount: z.number() }) },
  responses: {
    201: { description: "created", body: z.object({ id: z.string() }) },
  },
  handler: async ({ body }) => {
    const id = await chargeCard(body.amount); // runs at most once per key
    return { status: 201 as const, body: { id } };
  },
});`}
        language="ts"
      />

      <h2 id="how-it-works">How it works</h2>
      <p>
        For an applicable method that carries an <code>Idempotency-Key</code>{" "}
        header, the middleware fingerprints the request (method + path + query
        string + body) and consults a pluggable store:
      </p>

      <SequenceDiagram
        title="Same key, replayed request"
        participants={["Client", "idempotency()", "Store", "Handler"]}
        steps={[
          {
            from: "Client",
            to: "idempotency()",
            label: "POST /charges with Idempotency-Key",
            detail: "first attempt",
            kind: "request",
          },
          {
            from: "idempotency()",
            to: "Store",
            label: "reserve(key): atomic set-if-absent",
            detail: "wins the reservation",
            kind: "async",
          },
          {
            from: "idempotency()",
            to: "Handler",
            label: "Run handler once, capture response",
            detail: "complete(key, response) for ttlSeconds",
            kind: "request",
          },
          {
            from: "Client",
            to: "idempotency()",
            label: "Identical retry, same key + fingerprint",
            detail: "network hiccup, client retries",
            kind: "request",
          },
          {
            from: "idempotency()",
            to: "Client",
            label: "Replay stored response, handler skipped",
            detail: "Idempotency-Replayed: true",
            kind: "response",
          },
        ]}
        caption="The first request runs the handler and stores its response under the key. An identical retry replays that stored response byte for byte without running the side effect again. A retry while the first is still in flight gets a 409, and the same key with a different body gets a 422."
      />

      <ul>
        <li>
          <strong>First request</strong>: the handler runs normally; the final
          response is captured and persisted under the key for{" "}
          <code>ttlSeconds</code>.
        </li>
        <li>
          <strong>Identical retry</strong> (same key, same fingerprint, original
          completed): the stored response is replayed byte-for-byte with an{" "}
          <code>Idempotency-Replayed: true</code> header. The handler does{" "}
          <em>not</em> run again.
        </li>
        <li>
          <strong>Retry while the first is still in flight</strong>: a{" "}
          <code>409 Conflict</code> is returned (with{" "}
          <code>Cache-Control: no-store</code>) so the client backs off instead
          of racing.
        </li>
        <li>
          <strong>Same key, different body</strong>: a{" "}
          <code>422 Unprocessable Content</code> is returned. A key is
          permanently bound to the first payload it was used with.
        </li>
      </ul>
      <p>
        Responses that are not safe to cache are never stored, and the
        reservation is released so the client can retry: server errors (
        <code>5xx</code> by default, see <code>cacheableStatus</code>) and
        responses larger than <code>maxResponseBytes</code> (1&nbsp;MiB by
        default).
      </p>

      <h2 id="options">Options</h2>
      <CodeBlock
        code={`app.use(
  idempotency({
    // How long a key (and its replayed response) lives. Default: 86400 (24h).
    ttlSeconds: 86_400,
    // Request header carrying the key. Default: "idempotency-key".
    headerName: "idempotency-key",
    // Response header marking a replay. Default: "idempotency-replayed".
    replayHeaderName: "idempotency-replayed",
    // Methods the middleware applies to. Default: POST, PUT, PATCH, DELETE.
    methods: ["POST", "PUT", "PATCH", "DELETE"],
    // Reject applicable requests that omit the header with 400. Default: false.
    requireKey: false,
    // Maximum accepted key length. Default: 255.
    maxKeyLength: 255,
    // Largest response body buffered + stored. Default: 1 MiB.
    maxResponseBytes: 1_048_576,
    // Decide whether a response is cached. Default: status < 500.
    cacheableStatus: (status) => status < 500,
    // Share one in-memory store across mounts with the same id.
    groupId: "payments",
    // Namespace keys by caller. Default: hash of the Authorization header.
    scope: (ctx) => (ctx.state.session as { id?: string } | undefined)?.id,
  }),
);`}
        language="ts"
      />

      <h2 id="pluggable-stores">Pluggable stores</h2>
      <p>
        The default <code>MemoryIdempotencyStore</code> is process-local,
        perfect for tests and single-instance deployments. For a multi-instance
        or serverless fleet, supply a shared backend by implementing{" "}
        <code>IdempotencyStore</code>. The contract mirrors{" "}
        <code>SessionStore</code> and the rate-limit store: the one rule is that{" "}
        <code>reserve()</code> must be atomic (&ldquo;set if absent&rdquo;), the
        exact <code>SET key value NX</code> semantics of Redis, so two
        concurrent requests cannot both win the reservation. The{" "}
        <code>key</code> passed to your store is already namespaced by{" "}
        <code>groupId</code> and <code>scope</code>.
      </p>
      <CodeBlock
        code={`import type { IdempotencyStore, IdempotencyRecord } from "@daloyjs/core";

const redisIdempotencyStore: IdempotencyStore = {
  // Atomic reserve: persist only if the key is unused, else return the
  // existing record untouched.
  async reserve(key, record, ttlMs) {
    const ok = await redis.set(key, JSON.stringify(record), "PX", ttlMs, "NX");
    if (ok) return null;
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as IdempotencyRecord) : null;
  },
  async complete(key, record, ttlMs) {
    await redis.set(key, JSON.stringify(record), "PX", ttlMs);
  },
  async release(key) {
    await redis.del(key);
  },
};

app.use(idempotency({ store: redisIdempotencyStore }));`}
        language="ts"
      />

      <h2 id="client-usage">Client usage</h2>
      <p>
        Clients generate a unique key per logical operation (a UUID is ideal)
        and reuse it across retries of that same operation:
      </p>
      <CodeBlock
        code={`const key = crypto.randomUUID();

async function createChargeWithRetries(amount: number) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch("/charges", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": key, // same key on every retry
      },
      body: JSON.stringify({ amount }),
    });
    if (res.status !== 409) return res; // 409 = still in flight, back off
    await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
  }
  throw new Error("charge still in flight after retries");
}`}
        language="ts"
      />

      <h2 id="security-notes">Security notes</h2>
      <ul>
        <li>
          Keys are validated up front: empty, over-long (
          <code>maxKeyLength</code>), or non-printable keys are rejected with{" "}
          <code>400 Bad Request</code> before any store lookup.
        </li>
        <li>
          Conflict and reuse responses (<code>409</code>, <code>422</code>)
          carry <code>Cache-Control: no-store</code> so a shared cache cannot
          mask them.
        </li>
        <li>
          Server errors are never cached, so a transient <code>5xx</code> does
          not poison the key, so the client can safely retry.
        </li>
        <li>
          The stored body is capped by <code>maxResponseBytes</code> to bound
          memory growth from large replies.
        </li>
        <li>
          <strong>Keys are namespaced per principal (CWE-524).</strong> Without
          this, any client that reused another client&apos;s{" "}
          <code>Idempotency-Key</code> with the same body would receive that
          client&apos;s stored response. The store key is namespaced by the
          caller, defaulting to the <code>Authorization</code> header so the
          common bearer- / API-key case is isolated automatically. For
          cookie-based sessions, pass a stable identity via <code>scope</code>,
          e.g.{" "}
          <code>
            scope: (ctx) =&gt; (ctx.state.session as {"{ id?: string }"} |
            undefined)?.id
          </code>
          . Unauthenticated requests (no <code>Authorization</code>, no{" "}
          <code>scope</code>) still dedupe by key alone.
        </li>
      </ul>
    </>
  );
}
