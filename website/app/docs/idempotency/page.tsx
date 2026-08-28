import { CodeBlock } from "../../../components/code-block";
import { SequenceDiagram } from "../../../components/diagram";
import { UseCaseGuide } from "../../../components/use-case-guide";

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
        <code>POST</code>
        {", "}
        <code>PUT</code>
        {", "}
        <code>PATCH</code>
        {", "}
        <code>DELETE</code>) a blind retry can charge a card twice or create a
        duplicate order. The <code>idempotency()</code> middleware gives those
        requests an exactly-once guarantee: the client sends a unique{" "}
        <code>Idempotency-Key</code> header, and DaloyJS makes sure the side
        effect runs at most once no matter how many times the request is
        replayed.
      </p>
      <p>
        It is <strong>built-in and dependency-free</strong>
        {", "}built on Web Crypto and the Web-standard <code>Request</code>/
        <code>Response</code>
        {", "}so it runs unchanged on Node, Bun, Deno, and Cloudflare Workers.
        The behavior mirrors the IETF <em>Idempotency-Key HTTP Header Field</em>{" "}
        draft and the conventions used by major payment processors.
      </p>

      <UseCaseGuide
        featureName="Idempotency middleware"
        recommendation="Use idempotency keys for mutative and non-idempotent HTTP methods (POST, PUT, PATCH, DELETE) that perform critical operations like processing payments or updating state. Never require them for safe read-only requests (GET, HEAD, OPTIONS)."
        whenToUse={[
          "Critical state-mutating actions where duplicate execution causes business errors (e.g., payments, bank transfers, ticket bookings, creating orders).",
          "API endpoints exposed to clients on unstable networks (mobile apps, webhooks) that will automatically retry failed requests.",
          "Any POST/PUT/PATCH/DELETE handler where exactly-once execution is a business constraint.",
        ]}
        whenNotToUse={[
          "Safe HTTP methods (GET, HEAD, OPTIONS, TRACE), which are naturally idempotent and should never change state.",
          "Non-critical operations where duplicates are harmless (e.g., logging analytic events, page views, search inputs).",
          "High-frequency low-impact state updates where retries can naturally overwrite state (e.g., updating user cursor positions, simple read counts).",
        ]}
      />

      <h2 id="quick-start">Quick start</h2>
      <p>
        Mount <code>idempotency()</code> ahead of the routes that need
        exactly-once semantics. Clients opt in per request by
        sending an <code>Idempotency-Key</code> header.
      </p>
      <p>
        One ordering rule: if the app also uses <code>rateLimit()</code> or{" "}
        <code>loginThrottle()</code>, register the limiter{" "}
        <strong>before</strong> <code>idempotency()</code>. A replay is returned
        from <code>beforeHandle</code> and ends the hook chain, so a limiter
        mounted behind it never counts replayed requests and the declared budget
        is effectively unlimited. In production that order{" "}
        <a href="/docs/security/boot-guards#8-stored-response-mounted-ahead-of-a-request-budget">
          refuses to boot
        </a>
        .
      </p>
      <CodeBlock
        code={`import { App, idempotency } from "@daloyjs/core";
import { z } from "zod";

const app = new App();

// Safe retries for the whole write surface.
app.use(idempotency({ ttlSeconds: 86_400 }));

app.post(
  "/charges",
  {
    operationId: "createCharge",
    request: { body: z.object({ amount: z.number() }) },
    responses: {
      201: { description: "created", body: z.object({ id: z.string() }) },
    },
  },
  async ({ body }) => {
    const id = await chargeCard(body.amount); // runs at most once per key
    return { status: 201 as const, body: { id } };
  },
);`}
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
          First request
          {": "}the handler runs normally. The final response is captured and
          persisted under the key for <code>ttlSeconds</code>.
        </li>
        <li>
          Identical retry (same key, same fingerprint, original completed): the
          stored response is replayed byte-for-byte with an{" "}
          <code>Idempotency-Replayed: true</code> header. The handler does{" "}
          <em>not</em> run again.
        </li>
        <li>
          Retry while the first is still in flight
          {": "}a <code>409 Conflict</code> is returned (with{" "}
          <code>Cache-Control: no-store</code>) so the client backs off instead
          of racing.
        </li>
        <li>
          Same key, different body
          {": "}a <code>422 Unprocessable Content</code> is returned. A key is
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
        <code>IdempotencyStore</code>
        {". "}The contract mirrors <code>SessionStore</code> and the rate-limit
        store: the one rule is that <code>reserve()</code> must be atomic
        (&ldquo;set if absent&rdquo;), the exact <code>SET key value NX</code>{" "}
        semantics of Redis, so two concurrent requests cannot both win the
        reservation. The <code>key</code> passed to your store is already
        namespaced by <code>groupId</code> and <code>scope</code>.
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
          Conflict and reuse responses (<code>409</code>
          {", "}
          <code>422</code>) carry <code>Cache-Control: no-store</code> so a
          shared cache cannot mask them.
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
          cookie-based sessions, pass a stable identity via <code>scope</code>
          {", "}
          e.g.{" "}
          <code>
            scope: (ctx) =&gt; (ctx.state.session as {"{ id?: string }"} |
            undefined)?.id
          </code>
          {". "}Unauthenticated requests (no <code>Authorization</code>
          {", "}no <code>scope</code>) still dedupe by key alone.
        </li>
        <li>
          <strong>
            A cookie-bearing request with no resolvable scope is refused.
          </strong>{" "}
          Forgetting <code>scope</code> on a cookie-authenticated app is the one
          way the namespace silently collapses: no <code>Authorization</code>{" "}
          header means no scope tag, so the retry fingerprint (method + path +
          body) becomes the only thing separating two users, and two users
          submit the same fingerprint identically. DaloyJS therefore throws on a
          request that carries a <code>Cookie</code> but yields no scope, rather
          than serving one caller&apos;s stored response to another. Pass{" "}
          <code>scope</code>
          {", "}or set <code>allowUnscopedCallers: true</code> if those callers
          really are interchangeable (a public idempotent write whose response
          body is not caller-specific). A custom <code>scope</code> bypasses the
          guard entirely, including when it returns <code>undefined</code>
          {", "}because an explicit resolver owns its own posture.
        </li>
        <li>
          <strong>
            Pass <code>scope</code> whenever <code>Authorization</code> is not
            per-user.
          </strong>{" "}
          The default assumes that header names one caller. If it is shared (a
          per-tenant API key, a service token, a gateway credential) while end
          users are distinguished some other way, the scope <em>does</em>{" "}
          resolve, so no guard fires, and it partitions per tenant while
          everyone inside one tenant shares a namespace. DaloyJS cannot detect
          this: a coarse scope looks exactly like a correctly per-user one, and
          refusing every cookie-bearing request instead would reject the far
          more common shape of a per-user bearer token arriving with ordinary
          browser cookies (analytics, consent, CSRF). So this one is your call.
          The replay carries no credential either way, so a coarse namespace
          stays a body disclosure and never becomes a session handover.
        </li>
        <li>
          <strong>A replay never re-issues the original Set-Cookie.</strong>{" "}
          Storing every response header meant a <code>Set-Cookie</code> issued
          to the first caller was handed to whoever replayed the record. Under
          any coarse namespace that upgrades a body disclosure into giving away
          a live session, and even for a legitimate same-caller retry it would
          resurrect a cookie the handler set once, undoing a session rotation
          performed at login or on a privilege change. <code>Set-Cookie</code>{" "}
          is stripped on capture (so a credential never reaches the store) and
          re-checked on replay, alongside the hop-by-hop and per-request fields
          (<code>Connection</code>
          {", "}
          <code>Transfer-Encoding</code>
          {", "}
          <code>Age</code>
          {", "}
          <code>X-Request-Id</code>). Your application headers replay unchanged.
        </li>
        <li>
          <strong>The in-memory store is bounded.</strong>{" "}
          <code>MemoryIdempotencyStore</code> caps live records (
          <code>maxEntries</code>, default 10 000): it sweeps expired records
          first, then evicts the oldest survivor. Sweeping alone was not a
          bound, since a stream of unique keys inside the TTL grew the map
          linearly with each entry pinning a stored response body. Eviction can
          only cost exactly-once semantics for a retry that arrives after it, so
          supply a shared (Redis) store when your key volume approaches the cap,
          which you want anyway for multi-instance deployments.
        </li>
      </ul>
    </>
  );
}
