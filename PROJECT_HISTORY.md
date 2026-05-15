# DaloyJS — Project History & Mental Model

This document is the “re-onboarding” guide. It tells you, in order:

1. Why this project exists.
2. The exact sequence of decisions that shaped it.
3. Which files exist, why each one was created, and what role it plays.
4. The order features were added and what each unlocked.
5. How everything was renamed and shipped to the public repo.
6. Where to start coding next, and the safe ways to add features.

Keep this as a living log. When you add features, append an entry to the “Change log going forward” section at the bottom.

---

## 0. The one-paragraph elevator pitch

DaloyJS is a **runtime-portable, contract-first TypeScript web framework**. A single `app.route({...})` is the source of truth for **validation, types, OpenAPI 3.1, the typed client, and contract tests**. The core only knows `Request → Response` so the same app runs on **Node, Bun, Deno, Cloudflare Workers, and Vercel Edge**. It is **secure by default** (body limits, prototype-pollution-safe JSON, header/CRLF sanitization, path-traversal rejection, request timeouts, Helmet-grade headers, RFC 9457 problem+json with prod redaction). It is distributed via **pnpm** with a hardened `.npmrc`. Docs live in the Next.js 16 site under `daloyjs.dev/`.

Brand: **DaloyJS** · package: **`daloy`** · domain: **`daloyjs.dev`**.

---

## 1. The original problem and the design bet

Each existing framework is best at one thing and forces tradeoffs everywhere else:

- Hono — small + portable, OpenAPI is a plugin afterthought.
- Elysia — beautiful types, pulls toward Bun.
- Fastify — best Node ops story, Node-only, validation/types/docs not unified.
- FastAPI — best docs ergonomics, but Python.
- Hey API — best typed-client codegen, but you still need a server that emits a clean spec.
- npm — supply-chain hygiene is on you.

The bet: a framework can have **all of these wins simultaneously** if you make the route definition the contract and treat OpenAPI, the typed client, and contract tests as projections of that contract. That bet shaped every file in this repo.

Five non-negotiable principles:

1. **Explicit contracts, minimal ceremony.** One `app.route({...})` is the source of truth.
2. **Validation/typing/docs unified** via Standard Schema (Zod / Valibot / ArkType / TypeBox all work).
3. **Portable core, optional runtime optimizations.** Core is `Request → Response`. Runtime concerns live in adapters.
4. **Secure by default.** Bad defaults are bugs.
5. **Built for large-team maintenance**, not solo speed. Encapsulated plugins, decorators, request ids, structured logger, contract tests, introspection.

These principles explain every code decision below.

---

## 2. Step-by-step sequence: from empty workspace to deployed framework

This is the actual chronological narrative.

### Phase 1 — Project bootstrap

1. Started in an empty workspace folder.
2. Picked **TypeScript strict / ES2022 / NodeNext** as the baseline → created `tsconfig.json`.
3. Picked **pnpm** for supply-chain reasons → added `packageManager: "pnpm@9.15.0"` and a hardened `.npmrc`.
4. Defined the package shape with multiple **subpath exports** (`.`, `/node`, `/bun`, `/deno`, `/cloudflare`, `/vercel`, `/client`, `/openapi`, `/docs`, `/contract`) → wrote `package.json`. This locked the public API shape early so every later file had a known “home.”
5. Added a `.gitignore` and `dist/`, `coverage/`, `generated/` rules from day one.

### Phase 2 — The contract

6. Created `src/types.ts` — the entire framework’s vocabulary:
   - `HttpMethod`, `PathString`, `ParamsOf`, `PathParams`
   - `RequestSchemas`, `ResponseSpec`, `ResponsesMap`
   - `BaseContext`, `Hooks`, `AuthSpec`
   - `RouteDefinition` (the single source of truth)
   - `HandlerReturn` (status-discriminated union — this is what makes the typed client work later)
7. Created `src/schema.ts` — a tiny adapter over **Standard Schema v1** so any validator works (Zod, Valibot, ArkType, TypeBox).

This step is the project’s spine. Everything else is a projection of these types.

### Phase 3 — Errors as a first-class concern

8. Created `src/errors.ts` — RFC 9457 `application/problem+json` with subclasses:
   `HttpError`, `BadRequestError`, `ValidationError`, `NotFoundError`, `UnauthorizedError`, `ForbiddenError`, `MethodNotAllowedError`, `PayloadTooLargeError`, `UnsupportedMediaTypeError`, `TooManyRequestsError`, `RequestTimeoutError`, `InternalError`. Each has a stable `type` URI under `https://daloyjs.dev/errors/...`. Production mode redacts `detail` on 5xx.

### Phase 4 — Security primitives before any HTTP code

9. Created `src/security.ts` — security primitives the rest of the framework depends on:
   - `readBodyLimited` — streamed body read with hard cap (default 1 MiB).
   - `safeJsonParse` — strips `__proto__` / `constructor` / `prototype`.
   - `sanitizeHeaderName` / `sanitizeHeaderValue` — reject CRLF + NUL (response-splitting).
   - `timingSafeEqual` — credential comparison.
   - `randomId` — cryptographic request ids.

This came before `App` on purpose: secure defaults must be the only path, not an opt-in.

### Phase 5 — Routing

10. Created `src/router.ts` — a **trie-based router**:
    - Static routes resolve in **one `Map.get`** (~12M ops/sec on M-class CPU).
    - Dynamic params and wildcards walk a trie in O(segments).
    - Rejects `..` and empty segments before traversal.
    - Real `405` with `Allow` header (not a misleading 404).
    - Detects duplicate routes and conflicting param names at registration time.

### Phase 6 — Logger and middleware

11. Created `src/logger.ts` — a tiny Pino-style structured logger (`createLogger`, `noopLogger`, child bindings, level filtering, write override).
12. Created `src/middleware.ts` — built-in ops/security middleware:
    - `requestId({ trustIncoming, header, generator })`
    - `secureHeaders({ csp, hsts, frameOptions, ... })`
    - `cors({ origin, methods, ... })`
    - `rateLimit({ windowMs, max, store, retryAfter })` — token-bucket, pluggable store, `Retry-After`.
    - `timing()` — `Server-Timing` header.
    - `bearerAuth({ validate, realm })` — challenges with `WWW-Authenticate`.

### Phase 7 — The runtime: `App`

13. Created `src/app.ts` — the heart of the framework:
    - `new App(options)` with `bodyLimitBytes`, `allowedContentTypes`, `requestTimeoutMs`, `production`, `logger`, `mockMode`.
    - `app.route(def)`, `app.group({ prefix, tags, hooks, auth })`, `app.use(mw)`, `app.register(plugin, opts)`, `app.decorate(key, value)`.
    - `app.ready()`, `app.fetch(req)`, `app.request(input, init)`, `app.introspect()`, `app.shutdown(timeoutMs)`.
    - Lifecycle: `onRequest → beforeHandle → handler → afterHandle → onResponse` with `onError` interception.
    - Synthetic `OPTIONS` for CORS preflight.
    - HEAD falls back to GET with empty body.
    - Response serialization preserves explicit non-JSON bodies (string / Uint8Array / streams).
    - Production mode redacts 5xx detail and structured-logs every request.

### Phase 8 — Adapters

14. Created `src/adapters/node.ts` — `serve(app, opts)` with `requestTimeout`, `headersTimeout`, `maxHeaderSize`, signal handling, graceful shutdown.
15. Created `src/adapters/bun.ts` — thin wrapper around `app.fetch`, fails loudly outside Bun.
16. Created `src/adapters/deno.ts` — thin wrapper around `app.fetch`, fails loudly outside Deno.
17. Created `src/adapters/cloudflare.ts` — `toFetchHandler(app)`.
18. Created `src/adapters/vercel.ts` — `toEdgeHandler(app)`.

### Phase 9 — Contract-first projections

19. Created `src/openapi.ts` — `generateOpenAPI(app, { info, servers, securitySchemes })` produces a clean **OpenAPI 3.1** doc directly from registered routes (parameters, request body, responses, security, examples, tags).
20. Created `src/client.ts` — `createClient<App>(app, { baseUrl, fetch, headers })` returns an in-process **typed client keyed by `operationId`**. Each method takes `{ params, query, headers, body }` and returns a status-discriminated union.
21. Created `src/contract.ts` — `runContractTests(app)` validates examples against schemas, flags missing `operationId`, warns on body schemas for safe methods.
22. Created `src/docs.ts` — `scalarHtml`, `swaggerUiHtml`, `htmlResponse` for self-contained `/docs` pages with strict headers and HTML escaping.

### Phase 10 — The barrel

23. Created `src/index.ts` — explicit re-exports. This is what `import { App } from "daloy"` resolves to.

### Phase 11 — Examples and codegen

24. Created `examples/build-app.ts` — shared Bookstore app factory.
25. Created `examples/basic.ts` — runnable demo using the Node adapter.
26. Created `scripts/dump-openapi.ts` — writes `generated/openapi.json` from the example app.
27. Created `openapi-ts.config.ts` — Hey API config that reads `generated/openapi.json` and writes `generated/client/`.
28. Wired npm scripts: `gen:openapi`, `gen:client`, `gen`.

### Phase 12 — Tests (the safety net)

29. Built up tests in this order, each one driven by a real bug or risk:
    - `tests/router.test.ts` — static vs param precedence, wildcards, traversal rejection, allowedMethods.
    - `tests/security.test.ts` — body limits, content-type rejection, prototype pollution, 405 + Allow, traversal, rate limit, secure headers, request id, CORS preflight, bearerAuth, timingSafeEqual, mock mode, graceful shutdown.
    - `tests/app.test.ts` — schema validation, hooks, problem+json, 404, introspection, OpenAPI generation, duplicate operationId.
    - `tests/contract.test.ts` — clean app, invalid examples, body-on-safe-method warnings, missing operationId.
    - `tests/client-openapi.test.ts` — typed client param/query/header behavior, JSON parsing, non-JSON preservation, OpenAPI metadata/security.
    - `tests/middleware-extra.test.ts` — requestId trust policy, CORS allowlist, rateLimit stores/Retry-After, secureHeaders overrides, timing, bearerAuth invalid token.
    - `tests/docs-logger-adapters.test.ts` — HTML escape, htmlResponse headers, logger levels/child bindings, cloudflare/vercel adapters delegate, bun/deno guards.
    - `tests/app-lifecycle.test.ts` — query/header validation, hook order, onResponse on short-circuit, route-level onError, group/plugin merge, async plugin gating via `ready`, response schema redaction, undeclared status, request timeout, explicit non-JSON body, HEAD fallback.
30. Total at that point: **115 tests across 9 files**. The current framework suite is **119 tests across 10 root test files**, plus **7 `create-daloy` CLI/template tests**.

### Phase 13 — Hardening pass

31. Fixed CORS preflight to return 204 (was 405 originally).
32. Fixed `serializeResult` to pass through explicit non-JSON bodies (was JSON-stringifying HTML).
33. Hardened request-id trust policy.
34. Lifecycle fixes for route-level `onRequest`, route-level `onError`, `onResponse` for short-circuited responses, HEAD fallback.

### Phase 14 — Docs site (Next.js)

35. Scaffolded `daloyjs.dev/` as **Next.js 16.2.6 + React 19 + Tailwind v4**.
36. Manually created shadcn-style primitives (`button`, `card`, `badge`, `separator`) instead of running the CLI (the CLI hung on `pnpm approve-builds`).
37. Pinned `lucide-react@^0.475.0` (a wrong version was initially pulled).
38. Set `outputFileTracingRoot` and `turbopack.root` in `daloyjs.dev/next.config.mjs` so Next does not pick up the parent `src/middleware.ts`.
39. Built every docs page:
    - `/` — landing.
    - `/docs` — overview.
    - `/docs/installation`, `/docs/getting-started`
    - `/docs/routing`, `/docs/validation`, `/docs/plugins`, `/docs/errors`
    - `/docs/openapi`, `/docs/typed-client`, `/docs/testing`
    - `/docs/security`, `/docs/adapters`, `/docs/deployment`
    - `/docs/api-reference`
    - `/docs/tutorials/bookstore`

### Phase 15 — Naming and rename to DaloyJS

40. Picked the value proposition verbatim and explored Tagalog two-syllable names.
41. Decided: **brand `DaloyJS`**, **package `daloy`**, **domain `daloyjs.dev`**.
42. Verified availability signals (npm, domains, GitHub) — all unclaimed at the time.
43. Bulk-renamed across source/docs/config (used a Node script to avoid PowerShell quoting hangs).
44. Regenerated `generated/openapi.json` and `generated/client/`.
45. Patched README test count to `56/56` and the API reference to use lowercase `daloy/...` import paths.

### Phase 16 — Public repo and deployment

46. Decided to publish under a **GitHub organization `daloyjs`** with a **single monorepo `daloy`**, docs in `daloyjs.dev/`.
47. Created a fresh sibling folder `/Users/devlinduldulao/Documents/DEVELOPMENT/daloy` from the project, **excluding `.git`, `node_modules`, `dist`, `daloyjs.dev/.next`, etc.**, so the public repo starts at a single `Initial commit`.
48. SSH push was blocked because `~/.ssh/id_rsa` was a directory; switched to **GitHub CLI HTTPS auth** (`gh auth setup-git`) and pushed.
49. Added `"types": ["node"]` to both `tsconfig.json` files to fix VS Code Node type diagnostics; amended the public initial commit so history stays single-commit.
50. Deployment plan: **Vercel project**, root directory `daloyjs.dev`, attach the purchased `daloyjs.dev` domain.

This is the path you walked. From here, you can resume with full context.

---

## 3. File map — what exists, why, and where to touch

### Root config

- `package.json` — package name `daloy`, subpath exports, scripts (`build`, `test`, `typecheck`, `example`, `gen:openapi`, `gen:client`, `gen`, `audit`).
- `tsconfig.json` — strict, ES2022, NodeNext, `types: ["node"]`, includes only `src/**/*`.
- `.npmrc` — pnpm hardening: `auto-install-peers`, `strict-peer-dependencies`, `prefer-frozen-lockfile`, `verify-store-integrity`.
- `.gitignore` — ignores `node_modules`, `dist`, `coverage`, `generated/`, `daloyjs.dev/.next`, etc.
- `pnpm-lock.yaml` — reproducible installs.

### Framework source (`src/`)

| File | Why it exists |
|---|---|
| `src/types.ts` | The contract. `RouteDefinition`, request/response/auth/hooks/context types, `HandlerReturn` discriminated union. |
| `src/schema.ts` | Standard Schema v1 adapter — any validator works. |
| `src/errors.ts` | RFC 9457 problem+json hierarchy, prod-mode redaction. |
| `src/security.ts` | Security primitives every other module depends on. |
| `src/router.ts` | Trie router: static `Map.get`, dynamic O(segments), traversal rejection. |
| `src/logger.ts` | Tiny structured logger with child bindings. |
| `src/middleware.ts` | Built-in `requestId`, `secureHeaders`, `cors`, `rateLimit`, `timing`, `bearerAuth`. |
| `src/app.ts` | The runtime: lifecycle, hooks, error path, response serialization, groups, plugins, decorators, introspection, graceful shutdown. |
| `src/openapi.ts` | Generates OpenAPI 3.1 from registered routes. |
| `src/client.ts` | In-process typed client keyed by `operationId`. |
| `src/contract.ts` | Contract test runner. |
| `src/docs.ts` | Scalar/Swagger HTML helpers + `htmlResponse`. |
| `src/index.ts` | Public barrel. |

### Adapters (`src/adapters/`)

| File | Runtime | What it does |
|---|---|---|
| `node.ts` | Node ≥ 20.10 | `serve(app, opts)` with timeouts and graceful shutdown. |
| `bun.ts` | Bun | Thin wrapper around `app.fetch`. |
| `deno.ts` | Deno | Thin wrapper around `app.fetch`. |
| `cloudflare.ts` | Workers | `toFetchHandler(app)`. |
| `vercel.ts` | Vercel Edge | `toEdgeHandler(app)`. |

### Examples & scripts

- `examples/build-app.ts` — shared Bookstore app factory.
- `examples/basic.ts` — runnable demo via Node adapter (`pnpm example`).
- `scripts/dump-openapi.ts` — writes `generated/openapi.json` (`pnpm gen:openapi`).
- `openapi-ts.config.ts` — Hey API config (`pnpm gen:client`).
- `bench/router.bench.ts` — micro-benchmarks (`pnpm bench`).

### Tests (`tests/`)

10 root files, 119 framework tests, plus 7 `create-daloy` CLI/template tests under `packages/create-daloy/test/`. Order to read for understanding:

1. `router.test.ts` (the foundation)
2. `security.test.ts` (defaults that must hold)
3. `app.test.ts` (the runtime)
4. `app-lifecycle.test.ts` (hook ordering)
5. `middleware-extra.test.ts` (built-in middleware corner cases)
6. `client-openapi.test.ts` (contract-first projections)
7. `contract.test.ts` (cross-checks)
8. `docs-logger-adapters.test.ts` (peripheral subsystems)
9. `supply-chain-config.test.ts` (repo-level npm/GitHub Actions hardening)
10. `coverage.test.ts` (coverage-gate sanity checks)
11. `packages/create-daloy/test/templates.test.mjs` (scaffold/template regression tests)

### Generated artifacts (gitignored, regenerated by `pnpm gen`)

- `generated/openapi.json` — fresh spec from the example app.
- `generated/client/` — Hey API typed client.

### Docs site (`daloyjs.dev/`)

- `daloyjs.dev/package.json` — the docs app package manifest.
- `daloyjs.dev/next.config.mjs` — `outputFileTracingRoot` and `turbopack.root` to keep Next from picking up parent `src/middleware.ts`.
- `daloyjs.dev/app/layout.tsx` — root layout plus global metadata defaults.
- `daloyjs.dev/lib/seo.ts` — shared SEO metadata builder and site constants.
- `daloyjs.dev/app/sitemap.ts` / `daloyjs.dev/app/robots.ts` — search-engine discovery metadata.
- `daloyjs.dev/app/opengraph-image.tsx` — generated OG image for social sharing.
- `daloyjs.dev/components/site-header.tsx` — header/nav, brand `DaloyJS`, monogram `dj`, social links.
- `daloyjs.dev/app/page.tsx` — landing page.
- `daloyjs.dev/app/docs/*` — framework docs, including ORM integration guides and supply-chain security guidance.

### Supply-chain and release security

- `.npmrc` — repo-wide pnpm hardening: `ignore-scripts=true`, `minimum-release-age=1440`, frozen lockfile preference, verified store, strict peers, and publish provenance.
- `.github/workflows/ci.yml` — standard CI with top-level `permissions: {}`, no GitHub Actions cache, `--ignore-scripts`, `harden-runner`, typecheck, tests, coverage, build, audit, and create-daloy tests.
- `.github/workflows/release.yml` — isolated npm publish workflow. Triggered only by `v*` tags or maintainer dispatch, gated by the protected `npm-publish` environment, grants `id-token: write` only to publish jobs, uses npm trusted publishing with `--provenance`, and blocks unexpected egress.
- `.github/workflows/codeql.yml` — CodeQL for JavaScript/TypeScript and GitHub Actions workflow analysis.
- `.github/workflows/scorecard.yml` — OpenSSF Scorecard for continuous repo security posture checks.
- `.github/workflows/zizmor.yml` — static GitHub Actions workflow linting to catch dangerous patterns like `pull_request_target` with untrusted checkout.
- `.github/dependabot.yml` — weekly dependency updates for GitHub Actions, root npm dependencies, `create-daloy`, and the docs site.
- `.github/CODEOWNERS` — maintainer review gates for workflows, package manifests, lockfiles, `.npmrc`, and security docs.
- `tests/supply-chain-config.test.ts` — regression tests that assert the hardening controls stay present.
- `daloyjs.dev/app/docs/security/supply-chain/page.tsx` — public docs explaining the maintainer and user-facing supply-chain model.

---

## 4. The mental model in one diagram

```
                          ┌──────────────────┐
                          │  RouteDefinition │  ← single source of truth
                          └────────┬─────────┘
                                   │
       ┌───────────────────────────┼───────────────────────────┐
       │                           │                           │
       ▼                           ▼                           ▼
   Validation                  OpenAPI 3.1                 Typed Client
   (schema.ts)                 (openapi.ts)                (client.ts)
       │                           │                           │
       ▼                           ▼                           ▼
   Runtime checks         generated/openapi.json       in-process .operationId(...)
                                   │
                                   ▼
                              Hey API codegen → generated/client/
```

```
Request
  │
  ▼
secureHeaders → requestId → rateLimit → timing       (global middleware)
  │
  ▼
Router.find  ──→  405/Allow on method mismatch
  │                      404 on no match
  ▼
onRequest → beforeHandle → handler → afterHandle → onResponse
                       │              │
                       └── short-circuit Response (still runs onResponse)
  │
  ▼
serializeResult  (preserves explicit non-JSON bodies)
  │
  ▼
Response  (with secure headers, request id, timing, problem+json on errors)
```

---

## 5. Commands you will reuse

```bash
# install
pnpm install
cd daloyjs.dev && pnpm install && cd ..

# day-to-day
pnpm typecheck
pnpm test
pnpm build
pnpm example          # run the bookstore demo
pnpm gen              # regenerate openapi.json + typed client
pnpm bench            # micro-benchmark router

# docs site
cd daloyjs.dev
pnpm dev              # http://localhost:3000
pnpm lint
pnpm build
```

---

## 6. Where to start coding next

Pick from this list — each item is small enough to do in one sitting and lands a real improvement.

1. **`onSend` hook** for response transformation symmetric to `beforeHandle`.
2. **Multipart/form-data support** (currently `application/json` is the default body type).
3. **WebSocket adapter** for Node and Bun (the Web standard `Request` core does not cover WS by itself).
4. **Streaming response helpers** (SSE in particular).
5. **OpenAPI extras**: `securitySchemes` builder, `webhooks`, `callbacks`, `discriminator`.
6. **Rate-limit Redis store** as an optional sub-export.
7. **`pnpm create daloy` CLI** that scaffolds a starter project.
8. **CI workflow**: GitHub Actions running `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm audit`.
9. **Coverage** via `c8` and a badge in the README.
10. **`/docs` mounted in the example app** to ship Scalar UI alongside the API.

When you add a feature:

1. Start in `src/` with the smallest possible change.
2. If it touches the contract, edit `src/types.ts` first.
3. Add a focused test in the appropriate `tests/*.test.ts` file.
4. Run `pnpm test` and `pnpm typecheck`.
5. If it changes the public API, update `daloyjs.dev/app/docs/api-reference/page.tsx`.
6. If it changes a guide, update the relevant `daloyjs.dev/app/docs/*` page.

---

## 7. Branding and infrastructure cheatsheet

- Org: **`daloyjs`** on GitHub.
- Public repo: `https://github.com/daloyjs/daloy`.
- Old archive repo: `https://github.com/devlinduldulao/new-js-backend-framework` (keep private).
- npm package: **`daloy`** (not yet published).
- Domain: **`daloyjs.dev`** (purchased on Vercel).
- Docs deploy: Vercel project, **Root directory = `daloyjs.dev`**, framework preset Next.js.
- Auth quirk: local SSH key was broken; pushes go through `gh auth setup-git` (HTTPS).

---

## 8. Known small gotchas you’ll hit again

- `pnpm example` fails with `EADDRINUSE` if a Next dev server is on port 3000. Stop the offender or change ports.
- Vercel may refuse `sharp` / `unrs-resolver` install scripts under pnpm. Locally we ran `pnpm approve-builds`. If Vercel complains, commit the approval config.
- Next can accidentally pick up the parent `src/middleware.ts` if `outputFileTracingRoot` / `turbopack.root` are removed from `daloyjs.dev/next.config.mjs`.
- Do not run `git init` inside `daloyjs.dev/`. The monorepo has exactly one `.git` at the root.
- Do not “improve” `serializeResult` without re-reading the test that checks explicit non-JSON content types.

---

## 9. Change log going forward

Append entries here whenever you ship something. Newest at the top.

- _2026-05-15_ — fixed the release/CI runner configuration after GitHub Actions failed to resolve `node-version: 25.7.0` in `actions/setup-node`. The repo now uses the supported Node 24 line in `ci.yml` and `release.yml`, which restores the publish workflow and keeps CI on an available runtime.
- _2026-05-15_ — fixed the `zizmor` workflow after the manual `docker run ghcr.io/zizmorcore/zizmor:v1.25.0` step started failing with `manifest unknown`. The repo now uses the official pinned `zizmorcore/zizmor-action` integration, still locked to `zizmor v1.25.0`, which restores SARIF uploads without depending on an unpublished container tag.
- _2026-05-15_ — fixed the Scorecard workflow after OSSF rejected published results with `imposter commit` for the pinned `ossf/scorecard-action` SHA. The workflow now pins the real `v2.4.3` tag target commit from `ossf/scorecard-action`, which satisfies Scorecard's workflow verification rules.
- _2026-05-15_ — fixed the remaining Scorecard workflow rejection after OSSF flagged the pinned `github/codeql-action/upload-sarif` step as an `imposter commit`. The workflow now uses the same `upload-sarif` commit pin as the upstream OSSF Scorecard example, which matches Scorecard's allowed-action verification.
- _2026-05-15_ — documented the release workflow split more explicitly in `SECURITY.md`: signed `v*` tag pushes auto-publish `@daloyjs/core` after approval, while `create-daloy` remains a manual `workflow_dispatch` release so the CLI is not published unintentionally on every core tag.
- _2026-05-15_ — drafted repo-local GitHub release notes for `@daloyjs/core@0.1.3` and `create-daloy@0.1.9`, and fixed the last public README reference that still mentioned `create-daloy@0.1.8`.
- _2026-05-15_ — swept the remaining docs-site security copy to remove pnpm-only overstatements. Intro, installation, security, and tutorial pages now describe DaloyJS supply-chain posture as pnpm plus enforced project defaults and hardened publishing controls, which keeps the marketing claim strong while making it defensible.
- _2026-05-15_ — tightened the homepage and README supply-chain wording so the security claim stays promotional but precise: DaloyJS now explicitly credits pnpm plus the repo's enforced controls (blocked lifecycle scripts, release-age cooldowns, verified installs, SHA-pinned Actions, provenance publishing) instead of implying the framework alone inherits stronger guarantees just by using pnpm.
- _2026-05-15_ — prepared the next npm releases: bumped `@daloyjs/core` to `0.1.3` for the security-default changes (`rateLimit()` no longer trusts proxy headers by default, docs helpers support self-hosted assets/nonces, workflow actions are SHA-pinned) and bumped `create-daloy` to `0.1.9` so newly scaffolded apps depend on `@daloyjs/core@^0.1.3`. This is release prep only; actual npm publishing still needs to go through `release.yml`.
- _2026-05-15_ — finished the follow-up security cleanup after the initial supply-chain hardening pass. Pinned every third-party GitHub Action in the repo to immutable SHAs, updated the regression test to enforce SHA-pinned workflows, changed `rateLimit()` so proxy headers are not trusted by default unless `trustProxyHeaders: true` is set, added nonce/self-hosted docs asset support via `docsContentSecurityPolicy()` and `htmlResponse(..., opts)`, and synchronized the README plus security/deployment/API-reference docs to match the new behavior and wording. Verified `pnpm typecheck`, `pnpm test`, and `daloyjs.dev` typecheck/build.
- _2026-05-15_ — completed the npm/GitHub Actions supply-chain hardening pass after reviewing current npm incident writeups (TanStack cache poisoning + OIDC token extraction, chalk/debug maintainer phishing, Axios/node-ipc-style package compromise patterns). Added root `.npmrc` controls (`ignore-scripts=true`, `minimum-release-age=1440`, provenance, frozen/verified installs), isolated npm publishing into a protected `release.yml` workflow with OIDC trusted publishing and blocked egress, hardened CI, added CodeQL/Scorecard/zizmor/Dependabot/CODEOWNERS, shipped a public supply-chain docs page, updated SECURITY.md, hardened `create-daloy` template `.npmrc` files, and added regression tests in `tests/supply-chain-config.test.ts` plus `packages/create-daloy/test/templates.test.mjs`. Verified `pnpm coverage` (119 passing, 100% lines/functions), `pnpm typecheck`, `pnpm test`, `pnpm --filter create-daloy test`, `pnpm build`, `pnpm pack --dry-run`, and `daloyjs.dev` typecheck/build.
- _2026-05-14_ — added a shared `AppState` augmentation point and a real `app.onClose()` lifecycle hook to the core so plugin-provided state and cleanup callbacks are first-class, then added regression coverage for shutdown hooks (`src/types.ts`, `src/app.ts`, `src/index.ts`, `tests/app-lifecycle.test.ts`).
- _2026-05-14_ — improved `daloyjs.dev` discoverability with per-page metadata, canonical URLs, OpenGraph/Twitter cards, JSON-LD on the landing page, generated `sitemap.xml`, `robots.txt`, and an `opengraph-image` route. Added a new ORM section with guides for Prisma, Drizzle ORM, TypeORM, and Supabase, then wired the docs sidebar and sitemap to those pages (`daloyjs.dev/lib/seo.ts`, `daloyjs.dev/app/layout.tsx`, `daloyjs.dev/app/page.tsx`, `daloyjs.dev/app/sitemap.ts`, `daloyjs.dev/app/robots.ts`, `daloyjs.dev/app/opengraph-image.tsx`, `daloyjs.dev/app/docs/orm/**`, `daloyjs.dev/components/docs-sidebar.tsx`).
- _2026-05-14_ — added the official DaloyJS social links to the website: X (`https://x.com/daloyjs`), Bluesky (`https://bsky.app/profile/daloyjs.bsky.social`), and the GitHub organization (`https://github.com/daloyjs`). Wired them into the site header and landing page so visitors can find the project accounts immediately (`daloyjs.dev/components/site-header.tsx`, `daloyjs.dev/app/page.tsx`).
- _2026-05-14_ — added direct npm package links for both published packages to the Next.js docs site so users can jump straight from the docs to `@daloyjs/core` and `create-daloy` on npm (`daloyjs.dev/app/page.tsx`, `daloyjs.dev/app/docs/installation/page.tsx`, `daloyjs.dev/app/docs/scaffolder/page.tsx`).
- _2026-05-14_ — updated the create-daloy docs route to use the built-in Swagger UI helper instead of Scalar so the starter matches the FastAPI-style wording exactly. The Node starter now logs `Swagger UI: http://localhost:3000/docs` before the OpenAPI JSON URL, the temporary smoke-test folders (`fresh-docs`, `fresh-node`) were removed from the workspace, and the root/docs-site documentation was synchronized to describe Swagger UI-first starter behavior. Published `create-daloy@0.1.7` to npm.
- _2026-05-14_ — gave `create-daloy` starters FastAPI-style auto-docs: every scaffolded app now mounts `GET /docs` and `GET /openapi.json` automatically using `@daloyjs/core/docs` and `@daloyjs/core/openapi`. The Node starter logs both URLs at startup, and the Vercel template ships them inside the catch-all Edge route. Added regression tests in `packages/create-daloy/test/templates.test.mjs` to ensure both templates always include the docs routes, and published `create-daloy@0.1.6` to npm.
- _2026-05-14_ — fixed the `vercel-edge` scaffolder health route type widening bug by preserving `ok: true as const` in `api/[...path].ts`, added a regression test for the template, and published `create-daloy@0.1.5` as the patch release.
- _2026-05-14_ — normalized generated package-manager config in `create-daloy`: non-`pnpm` projects now drop the pnpm-specific `.npmrc` after scaffolding, which removes npm warning spam about unsupported `auto-install-peers`, `strict-peer-dependencies`, `prefer-frozen-lockfile`, and `verify-store-integrity`. Added a regression test for this behavior and published `create-daloy@0.1.4`. This does not change runtime behavior; it only avoids misleading install noise for npm users.
- _2026-05-14_ — fixed the `node-basic` scaffolder health route type widening bug by preserving `ok: true as const` in the generated template, added a regression test in `packages/create-daloy/test/templates.test.mjs`, and prepared `create-daloy@0.1.3` as the patch release.
- _2026-05-14_ — improved the `create-daloy` interactive experience without adding runtime dependencies: richer template labels/descriptions, `--list-templates`, package-manager selection, clearer scaffold progress output, and a more useful completion summary. Published `create-daloy@0.1.2` as the CLI polish release (`packages/create-daloy/bin/create-daloy.mjs`, docs, package README).
- _2026-05-14_ — prioritized Vercel in the scaffolder by adding a `vercel-edge` template to `packages/create-daloy` and documenting that Cloudflare Workers is an optional runtime target, not a required deployment path. The new template creates `api/[...path].ts` with `@daloyjs/core/vercel`, `export const config = { runtime: "edge" }`, `vercel dev` / `vercel deploy` scripts, and a smoke test. Updated scaffolder docs, deployment docs, README, and roadmap; published `create-daloy@0.1.1` and closed GitHub issue #13 as completed.
- _2026-05-14_ — published `create-daloy@0.1.0` and `@daloyjs/core@0.1.1` to the npm registry. The core release is a docs-only patch (README + roadmap), no `src/` changes; verified there were no functional differences from `0.1.0`. Fixed an `npm publish` warning by removing the `./` prefix from the `bin` field in `packages/create-daloy/package.json` (the registry now exposes `bin: { "create-daloy": "bin/create-daloy.mjs" }`). Seeded four follow-up issues on milestone `0.5.0` for additional scaffolder work (Bun, Deno, Vercel Edge templates, and a `--minimal` flag) at github.com/daloyjs/daloy/issues/11-14.
- _2026-05-14_ — split the original `0.2.0` roadmap into smaller releases (`0.2.0` confidence/lifecycle, `0.3.0` streaming/observability, `0.4.0` input ergonomics, `0.5.0` project ops), added `SECURITY.md` and `.github/workflows/ci.yml`, and synced GitHub milestones/labels for issues #1–#10 (`ROADMAP.md`, `README.md`, `SECURITY.md`, `.github/workflows/ci.yml`).
- _2026-05-14_ — shipped `packages/create-daloy`, the official `pnpm create daloy` / `npm create daloy` scaffolder. Zero-runtime-dependency CLI written in plain ESM (`bin/create-daloy.mjs`) with two starter templates (`node-basic`, `cloudflare-worker`), interactive prompts, non-interactive flags, project-name validation, package-manager auto-detection, optional `git init`, and template-file rename rules (`_gitignore` → `.gitignore`, `_npmrc` → `.npmrc`). Wired the root `pnpm-workspace.yaml` to include `packages/*` while excluding `daloyjs.dev`. Updated docs (`daloyjs.dev/app/docs/scaffolder/page.tsx`, sidebar, installation page) and moved the scaffolder roadmap item from `0.5.0` to a shipped `0.2.0` checkbox.
- _2026-05-14_ — moved the recommended validator path to Zod 4, updated install/docs examples, and made OpenAPI schema fallback tolerate both Zod 3-style and Zod 4-style internals while keeping Standard Schema support (`package.json`, `pnpm-lock.yaml`, `src/openapi.ts`, `README.md`).
- _2026-05-14_ — upgraded the framework toolchain to TypeScript 6, moved Hey API codegen to a TS6-compatible release, added explicit Prettier codegen formatting, and enabled stable declaration type ordering (`package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `openapi-ts.config.ts`, `README.md`).
- _YYYY-MM-DD_ — short summary of the change, file(s) touched, test added.
