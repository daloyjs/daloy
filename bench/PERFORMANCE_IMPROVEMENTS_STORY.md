# Performance improvements story

Living notes for benchmarking methodology and hot-path work on `@daloyjs/core`.
Run micro-benches before and after changes (`pnpm bench`, `pnpm bench:serverless`,
`pnpm bench:json`, `pnpm bench:json-e2e`, `pnpm bench:ablation`). For
cross-framework HTTP numbers use
`bench/cross-framework/` on Node 24 (`.nvmrc`), on AC power, with a raised
`ulimit -n`.

## Verdict (2026-07-17)

**DaloyJS performance is acceptable.** It is not a “slow framework”; the
default matrix measures a different product than bare Hono/Fastify:

| Posture                                                                 | What it does                                                                                                                       | Relative cost                                                                                                                           |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Full defaults** (`daloy`)                                             | Zod request + response validation, auto `secureHeaders`, cross-origin write guard, header smuggling / reserved-prefix / count caps | ~18–20% fewer req/s than `daloy-bare` in the 2026-07-17 run; ~25–26% behind validation-matched Hono on GET, but ~42% ahead on JSON echo |
| **Apple-to-apple** (`daloy-bare`, `preset: "internal-service"`, no Zod) | Router + dispatch only                                                                                                             | ~7–9% behind Fastify and ~10–12% behind Hono on GET; ~20–75% ahead on JSON echo                                                         |
| **In-process router**                                                   | `Router.find()` only                                                                                                               | ~26M static lookups/s — not the bottleneck                                                                                              |

Production apps almost always pay validation and security headers. Compare
secure-parity rows (`middleware-stack.mjs`, install/bundle secure parity) when
arguing production fitness, not the bare `GET /static` leaderboard alone.

## Fresh numbers (this machine)

**Machine:** Apple M3 Max, 16 cores, 64 GiB, AC power, Node v24.3.0 (micro) /
v26.4.0 (early micro) as recorded per run.

### In-process micro (`pnpm bench*`)

| Bench                            |                                                                                                         Result |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------: |
| Router static lookup             |                                                                     ~25.8M ops/s median (seven rotated rounds) |
| Router dynamic 4-segment         |                                                                                             ~2.1M ops/s median |
| Router miss                      |                                                                                             ~7.7M ops/s median |
| Serverless first fetch           |                                              ~2.6–3.7 ms median; every scenario sample runs in a fresh process |
| Serverless warm fetch            |                                                                                               ~21–23 µs median |
| JSON body limits ON vs OFF (e2e) | ~4% overhead (median of 5 rounds; per-round spread ~2–7%, so the bench reports the median, not a single round) |

### In-process dispatch ablation (dist `App.fetch`, no HTTP)

> **Caveat:** the numbers in the two tables below were measured with
> throwaway scripts before a checked-in harness existed, so they carry no
> raw samples or SHAs. A reproducible harness now lives at
> `bench/ablation.bench.ts` (`pnpm bench:ablation`): it runs the same config
> matrix (plus sync-vs-async bare handlers) against in-process
> `app.fetch` on `GET /static`, interleaves configs across rounds, reports
> the median across rounds, and writes raw samples + Node version, git SHA
> (with dirty flag), and machine info to `bench/results.ablation.json`
> (gitignored). Prefer `pnpm build` first — it benches `dist/` when built
> (like the tables below) and falls back to `src/` via tsx, recording which
> one ran as `moduleSource`. Re-run it before quoting these deltas.

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

Focused post-change run on Node 24.3.0, 100 connections, 5×5s, 10s warmup.
The headline is mean req/s with a 95% CI; rounded means are shown here:

| Framework        | GET /static | GET /users/:id | POST /echo |
| ---------------- | ----------: | -------------: | ---------: |
| hono             |      ~51.0k |         ~48.6k |     ~21.7k |
| hono-validated   |      ~48.8k |         ~47.9k |     ~21.4k |
| fastify          |      ~48.1k |         ~47.8k |     ~31.8k |
| **daloy-bare**   |  **~44.8k** |     **~43.6k** | **~38.0k** |
| **daloy** (full) |  **~36.6k** |     **~35.4k** | **~30.5k** |
| **daloy-nozod**  |  **~35.3k** |     **~34.8k** | **~30.7k** |

The secured-stack run (request ID, headers, CORS, rate limit, HS256 JWT)
measured Daloy at ~23.1k / 22.7k / 20.6k. That beat validation-matched Hono
(~17.4k / 17.3k / 11.7k) and trailed non-Zod Fastify on GET
(~29.3k / 29.1k) while matching its echo path (~21.0k). Do not call the
Fastify comparison full behavioral parity until it uses the same Zod request
and response schemas.

The older full-matrix run used 5×10s and a 15s warmup.
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
- Battery + FD-limit warnings
- Variants: `daloy-bare`, `daloy-shed`, `*-nozod`, `hono-validated`, secured stack

### Gaps / improvements

| Gap                                                                  | Why it matters                                                                                                                        | Suggested fix                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Missing `PERFORMANCE_IMPROVEMENTS_STORY.md` (was linked from README) | Agents/humans had no history                                                                                                          | This file                                                                                                                                                                                                                                        |
| Ablation numbers not reproducible                                    | The in-process dispatch tables above have no checked-in script, raw samples, or before/after SHAs — they are assertions, not evidence | **Fixed:** `bench/ablation.bench.ts` (`pnpm bench:ablation`) runs the config matrix and records Node version, git SHA + dirty flag, machine info, and raw samples to `bench/results.ablation.json`; the historical tables above still predate it |
| Throughput servers use `async` handlers for pure sync work           | ~15% self-inflicted on Daloy; others often sync                                                                                       | **Fixed:** synchronous work now uses synchronous handlers where framework APIs allow                                                                                                                                                             |
| Orange-to-apple still easy to misread                                | Marketing tables quote bare routers vs full Daloy                                                                                     | Lead with uncertainty groups plus `daloy-bare`, `daloy-nozod`, and `hono-validated`; document the posture in every claim                                                                                                                         |
| No pin of “quiet machine” gate                                       | High loadAvg makes ±10% noise                                                                                                         | Fail or warn when `loadAvg[0] > cpuCount`                                                                                                                                                                                                        |
| Full matrix ~35–90 min                                               | Discourages pre-merge runs                                                                                                            | Keep `smoke.mjs`; add `bench:ci` subset (daloy, daloy-bare, hono, fastify, 1 iter / 3s)                                                                                                                                                          |
| Client is autocannon only                                            | Fine for HTTP; fetch-based scripts understate concurrency fairness                                                                    | Keep autocannon for publish; document client                                                                                                                                                                                                     |
| Multi-runtime not in matrix                                          | Bun/Deno numbers differ                                                                                                               | Optional `RUNTIME=bun` note already in README — add one scheduled Bun pass                                                                                                                                                                       |
| Router micro-bench in root README                                    | Not comparable to HTTP                                                                                                                | Keep disclaimer; prefer cross-framework for claims                                                                                                                                                                                               |

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

# Dispatch ablation (build first so it benches dist, like the tables above)
pnpm build && pnpm bench:ablation

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
