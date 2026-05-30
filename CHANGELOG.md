# Changelog

All notable changes to **`@daloyjs/core`** (and its companion **`create-daloy`**
scaffolder, which ships in lockstep) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
For the forward-looking plan and the full thematic release log, see
[`ROADMAP.md`](ROADMAP.md).

> Pre-1.0: minor versions may contain breaking changes. `@daloyjs/core` and
> `create-daloy` are published together — a new core release always ships a
> matching scaffolder so generated projects pin the latest peer.

## [Unreleased]

_Nothing yet._

## [0.36.0] — 2026-05-28 to 2026-05-30

### Added

- `preset: "internal-service"` topology security preset for service-to-service
  deployments behind a mesh / sidecar / private network. Flips **off** only the
  browser-only guards (auto `secureHeaders`, the cross-origin state-changing
  request guard, the `session()` + `csrf` boot guard, and the unconfigured
  `X-Forwarded-*` 500) while keeping every input / parser / credential / SSRF
  guard on. The choice is logged once at boot under
  `event: "security.preset.applied"` enumerating disabled + kept guards and any
  caller overrides; per-knob options still win on top of the preset.
- `app.getSecurityPosture()` returns a frozen live snapshot of the active
  security posture for `/__security` introspection routes or CI audits.
- Node adapter `maxConnections` option mapping to `server.maxConnections` —
  connection-layer admission control that rejects overflow sockets at accept
  time instead of queuing them into the event loop under overload.

### Security

- Credential redaction extended to the 2026 GitHub stateless installation-token
  format (`ghs_`-prefixed ~520-char JWT, matched at 36–1024 chars).
- Bun adapter last-resort `error:` handler now logs server-side but never echoes
  `err.message` to the client, preserving prod-mode error redaction parity with
  the Node adapter.

### Fixed

- Deno adapter shutdown ordering: drain app-level hooks first (while the HTTP
  server can still respond), then call `server.shutdown()`, and abort the listen
  signal last as a safety net — so in-flight requests can finish.
- Welcome-banner polish and `detectAscii` platform handling.

### Docs

- Refreshed API reference, new "Where to use DaloyJS" beginner guide, conference
  `workshop/` materials, and per-runtime `SKILL.md` best-practices.

## [0.35.2] — 2026-05-28

### Performance

- Zero-copy buffered-body fast-path via the `DALOY_REQUEST_RAW_BODY` symbol:
  adapters stash a pre-validated `Uint8Array` so `readBodyLimited` skips the
  WHATWG `ReadableStream` reader loop entirely (re-checking the limit as
  defense-in-depth) with a tunable cap.
- `randomUUID` caching, dropped redundant header lowercasing, and a skipped
  no-op `logger.child` (~+23% on `bench:routes`).
- Stable hidden classes for `ctx` / `ctx.set` ("Round 19"), error-path parity
  with a hand-stripped baseline, and Node `Readable` responses piped directly to
  the socket.

### Fixed

- `randomId()` WebCrypto-reference fallback.
- `Buffer.alloc` used over `allocUnsafe`.
- Benchmark accuracy fixes (Windows RSS, Zod-parity rows).

## [0.35.1] — 2026-05-27

### Performance

- Rewritten HTTP dispatch + buffered Node body, measured **+37% GET / +61% POST**
  on `bench:routes`, after an added-then-reverted lazy-request experiment
  settled on the buffered fast-path.
- New `@daloyjs/core/app` deep entry point for a lighter cold start.
- Install-size trim (build source maps disabled).

### Added

- Isolated cross-framework HTTP benchmark suite under `bench/cross-framework/`
  (multiple server implementations + autocannon/pino logging bench).
- `clipboard-write` permission knob on `secureHeaders()`.

## [0.35.0] — 2026-05-24

### Added

- `safeRedirect()` + `OpenRedirectBlockedError`: validates redirect targets
  against an explicit path/origin allowlist and refuses protocol-relative
  (`//evil.com`) and scheme-bearing (`javascript:`, `https://evil`) targets.
- `fetchMetadata()` middleware enforcing a Fetch Metadata Resource Isolation
  Policy (`Sec-Fetch-Site` / `-Mode` / `-Dest` / `-User`) to block cross-site
  XS-Leaks while allowing same-origin, top-level navigations, and configured
  cross-site `Sec-Fetch-Dest` + navigate-method allowlists.
- Webhook timestamp verification + replay protection via a signed-timestamp
  tolerance window (`WEBHOOK_DEFAULT_TOLERANCE_SECONDS`, 5 minutes).
- `createJwtVerifier({ isRevoked })` token-revocation callback (logout / key
  rotation / compromise) without weakening the algorithm allowlist.
- `sanitizeFilename`, `assertSafeRelativePath`, `hasMongoOperatorKeys`, and
  `assertNoMongoOperators` — path-traversal and NoSQL-operator injection guards.

### Security

- `secureHeaders()` default `Permissions-Policy` now adds `clipboard-write=()`
  (alongside `camera=()`, `microphone=()`, `geolocation=()`) to neutralize the
  ClickFix paste-attack chain ([CVE-2026-26980], the May 2026 Ghost CMS campaign
  across 700+ domains). Override via `permissionsPolicy:` for legitimate copy
  buttons.
- Duplicate `Transfer-Encoding` headers are rejected (HTTP request smuggling).
- CORS middleware manages `Vary: Origin` to prevent cross-origin cache
  poisoning.
- `fetchGuard()` DNS-rebinding documentation and cloud-metadata test hardening.

### Added — supply chain & governance

- New verification gates: `verify:known-dep-names` (slopsquatting),
  `verify:no-polyfill-cdns`, `verify:runtime-eol`, `verify:no-shrinkwrap`,
  `verify:no-weak-random`, `verify:dep-licenses`, `verify:no-leaky-agent-skills`,
  `verify:no-toxic-agent-skills`.
- npm staged publishing, a gitleaks secret-scan workflow + staged-secret
  pre-commit hook, OSV-Scanner workflows, Opengrep SAST, and Cosign image
  signing / SBOM attestation.

### Docs

- Compliance docs (EU CRA, NIS2 self-assessment, ISO/IEC 27001:2022, DORA, UK
  Cyber Security & Resilience Bill), OWASP API Security Top 10 + injection
  guides, PWA support, conference `workshop/`.

## [0.34.3] — 2026-05-23

### Changed

- Split the portable, runtime-agnostic supply-chain hardening from the optional
  GitHub Actions CI bundle in the `create-daloy` templates, so scaffolded
  projects on any platform get the baseline hardening without inheriting
  GitHub-specific workflows.
- Website/branding refresh: homepage, layout, OpenGraph image + social banner
  SVGs, Deno adapter docs, and `seo.ts` metadata.

## [0.34.2] — 2026-05-23

### Changed

- Pinned `tsx ^4.22.3`; turbopack-root config.
- Per-adapter deployment + Payments docs, Vercel Analytics + Speed Insights,
  reading-progress / BackToTop / LogoLockup site components, Deno + Node
  deployment workflow templates.

### Fixed

- `create-daloy` now publishes correctly on tag releases.

## [0.34.1] — 2026-05-22

### Fixed

- CI builds and runs `gen:sbom` before `pnpm test`; verify scripts resolve
  `REPO_ROOT` via `process.cwd()`; SBOM release-automation docs; metadata-title
  fix.

## [0.34.0] — 2026-05-22

### Added

- `fetchGuard()` + `SsrfBlockedError` SSRF guard ([`src/fetch-guard.ts`](src/fetch-guard.ts)):
  blocks cloud-metadata (`169.254.169.254`), private/loopback/link-local ranges,
  and DNS rebinding by re-resolving and re-checking the resolved IP, sharing its
  CIDR matcher with `ipRestriction()`.
- CycloneDX 1.5 / SPDX 2.3 / SWID SBOM generation + verification
  ([`scripts/generate-sbom.ts`](scripts/generate-sbom.ts),
  [`scripts/verify-sbom.ts`](scripts/verify-sbom.ts)); SBOMs ship inside every
  tarball and are transitively bound by npm `--provenance` Sigstore attestation.

### Security

- `assertNoReservedInternalHeaders()` rejects inbound `x-daloy(js)-internal-*`
  headers — a structural defense against the Next.js [CVE-2025-29927]
  middleware-bypass class.
- Spring4Shell-class `isForbiddenObjectKey()` checks extended to query-string,
  `x-www-form-urlencoded`, and multipart field names.
- Prototype-pollution-safe JSON parsing of the JWT header and payload.
- `fileField` rejects scriptable image payloads (SVG/HTML/XML magic bytes).
- Cookie-tossing defense in `readRequestCookie`.
- Logger redaction extended to opaque-provider and AI-gateway credentials.
- New supply-chain gates: `verify:no-registry-exfiltration` (300+ IOC corpus —
  Lazarus BeaverTail/InvisibleFerret, Jade Sleet, xrpl.js, RATatouille, Advcash
  reverse-shell, Telegram-bot SSH-backdoor), `verify:no-bin-shadowing`,
  `verify:no-remote-exec`, `verify:no-vulnerable-sandboxes`,
  `verify:no-invisible-unicode`, `verify:no-unsafe-buffer`,
  `verify:no-encoded-payloads`, `verify:no-leaked-credentials`,
  `verify:actions-pinned` (GitHub Actions SHA-pin); `verify:secret-comparisons`
  tightened.
- Lockfiles reject all npm git-shorthand specifiers; daily SCA + container-scan
  + DAST workflows; Log4Shell / Spring4Shell regression tests.

> The `0.34.0` release commit itself is TSDoc-only across the public API; the
> behavior above landed in the preceding commits of the release.

## [0.33.0] — 2026-05-21

### Security

- **WebSocket CSWSH (Cross-Site WebSocket Hijacking) defense.** `app.ws()` gained
  `allowedOrigins` (`"same-origin"` / explicit origin allowlist / predicate),
  validated by `checkWebSocketOrigin()` **before** `beforeUpgrade` runs — a
  mismatched `Origin` returns `403` in both the Node and Bun upgrade paths.
  Under production secure-defaults, a route that neither sets `allowedOrigins`
  nor opts in via `acknowledgeCrossOriginUpgrade: true` **refuses to register**,
  closing the [CVE-2026-27148] Storybook-class hole. See
  [`src/websocket.ts`](src/websocket.ts) (`assertWebSocketOriginPolicy`).
- New `scripts/verify-no-lifecycle-scripts.ts` → `pnpm verify:no-lifecycle-scripts`
  refuses `preinstall` / `install` / `postinstall` / `prepare` / `prepublish` on
  the shipped packages.

### Changed

- Wave-number identifiers stripped from `src/` and docs comments.
- `SECURITY.md` expanded for slopsquatting, typosquat + init-time C2,
  dormant-maintainer / account-recovery-email risks, and IDE-extension /
  AI-agent threats.

## [0.32.0] — 2026-05-20

### Security

- WebSocket post-upgrade header immutability + pre-upgrade auth
  refuse-at-registration; `httpError({ res })` state-mutating-header refusal with
  Context-aware merge; middleware-order header-conflict refusal via
  `responseHeaders[]`.

## [0.31.0] — 2026-05-20

### Added

- Mature-Node second-pass audits: semicolon-delimiter refusal,
  error-handler-override refusal, `requestId()` trust-default audit,
  `addHttpMethod` RFC-method runtime allowlist + audit, draining
  `Connection: close` reaffirm audit.

## [0.30.0] — 2026-05-20

### Security

- Auth-failure `Cache-Control: no-store` (`UnauthorizedError` / `ForbiddenError`
  / `TooManyRequestsError`); CSP report receiver hardening (`application/json` →
  `415`, `maxBodyBytes > 64 KiB` refused at construction, prod sink omits report
  body unless `logCspReportBodies: true`); `cors()` `allowMethods` default
  narrowed to `[GET, HEAD, POST]` (refuse `methods: ['*']`); reverse-proxy helper
  absence audit; compression skip-already-encoded reaffirm. Wired into CI as
  `pnpm verify:runtime-parity-audits`.

## [0.29.1] — 2026-05-20

### Fixed

- Repair release: republished to fix an incomplete `0.29.0` publish and resync
  the `@daloyjs/core` version pin across every `create-daloy` template
  (`node-basic`, `bun-basic`, `deno-basic`, `cloudflare-worker`, `vercel-edge`)
  and the `seo.ts` fallback. No runtime behavior change.

## [0.29.0] — 2026-05-20

### Added

- Governance audit: `SECURITY-CONTACTS.md` rotation file,
  `scripts/verify-governance-audits.ts` → `pnpm verify:governance-audits`,
  release-workflow contributor-rotation refusal, plugin-prerequisite +
  `topoSortExtensions` cycle-detection reaffirm, documented governance floor with
  `SECURITY.md` waiver-required removal.

## [0.28.0] — 2026-05-20

### Added

- Parity audit suite: `scripts/verify-parity-audits.ts` →
  `pnpm verify:parity-audits` static gates, `daloy doctor --audit-defaults`
  live-config audits.

## [0.27.0] — 2026-05-20

### Security

- `secureDefaults` single-source-of-truth bake-ins: cookie / time-claim SSoT
  helpers, `__Secure-` cookie refusal, zero-runtime-deps + secret-comparison CI
  gates.

## [0.26.0] — 2026-05-20

### Security

- Secure-by-default slice 6: `secureDefaults: false` production acknowledgement +
  audit log, JWT HS-secret length refusal, `secureHeaders()` dual framing-defense
  refusal, mandatory 2FA release-audit docs.

## [0.25.0] — 2026-05-20

### Added

- `compression()` middleware on `CompressionStream` (`br` > `gzip` > `deflate`)
  with BREACH-aware always-on guards (skip `Set-Cookie` / `Authorization` /
  session-or-CSRF cookie / already-compressed types), `minimumSize: 1024` +
  negative-ratio post-check, no `compressLevel: 9` opt-in, always-on
  `Vary: Accept-Encoding`, and strong → weak ETag downgrade (RFC 9110).

## [0.24.0] — 2026-05-20

### Added

- Production fitness & deploy hardening: `app({ behindProxy })`,
  adapter-independent `ConnInfo`, `daloy doctor`, container-first `create-daloy`
  templates (`HEALTHCHECK`, `STOPSIGNAL SIGTERM`, non-root, `tini`), PSL-aware
  `subdomains()`, lazy `info.remote`, plugin `dependencies: string[]`
  refuse-to-boot, namespace-protected decorators, plugin extension `before` /
  `after` ordering with cycle detection, `defineDependency()`, scheme-aware
  `ctx.state.auth`, plugin lifecycle default `local`, required `name` + optional
  `seed` for stateful plugins.

## [0.23.0] — 2026-05-20

### Added

- `wsRateLimit()`, `loginThrottle()`, `rotateSession()`, file-upload magic-byte
  guards, `requirePayloadAuth`, and WebSocket safe defaults.

## [0.22.0] — 2026-05-20

### Added

- `jwk()` asymmetric-only JWKS middleware, `bearerAuth({ verify })`,
  `basicAuth({ onAuthSuccess })`, `Cache-Control: no-store` on auth 401
  challenges.

## [0.21.0] — 2026-05-20

### Added

- `createJwtSigner()` / `createJwtVerifier()` (`alg`-discipline, `exp`-required
  sign refusal), `requireScopes()` (RFC 6750 challenge, per-request aggregation),
  `etag()` helper with auto-skip on `Set-Cookie` /
  `Cache-Control: private | no-store | no-cache`.

## [0.20.0] — 2026-05-20

### Added

- `loadShedding()`, `app.cspReportRoute()` + `secureHeaders({ reportingEndpoints,
  reportTo })`, `disconnectStatusCode: 499` default, `defineConfig({ schema,
  source })`.

## [0.19.0] — 2026-05-20

### Added

- Secure-by-default slice 5: `rateLimit({ groupId })` shared buckets, `combine`
  primitives (`every` / `some` / `except`), `ipRestriction()` with CIDR
  IPv4/IPv6, `internal: true` routes (`404` via `app.fetch`, dispatch via
  `app.inject`).

## [0.18.0] — 2026-05-20

### Added

- Secure-by-default slice 4: connection-draining shutdown (`Connection: close`
  on `503` + in-flight), Node idle-close hook, `crashOnUnhandledRejection`
  default-on in prod, `app.healthcheck()` / `app.readinesscheck()` (bearer-token
  + per-IP rate limit), prod refuse-to-boot without
  `acknowledgeUnauthenticated: true`.

## [0.17.0] — 2026-05-19

### Security

- Secure-by-default slice 3: refuse-to-boot on weak session secrets /
  `cors({ origin: "*" })` / `session()` + state-changing route without `csrf()`.
  First-request `500` on unconfigured `X-Forwarded-*`.

## [0.16.0] — 2026-05-19

### Security

- Secure-by-default slice 2: `secureHeaders()` auto-applied, cross-origin
  state-changing requests → `403` unless `cors()` allows, per-route `accepts`
  content-type opt-in.

## [0.15.0] — 2026-05-19

### Added

- Secure-by-default slice 1: log redaction defaults, stripped `Server` /
  `X-Powered-By`, duplicate `Host` / `Content-Length` rejection,
  `@daloyjs/core/hashing` (`passwordHash` / `passwordVerify`),
  `verifyWebhookSignature` / `signWebhookPayload`, explicit `app({ env })` with
  `NODE_ENV` mismatch warning.

## [0.14.x] — 2026-05-19

### Added

- `docs.scalar` configuration for Scalar UI theming/custom CSS.
- AI-friendly route metadata: optional `meta` on routes (examples, summary,
  tags, `x-*`), schema-validated example pairs, `daloy inspect --ai`, `--yaml` /
  `--format yaml` output for AI and OpenAPI dumps, docs at
  `website/app/docs/ai-metadata/`.

## [0.13.x] — 2026-05-18

### Added

- `createApp(options)` alias, `daloy dev` watcher with
  `--runtime <node|bun|deno>` override, OpenAPI `info` autofill from `deno.json`
  / `deno.jsonc`.
- `GET /openapi.yaml` mounted alongside JSON, `openapiYamlPath` option,
  dependency-free `openapiToYAML`.
- `/openapi.yaml` served as `text/yaml`; `create-daloy` then made install +
  `--with-ci` default to yes and documented `/openapi.yaml` across templates
  while core stayed on `0.13.2`.

## [0.12.0] — 2026-05-18

### Security

- CSRF Fetch-Metadata strategy, dual CSRF (`"both"`), CSP nonce + Trusted Types
  in `secureHeaders()`, `basicAuth()` with UTF-8 credential decoding.

## [0.11.0] — 2026-05-17

### Added

- WebSockets: RFC 6455 frame protocol in [`src/websocket.ts`](src/websocket.ts),
  typed `app.ws(path, handler)`, `defineWebSocket()`, Node + Bun adapter wiring,
  `@daloyjs/core/websocket` subpath.

## [0.10.x] — 2026-05-16

### Added

- Branch coverage gate: `pnpm coverage:branches` against compiled JS, introduced
  at ≥95% in CI and later relaxed to the current ≥90% floor.

> No standalone `0.10.x` was published — the `package.json` version went
> `0.9.1` → `0.11.0`, so this work shipped as part of `0.11.0`.

## [0.9.x] — 2026-05-16

### Changed

- Boot banner; Node 24 runtime floor (current manifest: `>=24.0.0`; `0.9.0`
  briefly used `>=24.15.0`).

## [0.8.x] — 2026-05-16

### Changed

- Web-standard adapter cleanup.

## [0.7.x] — 2026-05-16

### Added

- Edge-friendly signed-cookie session (`__Host-`, HMAC-SHA256, key rotation),
  pluggable `SessionStore`, `ctx.state.session`.

> The public repository's initial commit was already at `0.7.5`, so the
> `0.2.x`–`0.7.x` entries below predate this repo's git history; they share the
> initial-commit date (2026-05-16) rather than individual version-bump dates.

## [0.6.x] — 2026-05-16

### Added

- Plugin lifecycle events: `onPluginInstalled`, `onShutdown`.

## [0.5.0] — 2026-05-16

### Added

- Bun + Deno scaffolder templates + `--minimal`,
  `@daloyjs/core/rate-limit-redis` (ioredis + node-redis), `daloy inspect` CLI.

## [0.4.0] — 2026-05-16

### Added

- Multipart/form-data (`fileField`, `multipartObject`), CSRF helper
  (double-submit + same-site).

## [0.3.x] — 2026-05-16

### Added

- Streaming & observability: `sseStream` / `ndjsonStream` helpers, `otelTracing`
  hook, OpenAPI extras (`securitySchemes`, `webhooks`, `callbacks`,
  `discriminator`).

## [0.2.x] — 2026-05-16

### Added

- Confidence & lifecycle: `onSend` hook, GitHub Actions CI, `SECURITY.md`, OIDC
  publish with provenance, `pnpm create daloy` scaffolder (`node-basic`,
  `vercel-edge`, `cloudflare-worker`), docs metadata + ORM guides.

[Unreleased]: https://github.com/daloyjs/daloy/compare/f37ce20...HEAD
[0.36.0]: https://github.com/daloyjs/daloy/compare/10de2f5...f37ce20
[0.35.2]: https://github.com/daloyjs/daloy/compare/f4a9733...10de2f5
[0.35.1]: https://github.com/daloyjs/daloy/compare/70592cb...f4a9733
[0.35.0]: https://github.com/daloyjs/daloy/compare/2fc135c...70592cb
[0.34.3]: https://github.com/daloyjs/daloy/compare/1805e7f...2fc135c
[0.34.2]: https://github.com/daloyjs/daloy/compare/v0.34.1...1805e7f
[0.34.1]: https://github.com/daloyjs/daloy/compare/v0.34.0...v0.34.1
[0.34.0]: https://github.com/daloyjs/daloy/compare/v0.33.0...v0.34.0
[0.33.0]: https://github.com/daloyjs/daloy/compare/v0.32.0...v0.33.0
[0.32.0]: https://github.com/daloyjs/daloy/compare/v0.31.0...v0.32.0
[0.31.0]: https://github.com/daloyjs/daloy/compare/v0.30.0...v0.31.0
[0.30.0]: https://github.com/daloyjs/daloy/compare/v0.29.1...v0.30.0
[0.29.1]: https://github.com/daloyjs/daloy/compare/v0.29.0...v0.29.1
[0.29.0]: https://github.com/daloyjs/daloy/compare/v0.28.0...v0.29.0
[0.28.0]: https://github.com/daloyjs/daloy/compare/v0.27.0...v0.28.0
[0.27.0]: https://github.com/daloyjs/daloy/compare/v0.26.0...v0.27.0
[0.26.0]: https://github.com/daloyjs/daloy/compare/v0.25.0...v0.26.0
[0.25.0]: https://github.com/daloyjs/daloy/compare/v0.24.0...v0.25.0
[0.24.0]: https://github.com/daloyjs/daloy/compare/v0.23.0...v0.24.0
[0.23.0]: https://github.com/daloyjs/daloy/compare/v0.22.0...v0.23.0
[0.22.0]: https://github.com/daloyjs/daloy/compare/v0.21.0...v0.22.0
[0.21.0]: https://github.com/daloyjs/daloy/compare/v0.20.0...v0.21.0
[0.20.0]: https://github.com/daloyjs/daloy/compare/v0.19.0...v0.20.0
[0.19.0]: https://github.com/daloyjs/daloy/compare/v0.18.0...v0.19.0
[0.18.0]: https://github.com/daloyjs/daloy/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/daloyjs/daloy/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/daloyjs/daloy/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/daloyjs/daloy/compare/v0.14.2...v0.15.0
[0.14.x]: https://github.com/daloyjs/daloy/compare/v0.13.2...v0.14.2
[0.13.x]: https://github.com/daloyjs/daloy/compare/v0.12.0...v0.13.2
[0.12.0]: https://github.com/daloyjs/daloy/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/daloyjs/daloy/compare/v0.9.1...v0.11.0
[0.10.x]: https://github.com/daloyjs/daloy/compare/v0.9.1...v0.11.0
[0.9.x]: https://github.com/daloyjs/daloy/compare/v0.8.2...v0.9.1
[0.8.x]: https://github.com/daloyjs/daloy/compare/v0.8.0...v0.8.2
[0.7.x]: https://github.com/daloyjs/daloy/releases
[0.6.x]: https://github.com/daloyjs/daloy/releases
[0.5.0]: https://github.com/daloyjs/daloy/releases
[0.4.0]: https://github.com/daloyjs/daloy/releases
[0.3.x]: https://github.com/daloyjs/daloy/releases
[0.2.x]: https://github.com/daloyjs/daloy/releases
[CVE-2026-27148]: https://www.aikido.dev/blog/storybooks-websockets-attack
[CVE-2026-26980]: https://www.aikido.dev/blog
[CVE-2025-29927]: https://nvd.nist.gov/vuln/detail/CVE-2025-29927
