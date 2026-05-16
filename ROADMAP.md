# DaloyJS Roadmap

This document is the source of truth for what's shipped, what's next, and the order
we plan to ship it. It complements the [README](./README.md) (the pitch). Update
this file when scope changes — never let it drift behind reality.

**Versioning policy:** semver with a hard rule — every `0.x` minor bump may break
the public API; every `1.x` minor bump must not. Once `1.0.0` ships, deprecations
last at least one minor cycle before removal.

**Definition of done for every milestone:**

1. Implementation in `src/` with no `any` leaks across public types.
2. Tests added; `pnpm coverage` stays at **100% lines / 100% functions**.
3. `pnpm typecheck`, `pnpm test`, `pnpm build`, and CI pass.
4. Security impact considered; `SECURITY.md` or threat notes updated when relevant.
5. Public-facing docs (`website/app/docs/...`) updated.
6. README "Status" table reflects new capability.

---

## Now — `0.1.x` (shipped)

Published to npm as **`@daloyjs/core@0.9.0`**. The `0.1.x` foundation below is fully shipped; confidence/lifecycle cleanup shipped in the `0.2.x` line, the streaming/helper + OpenAPI extras work shipped in the `0.3.x` line, input ergonomics shipped in the `0.4.x` line, the first project-ops slice shipped in the `0.5.x` line, plugin lifecycle events shipped in the `0.6.x` line, edge-friendly sessions shipped in the `0.7.x` line, adapter/runtime modernization shipped in the `0.8.x` line, and additional incremental refinements shipped in the `0.9.x` line.

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
- [x] Supply-chain defaults for installs: `ignore-scripts=true`, `minimum-release-age=1440`, verified store integrity, reproducible lockfile preference, and explicit `pnpm.onlyBuiltDependencies` allowlisting.
- [x] Supply-chain hardened CI/CD: no `pull_request_target`, no shared GitHub Actions cache in CI, top-level `permissions: {}`, SHA-pinned third-party actions, `step-security/harden-runner`, isolated tag-only npm publish workflow, npm trusted publishing with `--provenance`, CodeQL, OpenSSF Scorecard, zizmor, Dependabot, and CODEOWNERS on privileged files.
- [x] Public maintainer/user guidance for supply-chain security in `SECURITY.md` and `website/docs/security/supply-chain`.
- [x] **100% line + function test coverage** enforced by the `coverage` script.
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
- [→] **WebSocket primitives** with adapter coverage for Node and Bun — moved to `0.11.0`.

---

## Next — `0.10.0` ("close out confidence & lifecycle")

Finishes the leftover `0.2.x` items so the confidence/lifecycle milestone exits
cleanly before any new feature work. Both are `1.0.0` gates.

- [x] **Branch coverage gate established** — shipped as `pnpm coverage:branches` running against compiled JS, currently enforced at `>= 95%` in CI. This is the "stable high-confidence gate" the `1.0.0` criteria require.
- [ ] **Ratchet branch coverage gate to `>= 98%`** — incrementally add tests for currently-uncovered branches in the worst files (`lambda`, `openapi`, `client`, `cli`, `streaming`) and bump `--test-coverage-branches` in `package.json` as the floor rises. Tracked separately from the gate itself because it is iterative test work, not infrastructure.

---

## Then — `0.11.0` ("real-time")

- [ ] **WebSocket primitives** with adapter coverage for Node and Bun.

---

## Pre-1.0 — `0.12.0` ("AI-friendly route metadata")

Additive, non-breaking. Pulled out of the research bucket because the surface
is small (optional fields on existing `route()` calls) and lands cleanly before
the `1.0.0` freeze. Does **not** change how routes or handlers are written —
existing routes keep working unchanged.

- [ ] **`meta` field on route definitions** (optional): structured `examples`, `summary`, `description`, `tags`, free-form `x-*` extensions, all surfaced into the generated OpenAPI doc as `examples` / `x-daloy-*` vendor extensions.
- [ ] **Machine-readable usage examples**: request/response example pairs validated against the route's Standard Schema at build time, emitted into OpenAPI `examples` and into a sibling `routes.json` consumable by codegen agents and SDK builders.
- [ ] **`daloy inspect --ai`**: dumps the route catalog + examples + schemas as a single JSON document suitable for feeding to an LLM or codegen tool.
- [ ] Docs page in `website/app/docs/` showing how to author examples and how Hey API / agent tooling consumes them.

---

## Stabilization — `1.0.0` ("public API freeze")

Ship date target: when the items below are simultaneously true. We'd rather
delay `1.0.0` than freeze the wrong API.

- [ ] No breaking change in two consecutive `0.x` minors.
- [ ] At least three production users on file (internal + external).
- [ ] Public benchmark suite published with reproducible numbers.
- [ ] Migration guide from the most-used Node frameworks (Hono, Fastify, Elysia).
- [ ] Security policy and disclosure process have been exercised at least once.
- [ ] Branch coverage has a stable high-confidence gate; any ignored branches have documented runtime or source-map reasons. — Gate is shipped (`pnpm coverage:branches`); ratchet to `>= 98%` is the open subtask under `0.10.0`.

---

## Later — researching

Items we want but don't yet have a concrete design for. Anything here is fair
game to prototype, but nothing here blocks `1.0.0`.

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
