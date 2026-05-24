# DaloyJS Roadmap

This document is the source of truth for what's shipped, what's next, and the order
we plan to ship it. It complements the [README](./README.md) (the pitch). Update
this file when scope changes — never let it drift behind reality.

> **Release-slice naming.** Each shipped release below is identified by its
> semver tag (e.g. `0.15.0`) and a short thematic descriptor. The original
> per-release planning breakdown lives in
> [`otherdocs/secure-by-default-plan.md`](./otherdocs/secure-by-default-plan.md)
> for archaeological reference.

**Versioning policy:** semver with a hard rule — every `0.x` minor bump may break
the public API; every `1.x` minor bump must not. Once `1.0.0` ships, deprecations
last at least one minor cycle before removal.

**Definition of done for every milestone:**

1. Implementation in `src/` with no `any` leaks across public types.
2. Tests added; `pnpm coverage` stays at **≥90% lines / 90% functions** with `pnpm coverage:branches` at **≥90% branches** (relaxed from 100% — see [AGENTS.md](AGENTS.md): on hard security work, ship the feature instead of chasing useless coverage of unreachable defensive branches or tsx phantom lines).
3. `pnpm typecheck`, `pnpm test`, `pnpm build`, and CI pass.
4. Security impact considered; `SECURITY.md` or threat notes updated when relevant.
5. Public-facing docs (`website/app/docs/...`) updated.
6. README "Status" table reflects new capability.

---

## Now — `0.1.x` (shipped)

Published to npm as **`@daloyjs/core@0.32.0`**. The `0.1.x` foundation below is fully shipped; confidence/lifecycle cleanup shipped in the `0.2.x` line, the streaming/helper + OpenAPI extras work shipped in the `0.3.x` line, input ergonomics shipped in the `0.4.x` line, the first project-ops slice shipped in the `0.5.x` line, plugin lifecycle events shipped in the `0.6.x` line, edge-friendly sessions shipped in the `0.7.x` line, adapter/runtime modernization shipped in the `0.8.x` line, banner + Node ≥ 24.15 runtime upgrade shipped in the `0.9.x` line, branch coverage gate shipped in the `0.10.x` line, WebSocket primitives shipped in the `0.11.x` line, security hardening (CSRF Fetch-Metadata, CSP nonce + Trusted Types, `basicAuth`) shipped in the `0.12.x` line, the DX polish slice (`createApp()` alias, `daloy dev` watcher with `--runtime` override, OpenAPI `info` autofill from `deno.json` / `deno.jsonc`) shipped in the `0.13.x` line, AI-friendly route metadata + `daloy inspect --ai` + YAML dumps shipped in the `0.14.x` line, the focused **secure-by-default** slice (log redaction defaults, stripped `Server` / `X-Powered-By`, duplicate `Host` / `Content-Length` rejection, `passwordHash` / `passwordVerify` at `@daloyjs/core/hashing`, `verifyWebhookSignature` + `signWebhookPayload`, and explicit `app({ env })` option with `NODE_ENV` mismatch warning) shipped in the `0.15.0` release, the focused **secure-by-default** slice (`secureHeaders()` auto-applied, cross-origin state-changing requests rejected with `403` unless `cors()` allows, per-route `accepts` content-type opt-in) shipped in the `0.16.0` release, the focused **secure-by-default** slice (refuse-to-boot on weak session secrets / `cors({ origin: "*" })` / `session()` + state-changing route without `csrf()`, plus first-request `500` on unconfigured `X-Forwarded-*` headers) shipped in the `0.17.0` release, and the focused **secure-by-default** slice (connection-draining shutdown with `Connection: close` on `503` and on in-flight responses, idle-connection close hook on the Node adapter, `crashOnUnhandledRejection` default-on in production, `app.healthcheck()` / `app.readinesscheck()` primitives with bearer-token auth, per-IP rate limit, and refuse-to-boot in production without `acknowledgeUnauthenticated: true`) shipped in the `0.18.0` release, and the focused **secure-by-default** slice (`rateLimit({ groupId })` shared buckets across related routes, `combine` primitives `every` / `some` / `except` for declarative middleware composition, `ipRestriction()` with CIDR-aware IPv4/IPv6 allow/deny lists, and `internal: true` route flag enforced by `app.fetch` → `404` while `app.inject` dispatches normally) shipped in the `0.19.0` release, and the focused **production fitness & deploy hardening** slice (`app({ behindProxy })` declarative model, adapter-independent `ConnInfo` abstraction, `daloy doctor` posture validator, container-first `create-daloy` templates with `HEALTHCHECK` + `STOPSIGNAL SIGTERM` + non-root + `tini`, PSL-aware `subdomains()` helper, lazy `info.remote` accessor, plugin `dependencies: string[]` refuse-to-boot, namespace-protected decorators, explicit plugin extension `before` / `after` ordering with cycle detection, `behindProxy` collapses `maxIpsCount` to the `(N+1)`-from-rightmost slot, `defineDependency()` typed-DI chain helper, scheme-aware `ctx.state.auth` typed contract, plugin lifecycle encapsulation default of `local`, and required `name` + optional `seed` for stateful plugins) shipped in the `0.24.0` release, the first focused **when-we-ship-it conditionals** slice — a portable `compression()` middleware (built on `CompressionStream`, prefers `br` > `gzip` > `deflate`) with BREACH-aware always-on guards (skip `Set-Cookie` / `Authorization` / session-or-CSRF cookie / already-compressed content types), `minimumSize: 1024` + negative-ratio post-check, no `compressLevel: 9` opt-in, always-on `Vary: Accept-Encoding`, and strong → weak ETag downgrade per RFC 9110 — shipped in the `0.25.0` release, the focused **secure-by-default** slice (`secureDefaults: false` production acknowledgement + audit log, JWT HS-secret length refusal, `secureHeaders()` dual framing-defense refusal, and mandatory 2FA release-audit docs) shipped in the `0.26.0` release, and the remaining **secureDefaults** cross-cutting bake-ins (cookie/time-claim SSoT helpers, `__Secure-` cookie refusal, zero-runtime-deps and secret-comparison CI gates) shipped in the `0.27.0` release, the focused **pattern-agnostic-framework** parity audit suite (`scripts/verify-parity-audits.ts` static gates wired into CI as `pnpm verify:parity-audits` + `daloy doctor --audit-defaults` live-config audits) shipped in the `0.28.0` release, and the focused **zero-runtime-dependency** batteries-included parity & governance audit (`SECURITY-CONTACTS.md` rotation file, `scripts/verify-governance-audits.ts` static gates wired into CI as `pnpm verify:governance-audits`, release workflow contributor-rotation refusal, plugin-prerequisite + `topoSortExtensions` cycle-detection reaffirm, and the documented governance floor with `SECURITY.md` waiver-required removal) shipped in the `0.29.0` release, the focused **multi-runtime** web-standard ergonomic-framework parity bake-ins slice (auth-failure `Cache-Control: no-store` baked into `UnauthorizedError` / `ForbiddenError` / `TooManyRequestsError`, CSP report receiver hardening — `application/json` refused with `415`, `maxBodyBytes > 64 KiB` refused at construction, the default production sink omits the report body unless `logCspReportBodies: true` is set explicitly — `cors()` `allowMethods` default narrowed to `[GET, HEAD, POST]` with `methods: ['*']` refused at construction, reverse-proxy helper absence audit, and compression skip-already-encoded reaffirm — wired into CI as `pnpm verify:runtime-parity-audits` via [`scripts/verify-runtime-parity-audits.ts`](./scripts/verify-runtime-parity-audits.ts)) shipped in the `0.30.0` release, the focused **mature-Node** ergonomic-framework second-pass bake-ins shipped in the `0.31.0` release, and the **0.32.0 leftover focused slice** (WebSocket post-upgrade header immutability + pre-upgrade auth refuse-at-registration, `httpError({ res })` state-mutating-header refusal + Context-aware merge, and middleware-order header-conflict refusal via `responseHeaders[]`) shipped in the `0.32.0` release.

- [x] Trie router with static fast path, traversal guard, real `405 + Allow`.
- [x] Contract-first `app.route()`, groups, encapsulated plugins, decorators.
- [x] Standard Schema validation (Zod 4 / Valibot / ArkType / TypeBox).
- [x] RFC 9457 problem+json error model with prod-mode redaction.
- [x] OpenAPI 3.1 generator built into the core.
- [x] In-process test client + contract-test runner.
- [x] In-process typed client factory + Hey API codegen integration (`pnpm gen`).
- [x] Adapters: Node / Bun / Deno / Cloudflare Workers / Vercel Edge.
- [x] Security primitives: body limits, content-type allowlist, prototype-pollution-safe JSON, path-traversal rejection, request timeout, header injection guards.
- [x] Security middleware: `secureHeaders`, `cors`, `rateLimit`, `requestId`, `bearerAuth`, `timing`, `timingSafeEqual`.
- [x] Pluggable structured logger + request id propagation.
- [x] Graceful shutdown.
- [x] `app.onClose()` lifecycle hook and augmentable `AppState` for plugin-typed context.
- [x] Mock mode.
- [x] Scalar + Swagger UI handlers.
- [x] pnpm-first distribution with hardened `.npmrc`.
- [x] Supply-chain defaults for installs: `ignore-scripts=true`, `minimum-release-age=1440`, verified store integrity, reproducible lockfile preference, and an explicit pnpm workspace `allowBuilds` allowlist.
- [x] Supply-chain hardened CI/CD: no `pull_request_target`, no shared GitHub Actions cache in CI, top-level `permissions: {}`, SHA-pinned third-party actions, `step-security/harden-runner`, isolated tag-only npm publish workflow, npm trusted publishing with `--provenance`, CodeQL + Opengrep dual SAST (cosign-verified release binary), OpenSSF Scorecard, zizmor, Dependabot, and CODEOWNERS on privileged files.
- [x] Public maintainer/user guidance for supply-chain security in `SECURITY.md` and `website/docs/security/supply-chain`.
- [x] **≥90% line + function coverage / ≥90% branch coverage** enforced by the `coverage` and `coverage:branches` scripts (relaxed from 100% — see [AGENTS.md](AGENTS.md) for the pragmatic-escape clause on complex security work).
- [x] Regression coverage for repo-level security posture and scaffolder `.npmrc` hardening.

---

## Current — `0.2.x` ("confidence & lifecycle")

Goal: make every change safer to ship before expanding the feature surface.
None of these break the existing public API.

- [x] **`onSend` hook** symmetric to `beforeHandle` for response transformation.
- [x] **GitHub Actions CI** running install, typecheck, tests, coverage, build, and audit.
- [x] **Security policy** (`SECURITY.md`) and vulnerability disclosure process.
- [x] **Release pipeline hardening**: protected npm publish environment, OIDC trusted publishing with provenance, blocked egress on publish jobs, and static workflow/security scanners.
- [x] **Project scaffolder** (`pnpm create daloy`) shipped as `packages/create-daloy` with `node-basic`, `vercel-edge`, and `cloudflare-worker` templates.
- [x] **Docs discoverability + integration docs**: per-page metadata, sitemap, robots, OpenGraph image, and ORM guides in `website`.
- [x] **Branch coverage gate** — dist-based `pnpm coverage:branches` (compiled JS, no tsx source-map noise) enforced in CI at `>= 95%`; established as the stable, ratchetable floor. See `tsconfig.coverage.json` and the `coverage:branches` script.
- [x] **Docs cleanup**: publish a maintainer-facing release checklist (in `SECURITY.md`) and keep package naming/examples aligned with `@daloyjs/core`.

**Exit criteria:** every item above either ships or is moved to a later milestone
with an explicit reason. No silent dropouts.

---

## After — `0.3.x` ("streaming & observability")

Streaming and tracing are adapter-sensitive, so each item starts with an API
design issue before implementation.

- [x] **Streaming response helpers**: SSE + NDJSON with backpressure-safe writers (`sseStream`, `sseResponse`, `ndjsonStream`, `ndjsonResponse`).
- [x] **OpenTelemetry tracing hook** (`otelTracing`): per-request `SERVER` span with HTTP semantic-convention attributes; ends in `onSend`, escalates 5xx and thrown handlers to `ERROR`.
- [x] **OpenAPI extras**: `securitySchemes` builders (`httpBearerScheme`, `httpBasicScheme`, `apiKeyScheme`, `oauth2Scheme`, `openIdConnectScheme`), top-level `webhooks`, per-operation `callbacks`, and `discriminator` / `discriminatedUnion` helpers.

---

## Then — `0.4.0` ("input ergonomics")

- [x] **Multipart/form-data** ergonomics: typed file fields, per-field size caps, MIME allowlist, OpenAPI-aware emission (`fileField`, `multipartObject`, `AppOptions.multipart`).
- [x] **CSRF helper** middleware (double-submit cookie + same-site policy).

---

## Then — `0.5.0` ("project ops")

- [x] **More scaffolder templates** (Bun, Deno) and a `--minimal` flag.
- [x] **Rate-limit Redis store** as `@daloyjs/core/rate-limit-redis` sub-export with adapters for ioredis and node-redis.
- [x] **CLI inspector**: `daloy inspect` for routes, schemas, dead routes, missing operationIds.

---

## Later `0.x` — ("real-time & extensibility")

- [x] **Plugin lifecycle events** (`onPluginInstalled`, `onShutdown`) for observability plugins.
- [x] **Edge-friendly session primitive**: signed-cookie (`__Host-` prefix, HMAC-SHA256, key rotation) with a pluggable `SessionStore` (default in-memory, KV/Redis-friendly) exposed as `ctx.state.session`.
- [x] **Security hardening** — CSRF Fetch-Metadata strategy, dual CSRF (`"both"`), CSP nonce + Trusted Types in `secureHeaders()`, `basicAuth()` middleware with UTF-8 credential decoding, construction-time validation, and `basicAuth` exports — shipped in `0.12.0`.
- [x] **DX polish** — `createApp(options)` factory alias for `new App(options)`, `daloy dev [entry]` one-command watch loop that delegates to `node --import tsx --watch` / `bun --hot` / `deno run --watch` with a `--runtime <node|bun|deno>` override for `package.json` scripts, and OpenAPI `info` autofill extended to read `deno.json` / `deno.jsonc` when no `package.json` is present — shipped in `0.13.0`.
- [x] **OpenAPI YAML endpoint** — `docs: true` now mounts `GET /openapi.yaml` alongside `GET /openapi.json`, configurable via `openapiYamlPath` (or `false` to disable), backed by a dependency-free YAML 1.2 serializer exported as `openapiToYAML` — shipped in `0.13.1`.
- [x] **WebSocket primitives** with adapter coverage for Node and Bun — shipped in `0.11.0`.

---

## Next — `0.10.0` ("close out confidence & lifecycle")

Finishes the leftover `0.2.x` items so the confidence/lifecycle milestone exits
cleanly before any new feature work. Both are `1.0.0` gates.

- [x] **Branch coverage gate established** — shipped as `pnpm coverage:branches` running against compiled JS, currently enforced at `>= 95%` in CI. This is the "stable high-confidence gate" the `1.0.0` criteria require.
- [ ] **Ratchet branch coverage gate to `>= 98%`** — incrementally add tests for currently-uncovered branches in the worst files (`lambda`, `openapi`, `client`, `cli`, `streaming`) and bump `--test-coverage-branches` in `package.json` as the floor rises. Tracked separately from the gate itself because it is iterative test work, not infrastructure.

---

## Then — `0.11.0` ("real-time")

- [x] **WebSocket primitives** with adapter coverage for Node and Bun — runtime-agnostic RFC 6455 frame protocol in `src/websocket.ts`, typed `app.ws(path, handler)` registration, `defineWebSocket()` helper, and adapter wiring for `@daloyjs/core/node` and `@daloyjs/core/bun`. Bun uses the native `Bun.serve` `websocket` config; Node uses an HTTP upgrade listener (only installed when WS routes exist) with a streaming `FrameSink` parser, auto-PONG, and graceful close. Subpath export `@daloyjs/core/websocket` re-exports the primitives for custom adapters.

---

## Pre-1.0 — `0.14.0` ("AI-friendly route metadata")

Additive, non-breaking. Pulled out of the research bucket because the surface
is small (optional fields on existing `route()` calls) and lands cleanly before
the `1.0.0` freeze. Does **not** change how routes or handlers are written —
existing routes keep working unchanged.

- [x] **`meta` field on route definitions** (optional): structured `examples`, `summary`, `description`, `tags`, free-form `x-*` extensions, all surfaced into the generated OpenAPI doc as `examples` / `x-daloy-*` vendor extensions.
- [x] **Machine-readable usage examples**: request/response example pairs validated against the route's Standard Schema at build time, emitted into OpenAPI `examples` and into a sibling `routes.json` consumable by codegen agents and SDK builders (`daloy inspect --ai > routes.json`).
- [x] **`daloy inspect --ai`**: dumps the route catalog + examples + schemas as a single JSON document suitable for feeding to an LLM or codegen tool.
- [x] **YAML output for the AI dump and the OpenAPI dump** via `--yaml` / `--format yaml` on both `daloy inspect --ai` and `daloy inspect --openapi` — typically ~30% smaller than the equivalent pretty-printed JSON, which is the realistic shape these dumps take when they end up inside an LLM system prompt. (Shipped as part of the `0.14.x` patch line; zero new runtime dependencies — uses the built-in YAML 1.2 serializer that already powers `GET /openapi.yaml`.)
- [x] Docs page in `website/app/docs/ai-metadata/` showing how to author examples and how Hey API / agent tooling consumes them.

---

## Ongoing — `0.15.0`+ ("secure-by-default initiative")

Converts Daloy's existing security middleware from opt-in to opt-out where
exactly one correct default exists, and adds a small set of high-value
primitives. Full plan with risk matrix, breaking-change boundaries, and per-slice
test surface in [`otherdocs/secure-by-default-plan.md`](./otherdocs/secure-by-default-plan.md).
The initial secure-by-default slices shipped from `0.15.0` through `0.19.0`,
followed by the lifecycle-leftovers slice
(`loadShedding()`, `app.cspReportRoute()` + `secureHeaders({ reportingEndpoints, reportTo })`,
`disconnectStatusCode: 499` default, `defineConfig({ schema, source })`)
in `0.20.0`, and a focused JWT / scopes / etag slice (`createJwtSigner()` /
`createJwtVerifier()` with `alg`-discipline + `exp`-required sign refusal,
`requireScopes()` with RFC-6750 challenge + per-request aggregation,
`etag()` helper with `Set-Cookie` / `Cache-Control: private | no-store | no-cache`
auto-skip) in `0.21.0`, and the auth-cohesive slice (`jwk()`
asymmetric-only JWKS middleware, `bearerAuth({ verify })`,
`basicAuth({ onAuthSuccess })`, and `Cache-Control: no-store` on auth 401
challenges) in `0.22.0`, and the WebSocket / login-throttle slice (`wsRateLimit()`,
`loginThrottle()`, `rotateSession()`, file-upload magic-byte guards,
`requirePayloadAuth`, and WebSocket safe defaults) in `0.23.0`, the focused
production fitness & deploy hardening slice in `0.24.0`, the first
focused compression slice in `0.25.0`, the focused secureDefaults
cross-cutting bake-ins slice in `0.26.0`, and the remaining SSoT bake-ins in `0.27.0`,
and the pattern-agnostic-framework parity audit suite (`scripts/verify-parity-audits.ts`
static gates, `daloy doctor --audit-defaults` live-config checks, snapshot-test
coverage for already-shipped runtime defaults) in `0.28.0`,
and the zero-runtime-dependency batteries-included parity & governance
audit (`SECURITY-CONTACTS.md` rotation file, `scripts/verify-governance-audits.ts`
static gates wired into CI, release-workflow contributor-rotation refusal,
plugin-prerequisite + `topoSortExtensions` cycle-detection reaffirm, and the
documented governance floor with `SECURITY.md`-waiver-required removal) in
`0.29.0`, the multi-runtime web-standard ergonomic-framework parity
bake-ins (auth-failure `Cache-Control: no-store`, CSP report receiver hardening,
narrowed `cors()` `allowMethods` default, reverse-proxy helper absence audit,
compression skip-already-encoded reaffirm) in `0.30.0`, and the focused
mature-Node ergonomic-framework second-pass bake-ins (semicolon-delimiter
refusal audit, error-handler-override refusal audit, `requestId()` trust-default
audit, `addHttpMethod` RFC-method runtime allowlist + audit, draining
`Connection: close` reaffirm audit) in `0.31.0`, and the WebSocket-header-immutability
leftover slice
(WebSocket post-upgrade header immutability + pre-upgrade auth refuse-at-registration,
`httpError({ res })` state-mutating-header refusal + Context-aware merge, and
middleware-order header-conflict refusal via `responseHeaders[]`) in `0.32.0`; the
remaining open initiative bullets below
are still planned work.

---

## Stabilization — `1.0.0` ("public API freeze")

Ship date target: when the items below are simultaneously true. We'd rather
delay `1.0.0` than freeze the wrong API.

- [ ] No breaking change in two consecutive `0.x` minors.
- [ ] At least three production users on file (internal + external).
- [ ] Public benchmark suite published with reproducible numbers.
- [ ] Migration guide from the most-used Node frameworks.
- [ ] Security policy and disclosure process have been exercised at least once.
- [ ] Branch coverage has a stable high-confidence gate; any ignored branches have documented runtime or source-map reasons. — Gate is shipped (`pnpm coverage:branches`); ratchet to `>= 98%` is the open subtask under `0.10.0`.

---

## Later — researching

Items we want but don't yet have a concrete design for. Anything here is fair
game to prototype, but nothing here blocks `1.0.0`.

- [ ] **Portable `pnpm verify:supply-chain` umbrella** — a single script that any CI host (GitLab CI, Bitbucket Pipelines, Azure Pipelines, Jenkins, Drone, on-prem) can call to run the portable supply-chain checks that are not GitHub-Actions-specific: `pnpm verify:lockfile`, `pnpm audit --prod`, `pnpm verify:sbom` (when a generated SBOM is present), and the zero-runtime-dep gate. Goal is a one-line CI integration that gives non-GitHub users the same install-time hardening the `--with-ci` bundle ships, without requiring us to author a workflow file per CI provider. Marketing claim split today (portable hardening vs. GitHub-only bundle) is enforced by README + website language; this script would make the portable half *runnable*, not just documented.
- [ ] HTTP/2 + HTTP/3 adapters (Node h2; explore Workers AutoHTTP/3).
- [ ] Pluggable serialization (CBOR, MessagePack) gated by `Accept`.
- [ ] First-class background-job interface (queue-agnostic).

---

## Out of scope (intentional)

Avoiding scope creep is part of the design. These are explicit non-goals:

- A built-in ORM or query builder.
- A bundled UI / view layer.
- Project-wide DI containers.
- Anything that requires patching `globalThis` or monkey-patching `Request`/`Response`.

---

## How to propose a roadmap change

1. Open an issue titled `roadmap: <change>`.
2. Describe the user-visible problem first; design comes second.
3. Reference the milestone you'd like the work to land in and why.
4. If accepted, open a PR that updates this file in the same change as the implementation.

The maintainers explicitly reserve the right to defer or drop items based on
real usage signal — the roadmap is a plan, not a contract.
