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

> **Read the table as orange-to-apple, not apple-to-apple.** DaloyJS is the
> only server here that runs its full contract on every route: it Zod-parses
> the request params, Zod-parses the request body, **and** validates the
> _response_ body against its schema before sending. Every other server does
> little to no schema work — Hono/Fastify do a single `typeof` check on
> `/echo` and nothing on the GET routes, and none of them validate responses
> at all. So the throughput gap is mostly "daloy doing the most work" vs.
> "everyone doing the least," not a router/dispatch deficiency (the router
> micro-bench in [`../router.bench.ts`](../router.bench.ts) clocks daloy's
> core at tens of millions of lookups/sec). For closer-to-fair tiers, see the
> `daloy-bare`, `*-nozod`, and `*-validated` server variants under
> [`servers/throughput/`](servers/throughput/).

Each server is hit by [autocannon](https://github.com/mcollina/autocannon) on
`localhost`:

- 1 warmup run (15s, 100 connections) — discarded.
- 5 measurement runs (10s each, 100 connections, 1 pipelining).
- Median req/sec (±95% CI of the mean) and median p99 latency across the runs.

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

Besides `daloy`, the default `run.mjs` matrix includes these diagnostic
variants:

- **`daloy-nozod`** — secure defaults retained, with contract validation
  removed. This isolates the validation cost from the security-default cost.
- **`daloy-bare`** — validation work (Zod) and browser-facing guards stripped
  to the same posture as the bare routers (`hono.ts`, `fastify.ts`). This is
  the closest apple-to-apple row.
- **`daloy-shed`** — same full contract as `daloy`, plus connection-cap
  admission control and event-loop-delay load shedding. Compare against
  `daloy` under `--sweep=connections` for the overload / tail-latency story.
- **`hono-validated`** — Hono with the same request and response Zod schemas
  as full-contract Daloy, isolating framework dispatch from validation work.

## Running

```bash
cd bench/cross-framework
nvm use        # Node 24 (.nvmrc) — the version baseline numbers are produced on
pnpm install   # installs all framework deps in this folder only
node run.mjs   # ~42 min wall time for the full matrix (15s warmup + 5×10s per scenario)
```

To run a subset:

```bash
node run.mjs --only=daloy,fastify,hono
```

To change durations:

```bash
DURATION=20 CONNECTIONS=200 node run.mjs
```

## Running on macOS / laptops

The runners are cross-platform (macOS, Linux, Windows). Two laptop-specific
gotchas are detected automatically and printed to stderr at startup:

- **Battery throttling.** On battery, laptops (especially Apple-silicon
  MacBooks) scale clocks aggressively, so throughput/latency numbers become
  noisy and non-comparable. The runner warns when it detects battery power —
  **plug in before benchmarking.** The AC/battery state is also recorded in
  every `results*.json` under `machine.onBattery` / `machine.powerSource`.
- **File-descriptor limit.** macOS defaults to a soft `ulimit -n` of 256,
  which hundreds of autocannon client sockets plus the server's accepted
  sockets can exhaust (`EMFILE`, inflated error rates). The runner warns when
  the limit looks too low for the requested connection count. Raise it for the
  current shell before running:

  ```bash
  ulimit -n 4096
  node run.mjs
  ```

## Beyond the default throughput run

The default `run.mjs` measures requests/sec and latency for three small
endpoints. Real frameworks differ on many other axes that affect the
production experience. Each of the scripts below is a sibling of `run.mjs`
and can be run independently. They all share `lib/common.mjs` for server
spawning, machine-info capture, and statistics helpers, and write their own
`results.<scenario>.json` into this folder (redirect with
`BENCH_RESULTS_DIR=/some/dir` — `smoke.mjs` uses that to keep its throwaway
output away from real results).

| Script                 | Measures                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run.mjs`              | Throughput + p50/p75/p90/p99/p99.9 latency. Supports `--sweep=connections` and `--sweep=pipelining`. Correctness preflight before measuring. Prints per-scenario **uncertainty groups** before the ranked table (see methodology).                                                                                                                                                                                                                                                                                                                                                                                  |
| `cold-start.mjs`       | Wall-clock from process `spawn()` to first `200 OK` over N iterations. Default `--mode=compiled`: each server is precompiled to plain JS (esbuild, npm packages external) and spawned with bare `node`, so the number is the compiled-JS cold start a deployed app pays — compile time is not counted. `--mode=tsx` measures the dev-workflow path instead (tsx loader, transpile on boot); the two modes are not comparable and the results file records which one ran.                                                                                                                                            |
| `install-size.mjs`     | `node_modules` footprint per framework: own size + transitive size + direct + transitive dep counts. Reports two variants per framework: `minimal` (router/runtime only) and `secure parity` (adds helmet/secure-headers, CORS, rate-limit, HS256 JWT). Daloy and Hono's two rows are identical because those guards ship in-package; every other framework grows. pnpm-aware: walks the `.pnpm/` store so transitive deps under symlinked locations are counted. Optional peer deps (e.g. NestJS's class-validator, class-transformer, websockets) are skipped.                                                    |
| `bundle-size.mjs`      | esbuild ESM bundle of a minimal "hello world" app, raw and gzipped. Reports two variants per framework: `minimal` (bare router) and `secure parity` (request-id, secure headers, CORS allowlist, rate-limit hook, HS256 JWT verify). Daloy ships those guards in core; every other framework requires opt-in middleware, so compare the secure-parity rows to each other for an honest edge/serverless number. The minimal rows are router-only baselines, not production bundles. NestJS optional peer deps (class-validator, class-transformer, websockets, microservices, platform-express) are marked external. |
| `body-size-sweep.mjs`  | POST throughput across body sizes {100 B, 1 KiB, 16 KiB, 256 KiB, 1 MiB, 4 MiB}.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `memory-load.mjs`      | RSS at idle, during sustained load, and after settle. Detects leaks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `route-scale.mjs`      | Throughput when the router holds N routes {10, 100, 500, 2000}, hitting the worst-case slot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `error-path.mjs`       | Throughput of the 400 / 404 paths (malformed JSON, schema failure, route miss).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `streaming.mjs`        | Large `ReadableStream` response throughput in MiB/s and req/s.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `middleware-stack.mjs` | Same scenarios as `run.mjs` but with the production security middleware stack on (CORS, secure headers, request-id, rate-limit, JWT verify). Daloy and Hono also run matched request/response Zod schemas; most other peers keep their bare validation posture, so read those rows as security-stack cost rather than full behavioral parity.                                                                                                                                                                                                                                                                       |
| `logging.mjs`          | Same scenarios as `run.mjs` but with one structured Pino access log emitted per completed response. Defaults to `LOG_DEST=/dev/null` to avoid terminal or collector backpressure.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `profile-imports.mjs`  | Cold-process import cost per module: each candidate is imported in its own fresh Node process so the loader cache never warms across samples.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `smoke.mjs`            | Runs every bench script above with minimal durations/iterations to verify the harness wiring end-to-end (`pnpm bench:smoke`). CI-suitable; measures nothing. Writes to a temp `BENCH_RESULTS_DIR`, so it never overwrites real `results.*.json`.                                                                                                                                                                                                                                                                                                                                                                    |

### Server layout

The framework servers live under `servers/`, organized by the concern each
scenario exercises. Every framework has one file per concern, named by the
framework alone:

```
servers/
  throughput/   plain router + JSON handlers (run.mjs, cold-start, error-path, memory-load)
  secured/      production middleware stack: request-id, secure headers, CORS, rate-limit, HS256 JWT (middleware-stack.mjs)
  logging/      one structured Pino access log per response, via ./access-log (logging.mjs)
  stream/       large ReadableStream responses (streaming.mjs)
  echo-bytes/   raw-bytes POST echo for the body-size sweep (body-size-sweep.mjs)
  scale/        N dynamically registered routes (route-scale.mjs)
```

Daloy/Hono A/B variants that don't generalize across frameworks keep their
descriptive suffix inside the relevant folder (e.g.
`throughput/daloy-bare.ts`, `throughput/daloy-shed.ts`,
`throughput/daloy-minimal.ts`, `throughput/daloy-nozod.ts`,
`throughput/hono-validated.ts`, `scale/daloy-nozod.ts`,
`scale/hono-validated.ts`).

Run any one:

```bash
node cold-start.mjs --only=daloy
node body-size-sweep.mjs
node middleware-stack.mjs
node logging.mjs --only=daloy,hono
```

Run the full set sequentially:

```bash
pnpm bench:all   # ~60–90 min wall time depending on the matrix
```

### Methodology notes (apply to all scripts)

- **Long warmup, then measure.** `run.mjs` defaults to a 15s warmup so V8
  has time to tier up to TurboFan. Override with `WARMUP=30`.
- **Multiple iterations, mean + 95% CI.** The throughput headline and its
  confidence interval use the same estimator.
  Defaults: 5 iterations of 10s each (enough samples for a meaningful
  confidence interval; push to `ITERATIONS=10 DURATION=20` for
  publication-grade numbers). Aggregated latency percentiles (p50…p99.9) are
  the **median** across iterations, not the mean — averaging tail percentiles
  lets one bad iteration drag the headline number. Raw per-iteration values
  stay in `samples`.
- **Confidence intervals on every aggregate.** `stats()` records `ci95`, the
  half-width of the two-sided 95% confidence interval of the mean (Student's
  t on the sample variance). Tables render it as `mean ±ci95`.
- **Uncertainty groups are descriptive, not a significance test.** `run.mjs`,
  `middleware-stack.mjs`, and `cold-start.mjs` visually group frameworks
  while their marginal 95% CIs overlap the group leader's. CI overlap is a
  useful noise warning, but it does not prove equal performance or replace a
  direct test of paired differences. The ranked table remains as detail.
- **Shuffled framework order.** Each run executes frameworks in a random
  order so nobody systematically benefits from running first (cool machine)
  or last (thermal throttle); repeated runs average position effects out.
  `rows` in every results file reflect actual execution order. Pass
  `--order=fixed` (or `BENCH_ORDER=fixed`) to keep the declared order.
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
- **Provenance captured.** Every results file also records the git commit
  SHA, whether the worktree was dirty, the pnpm version, and the resolved
  version of every framework dependency (including the `file:`-linked
  `@daloyjs/core`), so a number can always be traced back to the exact code
  and dependency set that produced it.

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

`run.mjs` writes a `results.json` next to this README (all scripts write
their `results.*.json` here unless `BENCH_RESULTS_DIR` overrides it) and
prints per-scenario uncertainty groups followed by a markdown table:

```
Uncertainty groups — GET /static (req/s) (higher is better; CI overlap is not a significance test)
  1. hono 125,001 ±2,113  ·  daloy-bare 123,456 ±1,890
  2. fastify 101,300 ±955
...

| Framework  | GET /static (req/s ±95% CI) | GET /users/:id (req/s ±95% CI) | ... |
| ---------- | --------------------------: | -----------------------------: | --- |
| daloy      |              123,456 ±1,890 |                 111,222 ±1,404 | ... |
| hono       |                         ... |                            ... | ... |
...
```

Reproducible: the committed [`.nvmrc`](.nvmrc) pins **Node 24** — the
framework's supported floor and the version baseline numbers are produced
on (`nvm use` before benchmarking; the harness itself runs on any Node
≥ 24, and `machine.node` records what actually ran). Install with the
committed `pnpm-lock.yaml` (`pnpm install --frozen-lockfile`), and run on a
quiet machine with `--max-old-space-size` left at default. The recorded
`machine.gitSha` / `machine.gitDirty` / `machine.depVersions` fields tell
you whether two results files are actually comparable.

## Honest caveats

- Microbenchmarks are **not production performance**. They flatter routers
  and punish any framework that does useful work (validation, OpenAPI,
  refuse-to-boot checks). This is an **orange-to-apple** comparison by
  construction: on all three endpoints DaloyJS validates the request _and_
  the response against Zod schemas, while Express/Koa/Hono/Fastify validate
  nothing on the GET routes and at most do a one-line `typeof` check on
  `POST /echo`. None of the others validate response bodies at all. Read the
  default table as "daloy with its safety rails on vs. everyone else with
  theirs off," and use the `daloy-bare` / `daloy-nozod` / `hono-validated`
  variants if you want a like-for-like tier.
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
