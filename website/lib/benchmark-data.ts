/**
 * Cross-framework benchmark data for the landing-page charts.
 *
 * Every number here is copied verbatim from the repository's own benchmark
 * suite under `bench/cross-framework/lib/results*.json`. The runs were executed
 * on a single Apple M3 Max (16 cores, 64 GiB) under Node v25.7 in June 2026
 * against `@daloyjs/core` 1.0.0-beta.1. They are a point-in-time snapshot, not a
 * continuously updated leaderboard — see {@link BENCH_NOTES} for why these are
 * deliberately *not* an apples-to-apples comparison.
 */

/** Provenance shown alongside the charts so readers can reproduce the numbers. */
export const BENCH_META = {
  machine: "Apple M3 Max · 16 cores · Node v25.7",
  ranAt: "June 2026",
  coreVersion: "@daloyjs/core 1.0.0-beta.1",
  source: "bench/cross-framework",
} as const

/**
 * One framework's footprint for a metric, split into the two app shapes the
 * suite measures:
 * - `minimal` — the framework's bare "hello world" install.
 * - `secure` — "secure parity": the extra plugins (helmet/CORS/rate-limit/JWT
 *   equivalents) a real app needs to approach DaloyJS's secure-by-default
 *   posture. DaloyJS ships those defaults in-core, so its two bars are equal.
 */
export type FootprintRow = {
  /** Framework label as shown on the x-axis. */
  framework: string
  /** Value for the minimal install. */
  minimal: number
  /** Value for the secure-parity install. */
  secure: number
}

/**
 * Total on-disk install size in bytes (`node_modules` for that framework's
 * package set). Source: `results.install-size.json` → `totalBytes`.
 * Sorted ascending by the secure-parity size.
 */
export const INSTALL_FOOTPRINT_BYTES: FootprintRow[] = [
  { framework: "koa", minimal: 794585, secure: 1263699 },
  { framework: "hono", minimal: 1642345, secure: 1642345 },
  { framework: "elysia", minimal: 1458302, secure: 1867366 },
  { framework: "daloy", minimal: 2008237, secure: 2008237 },
  { framework: "express", minimal: 2027687, secure: 2874459 },
  { framework: "fastify", minimal: 7133620, secure: 8315670 },
  { framework: "nest", minimal: 13845732, secure: 17173856 },
]

/**
 * Transitive dependency count installed alongside each framework. Source:
 * `results.install-size.json` → `transitiveDepCount`. DaloyJS and Hono are the
 * only entries that pull in zero transitive dependencies.
 * Sorted ascending by the secure-parity count.
 */
export const DEPENDENCY_COUNT: FootprintRow[] = [
  { framework: "daloy", minimal: 0, secure: 0 },
  { framework: "hono", minimal: 0, secure: 0 },
  { framework: "elysia", minimal: 4, secure: 5 },
  { framework: "koa", minimal: 32, secure: 55 },
  { framework: "fastify", minimal: 42, secure: 57 },
  { framework: "express", minimal: 61, secure: 76 },
  { framework: "nest", minimal: 68, secure: 86 },
]

/**
 * Bundled-and-gzipped size in bytes (single-file build of a hello-world app).
 * Source: `results.bundle-size.json` → `gzipped`.
 * Sorted ascending by the secure-parity size.
 */
export const BUNDLE_GZIP_BYTES: FootprintRow[] = [
  { framework: "hono", minimal: 10941, secure: 16664 },
  { framework: "daloy", minimal: 37695, secure: 41640 },
  { framework: "koa", minimal: 76682, secure: 102050 },
  { framework: "elysia", minimal: 129316, secure: 137755 },
  { framework: "fastify", minimal: 164310, secure: 207872 },
  { framework: "express", minimal: 270341, secure: 304256 },
  { framework: "nest", minimal: 285768, secure: 308720 },
]

/**
 * A single route scenario in the middleware-stack throughput benchmark.
 * Source: `results.middleware-stack.json` → `reqPerSec.mean`.
 */
export type MiddlewareThroughputRow = {
  /** Route scenario label. */
  scenario: string
  /** DaloyJS requests/sec with its middleware stack. */
  daloy: number
  /** Hono requests/sec with a comparable middleware stack. */
  hono: number
}

/**
 * Throughput (requests/sec, 100 connections) with a comparable middleware
 * stack on both frameworks. This is the fair throughput comparison: when both
 * sides actually do per-request work, DaloyJS and Hono land within a handful of
 * percent of each other, with DaloyJS slightly ahead (~6% on these GET routes).
 * The `echo` (POST body) scenario is omitted to keep the chart to the two GET
 * routes; both frameworks returned zero non-2xx responses on every scenario in
 * this run.
 */
export const MIDDLEWARE_THROUGHPUT_RPS: MiddlewareThroughputRow[] = [
  { scenario: "Static route", daloy: 18570, hono: 17492 },
  { scenario: "Dynamic route", daloy: 18188, hono: 17171 },
]

/**
 * The "several factors" that make these charts *not* an apples-to-apples
 * comparison. Rendered as a caveat list under the charts.
 */
export const BENCH_NOTES: string[] = [
  "Apples vs oranges, not apples to apples. These are different tools doing different amounts of work. On every request, DaloyJS validates the body against your Zod or Valibot schema and runs secure headers, a request ID, body-size limits, and request timeouts, all out of the box. The 'minimal' apps for the other frameworks do almost none of this, and even 'secure parity' rarely matches it one for one. So part of every DaloyJS number is security and validation you would otherwise have to build yourself.",
  "Footprint methodology differs: DaloyJS is one zero-dependency package, while the others resolve transitive trees whose exact size depends on when the lockfile was generated.",
  "Throughput is workload-shaped: with a comparable middleware stack on both sides, DaloyJS and Hono land within a handful of percent of each other (DaloyJS ~6% ahead on these GET routes). Real services are usually bound by database and I/O time, not framework dispatch, so these micro-numbers rarely predict production.",
  "Different target runtimes: some frameworks (e.g. Elysia) are tuned for Bun but are measured here under their Node adapters for a fair single-runtime baseline.",
  "Single machine, single moment: one Apple M3 Max, Node v25.7, June 2026, against @daloyjs/core 1.0.0-beta.1. Your hardware, runtime, and versions will move these numbers.",
]
