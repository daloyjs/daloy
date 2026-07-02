/**
 * `loadShedding()` primitive.
 *
 * Lightweight Node-process pressure monitor that returns `Hooks` for
 * `app.use(...)`. When any of the configured thresholds is exceeded,
 * every incoming request is short-circuited with `503 Service Unavailable`
 * carrying a `Retry-After` header. First-party answer to
 * `@fastify/under-pressure`. Defaults are off for heap/RSS thresholds
 * (deployment-specific) and conservative for everything else (event-loop
 * delay at 1 s, event-loop utilization at 0.98). The monitor samples at
 * `sampleIntervalMs` (default 1 s). Graceful no-op on runtimes without
 * `node:perf_hooks` (Workers / Edge / Fastly Compute).
 *
 * @since 0.20.0
 */

import type { Hooks } from "./types.js";
import { HttpError } from "./errors.js";

/** Configuration accepted by {@link loadShedding}. Every field is optional. */
export interface LoadSheddingOptions {
  /** Max tolerated event-loop delay (ms). Default `1000`. `0` disables. */
  maxEventLoopDelayMs?: number;
  /** Max tolerated `heapUsed` bytes. Off by default. */
  maxHeapUsedBytes?: number;
  /** Max tolerated `rss` bytes. Off by default. */
  maxRssBytes?: number;
  /** Max tolerated event-loop utilization (`[0, 1]`). Default `0.98`. `0` disables. */
  maxEventLoopUtilization?: number;
  /** Sampling interval (ms). Default `1000`; clamped to at least `100`. */
  sampleIntervalMs?: number;
  /** `Retry-After` seconds on the shedded `503`. Default `10`. */
  retryAfterSeconds?: number;
  /** Optional custom check; truthy return value becomes a shed reason. */
  healthCheck?: () => string | undefined | Promise<string | undefined>;
  /** Interval for `healthCheck` (ms). Defaults to `sampleIntervalMs`. */
  healthCheckIntervalMs?: number;
}

/**
 * Snapshot returned by the internal pressure sampler. Exposed for tests.
 *
 * @internal
 */
export interface LoadSheddingSnapshot {
  /** Sampled event-loop delay in milliseconds. */
  eventLoopDelayMs: number;
  /** Sampled `heapUsed` in bytes. */
  heapUsedBytes: number;
  /** Sampled resident set size (`rss`) in bytes. */
  rssBytes: number;
  /** Sampled event-loop utilization in the range `[0, 1]`. */
  eventLoopUtilization: number;
  /** Reason the request was shed, when a threshold is exceeded. */
  reason?: string;
}

type EventLoopUtilization = { idle: number; active: number; utilization: number };

interface PerfHooksAPI {
  monitorEventLoopDelay?: (options?: { resolution?: number }) => { enable(): void; disable(): void; reset(): void; mean: number };
  performance?: { eventLoopUtilization?: (prev?: EventLoopUtilization) => EventLoopUtilization };
}

async function tryLoadPerfHooks(): Promise<PerfHooksAPI | undefined> {
  try {
    return (await import("node:perf_hooks")) as unknown as PerfHooksAPI;
  } catch {
    return undefined;
  }
}

/**
 * Build a Hooks bundle that refuses requests with `503` when the configured
 * process-pressure thresholds are exceeded.
 *
 * @example
 * ```ts
 * import { App, loadShedding } from "@daloyjs/core";
 *
 * const app = new App();
 * app.use(loadShedding({
 *   maxEventLoopDelayMs: 500,
 *   maxHeapUsedBytes: 1.5 * 1024 ** 3,
 *   retryAfterSeconds: 5,
 * }));
 * ```
 *
 * @param opts - Pressure thresholds (event-loop delay default 1000 ms, ELU default 0.98, optional heap/RSS byte caps), sampling interval, `Retry-After` seconds, and an optional custom `healthCheck`.
 * @returns A {@link Hooks} bundle that sheds requests with `503` + `Retry-After` while pressure thresholds are exceeded.
 */
export function loadShedding(opts: LoadSheddingOptions = {}): Hooks {
  const maxDelay = opts.maxEventLoopDelayMs ?? 1000;
  const maxHeap = opts.maxHeapUsedBytes;
  const maxRss = opts.maxRssBytes;
  const maxELU = opts.maxEventLoopUtilization ?? 0.98;
  const sampleMs = Math.max(100, opts.sampleIntervalMs ?? 1000);
  const retryAfter = opts.retryAfterSeconds ?? 10;
  const healthCheckMs = Math.max(
    100,
    opts.healthCheckIntervalMs ?? sampleMs,
  );

  const snapshot: LoadSheddingSnapshot = {
    eventLoopDelayMs: 0,
    heapUsedBytes: 0,
    rssBytes: 0,
    eventLoopUtilization: 0,
  };

  let perf: PerfHooksAPI | undefined;
  let histogram: ReturnType<NonNullable<PerfHooksAPI["monitorEventLoopDelay"]>> | undefined;
  let lastELU: { idle: number; active: number; utilization: number } | undefined;
  let lastSample = 0;
  let lastHealth = 0;
  let perfPromise: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;

  const procRef =
    typeof process !== "undefined" ? (process as NodeJS.Process) : undefined;

  const ensurePerf = (): Promise<void> => {
    if (perfPromise) return perfPromise;
    perfPromise = (async () => {
      perf = await tryLoadPerfHooks();
      if (perf?.monitorEventLoopDelay && maxDelay > 0) {
        histogram = perf.monitorEventLoopDelay({ resolution: 20 });
        histogram.enable();
        // Make sure the histogram does not pin the event loop alive.
        const unref = (histogram as unknown as { unref?: () => void }).unref;
        if (typeof unref === "function") unref.call(histogram);
      }
      if (perf?.performance?.eventLoopUtilization) {
        lastELU = perf.performance.eventLoopUtilization();
      }
    })();
    return perfPromise;
  };

  const refreshSnapshot = (): void => {
    if (histogram) {
      // mean is in nanoseconds; convert to ms.
      snapshot.eventLoopDelayMs = histogram.mean / 1e6;
      histogram.reset();
    }
    if (perf?.performance?.eventLoopUtilization && lastELU) {
      const next = perf.performance.eventLoopUtilization(lastELU);
      snapshot.eventLoopUtilization = next.utilization;
      lastELU = perf.performance.eventLoopUtilization();
    }
    if (procRef?.memoryUsage) {
      const mem = procRef.memoryUsage();
      snapshot.heapUsedBytes = mem.heapUsed;
      snapshot.rssBytes = mem.rss;
    }
  };

  const reasonFor = (): string | undefined => {
    if (maxDelay > 0 && snapshot.eventLoopDelayMs > maxDelay) {
      return `event-loop delay ${snapshot.eventLoopDelayMs.toFixed(0)}ms > ${maxDelay}ms`;
    }
    if (maxHeap !== undefined && snapshot.heapUsedBytes > maxHeap) {
      return `heap used ${snapshot.heapUsedBytes} > ${maxHeap}`;
    }
    if (maxRss !== undefined && snapshot.rssBytes > maxRss) {
      return `rss ${snapshot.rssBytes} > ${maxRss}`;
    }
    if (maxELU > 0 && snapshot.eventLoopUtilization > maxELU) {
      return `event-loop utilization ${snapshot.eventLoopUtilization.toFixed(3)} > ${maxELU}`;
    }
    if (snapshot.reason) return snapshot.reason;
    return undefined;
  };

  const startTimer = (): void => {
    if (timer || stopped) return;
    if (typeof setInterval !== "function") return;
    timer = setInterval(() => {
      refreshSnapshot();
    }, sampleMs);
    const unref = (timer as unknown as { unref?: () => void }).unref;
    if (typeof unref === "function") unref.call(timer);
  };

  const maybeSample = async (): Promise<void> => {
    await ensurePerf();
    const now = Date.now();
    if (now - lastSample >= sampleMs) {
      lastSample = now;
      refreshSnapshot();
      startTimer();
    }
    if (opts.healthCheck && now - lastHealth >= healthCheckMs) {
      lastHealth = now;
      try {
        const reason = await opts.healthCheck();
        snapshot.reason = reason || undefined;
      } catch (err) {
        snapshot.reason =
          err instanceof Error ? `healthCheck threw: ${err.message}` : "healthCheck threw";
      }
    }
  };

  return {
    async beforeHandle() {
      await maybeSample();
      const reason = reasonFor();
      if (!reason) return undefined;
      throw new HttpError(
        503,
        {
          type: "https://daloyjs.dev/errors/load-shed",
          title: "Service Unavailable",
          detail: `Load shedding: ${reason}`,
        },
        { "retry-after": String(retryAfter) },
      );
    },
  };
}

/**
 * Read-only accessor for tests + observability plugins that want to know
 * what the latest pressure sample looked like. Returns `undefined` if the
 * given hooks object was not produced by {@link loadShedding}.
 *
 * @internal
 */
export const LOAD_SHEDDING_MARKER: unique symbol = Symbol.for(
  "daloyjs.loadShedding",
);
