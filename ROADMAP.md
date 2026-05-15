# DaloyJS Roadmap

This document is the source of truth for what's shipped, what's next, and the order
we plan to ship it. It complements [PROJECT_HISTORY.md](./PROJECT_HISTORY.md) (the
"why" log) and the [README](./README.md) (the pitch). Update this file when scope
changes — never let it drift behind reality.

**Versioning policy:** semver with a hard rule — every `0.x` minor bump may break
the public API; every `1.x` minor bump must not. Once `1.0.0` ships, deprecations
last at least one minor cycle before removal.

**Definition of done for every milestone:**

1. Implementation in `src/` with no `any` leaks across public types.
2. Tests added; `pnpm coverage` stays at **100% lines / 100% functions**.
3. `pnpm typecheck`, `pnpm test`, `pnpm build`, and CI pass.
4. Security impact considered; `SECURITY.md` or threat notes updated when relevant.
5. Public-facing docs (`daloyjs.dev/app/docs/...`) updated.
6. Entry appended to `PROJECT_HISTORY.md` § 9 (change log).
7. README "Status" table reflects new capability.

---

## Now — `0.1.x` (shipped)

Published to npm as **`@daloyjs/core@0.1.2`**. Main is prepared for **`0.1.3`** with the latest security-default updates.

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
- [x] Public maintainer/user guidance for supply-chain security in `SECURITY.md` and `daloyjs.dev/docs/security/supply-chain`.
- [x] **100% line + function test coverage** enforced by the `coverage` script.
- [x] Regression coverage for repo-level security posture and scaffolder `.npmrc` hardening.

---

## Next — `0.2.0` ("confidence & lifecycle")

Goal: make every change safer to ship before expanding the feature surface.
None of these break the existing public API.

- [ ] **`onSend` hook** symmetric to `beforeHandle` for response transformation.
- [x] **GitHub Actions CI** running install, typecheck, tests, coverage, build, and audit.
- [x] **Security policy** (`SECURITY.md`) and vulnerability disclosure process.
- [x] **Release pipeline hardening**: protected npm publish environment, OIDC trusted publishing with provenance, blocked egress on publish jobs, and static workflow/security scanners.
- [ ] **Branch coverage push** to `>= 98%` with a coverage gate where the Node runner supports it cleanly.
- [x] **Project scaffolder** (`pnpm create daloy`) shipped as `packages/create-daloy` with `node-basic`, `vercel-edge`, and `cloudflare-worker` templates.
- [x] **Docs discoverability + integration docs**: per-page metadata, sitemap, robots, OpenGraph image, and ORM guides in `daloyjs.dev`.
- [ ] **Docs cleanup**: publish a maintainer-facing release checklist and keep package naming/examples aligned with `@daloyjs/core`.

**Exit criteria:** every item above either ships or is moved to a later milestone
with an explicit reason. No silent dropouts.

---

## After — `0.3.0` ("streaming & observability")

Streaming and tracing are adapter-sensitive, so each item starts with an API
design issue before implementation.

- [ ] **Streaming response helpers**: SSE + NDJSON with backpressure-safe writers.
- [ ] **OpenTelemetry tracing hook** (`onRequest` -> span, `onResponse` -> end).
- [ ] **OpenAPI extras**: `securitySchemes` builder, `webhooks`, `callbacks`, `discriminator`.

---

## Then — `0.4.0` ("input ergonomics")

- [ ] **Multipart/form-data** ergonomics: typed file fields, per-field size caps, streaming uploads.
- [ ] **CSRF helper** middleware (double-submit cookie + same-site policy).

---

## Then — `0.5.0` ("project ops")

- [ ] **More scaffolder templates** (Bun, Deno) and a `--minimal` flag.
- [ ] **Rate-limit Redis store** as `@daloyjs/rate-limit-redis` sub-export.
- [ ] **CLI inspector**: `daloy inspect` for routes, schemas, dead routes, missing operationIds.

---

## Later `0.x` — ("real-time & extensibility")

- [ ] **WebSocket primitives** with adapter coverage for Node and Bun.
- [ ] **Plugin lifecycle events** (`onPluginInstalled`, `onShutdown`) for observability plugins.

---

## Stabilization — `1.0.0` ("public API freeze")

Ship date target: when the items below are simultaneously true. We'd rather
delay `1.0.0` than freeze the wrong API.

- [ ] No breaking change in two consecutive `0.x` minors.
- [ ] At least three production users on file (internal + external).
- [ ] Public benchmark suite published with reproducible numbers.
- [ ] Migration guide from the most-used Node frameworks (Hono, Fastify, Elysia).
- [ ] Security policy and disclosure process have been exercised at least once.
- [ ] Branch coverage has a stable high-confidence gate; any ignored branches have documented runtime or source-map reasons.

---

## Later — researching

Items we want but don't yet have a concrete design for. Anything here is fair
game to prototype, but nothing here blocks `1.0.0`.

- [ ] HTTP/2 + HTTP/3 adapters (Node h2; explore Workers AutoHTTP/3).
- [ ] Pluggable serialization (CBOR, MessagePack) gated by `Accept`.
- [ ] First-class background-job interface (queue-agnostic).
- [ ] Edge-friendly session primitive (signed cookie + KV-backed store).
- [ ] AI-friendly route metadata (machine-readable usage examples for codegen agents).

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
