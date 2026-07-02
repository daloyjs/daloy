/**
 * Redis-backed {@link RateLimitStore} for {@link rateLimit}.
 *
 * The default in-process `MemoryStore` is per-instance and therefore unsafe
 * behind more than one server replica. This store keeps the same token-bucket
 * semantics (fixed window of `windowMs`) but stores the counter in Redis so
 * every replica observes the same value.
 *
 * We avoid taking a hard dependency on any specific Redis client. Instead the
 * store accepts a tiny {@link RedisCommands} contract: a single `eval`
 * method. It also ships small adapters for the two most common clients
 * ({@link ioredisAdapter}, {@link nodeRedisAdapter}). That keeps installs
 * lightweight and means new clients can be plugged in with ~5 lines of glue
 * code, which matches DaloyJS's "no magic, no global patching" rule.
 *
 * @example Using ioredis
 * ```ts
 * import IORedis from "ioredis";
 * import { rateLimit } from "@daloyjs/core";
 * import { redisRateLimitStore, ioredisAdapter } from "@daloyjs/core/rate-limit-redis";
 *
 * const redis = new IORedis(process.env.REDIS_URL!);
 * app.use(rateLimit({
 *   windowMs: 60_000,
 *   max: 120,
 *   store: redisRateLimitStore({ client: ioredisAdapter(redis) }),
 * }));
 * ```
 *
 * @example Using node-redis v4+
 * ```ts
 * import { createClient } from "redis";
 * import { redisRateLimitStore, nodeRedisAdapter } from "@daloyjs/core/rate-limit-redis";
 *
 * const redis = createClient({ url: process.env.REDIS_URL });
 * await redis.connect();
 * app.use(rateLimit({
 *   windowMs: 60_000,
 *   max: 120,
 *   store: redisRateLimitStore({ client: nodeRedisAdapter(redis) }),
 * }));
 * ```
 */

import type { RateLimitStore } from "./middleware.js";

/**
 * Minimal Redis transport contract used by {@link redisRateLimitStore}.
 *
 * `eval` must execute the supplied Lua script atomically on the server and
 * return whatever Redis returns. Returning the array `[count, ttlMs]` is
 * required by the bundled script.
 */
export interface RedisCommands {
  /** Run a Lua script atomically with the given `KEYS` / `ARGV` and return the raw Redis reply. */
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}

/** Options accepted by {@link redisRateLimitStore}. */
export interface RedisRateLimitStoreOptions {
  /** Redis transport (see {@link ioredisAdapter} / {@link nodeRedisAdapter} for common clients). */
  client: RedisCommands;
  /**
   * Optional namespace prefix for every Redis key. Defaults to `"daloy:rl:"`.
   * Use a unique prefix per app/environment to avoid key collisions on a
   * shared Redis.
   */
  prefix?: string;
  /**
  * Called when the underlying Redis call throws. The default behavior is
  * fail-open, which allows the request and reports it as the first hit in a
  * fresh local window. Override to fail-closed or to wire into your
  * structured logger.
   */
  onError?: (err: unknown) => "fail-open" | "fail-closed";
}

/**
 * Atomic INCR + PEXPIRE script.
 *
 * Returns `{count, ttlMs}` so the caller can compute `resetMs` without a
 * second round trip. We set the TTL only on the very first INCR so a busy
 * key keeps its original window and is not perpetually extended.
 */
const SCRIPT = `local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  return {current, tonumber(ARGV[1])}
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {current, ttl}`;

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Build a {@link RateLimitStore} that persists counters in Redis.
 *
 * The returned store is safe to share between requests and replicas. Errors
 * from Redis are fail-open by default (see {@link RedisRateLimitStoreOptions.onError});
 * pass a custom handler to fail-closed (return `"fail-closed"`).
 *
 * @remarks
 * Security: the default fail-open posture biases toward availability — while
 * Redis is unreachable the limiter stops enforcing and every request is
 * allowed (reported as the first hit of a fresh local window). For
 * abuse-sensitive limiters in front of auth, password-reset, or other
 * credential endpoints, pass `onError: () => "fail-closed"` so a Redis
 * outage rejects rather than silently disables the limit.
 *
 * @param opts - Redis client, key prefix, and error policy; see
 *   {@link RedisRateLimitStoreOptions}.
 * @returns A {@link RateLimitStore} whose `hit()` atomically increments the
 *   windowed counter in Redis and reports `{ count, resetMs }`.
 */
export function redisRateLimitStore(opts: RedisRateLimitStoreOptions): RateLimitStore {
  const prefix = opts.prefix ?? "daloy:rl:";
  const onError = opts.onError;
  return {
    async hit(key: string, windowMs: number) {
      const fullKey = prefix + key;
      try {
        const result = (await opts.client.eval(SCRIPT, [fullKey], [String(windowMs)])) as
          | [unknown, unknown]
          | readonly unknown[];
        const count = toNumber(result?.[0]);
        const ttl = toNumber(result?.[1]);
        return { count, resetMs: Date.now() + ttl };
      } catch (err) {
        const decision = onError ? onError(err) : "fail-open";
        if (decision === "fail-closed") throw err;
        return { count: 1, resetMs: Date.now() + windowMs };
      }
    },
  };
}

// ---------- Client adapters ----------

/**
 * Shape of an `ioredis` client we care about. Only the `eval` overload that
 * takes `(script, numKeys, ...keysAndArgs)` is used.
 */
export interface IoredisLike {
  /** ioredis-style `EVAL`: script, number of keys, then keys and args flattened. */
  eval(script: string, numKeys: number, ...keysAndArgs: string[]): Promise<unknown>;
}

/**
 * Wrap an [`ioredis`](https://github.com/redis/ioredis) client.
 *
 * @param client - Connected ioredis instance (only its `eval` is used).
 * @returns A {@link RedisCommands} transport for {@link redisRateLimitStore}.
 */
export function ioredisAdapter(client: IoredisLike): RedisCommands {
  return {
    eval(script, keys, args) {
      return client.eval(script, keys.length, ...keys, ...args);
    },
  };
}

/**
 * Shape of a `node-redis` v4+ client we care about. The v4 `eval` takes an
 * options object instead of variadic arguments.
 */
export interface NodeRedisLike {
  /** node-redis v4+ `EVAL`: script plus a `{ keys, arguments }` options object. */
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] }
  ): Promise<unknown>;
}

/**
 * Wrap a [`node-redis`](https://github.com/redis/node-redis) v4+ client.
 *
 * @param client - Connected node-redis v4+ instance (only its `eval` is used).
 * @returns A {@link RedisCommands} transport for {@link redisRateLimitStore}.
 */
export function nodeRedisAdapter(client: NodeRedisLike): RedisCommands {
  return {
    eval(script, keys, args) {
      return client.eval(script, { keys, arguments: args });
    },
  };
}
