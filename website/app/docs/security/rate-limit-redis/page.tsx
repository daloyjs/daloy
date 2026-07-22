import { CodeBlock } from "../../../../components/code-block";
import { SequenceDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Redis rate-limit store",
  description:
    "Plug a Redis-backed RateLimitStore into rateLimit() for shared counters across replicas, with adapters for ioredis and node-redis.",
  path: "/docs/security/rate-limit-redis",
  keywords: [
    "DaloyJS rate limit",
    "Redis rate limit",
    "ioredis rate limit",
    "node-redis rate limit",
    "shared rate limit store",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Redis rate-limit store</h1>
      <blockquote>
        A Redis-backed store gives every replica the same rate-limit counter.
        Requests cannot gain a separate allowance by reaching another instance.
      </blockquote>
      <p>
        The default <code>rateLimit()</code> middleware uses an in-process
        memory store. That is perfect for a single Node process but unsafe
        behind multiple replicas. Each instance keeps its own counter, so a
        client in practice gets <code>N * max</code> requests per window.
      </p>
      <p>
        DaloyJS ships an optional <strong>Redis-backed</strong> store at the{" "}
        <code>@daloyjs/core/rate-limit-redis</code> sub-export. Counters live in
        Redis and are updated atomically with a small Lua script (
        <code>INCR</code> + <code>PEXPIRE</code>), so every replica observes the
        same window without a hot key shootout.
      </p>
      <SequenceDiagram
        title="One client hitting two replicas, one shared counter"
        participants={["Client", "Replica A", "Replica B", "Redis"]}
        steps={[
          {
            from: "Client",
            to: "Replica A",
            label: "Request lands on replica A",
            detail: "key = daloy:rl:<key>",
            kind: "request",
          },
          {
            from: "Replica A",
            to: "Redis",
            label: "Atomic INCR + PEXPIRE (Lua)",
            detail: "count = 120 / max 120",
            kind: "async",
          },
          {
            from: "Replica A",
            to: "Client",
            label: "Allowed, at the limit",
            detail: "200 OK",
            kind: "response",
          },
          {
            from: "Client",
            to: "Replica B",
            label: "Next request load-balanced away",
            detail: "same key, different process",
            kind: "request",
          },
          {
            from: "Replica B",
            to: "Redis",
            label: "INCR sees the shared count",
            detail: "count = 121 > 120",
            kind: "async",
          },
          {
            from: "Replica B",
            to: "Client",
            label: "Rejected by the shared window",
            detail: "429 + Retry-After",
            kind: "response",
          },
        ]}
        caption="Every replica increments the same Redis key, so switching doors does not reset the count. With the in-memory store each replica keeps its own counter and a client can get N times the limit."
      />

      <h2 id="when-to-use-redis-and-when-not-to">
        When to use Redis (and when not to)
      </h2>
      <p>
        The Redis store is built for{" "}
        <strong>long-lived multi-replica deployments</strong>
        {": "}VPS, containers, Kubernetes, Fly.io, Render, ECS, App Runner,
        Railway. Anywhere you run more than one Node / Bun / Deno process and
        need a shared counter so a client can&apos;t get <code>N&times;</code>{" "}
        the limit by load-balancing across replicas.
      </p>
      <p>
        On <strong>edge runtimes</strong> (Cloudflare Workers, Fastly Compute),
        prefer the platform&apos;s native primitive rather than fronting Redis
        from every region:
      </p>
      <ul>
        <li>
          Cloudflare Workers
          {": "}Durable Objects (strongly consistent per-key), or KV / D1 for
          relaxed consistency.
        </li>
        <li>
          Fastly Compute
          {": "}Edge Dictionaries for static quotas, KV Store for dynamic
          counters.
        </li>
      </ul>
      <p>
        <code>rateLimit()</code> accepts any object implementing the{" "}
        <code>RateLimitStore</code> contract, so each of these platforms can be
        wired up in a few lines using the same middleware. The Redis adapter
        shown below is just the most common case.
      </p>

      <h2 id="install-your-redis-client">Install your Redis client</h2>
      <p>
        DaloyJS does not bundle a Redis client. Pick whichever is already in
        your stack; there are first-class adapters for the two most common
        options.
      </p>
      <CodeBlock
        language="bash"
        code={`# pick one
pnpm add ioredis
pnpm add redis        # node-redis v4+`}
      />

      <h2 id="run-a-redis-to-point-at">Run a Redis to point at</h2>
      <p>
        The adapter needs a Redis it can reach; DaloyJS does not start one for
        you. For local development the quickest path is a container:
      </p>
      <CodeBlock
        language="bash"
        code={`docker run --rm -p 6379:6379 redis:7-alpine
# then, in your app's environment:
export REDIS_URL=redis://127.0.0.1:6379`}
      />
      <p>
        In production use a managed Redis (Upstash, ElastiCache, Memorystore,
        Redis Cloud) and read the URL from the environment. Keep exactly one
        client per process and share it, see{" "}
        <a href="#what-it-does-not-do">What it does not do</a> below.
      </p>

      <h2 id="quick-start-ioredis">Quick start (ioredis)</h2>
      <CodeBlock
        code={`import IORedis from "ioredis";
import { App, rateLimit } from "@daloyjs/core";
import {
  redisRateLimitStore,
  ioredisAdapter,
} from "@daloyjs/core/rate-limit-redis";

const redis = new IORedis(process.env.REDIS_URL!);

const app = new App();
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 120,
    store: redisRateLimitStore({ client: ioredisAdapter(redis) }),
    trustProxyHeaders: true,
  }),
);`}
      />

      <h2 id="quick-start-node-redis-v4">Quick start (node-redis v4+)</h2>
      <CodeBlock
        code={`import { createClient } from "redis";
import { App, rateLimit } from "@daloyjs/core";
import {
  redisRateLimitStore,
  nodeRedisAdapter,
} from "@daloyjs/core/rate-limit-redis";

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const app = new App();
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 120,
    store: redisRateLimitStore({ client: nodeRedisAdapter(redis) }),
  }),
);`}
      />

      <h2 id="how-clients-are-keyed">How clients are keyed</h2>
      <p>
        This is the part people get wrong. By default <code>rateLimit()</code>{" "}
        derives a single shared key, <code>global</code>
        {", "}so <strong>every caller lands in one bucket</strong> (the Redis
        key is <code>daloy:rl:global</code>). That is a deliberate safe default:
        DaloyJS will not key off a spoofable client IP unless you tell it to. To
        limit <em>per client</em> you have to opt in.
      </p>
      <ul>
        <li>
          Per authenticated user (preferred): pass a <code>keyGenerator</code>{" "}
          that returns a stable id.
        </li>
        <li>
          Per source IP
          {": "}set <code>trustProxyHeaders: true</code> <em>only</em> when you
          run behind a trusted proxy or load balancer that <em>overwrites</em>{" "}
          <code>X-Forwarded-For</code>
          {". "}The key is then the first <code>X-Forwarded-For</code> entry (or{" "}
          <code>X-Real-IP</code>), and falls back to <code>global</code> when
          neither is present.
        </li>
      </ul>
      <CodeBlock
        code={`app.use(
  rateLimit({
    windowMs: 60_000,
    max: 120,
    store: redisRateLimitStore({ client: ioredisAdapter(redis) }),
    // Per-user bucket; fall back to a single anonymous bucket otherwise.
    keyGenerator: (ctx) => (ctx.state.user as { id?: string })?.id ?? "anonymous",
  }),
);`}
      />
      <blockquote>
        <strong>Security:</strong> never set{" "}
        <code>trustProxyHeaders: true</code> on a service reachable directly. A
        client can send any <code>X-Forwarded-For</code> it likes, mint a fresh
        bucket per spoofed IP, and walk straight past the limit. Behind a proxy
        that rewrites the header it is safe; exposed directly it is an evasion
        hole. When in doubt, key off the authenticated user instead.
      </blockquote>
      <p>
        For credential-entry routes, register <code>loginThrottle()</code> (or
        an IP/raw-header keyed <code>rateLimit()</code>) before authentication
        so failed credentials consume the budget before the body is read. Keep a
        per-authenticated-user limiter after auth when its key depends on{" "}
        <code>ctx.state.user</code>.
      </p>

      <h2 id="failure-mode">Failure mode</h2>
      <p>
        By default the store is <strong>fail-open</strong>
        {": "}if Redis throws (network blip, restart), the request is treated as
        if it were the only one in the window. That keeps your API available
        during a Redis outage at the cost of temporarily losing the limit.
      </p>
      <p>
        Pass <code>onError</code> to change the behavior: return{" "}
        <code>&quot;fail-closed&quot;</code> to surface the error and reject the
        request, or hook the error into your structured logger:
      </p>
      <CodeBlock
        code={`// logger here is your app's structured logger (e.g. createLogger()).
redisRateLimitStore({
  client: ioredisAdapter(redis),
  onError: (err) => {
    logger.error({ err }, "redis rate-limit store failed");
    return process.env.NODE_ENV === "production" ? "fail-closed" : "fail-open";
  },
});`}
      />

      <blockquote>
        <strong>Fail-open only works if your Redis client fails fast.</strong> A
        bare <code>new IORedis(url)</code> queues commands and retries while
        disconnected, so during an outage a request blocks for{" "}
        <em>tens of seconds</em> (until the client&apos;s retry budget, then the
        app&apos;s <code>requestTimeoutMs</code>
        {", "}give up) before it ever reaches <code>onError</code>
        {". "}That is neither fast-open nor fast-closed, just slow, and it will
        exhaust your connections under load. Construct the client to give up
        quickly:
      </blockquote>
      <CodeBlock
        code={`// ioredis: fail fast so the store can fall back immediately
const redis = new IORedis(process.env.REDIS_URL!, {
  enableOfflineQueue: false,   // don't queue commands while disconnected
  maxRetriesPerRequest: 1,     // give up after a single retry
  connectTimeout: 500,
});

// node-redis equivalent
const redis = createClient({
  url: process.env.REDIS_URL,
  disableOfflineQueue: true,
  socket: { connectTimeout: 500, reconnectStrategy: (n) => Math.min(n * 50, 500) },
});`}
      />
      <p>
        With those options a Redis outage resolves in milliseconds: fail-open
        allows the request immediately, fail-closed rejects it with a{" "}
        <code>500</code> immediately. Without them you get the same decision
        eventually, just after a long stall on every request.
      </p>

      <h2 id="custom-redis-clients">Custom Redis clients</h2>
      <p>
        The store talks to Redis through a tiny contract: a single{" "}
        <code>eval()</code> method. Anything that can run a Lua script can be
        wrapped in a few lines:
      </p>
      <CodeBlock
        code={`import type { RedisCommands } from "@daloyjs/core/rate-limit-redis";

const myAdapter: RedisCommands = {
  eval: (script, keys, args) => myClient.runLua(script, keys, args),
};`}
      />

      <h2 id="key-namespacing">Key namespacing</h2>
      <p>
        Every key is prefixed with <code>daloy:rl:</code> by default. Override{" "}
        <code>prefix</code> per app or environment to avoid collisions on a
        shared Redis:
      </p>
      <CodeBlock
        code={`redisRateLimitStore({
  client: ioredisAdapter(redis),
  prefix: "myapp:prod:rl:",
});`}
      />

      <h2 id="what-it-does-not-do">What it does not do</h2>
      <ul>
        <li>
          It does not pool connections for you. Reuse a single client across
          requests; do not create one per call.
        </li>
        <li>
          It does not synchronize clocks. The reset timestamp returned to
          clients is computed from the local time plus the Redis-reported TTL,
          which is good enough for <code>Retry-After</code> but not for
          fine-grained billing.
        </li>
        <li>
          It does not implement sliding windows. The semantics match the
          in-process store: a fixed window of <code>windowMs</code> with
          token-bucket-style counting.
        </li>
      </ul>
    </>
  );
}
