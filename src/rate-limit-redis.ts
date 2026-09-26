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
import type {
  AutoBanRecord,
  AutoBanStore,
  AutoBanStrikePolicy,
  AutoBanStrikeResult,
} from "./auto-ban.js";

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
          [unknown, unknown] | readonly unknown[];
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

// ---------- autoBan store ----------

/** Options accepted by {@link redisAutoBanStore}. */
export interface RedisAutoBanStoreOptions {
  /** Redis transport (see {@link ioredisAdapter} / {@link nodeRedisAdapter}). */
  client: RedisCommands;
  /** Namespace prefix for every Redis key. Defaults to `"daloy:ab:"`. */
  prefix?: string;
}

// Each script starts with a marker comment so test fakes can dispatch on it.
const AB_GET = `-- daloy:autoban:get
return redis.call('HMGET', KEYS[1], 's', 'se', 'bu', 'bc')`;

const AB_SET = `-- daloy:autoban:set
redis.call('HSET', KEYS[1], 's', ARGV[1], 'se', ARGV[2], 'bu', ARGV[3], 'bc', ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return 1`;

const AB_DEL = `-- daloy:autoban:del
redis.call('DEL', KEYS[1])
return 1`;

/**
 * Atomic strike: a Lua port of `applyAutoBanStrike` (src/auto-ban.ts). Keep the
 * two in sync. ARGV: now, windowMs, maxStrikes, banMs, maxBanMs, escalate(0|1).
 * Returns {strikes, banned(0|1), banCount, banDurationMs, bannedUntilMs}.
 */
const AB_STRIKE = `-- daloy:autoban:strike
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local maxStrikes = tonumber(ARGV[3])
local banMs = tonumber(ARGV[4])
local maxBanMs = tonumber(ARGV[5])
local v = redis.call('HMGET', KEYS[1], 's', 'se', 'bu', 'bc')
local s = tonumber(v[1]) or 0
local se = tonumber(v[2]) or 0
local bu = tonumber(v[3]) or 0
local bc = tonumber(v[4]) or 0
if se <= now then s = 0 end
s = s + 1
local strikes = s
local banned = 0
local dur = 0
se = now + windowMs
if s >= maxStrikes then
  bc = bc + 1
  if ARGV[6] == '1' then
    dur = math.min(maxBanMs, banMs * (2 ^ (bc - 1)))
  else
    dur = banMs
  end
  bu = now + dur
  banned = 1
  s = 0
end
redis.call('HSET', KEYS[1], 's', string.format('%d', s), 'se', string.format('%d', se), 'bu', string.format('%d', bu), 'bc', string.format('%d', bc))
redis.call('PEXPIRE', KEYS[1], string.format('%d', math.max(1, math.max(se, bu) - now)))
return {strikes, banned, bc, dur, bu}`;

/**
 * Build a Redis-backed {@link AutoBanStore} for `autoBan()` whose
 * {@link AutoBanStore.strike} runs as a single Lua script, so concurrent
 * failures on any number of replicas cannot overwrite each other's strikes.
 *
 * Records are stored as a Redis hash (`s`, `se`, `bu`, `bc`) with a `PEXPIRE`
 * matching the record TTL. Requires Redis >= 4 (multi-field `HSET`).
 *
 * @remarks
 * Security: store errors propagate. `autoBan()` fails **closed** on a read error
 * during ban enforcement (the request errors) and, on a strike error, skips the
 * strike and reports it through `onStoreError` rather than failing the response.
 * The strike clock is the calling replica's `Date.now()`; keep replica clocks in
 * sync (NTP).
 *
 * @example
 * ```ts
 * import { autoBan } from "@daloyjs/core";
 * import { redisAutoBanStore, ioredisAdapter } from "@daloyjs/core/rate-limit-redis";
 *
 * app.use(autoBan({ trustedHops: 1, store: redisAutoBanStore({ client: ioredisAdapter(redis) }) }));
 * ```
 *
 * @param opts - Redis client and key prefix; see {@link RedisAutoBanStoreOptions}.
 * @returns An {@link AutoBanStore} implementing the atomic `strike()` method.
 * @since 1.3.7
 */
export function redisAutoBanStore(opts: RedisAutoBanStoreOptions): AutoBanStore {
  const prefix = opts.prefix ?? "daloy:ab:";
  const client = opts.client;
  return {
    async get(key: string): Promise<AutoBanRecord | undefined> {
      const v = (await client.eval(AB_GET, [prefix + key], [])) as readonly unknown[] | null;
      if (!v || v[0] === null || v[0] === undefined || v[0] === false) return undefined;
      return {
        strikes: toNumber(v[0]),
        strikeExpiresMs: toNumber(v[1]),
        bannedUntilMs: toNumber(v[2]),
        banCount: toNumber(v[3]),
      };
    },
    async set(key: string, record: AutoBanRecord, ttlMs: number): Promise<void> {
      await client.eval(
        AB_SET,
        [prefix + key],
        [
          String(Math.trunc(record.strikes)),
          String(Math.trunc(record.strikeExpiresMs)),
          String(Math.trunc(record.bannedUntilMs)),
          String(Math.trunc(record.banCount)),
          String(Math.max(1, Math.ceil(ttlMs))),
        ]
      );
    },
    async delete(key: string): Promise<void> {
      await client.eval(AB_DEL, [prefix + key], []);
    },
    async strike(
      key: string,
      policy: AutoBanStrikePolicy,
      nowMs: number
    ): Promise<AutoBanStrikeResult> {
      const r = (await client.eval(
        AB_STRIKE,
        [prefix + key],
        [
          String(Math.trunc(nowMs)),
          String(policy.windowMs),
          String(policy.maxStrikes),
          String(policy.banMs),
          String(policy.maxBanMs),
          policy.escalate ? "1" : "0",
        ]
      )) as readonly unknown[] | null;
      if (!Array.isArray(r) || r.length < 5) {
        throw new Error("redisAutoBanStore: unexpected strike reply from Redis");
      }
      return {
        strikes: toNumber(r[0]),
        banned: toNumber(r[1]) === 1,
        banCount: toNumber(r[2]),
        banDurationMs: toNumber(r[3]),
        bannedUntilMs: toNumber(r[4]),
      };
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
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
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
