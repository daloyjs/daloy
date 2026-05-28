# Cross-framework HTTP benchmark

A **neutral, head-to-head HTTP benchmark** comparing DaloyJS against the
frameworks referenced in the root [README.md](../../README.md) comparison
table.

> ⚠️ **This package is intentionally isolated from the pnpm workspace.** It is
> not listed in [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml) so its
> devDependencies (Express, Fastify, Nest, Koa, Feathers, Elysia, Hono, …)
> never touch `@daloyjs/core`'s install graph or trip the zero-runtime-dep,
> known-dep-names, lockfile-source, or release-age gates. Install and run it
> on its own.

## What it measures

For each framework, a minimal HTTP server exposing the same three endpoints:

| Endpoint         | Purpose                                                      |
| ---------------- | ------------------------------------------------------------ |
| `GET /static`    | Static-route fast path. No params, no body, no validation.   |
| `GET /users/:id` | One-segment dynamic param. Echoes the id back as JSON.       |
| `POST /echo`     | JSON body parsing + schema validation of `{ name: string }`. |

Each server is hit by [autocannon](https://github.com/mcollina/autocannon) on
`localhost`:

- 1 warmup run (5s, 100 connections) — discarded.
- 3 measurement runs (10s each, 100 connections, 1 pipelining).
- Mean req/sec and p99 latency reported across the 3 runs.

The runner spawns each server as a child process, polls `GET /static` until
the server responds, runs autocannon, kills the process, then moves on. No
framework sees another's warmup.

## What it does NOT measure

- Cold start time / time-to-first-request.
- TLS termination.
- Anything beyond the local loopback (no real network).
- Production middleware stacks (compression, auth, logging) — each server is
  deliberately bare so router and request-pipeline cost dominate.
- Memory footprint.

If you need any of these, fork the runner.

## Why these scenarios

- **`GET /static`** — measures the router fast path. Most frameworks have a
  hash-map or radix-trie shortcut here.
- **`GET /users/:id`** — measures the dynamic-segment cost (trie walk,
  regex, or string scan) plus param extraction.
- **`POST /echo`** — measures body parsing + validation, which is where the
  "thin router" frameworks usually lose to "batteries-included" frameworks
  (and vice versa).

## Frameworks included

| Framework      | Adapter / transport used                                                                |
| -------------- | --------------------------------------------------------------------------------------- |
| **DaloyJS**    | `@daloyjs/core/node` (sourced from this repo via `file:../..`)                          |
| **Hono**       | `@hono/node-server`                                                                     |
| **Fastify**    | native                                                                                  |
| **Express v5** | native                                                                                  |
| **Koa**        | `@koa/router` + `koa-bodyparser`                                                        |
| **NestJS**     | `@nestjs/platform-fastify` (faster than the default Express platform — fairer to Nest)  |
| **Elysia**     | `@elysiajs/node` (Elysia is Bun-first; the Node adapter is the only cross-runtime path) |
| **FeathersJS** | `@feathersjs/koa` transport with a plain route (no service layer, kept fair)            |

Every server uses `JSON.stringify` / built-in body parsing only. No
framework-specific perf tricks (no Fastify response schema, no DaloyJS
typed-client client-side cache).

## Running

```bash
cd bench/cross-framework
pnpm install   # installs all framework deps in this folder only
node run.mjs   # ~5 min wall time for all 8 frameworks
```

To run a subset:

```bash
node run.mjs --only=daloy,fastify,hono
```

To change durations:

```bash
DURATION=20 CONNECTIONS=200 node run.mjs
```

## Beyond the default throughput run

The default `run.mjs` measures requests/sec and latency for three small
endpoints. Real frameworks differ on many other axes that affect the
production experience. Each of the scripts below is a sibling of `run.mjs`
and can be run independently. They all share `lib/common.mjs` for server
spawning, machine-info capture, and statistics helpers, and write their own
`results.<scenario>.json`.

| Script                 | Measures                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run.mjs`              | Throughput + p50/p75/p90/p99/p99.9 latency. Supports `--sweep=connections` and `--sweep=pipelining`. Correctness preflight before measuring.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `cold-start.mjs`       | Wall-clock from process `spawn()` to first `200 OK`, averaged over N iterations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `install-size.mjs`     | `node_modules` footprint per framework: own size + transitive size + direct + transitive dep counts. Reports two variants per framework: `minimal` (router/runtime only) and `secure parity` (adds helmet/secure-headers, CORS, rate-limit, HS256 JWT). Daloy and Hono's two rows are identical because those guards ship in-package; every other framework grows. pnpm-aware: walks the `.pnpm/` store so transitive deps under symlinked locations are counted. Optional peer deps (e.g. NestJS's class-validator, class-transformer, websockets) are skipped.                                                    |
| `bundle-size.mjs`      | esbuild ESM bundle of a minimal "hello world" app, raw and gzipped. Reports two variants per framework: `minimal` (bare router) and `secure parity` (request-id, secure headers, CORS allowlist, rate-limit hook, HS256 JWT verify). Daloy ships those guards in core; every other framework requires opt-in middleware, so compare the secure-parity rows to each other for an honest edge/serverless number. The minimal rows are router-only baselines, not production bundles. NestJS optional peer deps (class-validator, class-transformer, websockets, microservices, platform-express) are marked external. |
| `body-size-sweep.mjs`  | POST throughput across body sizes {100 B, 1 KiB, 16 KiB, 256 KiB, 1 MiB, 4 MiB}.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `memory-load.mjs`      | RSS at idle, during sustained load, and after settle. Detects leaks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `route-scale.mjs`      | Throughput when the router holds N routes {10, 100, 500, 2000}, hitting the worst-case slot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `error-path.mjs`       | Throughput of the 400 / 404 paths (malformed JSON, schema failure, route miss).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `streaming.mjs`        | Large `ReadableStream` response throughput in MiB/s and req/s.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `middleware-stack.mjs` | Same scenarios as `run.mjs` but with the production middleware stack on (CORS, secure headers, request-id, rate-limit, JWT verify).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `logging.mjs`          | Same scenarios as `run.mjs` but with one structured Pino access log emitted per completed response. Defaults to `LOG_DEST=/dev/null` to avoid terminal or collector backpressure.                                                                                                                                                                                                                                                                                                                                                                                                                                   |

Run any one:

```bash
node cold-start.mjs --only=daloy
node body-size-sweep.mjs
node middleware-stack.mjs
node logging.mjs --only=daloy,hono
```

Run the full set sequentially:

```bash
pnpm bench:all   # ~25–40 min wall time depending on the matrix
```

### Methodology notes (apply to all scripts)

- **Long warmup, then measure.** `run.mjs` defaults to a 15s warmup so V8
  has time to tier up to TurboFan. Override with `WARMUP=30`.
- **Multiple iterations, median + stddev.** Mean alone hides outliers.
  Defaults: 3 iterations of 10s each. Override with `ITERATIONS=5
DURATION=20`.
- **Correctness preflight.** `run.mjs` fetches each endpoint once before
  benchmarking and aborts the run for that framework if the response body
  doesn't match the expected shape — so "fastest" can't mean "returned the
  wrong thing the fastest".
- **Forced GC between iterations.** Run with `--expose-gc` (`node
--expose-gc run.mjs`) to discard heap pressure carried over from the
  previous iteration.
- **Per-iteration samples kept.** `results.*.json` carries every raw
  sample, so you can re-render tables or compute percentiles without
  re-running.
- **Machine fingerprint captured.** Every results file records Node
  version, OS, CPU model, core count, and total RAM. Compare apples to
  apples.

### What's still not measured

- **Multi-runtime parity.** This folder only spawns Node servers. For
  Daloy specifically, you can re-run any of these scripts against Bun
  (`bun --bun run …`), Deno (`deno run -A …`), or the Cloudflare/Vercel
  adapters by swapping the server file — the bench scripts only assume
  the server emits a `READY <port>` line on stdout.
- **TLS termination cost.**
- **Real network latency.** Loopback only.
- **WebSocket throughput.** Daloy has a `WebSocket` implementation; add a
  bench script if you need numbers for it.
- **External logging backpressure.** `logging.mjs` writes to `/dev/null` by
  default so it measures framework hook and Pino serialization/write cost,
  not the behavior of a terminal, sidecar, or remote collector. Set
  `LOG_DEST=./access.log` if you want a real file sink.

To change durations on the original throughput script:

```bash
DURATION=20 CONNECTIONS=200 node run.mjs
```

## Output

`run.mjs` writes a `results.json` and prints a markdown table:

```
| Framework  | GET /static (req/s) | GET /users/:id (req/s) | POST /echo (req/s) | p99 (ms) /static |
| ---------- | ------------------: | ---------------------: | -----------------: | ---------------: |
| daloy      |             123,456 |                111,222 |             88,777 |             1.21 |
| hono       |                 ... |                    ... |                ... |              ... |
...
```

Reproducible: pin Node version (`.nvmrc`), pin lockfile, run on a quiet
machine with `--max-old-space-size` left at default.

## Honest caveats

- Microbenchmarks are **not production performance**. They flatter routers
  and punish any framework that does useful work (validation, OpenAPI,
  refuse-to-boot checks). DaloyJS's validation path adds cost that
  Express/Koa skip entirely on `POST /echo` because they don't validate.
- The numbers can shift ±10% between runs depending on CPU thermal state.
  Run twice if a number looks off.
- Elysia on `@elysiajs/node` is **not** representative of Elysia on Bun.
  Bun-native numbers will be much higher; that is a runtime story, not a
  framework story.
- NestJS on Fastify is the fast configuration; on Express (the default) it
  is meaningfully slower.

## Reproducing the README claim

The root [README.md](../../README.md#performance) currently quotes only the
in-process router micro-benchmark (`pnpm bench`, see
[bench/router.bench.ts](../router.bench.ts)). That number is **not**
comparable to the numbers produced here — `bench/router.bench.ts` measures
`Router.find()` in a tight loop, no HTTP, no body parsing, no JSON
serialization. Use this folder for cross-framework HTTP numbers.
