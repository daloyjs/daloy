# Performance improvements story

Living notes for benchmarking methodology and hot-path work on `@daloyjs/core`.
Run micro-benches before and after changes (`pnpm bench`, `pnpm bench:serverless`,
`pnpm bench:json`, `pnpm bench:json-e2e`). For cross-framework HTTP numbers use
`bench/cross-framework/` on Node 24 (`.nvmrc`), on AC power, with a raised
`ulimit -n`.

## Verdict (2026-07-16)

**DaloyJS performance is acceptable.** It is not a “slow framework”; the
default matrix measures a different product than bare Hono/Fastify:

| Posture                                                                 | What it does                                                                                                                       | Relative cost                                                                                                                                              |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Full defaults** (`daloy`)                                             | Zod request + response validation, auto `secureHeaders`, cross-origin write guard, header smuggling / reserved-prefix / count caps | ~21–27% fewer req/s than `daloy-bare` in the stored run (static 21.5%, dynamic 23.3%, echo 26.8%); ~25–37% vs the fastest bare frameworks, route-dependent |
| **Apple-to-apple** (`daloy-bare`, `preset: "internal-service"`, no Zod) | Router + dispatch only                                                                                                             | Within ~5–10% of Hono/Fastify/Nest on the same machine                                                                                                     |
| **In-process router**                                                   | `Router.find()` only                                                                                                               | ~15M static lookups/s — not the bottleneck                                                                                                                 |

Production apps almost always pay validation and security headers. Compare
secure-parity rows (`middleware-stack.mjs`, install/bundle secure parity) when
arguing production fitness, not the bare `GET /static` leaderboard alone.

## Fresh numbers (this machine)

**Machine:** Apple M3 Max, 16 cores, 64 GiB, AC power, Node v24.3.0 (micro) /
v26.4.0 (early micro) as recorded per run.

### In-process micro (`pnpm bench*`)

| Bench                                          |                                                                                                         Result |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------: |
| Router static lookup                           |                                                                                                   ~15.3M ops/s |
| Router dynamic 4-segment                       |                                                                                                    ~1.4M ops/s |
| Router miss                                    |                                                                                                    ~4.5M ops/s |
| Serverless warm fetch (1 route, full contract) |                                                                                                         ~25 µs |
| Serverless warm fetch (scaled routes)          |                                                                                                      ~11–12 µs |
| JSON body limits ON vs OFF (e2e)               | ~4% overhead (median of 5 rounds; per-round spread ~2–7%, so the bench reports the median, not a single round) |

### In-process dispatch ablation (dist `App.fetch`, no HTTP)

> **Caveat:** these ablation numbers were measured with throwaway scripts —
> no checked-in harness, raw samples, or before/after SHAs exist yet (see
> the gaps table below). Treat the deltas as indicative until a
> reproducible `bench/ablation` script lands.

Before this pass’s hot-path tweaks:

| Config                          |           GET /static |
| ------------------------------- | --------------------: |
| Full defaults + response schema |       ~137–145k ops/s |
| `validateResponses: false`      |     ~151k ops/s (~5%) |
| `preset: "internal-service"`    |           ~220k ops/s |
| `secureDefaults: false`         |           ~221k ops/s |
| Bare (no Zod, internal-service) |           ~223k ops/s |
| Sync handler vs async (bare)    | ~253k vs ~221k (~15%) |

After `assertInboundHeaderGuards` + `secureHeaders` common-path apply (same machine):

| Config                          |                      GET /static |
| ------------------------------- | -------------------------------: |
| Full defaults + response schema | **~159k ops/s** (~10–15% vs pre) |
| `validateResponses: false`      |                      ~173k ops/s |
| `preset: "internal-service"`    |                      ~232k ops/s |
| Bare no schema + internal       |                      ~262k ops/s |
| `secureDefaults: false`         |                      ~242k ops/s |

Handler-supplied `x-frame-options: SAMEORIGIN` still wins over auto DENY; CSP
and the rest of the baseline still apply (verified in ablation + unit tests).

**Dominant cost of full defaults:** auto `secureHeaders` `onResponse` (many
header writes + finalize hook path), not Zod response validation and not the
router.

### Cross-framework HTTP (local `results.json`, autocannon)

Median req/s @ 100 connections, 5×10s, 15s warmup (prior run same day).
`bench/cross-framework/results.json` is **gitignored** — these numbers come
from a local run whose provenance recorded a dirty tree and loadAvg ~15–18,
so treat them as indicative, not publication-grade:

| Framework               | GET /static | GET /users/:id | POST /echo |
| ----------------------- | ----------: | -------------: | ---------: |
| elysia                  |      ~54.5k |         ~54.3k |     ~29.5k |
| nest (Fastify platform) |      ~54.2k |         ~52.6k |     ~46.9k |
| hono                    |      ~49.9k |         ~49.6k |     ~21.8k |
| koa                     |      ~48.8k |         ~48.5k |     ~40.7k |
| feathers                |      ~47.5k |         ~46.9k |     ~39.6k |
| fastify                 |      ~48.2k |         ~48.1k |     ~32.7k |
| **daloy-bare**          |  **~46.0k** |     **~45.0k** | **~39.8k** |
| express                 |      ~41.8k |         ~41.0k |     ~36.5k |
| **daloy** (full)        |  **~36.1k** |     **~34.5k** | **~29.2k** |
| daloy-shed              |      ~36.1k |         ~34.6k |     ~29.7k |

Note: that run recorded `loadAvg` ~15–18 (noisy). Re-run on a quiet machine
before publishing.

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

**This pass (security-preserving):**

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

## Benchmarking methodology — keep / improve

### Already strong

- Isolated `bench/cross-framework` (does not pollute core lockfile)
- Warmup + multi-iteration median + 95% CI + parity tiers
- Correctness preflight (wrong body cannot win “fastest”)
- Framework order shuffle; machine / git / dep provenance in results
- Battery + FD-limit warnings
- Variants: `daloy-bare`, `daloy-shed`, `*-nozod`, `hono-validated`, secured stack

### Gaps / improvements

| Gap                                                                  | Why it matters                                                                                                                        | Suggested fix                                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Missing `PERFORMANCE_IMPROVEMENTS_STORY.md` (was linked from README) | Agents/humans had no history                                                                                                          | This file                                                                                        |
| Ablation numbers not reproducible                                    | The in-process dispatch tables above have no checked-in script, raw samples, or before/after SHAs — they are assertions, not evidence | Add a `bench/ablation` script that records Node version, git SHA, config matrix, and raw samples |
| Throughput servers use `async` handlers for pure sync work           | ~15% self-inflicted on Daloy; others often sync                                                                                       | Prefer sync handlers in `servers/throughput/*` where types allow                                 |
| Orange-to-apple still easy to misread                                | Marketing tables quote bare routers vs full Daloy                                                                                     | Always lead with **parity tiers** + `daloy-bare` row; document in README claim                   |
| No pin of “quiet machine” gate                                       | High loadAvg makes ±10% noise                                                                                                         | Fail or warn when `loadAvg[0] > cpuCount`                                                        |
| Full matrix ~35–90 min                                               | Discourages pre-merge runs                                                                                                            | Keep `smoke.mjs`; add `bench:ci` subset (daloy, daloy-bare, hono, fastify, 1 iter / 3s)          |
| Client is autocannon only                                            | Fine for HTTP; fetch-based scripts understate concurrency fairness                                                                    | Keep autocannon for publish; document client                                                     |
| Multi-runtime not in matrix                                          | Bun/Deno numbers differ                                                                                                               | Optional `RUNTIME=bun` note already in README — add one scheduled Bun pass                       |
| Router micro-bench in root README                                    | Not comparable to HTTP                                                                                                                | Keep disclaimer; prefer cross-framework for claims                                               |

## Safe future optimisations (do not weaken security)

Ranked by expected impact vs risk:

1. **Non-`async` `dispatch` / `fetch`** — return `Response | PromiseLike<Response>` and only allocate a Promise when work suspends. Large refactor; Hono-class win on pure-sync routes. Keep every security check on both paths.
2. **Fold auto-`secureHeaders` into `serializeResult` header construction** for the default static set (defaults first, handler headers overwrite) while still running `onResponse` for error / raw-`Response` paths. Semantics must match set-if-absent.
3. **Keep sync handlers** in docs examples for static routes.
4. **Do not** disable response validation, body limits, reserved headers, or smuggling checks to “make the bench green.”

## How to re-run

```sh
# Micro
pnpm bench && pnpm bench:serverless && pnpm bench:json && pnpm bench:json-e2e

# Cross-framework (Node 24, plugged in)
cd bench/cross-framework
nvm use
ulimit -n 65536
pnpm install --frozen-lockfile
node run.mjs --only=daloy,daloy-bare,hono,fastify
# publication-grade:
# WARMUP=30 ITERATIONS=10 DURATION=20 node run.mjs
```

Never remove or compromise built-in security features to improve these numbers.
