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

Published to npm as **`@daloyjs/core@0.12.0`**. The `0.1.x` foundation below is fully shipped; confidence/lifecycle cleanup shipped in the `0.2.x` line, the streaming/helper + OpenAPI extras work shipped in the `0.3.x` line, input ergonomics shipped in the `0.4.x` line, the first project-ops slice shipped in the `0.5.x` line, plugin lifecycle events shipped in the `0.6.x` line, edge-friendly sessions shipped in the `0.7.x` line, adapter/runtime modernization shipped in the `0.8.x` line, banner + Node ≥ 24.15 runtime upgrade shipped in the `0.9.x` line, branch coverage gate shipped in the `0.10.x` line, WebSocket primitives shipped in the `0.11.x` line, and security hardening (CSRF Fetch-Metadata, CSP nonce + Trusted Types, `basicAuth`) shipped in the `0.12.x` line.

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
- [x] **Security hardening** — CSRF Fetch-Metadata strategy, dual CSRF (`"both"`), CSP nonce + Trusted Types in `secureHeaders()`, `basicAuth()` middleware with UTF-8 credential decoding, construction-time validation, and `basicAuth` exports — shipped in `0.12.0`.
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

## Pre-1.0 — `0.13.0` ("AI-friendly route metadata")

Additive, non-breaking. Pulled out of the research bucket because the surface
is small (optional fields on existing `route()` calls) and lands cleanly before
the `1.0.0` freeze. Does **not** change how routes or handlers are written —
existing routes keep working unchanged.

- [ ] **`meta` field on route definitions** (optional): structured `examples`, `summary`, `description`, `tags`, free-form `x-*` extensions, all surfaced into the generated OpenAPI doc as `examples` / `x-daloy-*` vendor extensions.
- [ ] **Machine-readable usage examples**: request/response example pairs validated against the route's Standard Schema at build time, emitted into OpenAPI `examples` and into a sibling `routes.json` consumable by codegen agents and SDK builders.
- [ ] **`daloy inspect --ai`**: dumps the route catalog + examples + schemas as a single JSON document suitable for feeding to an LLM or codegen tool.
- [ ] Docs page in `website/app/docs/` showing how to author examples and how Hey API / agent tooling consumes them.

---

## Soon — `0.14.0`+ ("secure-by-default initiative")

Converts Daloy's existing security middleware from opt-in to opt-out where
exactly one correct default exists, and adds a small set of high-value
primitives. Full plan with risk matrix, breaking-change boundaries, and per-wave
test surface in [`otherdocs/secure-by-default-plan.md`](./otherdocs/secure-by-default-plan.md).
Awaiting owner sign-off before implementation begins.

- [ ] **Wave 1 — additive (target `0.13.x` patch line):** default log redaction (authorization / cookie / set-cookie / x-api-key / password / token / JWT-shaped), strip `Server` and `X-Powered-By`, reject duplicate `Host` / `Content-Length`, `argon2id` helper, webhook HMAC verify helper, explicit `app({ env: "production" })` option with mismatch warning, **constructor-poisoning rejection** at parity with `__proto__` rejection in the JSON parser, **default `maxParamLength: 100`** on parametric routes + **refuse unsafe regex routes** by default (ReDoS guard, consistent with established JS framework best practices), **cooperative `AbortSignal` on request timeout** so handlers can cancel DB/`fetch()` work, **request-id input hardening** (length cap, reject control chars and CR/LF — header-injection guard), **rate-limit `ban` escalation** (N×429 ⇒ 403) and **IETF draft `ratelimit-*` headers** default-on, **CSRF user-bound tokens** (cookie-tossing defense) when an authenticated identity is on the request, **bearer-auth strict RFC 6750** matching + per-instance `verifyErrorLogLevel` (so brute-force noise doesn't flood `error` logs), **`[Symbol.asyncDispose]`** on `App` for `await using app = daloy()` ergonomics in TS 5.2+ tests, **open-redirect guard** on every framework-set `Location:` header (off-origin redirect requires explicit `allowedRedirectHosts` or `{ external: true }` + allowlist; otherwise structured `problem+json` rejection), **`TRACE` and `CONNECT` refused at the router by default** (XST defense), **reject `X-HTTP-Method-Override` / `_method` body/query overrides** on state-changing requests (CSRF amplifier; once-per-process `warn` log when seen on authenticated traffic), **disable `ETag` on responses that carry `Set-Cookie` or `Cache-Control: private`/`no-store`** (cross-tenant fingerprinting defense), **Node adapter slow-loris defaults** (`headersTimeout = 60_000`, `requestTimeout = 60_000`, `keepAliveTimeout = 5_000`, `maxHeaderSize = 8 KiB`), **per-adapter `idleTimeout` floor of 30 s on Bun / Deno / Workers adapters** + **refuse `idleTimeout: 0` in production** unless `behindProxy` is declared (so the slow-loris posture is identical across every runtime, not just Node), **audit default session cookie name** so it never embeds the framework string (rename to a generic `sid` if needed — fingerprinting parity with the `Server` / `X-Powered-By` strip), **first-class cookie helper with RFC 6265bis + CHIPS enforcement at write time** (`setCookie` / `setSignedCookie` / `getCookie` / `getSignedCookie` / `deleteCookie` that throw when `__Secure-` lacks `secure: true`, when `__Host-` lacks `secure: true` + `path: "/"` + no `Domain=`, when `Max-Age` / `Expires` exceed the 400-day RFC6265bis-13 cap, or when `SameSite: None` is set without `Secure` — no silent fallback, signed variants use WebCrypto HMAC-SHA256 so they work on Edge/Workers), **cookie helper defaults `Secure: true` + `HttpOnly: true` + `SameSite: 'lax'`** for every framework-emitted cookie (developer downgrade requires an explicit `unsafe: true` flag and is refused-at-construction in production), **signed-cookie rotation refuses `null` in the `secrets` array in production** (no silent unsigned-fallback passthrough — migration to signed cookies must complete in development first; once-per-process `warn` log + acknowledged-deadline string required in dev), **narrow `csrf()` validation to form-submittable Content-Types** (only `application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain` on unsafe methods — JSON APIs are CSRF-immune via the CORS preflight and should not 403), **expand default `Permissions-Policy`** to also include `interest-cohort=()` and `browsing-topics=()` (opt out of FLoC + Topics by default — both are tracking surfaces browsers ship enabled), **refuse-at-construction-time `cors({ origin: "*", credentials: true })` AND `cors({ origin: true, credentials: true })`** (browsers silently drop the combination; the framework should throw, not let it ship to production unnoticed — covers both the wildcard-string and boolean-true forms shipped by other ergonomic frameworks), **`timing()` middleware production gate** — when `secureDefaults` is on and `env: "production"`, `Server-Timing` headers are off by default and opt back in only via `timing({ exposeInProduction: true })` with a once-per-process `warn` log, OR automatically when the request carries an authenticated identity (closes a documented side-channel / blind-timing fingerprinting surface that most TS-first frameworks ship default-on). **Non-breaking.**
- [ ] **Wave 2 — flip defaults (target `0.14.0`, breaking):** auto-apply `secureHeaders`, secure cookie defaults, CORS deny-by-default for state-changing cross-origin, **CORS `maxAge` policy** — default `600 s` (instead of the 5 s default shipped by other ergonomic frameworks, which causes preflight thrash and a DoS-via-preflight surface), cap user-configured `maxAge` at `7200 s` (the Chromium hard cap) in production, refuse `maxAge: 0` in production, Content-Type allowlist enforced at the framework (default rejects `text/xml`, `application/xml`, any `+xml` vendor suffix, and `application/x-www-form-urlencoded` unless a route opts in via `acceptFormUrlEncoded`), **per-content-type JSON body cap default of `1 MiB`** with refuse-at-construction when the developer sets `bodyLimit.json > 10 MiB` in production without an explicit `acceptLargeJson: true` route-level opt-in (closes the "blanket 128 MB body cap" surface shipped by other ergonomic frameworks), **CSP nonces default-on when CSP is enabled**, **multipart hard cap on `parts` count** enforced at the framework (not the route), **Helmet header parity expansion**: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Cross-Origin-Embedder-Policy` (opt-in default for `require-corp`), `Origin-Agent-Cluster: ?1`, `X-DNS-Prefetch-Control: off`, `X-Permitted-Cross-Domain-Policies: none`, `X-Download-Options: noopen` all default-on, **TLS enforcement in production** (HSTS preload-eligible header `max-age=63072000; includeSubDomains; preload` auto-attached over HTTPS; refuse plaintext HTTP unless `behindProxy` declared on the Node adapter), **strict request-body validator: strip unknown keys by default** across every Standard Schema adapter (Zod/Valibot/ArkType/TypeBox) — mass-assignment defense, single `app({ allowExtraFields: true })` opt-out, **reject duplicate / repeated query keys** unless the route schema declares an array, **static-server defaults** (conditional on a static helper shipping): `dotfiles: 'deny'`, `index: false`, no symlink traversal, no directory listing, no redirect, **immovable CSP `frame-ancestors 'none'`** when the developer-supplied CSP string omits the directive (the framework appends it and logs a once-per-process warning, closing the "custom CSP silently lost framing protection" gap), **canonical trailing-slash policy** applied at the router (default `trim`) so two URLs never resolve to two cache keys / analytics rows / CSRF-token scopes (per-route opt-out for paths with file extensions). Single master opt-out `app({ secureDefaults: false })` plus per-feature opt-outs. Migration guide + `create-daloy` template bump in the same release.
- [ ] **Wave 3 — boot/first-request guards (target `0.14.0`):** refuse-to-boot on weak HMAC/JWT secrets in prod, refuse-to-boot on `session()` + state-changing route without `csrf()`, refuse-to-boot on `cors({ origin: "*" })` in prod, **refuse-to-boot on `requestTimeout: 0` in production unless an explicit reverse-proxy / load-balancer is declared** (a well-known DoS surface; Daloy refuses), first-request 500 on unconfigured `X-Forwarded-*` (prevents IP spoofing through the rate limiter), **`Host`-header allowlist** required in production (`app({ allowedHosts: [...] })`) — refuse-to-boot when missing or `["*"]`, and reject requests with non-matching `Host` at the framework with `421 Misdirected Request` (host-header injection / cache-poisoning / password-reset-poisoning defense).
- [ ] **Wave 4 — lifecycle & health (target `0.15.0`):** connection-draining graceful shutdown with **`forceCloseConnections: "idle"` semantics** (kill idle keep-alives, let in-flight requests drain) and **`Connection: close` + `503` on requests arriving during shutdown**, crash-on-unhandled-rejection in prod (both `unhandledRejection` and `uncaughtException` log + `process.exit(1)`; explicitly avoids the "swallow and keep running" anti-pattern), **auto-wired `SIGTERM` + `SIGINT` handlers** on the Node adapter that call `app.close()` exactly once (de-duplicated against user-installed handlers), `app.health()` / `app.ready()` primitives rate-limited + auth-required by default, **`loadShedding()` primitive** (event-loop delay / heap / RSS / event-loop-utilization thresholds ⇒ auto-503 with `Retry-After` — opt-in but a one-line default in templates), **CSP report-route + `Reporting-Endpoints` / `Report-To` wiring** so a single line (`app.cspReportRoute("/__csp-report")`) registers a rate-limited POST receiver that parses violation reports, redacts PII through the pluggable logger, and threads the endpoint name back into `secureHeaders()` automatically — closes the "we ship CSP but never see when it fires in production" gap.
- [ ] **Wave 5 — opt-in one-liners (target `0.16.x`):** `wsRateLimit()` and `graphqlRateLimit()` adapters, `loginThrottle()` preset (login-bucket + slow-down), **`rotateSession()` helper** with auto-rotation on privilege change (key rotation array support), file-upload MIME + magic-byte + size guard, **`rateLimit({ groupId })`** for shared buckets across related routes (OTP/login/password-reset), **`jwk()` middleware that refuses symmetric algorithms outright** (asymmetric-only allowlist: `RS256`/`RS384`/`RS512`/`PS256`/`PS384`/`PS512`/`ES256`/`ES384`/`ES512`/`EdDSA`; require `kid` header + matching JWK; require JWT-header `alg` ∈ allowlist; require JWK `alg` to equal JWT-header `alg` when both present; default-on `nbf` / `exp` / `iat` validation — closes the entire JWKS confused-deputy attack class, no developer choice possible), **`jwt()` verify helper** with default-on time-claim validation (`nbf`, `exp`, `iat`) plus optional `iss` / `aud` checks (no opt-in needed to be safe), **`jwt()` construction-time `alg` discipline**: refuse `alg: "none"` outright; require an explicit `alg` allowlist (no implicit list); refuse-at-construction when the configured allowlist contains symmetric algorithms (`HS*`) AND the key source is a JWK / JWKS URL (the automatic confused-deputy path other ergonomic frameworks ship as their default `HS256` + JWK combination), **`ipRestriction()` primitive** with CIDR-aware IPv4/IPv6 allow/deny lists (`192.168.2.0/24`, `::1/10`, wildcards) that reads the client IP through the adapter-independent `ConnInfo` abstraction, **`combine` primitives (`some` / `every` / `except`)** so security rules like "rate-limit unless authed" or "auth except `/public/*`" become single-line declarations instead of fragile `if (...) await next()` chains, **`etag()` helper** with strong-validation default (`weak: false`, SHA-1 digest), auto-skip on `Set-Cookie` / `Cache-Control: private | no-store` responses (cross-tenant fingerprinting defense — helper-side counterpart to the Wave 1 default), **`basicAuth({ onAuthSuccess })`** typed-context callback that writes through to `ctx.state.user.username` (typed via `AppState`) so developers don't re-parse the Authorization header in every handler.
- [ ] **Wave 6 — production fitness & deploy hardening (target `0.17.x`):** new wave covering the cross-cutting Express-derived items that don't fit a single primitive. **`app({ behindProxy })` declarative model** — replaces the foot-gunny `trustProxy` boolean with a structured value (`"none" | "loopback" | { hops: N } | { cidrs: [...] }`) that simultaneously configures the rate limiter, the TLS enforcement check, request-IP resolution, and the `X-Forwarded-*` accept policy from a single source of truth. **Adapter-independent `ConnInfo` abstraction** — every adapter (Node / Bun / Deno / Cloudflare Workers / Vercel / AWS Lambda) exports the same `getConnInfo()` helper, threaded into a `ctx.remoteAddress` / `ctx.remotePort` typed contract that respects `behindProxy`; security middleware (rate-limit, `ipRestriction`, audit log) reads from this single source of truth so developers never reach into adapter internals or trust raw `X-Forwarded-For` echoes by mistake. **Production posture validator** (`daloy doctor`) — boot-time + CLI command that audits the live config against the secure-by-default matrix (TLS, HSTS, `allowedHosts`, `behindProxy`, session key length, CSRF on state-changing routes, `requestTimeout`, etc.) and exits non-zero on any violation; designed to be the last step in container `HEALTHCHECK` and CI deploy gates. **Container-first defaults** in `create-daloy` templates: `HEALTHCHECK` wired to `app.ready()`, `STOPSIGNAL SIGTERM`, non-root user, read-only root filesystem, `tini`-equivalent PID 1 handling documented. **Documented non-goals (intentionally absent surface):** no `JSONP` helper, no `res.jsonp()` equivalent, no `X-HTTP-Method-Override` honoring, no built-in CSV/XML body parsers, **no method-override middleware at all** (even when asked — it is a documented CSRF amplifier with no safe configuration), **no `allowUnsafeValidationDetails`-style runtime opt-in to leak schema details to clients in production** (the knob does not exist; production redaction in `src/errors.ts` is non-negotiable, opt-out only in development behind the Wave 8 master flag), **no string-sanitize hook on validators** (HTML / SQL / JS escaping is context-dependent and belongs in renderers, not validators — baking it in causes double-encoding bugs), **no first-party Bearer extractor that skips verification** (the "extract but don't verify" anti-pattern other ergonomic frameworks ship as their advertised default is refused by Daloy — `bearerAuth()` always verifies with timing-safe compare or it does not exist), **no first-party `Server-Timing` exposure in production by default** (side-channel info disclosure — see Wave 1 production gate), **no signed-cookie rotation API that accepts unsigned fallback in production** (the Wave 1 cookie helper refuses `null` in the `secrets` array in production, even when asked) — these are codified in the security docs as features Daloy refuses to ship because they are net-negative for security with no developer choice to delegate.
- [ ] **Wave 7 — when-we-ship-it conditionals (research bucket within the initiative):** items that only become real once an adjacent feature lands. **Compression helper BREACH guard** (refuse to compress responses that carry `Set-Cookie`, an `Authorization`-echoed body, or any CSRF token; refuse to compress responses < 1 KiB) — gated on Daloy shipping a built-in compression helper. **HTTP/2 + HTTP/3 secure defaults** (`http2SessionTimeout` non-zero, `settings.maxConcurrentStreams` cap, `enablePush: false`, RAPID-RESET mitigation) — gated on the HTTP/2 / HTTP/3 adapters from the research bucket below. **Static-server `Range` request DoS guard** (cap simultaneous range parts, refuse overlapping ranges) — gated on a static helper landing. **Built-in response-cache cross-tenant guards** (refuse `Vary: *`, always include `Authorization` + `Cookie` in the cache key when present, never cache responses carrying `Set-Cookie`, never cache status codes outside an explicit `cacheableStatusCodes` allowlist) — gated on a first-party response cache landing. **Accepts negotiation contract** (any future content-negotiation surface must take an explicit `supports[]` + `default` pair and refuse silent fallthrough) — gated on pluggable serialization landing.

- [ ] **Wave 8 — cross-cutting bake-ins (target `0.18.x`):** new wave for cross-cutting hardening that does not slot cleanly into a single primitive of waves 1–7. **Single source of truth for cookie writes**: every framework subsystem that emits `Set-Cookie` (session, CSRF, rate-limit ban marker, future helpers) routes through the Wave 1 cookie helper so the RFC 6265bis + CHIPS guards apply uniformly — no subsystem gets to bypass them. **Single source of truth for client IP**: rate-limit, `ipRestriction`, request-id propagation, audit log, and TLS enforcement all read from the Wave 6 `ConnInfo` abstraction; the framework has zero direct reads of `req.headers['x-forwarded-for']` outside that one helper. **Single source of truth for time-based claim validation**: any JWT, JWK, signed-cookie, signed-URL, or webhook signature verifier the framework ships uses one internal `validateTimeClaims({ nbf, exp, iat, clockSkewSeconds })` helper so a fix to one (e.g., clock-skew tolerance) propagates to all. **Refuse-to-boot matrix expansion**: production boot also fails when (a) the cookie helper detects any subsystem trying to set a `__Secure-` cookie without TLS, (b) the JWT helper detects an HS-shaped secret of length < 32 bytes, (c) `secureHeaders()` is constructed with an empty CSP and an empty `frame-ancestors` (developer disabled both framing defenses simultaneously). **`daloy doctor --audit-secrets`** subcommand that scans environment variables and `package.json` for leaked HMAC secrets, sample JWT keys (`it-is-very-secret`, `secret`, `changeme`), and committed `.env` files; exits non-zero on any hit so deploy gates fail loud. **All Wave 1–7 defaults locked behind one master flag** (`app({ secureDefaults: false })`) which (i) requires `env: "development"`, (ii) refuses to set the flag in production, (iii) emits a once-per-process `error` log naming every disabled default. Together these items remove the last "developer remembered to do X but not Y" failure modes by making the framework's security surface internally self-consistent.

- [ ] **Wave 9 — pattern-agnostic-framework parity audit (target `0.19.x`):** new wave that converts the head-to-head feature comparison in [`otherdocs/security_task.txt`](./otherdocs/security_task.txt) into a standing audit so the framework never silently regresses against another TS / Bun / Node ergonomic framework's documented defaults. Items are checks, not one-time changes:
  1. **CORS default posture audit** — `origin`, `credentials`, and `maxAge` defaults are each `≤` the strictest documented competitor every release; CI fails when any competitor docs change and Daloy's matching default has not been re-reviewed in the same release window.
  2. **Cookie helper defaults audit** — `Secure` / `HttpOnly` / `SameSite` defaults and the signed-cookie rotation policy (no `null` in `secrets` in production) are each `≥` the strictest documented competitor.
  3. **JWT / JWK algorithm discipline audit** — no `alg: "none"`, no symmetric-algorithm + JWKS combination, default-on `nbf` / `exp` / `iat` validation, explicit allowlist required; audited against the documented defaults of every competitor.
  4. **Body-size cap audit** — defaults are `≤` the strictest documented competitor AND always per-content-type (no blanket cap that hides JSON-vs-multipart distinction).
  5. **Idle-timeout / request-timeout audit** — non-zero in production across every shipped adapter; CI fails when a new adapter ships without an explicit timeout default that matches Wave 1.
  6. **Validation-detail / framework-identity leak audit** — no runtime opt-in to leak schema details, framework name, or version in production exists in the public API; CI grep gate on the documented non-goals list in Wave 6.
  7. **Side-channel / timing exposure audit** — no first-party middleware attaches performance-timing headers in production without authentication; covers `timing()` (Wave 1 gate) and any future helper.
  8. **`daloy doctor --audit-defaults` subcommand** — boot-time + CLI command that runs the seven checks above against the live config; exits non-zero on any drift. Companion to `daloy doctor --audit-secrets` from Wave 8 — together they form the deploy-gate matrix every container `HEALTHCHECK` and CI deploy step is expected to run.

Out of scope for this initiative (policy decisions, kept as documented recipes):
JWT/JWK/OAuth/OIDC strategies, RBAC/ABAC models, AES recipe, DI guards/interceptors model.

### Feature-comparison provenance

The wave items above are derived from a head-to-head review of established JS
frameworks and their security plugin ecosystems, recorded in
[`otherdocs/security_task.txt`](./otherdocs/security_task.txt). The latest
addition to that review covers a pattern-agnostic, TS / Bun-first ergonomic
framework whose documented defaults (wildcard CORS on, credentials on,
plaintext cookies, `JWT alg: HS256` + JWK without an asymmetric-only path,
signed-cookie rotation that accepts unsigned fallback, `Server-Timing`
default-on, `128 MB` blanket body cap, opt-in production validation-detail
leak, Bearer plugin that explicitly declines verification) feed every Wave
1 / 2 / 5 / 6 addition flagged above as well as the new Wave 9 standing
audit. The rule of inclusion is unchanged: a feature only becomes a default
when exactly one correct value exists and DaloyJS can pick it without
removing developer choice on policy questions.

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
