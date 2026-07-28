/**
 * Per-route / per-client concurrency limiting with bounded FIFO queueing.
 *
 * Where the Node adapter's `maxConnections` caps *sockets* at accept time and
 * `loadShedding()` rejects traffic under *process* pressure, {@link concurrencyLimit}
 * bounds the number of requests **in flight through a given surface** — the
 * in-app equivalent of HAProxy's `maxconn` + request queue. Each request tries
 * to acquire a slot from a semaphore; if all slots are busy it waits in a
 * bounded FIFO queue (up to {@link ConcurrencyLimitOptions.maxQueue}) for up to
 * {@link ConcurrencyLimitOptions.queueTimeoutMs}, and is rejected with a fast
 * `503 Service Unavailable` (+ `Retry-After`) once the queue is full or the
 * wait times out. The slot is released when the response is finalized.
 *
 * The limiter can be partitioned with {@link ConcurrencyLimitOptions.scope}:
 *
 * - `"global"` (default) — one shared budget across the whole mount.
 * - `"route"` — a separate budget per `method + path`, so a single hot endpoint
 *   can't starve the others mounted under the same guard.
 * - `"client"` — a separate budget per client identity (requires
 *   {@link ConcurrencyLimitOptions.trustProxyHeaders} or a
 *   {@link ConcurrencyLimitOptions.keyGenerator}); a heavy client can't consume
 *   everyone else's slots.
 * - a custom function — return a bucket key, or `undefined` to skip limiting
 *   for that request (fail-open).
 *
 * The middleware is dependency-free and runtime-portable: it acquires in
 * {@link "./types.js".Hooks.beforeHandle} and releases in
 * {@link "./types.js".Hooks.onSend}, which the framework runs on the success,
 * error, and short-circuit response paths alike, so a slot is never leaked.
 *
 * @example
 * ```ts
 * import { App, concurrencyLimit } from "@daloyjs/core";
 *
 * const app = new App();
 * // At most 100 in flight per route, queue up to 50 more, wait at most 2s.
 * app.use(concurrencyLimit({
 *   maxConcurrent: 100,
 *   maxQueue: 50,
 *   queueTimeoutMs: 2000,
 *   scope: "route",
 * }));
 * ```
 *
 * @module
 * @since 0.37.0
 */

import type { BaseContext, Hooks } from "./types.js";
import { HttpError } from "./errors.js";
import { assertTrustedHops, resolveForwardedClientIp } from "./conn-info.js";

/**
 * Details of a request rejected by {@link concurrencyLimit}, passed to
 * {@link ConcurrencyLimitOptions.onReject}.
 *
 * @since 0.37.0
 */
export interface ConcurrencyRejection {
  /** The bucket key whose budget was exhausted. */
  key: string;
  /** Why the request was rejected. */
  reason: "queue-full" | "queue-timeout";
  /** In-flight requests for the bucket at rejection time. */
  active: number;
  /** Requests already waiting in the bucket's queue at rejection time. */
  queued: number;
}

/**
 * Configuration for {@link concurrencyLimit}.
 *
 * @since 0.37.0
 */
export interface ConcurrencyLimitOptions {
  /**
   * Maximum number of requests allowed in flight per bucket at once. Required,
   * positive integer. Additional requests queue (up to {@link maxQueue}) or are
   * rejected with `503`.
   */
  maxConcurrent: number;
  /**
   * Maximum number of requests allowed to wait in a bucket's FIFO queue while
   * all slots are busy. Default `0` (no queue — overflow is rejected
   * immediately). A waiting request is admitted in arrival order as slots free.
   */
  maxQueue?: number;
  /**
   * Maximum time, in ms, a request may wait in the queue before being rejected
   * with `503`. Default `0`, which means "wait indefinitely" — only meaningful
   * when {@link maxQueue} `> 0`. Set a finite value to bound tail latency.
   */
  queueTimeoutMs?: number;
  /**
   * How to partition the concurrency budget. `"global"` (default) shares one
   * budget; `"route"` keys by `method + path`; `"client"` keys by client
   * identity (needs {@link trustProxyHeaders} or {@link keyGenerator}); a
   * function returns a custom bucket key (or `undefined` to skip limiting).
   */
  scope?: "global" | "route" | "client" | ((ctx: BaseContext<any, any>) => string | undefined);
  /**
   * Read `X-Forwarded-For` / `X-Real-IP` when `scope: "client"`. Off by default
   * because those headers are client-spoofable unless every request reaches the
   * app through a proxy chain you control.
   *
   * When enabled, the key is the **rightmost** `X-Forwarded-For` entry — the
   * one your immediate proxy appended — never the attacker-influenceable
   * leftmost one. Behind more than one proxy hop, set {@link trustedHops}
   * instead.
   */
  trustProxyHeaders?: boolean;
  /**
   * Declare exactly how many proxy hops sit between Daloy and the public
   * internet when `scope: "client"`. Implies proxy-header trust and reads the
   * client IP that many entries from the right of `X-Forwarded-For` via
   * {@link "./conn-info.js".resolveForwardedClientIp}, so attacker-prepended
   * entries on the left cannot hop buckets to hoard slots. Must be an integer
   * in [1, 64]; validated at construction.
   */
  trustedHops?: number;
  /**
   * Custom client-identity resolver for `scope: "client"`. Overrides
   * {@link trustProxyHeaders}. Returning `undefined` skips limiting for the
   * request (fail-open).
   */
  keyGenerator?: (ctx: BaseContext<any, any>) => string | undefined;
  /** `Retry-After` seconds on the `503` rejection. Default `1`. `0` omits the header. */
  retryAfterSeconds?: number;
  /** `detail` for the `503` problem+json. Default `"Concurrency limit exceeded"`. */
  message?: string;
  /** Called when a request is rejected (queue full or wait timed out). */
  onReject?: (rejection: ConcurrencyRejection) => void;
}

/** One waiter parked in a bucket's FIFO queue. */
interface Waiter {
  resolve: () => void;
  reject: (err: unknown) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** Per-bucket semaphore + FIFO wait queue. */
interface Bucket {
  active: number;
  queue: Waiter[];
}

const DEFAULT_MESSAGE = "Concurrency limit exceeded";

/** Monotonic id so multiple mounted limiters use distinct per-request state slots. */
let instanceCounter = 0;

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`concurrencyLimit(): ${name} must be a positive integer.`);
  }
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`concurrencyLimit(): ${name} must be a non-negative integer.`);
  }
}

/**
 * @internal Default identity resolver: the client IP `hops` entries from the
 * right of `X-Forwarded-For` (falling back to `X-Real-IP`) — the
 * spoof-resistant side of the header; see {@link resolveForwardedClientIp}.
 */
function forwardedKey(hops: number) {
  return (ctx: BaseContext<any, any>): string | undefined =>
    resolveForwardedClientIp(ctx.request, hops);
}

/** Extract just the pathname from a request URL without a full `URL` parse where possible. */
function pathnameOf(url: string): string {
  const schemeEnd = url.indexOf("://");
  if (schemeEnd === -1) {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  }
  const pathStart = url.indexOf("/", schemeEnd + 3);
  if (pathStart === -1) return "/";
  let end = url.length;
  const q = url.indexOf("?", pathStart);
  if (q !== -1) end = q;
  const h = url.indexOf("#", pathStart);
  if (h !== -1 && h < end) end = h;
  return url.slice(pathStart, end);
}

/**
 * Build the per-request bucket-key resolver for the configured {@link ConcurrencyLimitOptions.scope}.
 *
 * @internal
 */
function buildScopeResolver(
  opts: ConcurrencyLimitOptions
): (ctx: BaseContext<any, any>) => string | undefined {
  const scope = opts.scope ?? "global";
  if (typeof scope === "function") return scope;
  if (scope === "global") return () => "global";
  if (scope === "route") {
    return (ctx) => `${ctx.request.method} ${pathnameOf(ctx.request.url)}`;
  }
  // scope === "client"
  if (!opts.keyGenerator && !opts.trustProxyHeaders && opts.trustedHops === undefined) {
    throw new Error(
      'concurrencyLimit(): scope "client" requires keyGenerator, trustedHops, or trustProxyHeaders so ' +
        "clients can be identified; otherwise every caller shares one bucket."
    );
  }
  assertTrustedHops("concurrencyLimit()", opts.trustedHops);
  const resolve = opts.keyGenerator ?? forwardedKey(opts.trustedHops ?? 1);
  return (ctx) => {
    const id = resolve(ctx);
    return id === undefined ? undefined : `client:${id}`;
  };
}

/**
 * Bound the number of in-flight requests per route and/or per client with a
 * bounded FIFO queue and a fast `503`, the in-app equivalent of HAProxy's
 * `maxconn` + request queue. Complements the global `maxConnections` socket cap
 * and `loadShedding()` process-pressure shedding.
 *
 * A request acquires a slot in `beforeHandle`; if the bucket is saturated it
 * waits in a bounded FIFO queue (subject to {@link ConcurrencyLimitOptions.maxQueue}
 * and {@link ConcurrencyLimitOptions.queueTimeoutMs}) and is rejected with `503`
 * when the queue is full or the wait times out. The slot is released on the
 * response path (`onSend`), so it is freed for success, error, and
 * short-circuit responses alike.
 *
 * @param opts - Concurrency-limit configuration; `maxConcurrent` is required.
 * @returns A {@link Hooks} bundle ready for `app.use(...)`.
 * @throws Error when `maxConcurrent` is not a positive integer, `maxQueue` /
 *   `queueTimeoutMs` / `retryAfterSeconds` are out of range, or `scope: "client"`
 *   is used without an identity source.
 * @since 0.37.0
 */
export function concurrencyLimit(opts: ConcurrencyLimitOptions): Hooks {
  assertPositiveInteger("maxConcurrent", opts.maxConcurrent);
  const maxConcurrent = opts.maxConcurrent;

  const maxQueue = opts.maxQueue ?? 0;
  assertNonNegativeInteger("maxQueue", maxQueue);

  const queueTimeoutMs = opts.queueTimeoutMs ?? 0;
  assertNonNegativeInteger("queueTimeoutMs", queueTimeoutMs);

  const retryAfterSeconds = opts.retryAfterSeconds ?? 1;
  assertNonNegativeInteger("retryAfterSeconds", retryAfterSeconds);

  const message = opts.message ?? DEFAULT_MESSAGE;
  const resolveKey = buildScopeResolver(opts);

  const buckets = new Map<string, Bucket>();
  // Unique per-request state slots so multiple concurrencyLimit() mounts on the
  // same group don't clobber each other's acquired-flag / bucket-key bookkeeping.
  const id = instanceCounter++;
  const ACQUIRED_KEY = `__concurrencyAcquired_${id}`;
  const BUCKET_KEY = `__concurrencyBucket_${id}`;

  const reject503 = (rejection: ConcurrencyRejection): never => {
    opts.onReject?.(rejection);
    const headers =
      retryAfterSeconds > 0 ? { "retry-after": String(retryAfterSeconds) } : undefined;
    throw new HttpError(
      503,
      {
        type: "https://daloyjs.dev/errors/concurrency-limit",
        title: "Service Unavailable",
        detail: message,
      },
      headers
    );
  };

  const getBucket = (key: string): Bucket => {
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { active: 0, queue: [] };
      buckets.set(key, bucket);
    }
    return bucket;
  };

  /** Release a slot back to a bucket: hand it to the next waiter, or free it. */
  const release = (key: string): void => {
    const bucket = buckets.get(key);
    if (!bucket) return;
    const next = bucket.queue.shift();
    if (next) {
      if (next.timer !== undefined) clearTimeout(next.timer);
      next.resolve();
      return;
    }
    bucket.active--;
    // Reclaim empty buckets so per-client / per-route keys don't leak memory.
    if (bucket.active <= 0 && bucket.queue.length === 0) {
      bucket.active = 0;
      buckets.delete(key);
    }
  };

  return {
    async beforeHandle(ctx) {
      const key = resolveKey(ctx);
      if (key === undefined) return undefined; // fail-open: not subject to limiting

      const bucket = getBucket(key);
      if (bucket.active < maxConcurrent) {
        bucket.active++;
      } else if (maxQueue > 0 && bucket.queue.length < maxQueue) {
        await new Promise<void>((resolve, reject) => {
          const waiter: Waiter = { resolve, reject, timer: undefined };
          if (queueTimeoutMs > 0) {
            waiter.timer = setTimeout(() => {
              const idx = bucket.queue.indexOf(waiter);
              if (idx !== -1) bucket.queue.splice(idx, 1);
              try {
                reject503({
                  key,
                  reason: "queue-timeout",
                  active: bucket.active,
                  queued: bucket.queue.length,
                });
              } catch (err) {
                reject(err);
              }
            }, queueTimeoutMs);
            const timer = waiter.timer as unknown as { unref?: () => void };
            if (typeof timer.unref === "function") timer.unref();
          }
          bucket.queue.push(waiter);
        });
        // Admitted from the queue: the releaser left `active` unchanged for us.
      } else {
        reject503({
          key,
          reason: "queue-full",
          active: bucket.active,
          queued: bucket.queue.length,
        });
      }

      const state = ctx.state as Record<string, unknown>;
      state[ACQUIRED_KEY] = true;
      state[BUCKET_KEY] = key;
      return undefined;
    },
    onSend(_res, ctx) {
      if (!ctx) return undefined;
      const state = ctx.state as Record<string, unknown>;
      if (state[ACQUIRED_KEY] !== true) return undefined;
      // Guard against a double release if onSend somehow runs twice.
      state[ACQUIRED_KEY] = false;
      const key = state[BUCKET_KEY];
      if (typeof key === "string") release(key);
      return undefined;
    },
  };
}
