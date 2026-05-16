import { CodeBlock } from "../../../../components/code-block";

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
      <p>
        The default <code>rateLimit()</code> middleware uses an in-process memory store. That is
        perfect for a single Node process but unsafe behind multiple replicas. Each instance keeps
        its own counter, so a client in practice gets <code>N * max</code> requests per window.
      </p>
      <p>
        DaloyJS ships an optional <strong>Redis-backed</strong> store at the
        {" "}
        <code>@daloyjs/core/rate-limit-redis</code> sub-export. Counters live in Redis and are
        updated atomically with a small Lua script (<code>INCR</code> + <code>PEXPIRE</code>),
        so every replica observes the same window without a hot key shootout.
      </p>

      <h2>Install your Redis client</h2>
      <p>
        DaloyJS does not bundle a Redis client. Pick whichever is already in your stack; there
        are first-class adapters for the two most common options.
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
        By default the store is <strong>fail-open</strong>: if Redis throws (network blip, restart),
        the request is treated as if it were the only one in the window. That keeps your API
        available during a Redis outage at the cost of temporarily losing the limit.
      </p>
      <p>
        Pass <code>onError</code> to change the behavior: return <code>&quot;fail-closed&quot;</code>
        {" "}to surface the error and reject the request, or hook the error into your structured logger:
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
        The store talks to Redis through a tiny contract: a single <code>eval()</code> method.
        Anything that can run a Lua script can be wrapped in a few lines:
      </p>
      <CodeBlock
        code={`import type { RedisCommands } from "@daloyjs/core/rate-limit-redis";

const myAdapter: RedisCommands = {
  eval: (script, keys, args) => myClient.runLua(script, keys, args),
};`}
      />

      <h2>Key namespacing</h2>
      <p>
        Every key is prefixed with <code>daloy:rl:</code> by default. Override <code>prefix</code>
        {" "}per app or environment to avoid collisions on a shared Redis:
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
          <strong>It does not pool connections for you.</strong> Reuse a single client across
          requests; do not create one per call.
        </li>
        <li>
          <strong>It does not synchronize clocks.</strong> The reset timestamp returned to clients
          is computed from the local time plus the Redis-reported TTL, which is good enough for
          {" "}<code>Retry-After</code> but not for fine-grained billing.
        </li>
        <li>
          <strong>It does not implement sliding windows.</strong> The semantics match the in-process
          store: a fixed window of <code>windowMs</code> with token-bucket-style counting.
        </li>
      </ul>
    </>
  );
}
