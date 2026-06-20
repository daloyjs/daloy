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
        <strong>Think of it like…</strong> moving the nightclub&apos;s clicker
        from one door to a shared headcount board every door reads from. With
        many doors (replicas) and a local clicker each, a guest can sneak in N
        times by trying every door. With a shared clicker (Redis), the cap is
        honoured everywhere, no matter which door they queue at.
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
            detail: "key = daloy:rl:<client>",
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

      <h2>When to use Redis (and when not to)</h2>
      <p>
        The Redis store is built for{" "}
        <strong>long-lived multi-replica deployments</strong>: VPS, containers,
        Kubernetes, Fly.io, Render, ECS, App Runner, Railway. Anywhere you run
        more than one Node / Bun / Deno process and need a shared counter so a
        client can&apos;t get <code>N&times;</code> the limit by load-balancing
        across replicas.
      </p>
      <p>
        On <strong>edge runtimes</strong> (Cloudflare Workers, Vercel Edge,
        Fastly Compute), prefer the platform&apos;s native primitive rather than
        fronting Redis from every region:
      </p>
      <ul>
        <li>
          <strong>Cloudflare Workers</strong>: Durable Objects (strongly
          consistent per-key), or KV / D1 for relaxed consistency.
        </li>
        <li>
          <strong>Vercel Edge</strong>: Vercel KV (Upstash Redis under the
          hood) is reachable from edge functions; for very high RPS prefer Edge
          Config + a Node region for the counter write path.
        </li>
        <li>
          <strong>Fastly Compute</strong>: Edge Dictionaries for static quotas,
          KV Store for dynamic counters.
        </li>
      </ul>
      <p>
        <code>rateLimit()</code> accepts any object implementing the{" "}
        <code>RateLimitStore</code> contract, so each of these platforms can be
        wired up in a few lines using the same middleware. The Redis adapter
        shown below is just the most common case.
      </p>

      <h2>Install your Redis client</h2>
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

      <h2>Quick start (ioredis)</h2>
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

      <h2>Quick start (node-redis v4+)</h2>
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

      <h2>Failure mode</h2>
      <p>
        By default the store is <strong>fail-open</strong>: if Redis throws
        (network blip, restart), the request is treated as if it were the only
        one in the window. That keeps your API available during a Redis outage
        at the cost of temporarily losing the limit.
      </p>
      <p>
        Pass <code>onError</code> to change the behavior: return{" "}
        <code>&quot;fail-closed&quot;</code> to surface the error and reject the
        request, or hook the error into your structured logger:
      </p>
      <CodeBlock
        code={`redisRateLimitStore({
  client: ioredisAdapter(redis),
  onError: (err) => {
    logger.error({ err }, "redis rate-limit store failed");
    return process.env.NODE_ENV === "production" ? "fail-closed" : "fail-open";
  },
});`}
      />

      <h2>Custom Redis clients</h2>
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

      <h2>Key namespacing</h2>
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

      <h2>What it does not do</h2>
      <ul>
        <li>
          <strong>It does not pool connections for you.</strong> Reuse a single
          client across requests; do not create one per call.
        </li>
        <li>
          <strong>It does not synchronize clocks.</strong> The reset timestamp
          returned to clients is computed from the local time plus the
          Redis-reported TTL, which is good enough for <code>Retry-After</code>{" "}
          but not for fine-grained billing.
        </li>
        <li>
          <strong>It does not implement sliding windows.</strong> The semantics
          match the in-process store: a fixed window of <code>windowMs</code>{" "}
          with token-bucket-style counting.
        </li>
      </ul>
    </>
  );
}
