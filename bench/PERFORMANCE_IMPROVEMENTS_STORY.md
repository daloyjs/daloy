# Performance improvements story

Living notes for benchmarking methodology and hot-path work on `@daloyjs/core`.
Run micro-benches before and after changes (`pnpm bench`, `pnpm bench:serverless`,
`pnpm bench:json`, `pnpm bench:json-e2e`, `pnpm bench:ablation`). For
cross-framework HTTP numbers use
`bench/cross-framework/` on Node 24 (`.nvmrc`), on AC power, with a raised
`ulimit -n`. Record the actual Node version from `machine.node` in results —
spot checks on Node 26 are fine but are **not** interchangeable with the
Node 24 baseline.

**DaloyJS performance is acceptable.** It is not a “slow framework”; the
default matrix measures a different product than bare Hono/Fastify:

| Posture                                                                 | What it does                                                                                                                       | Relative cost (this re-run, Node 26.4.0)                                                                                  |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Full defaults** (`daloy`)                                             | Zod request + response validation, auto `secureHeaders`, cross-origin write guard, header smuggling / reserved-prefix / count caps | ~16% fewer req/s than `daloy-bare` on GET; ~30% behind bare Fastify/Hono on GET; **~17% ahead of bare Hono** on JSON echo |
| **Apple-to-apple** (`daloy-bare`, `preset: "internal-service"`, no Zod) | Router + dispatch only                                                                                                             | ~21% behind Fastify / ~17% behind Hono on GET; solid second tier on POST /echo among focused matrix                       |
| **Secured production stack**                                            | Request ID + headers + CORS + rate limit + HS256 JWT                                                                               | **~12% behind Fastify** on GET; **~32% ahead of Hono** on GET and **~62% ahead** on echo                                  |
| **In-process router**                                                   | `Router.find()` only                                                                                                               | ~28M static lookups/s on Node 26 — not the bottleneck                                                                     |

> **Caveat:** the relative-cost column above comes from the 2026-07-18
> **Node 26.4.0 spot-check**, which is off the repo's Node 24 (`.nvmrc`)
> baseline. Node majors shift peer rankings — Fastify POST /echo alone moved
> ~+75% from Node 24 to Node 26. Treat cross-framework rankings as
> provisional until re-measured on Node 24; the in-process ablation
> conclusions (secureHeaders dominates, Zod ~1%) are Node-major-robust.

Production apps almost always pay validation and security headers. Compare
secure-parity rows (`middleware-stack.mjs`, install/bundle secure parity) when
arguing production fitness, not the bare `GET /static` leaderboard alone.

**No urgent hot-path work required.** The cost of full defaults is intentional
security + contract work (especially auto `secureHeaders` `onResponse`), not a
broken router. Response Zod validation is ~1% in the in-process ablation.
See “Safe future optimisations” below if chasing more later.

## Publication baseline — Node 24.3.0 focused run (2026-07-17)

On-baseline (`.nvmrc`) cross-framework run. **Prefer these numbers for any
external claim** until a fresh Node 24 re-run replaces them.

| Framework        |       GET /static |  GET /users/:id |      POST /echo |
| ---------------- | ----------------: | --------------: | --------------: |
| hono             |     55,905 ±1,354 |     55,987 ±760 |      22,709 ±98 |
| hono-validated   |       56,627 ±233 |     54,499 ±800 |     22,652 ±130 |
| fastify          |     51,766 ±1,639 |     51,834 ±806 |      32,911 ±93 |
| **daloy-bare**   |   **51,619 ±959** | **51,046 ±799** | **42,365 ±202** |
| **daloy** (full) | **41,229 ±1,009** | **40,815 ±241** | **33,118 ±174** |

On Node 24, bare Daloy was **tied with Fastify** on GET (CI overlap) and
**fastest** on POST /echo. Node 26 lifts Fastify/Hono more than Daloy on the
bare GET path — always label results with `machine.node`. Note this run
predates the `daloy-nozod` / `stream` logger fix (2026-07-18), so its nozod
row (omitted here) is not comparable.

## Node 26.4.0 spot-check (2026-07-18) — off-baseline; do not publish

> **Off-baseline run.** Node 26 is not the `.nvmrc` baseline; these tables
> exist to document the ablation findings and the logger methodology fix,
> **not** to source cross-framework claims. Re-run on Node 24 before quoting.

**Machine:** Apple M3 Max, 16 cores, 64 GiB, AC power, Node **v26.4.0**, git
`d9605273` (clean), loadAvg ~4–5 on 16 cores.

### In-process micro (`pnpm bench*`, Node 26.4.0)

| Bench                                          |                                                            Result |
| ---------------------------------------------- | ----------------------------------------------------------------: |
| Router static lookup                           |                        ~28.5M ops/s median (seven rotated rounds) |
| Router dynamic 4-segment                       |                                                ~2.2M ops/s median |
| Router miss                                    |                                                ~8.2M ops/s median |
| Serverless first fetch                         | ~2.5–3.2 ms median; every scenario sample runs in a fresh process |
| Serverless warm fetch                          |                                                  ~21–22 µs median |
| Serverless import `dist/app.js`                |                                                   ~18.2 ms median |
| JSON body limits ON vs OFF (e2e)               |   ~2.3% overhead (median of 5 rounds; per-round spread ~1.6–4.7%) |
| JSON safe parse typical (limited vs unlimited) |                ~10% overhead for key/depth caps on a typical body |

### In-process dispatch ablation (dist `App.fetch`, no HTTP)

Harness: `bench/ablation.bench.ts` (`pnpm bench:ablation`). 5 rounds × 50k
iters, interleaved configs, raw samples + provenance in
`bench/results.ablation.json` (gitignored).

## What already landed (historical + this pass)

Earlier hot-path work (still load-bearing — do not regress):

- Sync-first validation / serialization (no microtask when Zod is sync)
- `finalizeFast` when no `onSend` / `onResponse`
- Stable `RequestContext` hidden class (no per-request `defineProperty`)
- Lazy query/headers materialization
- `getPathnameFast` / `getOriginFast` without `new URL()` on the common path
- Node adapter `LightRequest` / `LightResponse` + raw-body symbol
- noop logger skip of `child()` allocation
- Prototype-pollution-safe parsers without sacrificing the body fast path

**Security-preserving hot-path work (prior pass, still load-bearing):**

1. **`assertInboundHeaderGuards`** — one `Headers.forEach` for reserved
   internal prefixes **and** the header-count cap (was two walks on every
   request). Public helpers unchanged; dispatch uses the combined path.
   The helper is **dispatch-internal** (exported from `security.ts` but not
   re-exported from the package index). Precedence matches the sequential
   guards exactly — a reserved header anywhere in the map yields `400` even
   when the map also exceeds the count cap (`431` is deferred past the
   prefix scan); regression-tested in
   `tests/reserved-internal-headers.test.ts`.
2. **`secureHeaders` common-path apply** — if the response does not already
   carry any of the default security header names, bulk-`set` without N
   `has()` probes; if any conflict exists, keep set-if-absent so handler /
   earlier-hook values still win (OWASP / clickjacking posture unchanged).
3. **Router allocation removal** — exact static lookups probe the static map
   before allocating a trailing-slash-normalized string; normalization now
   uses character scans instead of regex replacements; dynamic and wildcard
   segments skip `decodeURIComponent` when no `%` is present. Traversal
   rejection and malformed percent-escape behavior are unchanged and covered
   by router plus auth-bypass regression tests.

## Benchmarking methodology — keep / improve

### Already strong

- Isolated `bench/cross-framework` (does not pollute core lockfile)
- Warmup + multi-iteration mean + 95% CI + uncertainty groups
- Correctness preflight (wrong body cannot win “fastest”)
- Framework order shuffle; machine / git / dep provenance in results
- Battery + FD-limit + high-loadAvg warnings
- Variants: `daloy-bare`, `daloy-shed`, `*-nozod`, `hono-validated`, secured stack
- Ablation harness with raw samples (`pnpm bench:ablation`)
- `pnpm bench:ci` short pre-merge subset

### Gaps fixed / found this re-run

| Gap                                                  | Why it matters                                                                                                                | Status                                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `throughput/daloy-nozod.ts` used default info logger | Per-request `logger.child()` made nozod **slower** than full-contract `daloy` (`logger: false`), confounded “validation cost” | **Fixed 2026-07-18** — both use `logger: false`; short re-check shows CI overlap                 |
| `stream/daloy.ts` same logger mismatch               | Streaming story mixed logger cost into framework cost                                                                         | **Fixed 2026-07-18**                                                                             |
| Secured-stack runner only checked readiness          | A fast but semantically wrong endpoint could have been timed                                                                  | **Fixed 2026-07-19** — all three endpoints now require an expected 200 JSON body before sampling |
| Ablation numbers not reproducible                    | Tables without raw samples                                                                                                    | **Fixed earlier:** `pnpm bench:ablation`                                                         |
| Throughput servers used `async` for pure sync work   | ~15% self-inflicted                                                                                                           | **Fixed earlier**                                                                                |
| Orange-to-apple still easy to misread                | Marketing tables quote bare routers vs full Daloy                                                                             | Keep leading with uncertainty groups + variants                                                  |
| No pin of “quiet machine” gate                       | High loadAvg makes ±10% noise                                                                                                 | **Fixed earlier:** warn when `loadAvg[0] > cpuCount`                                             |
| Shell not on `.nvmrc` Node                           | This re-run used system Node 26 while docs say Node 24 baseline — absolute and relative numbers shift                         | Always `nvm use` / record `machine.node`; do not mix Node majors when comparing                  |
| Multi-runtime not in matrix                          | Bun/Deno numbers differ                                                                                                       | Optional scheduled Bun pass still open                                                           |
| Router micro-bench in root README                    | Not comparable to HTTP                                                                                                        | Keep disclaimer; prefer cross-framework for claims                                               |

### Remaining methodology improvements (nice-to-have)

1. **Assert `logger: false` (or equivalent silence) in a smoke check** for all
   throughput/secured Daloy variants so a future edit cannot reintroduce
   default-logger noise.
2. **Publication runs** should pin Node 24 via `.nvmrc` and use
   `WARMUP=30 ITERATIONS=10 DURATION=20` on a quiet AC machine —
   “quiet” meaning loadAvg ≲ 0.25 × cores, not merely under the
   `loadAvg > cpuCount` warn gate (see the 2026-07-26 methodology note:
   loadAvg ~5/16 moved absolutes ~10–12%).
3. **Paired difference tests** (not just CI overlap groups) if publishing
   “tied with Fastify” claims.
4. Optional Bun matrix for multi-runtime parity claims.
5. **Split `--only` subset runs are second-class** (found 2026-07-26): each
   invocation overwrites `results.json`, and the framework order shuffle only
   rotates within one invocation, so cross-subset position effects are not
   averaged out. Workaround today: give each subset its own
   `BENCH_RESULTS_DIR` and compare tables by hand. Proper fix: a merge tool
   (or `--append`) that combines per-subset results files into one matrix
   with the union of rows.

## Safe future optimisations (do not weaken security)

Ranked by expected impact vs risk — **none are required** for acceptable
production performance:

1. **Non-`async` `dispatch` / `fetch`** — return `Response | PromiseLike<Response>` and only allocate a Promise when work suspends. Large refactor; Hono-class win on pure-sync routes. Keep every security check on both paths.
2. **Fold auto-`secureHeaders` into `serializeResult` header construction** for the default static set (defaults first, handler headers overwrite) while still running `onResponse` for error / raw-`Response` paths. Semantics must match set-if-absent. Ablation says this is the dominant full-defaults cost.
3. **Keep sync handlers** in docs examples for static routes.
4. **Do not** disable response validation, body limits, reserved headers, or smuggling checks to “make the bench green.”

## How to re-run

```sh
# Micro
pnpm bench && pnpm bench:serverless && pnpm bench:json && pnpm bench:json-e2e

# Dispatch ablation (build first so it benches dist, like the tables above)
pnpm build && pnpm bench:ablation

# Cross-framework (Node 24 via .nvmrc, plugged in, quiet loadAvg)
cd bench/cross-framework
nvm use
ulimit -n 65536
pnpm install --frozen-lockfile
# quick pre-merge subset:
pnpm bench:ci
# focused diagnostic matrix:
node run.mjs --only=daloy,daloy-bare,daloy-nozod,hono,hono-validated,fastify
# secured production stack:
node middleware-stack.mjs --only=daloy,hono,fastify
# publication-grade:
# WARMUP=30 ITERATIONS=10 DURATION=20 node run.mjs
```

Never remove or compromise built-in security features to improve these numbers.
