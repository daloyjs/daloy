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

### Added

- **HTTP Message Signatures (RFC 9421) at `@daloyjs/core/http-signatures`.**
  First-party, dependency-free sign/verify for server-to-server request
  authentication via the standard `Signature` / `Signature-Input` headers.
  `signMessage` / `signRequest` build an RFC 9421 signature base over derived
  components (`@method`, `@target-uri`, `@authority`, `@scheme`,
  `@request-target`, `@path`, `@query`, `@query-param`, `@status`) and HTTP
  fields, with Structured-Fields header serialization; `verifyMessage` /
  `verifyRequest` and the `httpSignatureAuth()` middleware check them. Supports
  `hmac-sha256`, `ed25519`, `ecdsa-p256-sha256`, `ecdsa-p384-sha384`,
  `rsa-pss-sha512`, and `rsa-v1_5-sha256` via WebCrypto (no `node:` imports).
  Secure-by-default verify: a mandatory `algorithms` allowlist, optional
  per-key algorithm pinning to defeat algorithm-confusion, a required `created`
  timestamp with a `DEFAULT_MAX_SIGNATURE_AGE_SECONDS` (300s) freshness window,
  `created`-in-future / `expires` skew rejection, configurable
  `requiredComponents`, a 32-byte raw-HMAC floor, and `nonce` replay defense.
  The middleware answers a missing/invalid signature with `401` +
  `Cache-Control: no-store` and stamps the verified result on
  `ctx.state.httpSignature`. Adds RFC 9530 `contentDigest` /
  `verifyContentDigest` helpers to bind the request body into the signature.

- **Subresource Integrity (SRI) for the CDN-loaded docs UI assets.** The
  built-in `/docs` page loads Scalar / Swagger UI bundles from jsDelivr; the
  new `DocsAssetOptions` lets you pin version-exact `*Integrity` hashes
  (`scalarScriptIntegrity`, `swaggerUiCssIntegrity`, `swaggerUiBundleIntegrity`)
  plus a `crossOrigin` value (default `"anonymous"`) so `scalarHtml()` /
  `swaggerUiHtml()` and the `docs: { assets }` auto-mount emit
  `integrity="…" crossorigin="…"` on the external `<script>` / `<link>` tags.
  A malformed SRI value throws a `TypeError` at startup (browsers silently
  ignore unparseable `integrity`, so failing loud prevents a false sense of
  protection). Self-hosting the assets remains supported via the same `assets`
  URLs. New docs page: **Docs UI asset integrity (SRI)**.
- **Opt-in WAF-lite signature/anomaly inspection middleware.** New
  dependency-free `@daloyjs/core/waf` module adds `waf()` — a first-party
  defense-in-depth layer for teams without an edge WAF (it does **not** replace
  ModSecurity / a CDN WAF). Wires curated, low-false-positive SQLi / XSS /
  NoSQL-operator / command-injection signatures (NoSQLi reuses
  `hasMongoOperatorKeys` for a structural body check) into one scored
  `beforeHandle` inspection pass over the decoded path, the raw + decoded query
  string, an opt-in header allowlist, and the validated body. Each rule that
  fires adds an anomaly `score`; reaching `blockThreshold` (default `5`) rejects
  with a generic `403` (block mode, never naming the rule that fired) or reports
  via `onMatch` (log mode) so operators can tune against real traffic first.
  Per-rule enable/disable + score overrides, inspection-surface toggles, and
  bounded scanning (`maxValueLength` / `maxBodyNodes`) with
  control-character-stripped log samples keep a hostile payload from becoming
  CPU-DoS. Exposes `WafOptions` / `WafEvent` / `WafMatch` / `WafRuleId` /
  `WafRuleConfig` / `WafMode` / `WafInspectConfig` / `WafInspectionLocation`.

- **Inbound request-decompression bomb guard.** New dependency-free
  `@daloyjs/core/request-decompression` module adds `requestDecompression()`.
  DaloyJS core deliberately does not decompress request bodies (safe by
  omission), so a `Content-Encoding: gzip` body is read as-is and a schema parse
  simply fails on the compressed bytes. For services that genuinely must accept
  compressed uploads, this opt-in middleware inflates `gzip` / `deflate` bodies
  **with the decompression-bomb (zip-bomb) guard baked in**: two independent caps
  are enforced *during* inflation so a bomb is aborted long before it is fully
  materialised — a required absolute `maxDecompressedBytes` cap and an
  expansion-`maxRatio` cap (default `100`, the inflated size may never exceed
  `compressedBytes * maxRatio`), both rejecting with `413`. The compressed upload
  itself is bounded by `maxCompressedBytes` (default 1 MiB) before a single byte
  is inflated. Unknown, non-allowlisted, runtime-unsupported, or **layered**
  (`gzip, gzip`) encodings are refused `415` (with an `Accept-Encoding` header);
  malformed / truncated streams `400` (never silently treated as empty, to avoid
  request-smuggling-style desync); and requests without a `Content-Encoding` (or
  `identity`), as well as `GET` / `HEAD`, pass through untouched. The middleware
  runs in the `onRequest` phase and stashes the inflated bytes on the request so
  schema-validated bodies and raw-body handlers both see the decompressed
  payload. Offers an `onBomb` observability hook (encoding, compressed size,
  inflated bytes produced before the abort, `"absolute"` / `"ratio"` reason) and
  exports a low-level `decompressRequestBody()` guard for custom raw-body flows.
  Built on the web-standard `DecompressionStream` (works on Node, Bun, Deno,
  Workers, Edge; brotli intentionally excluded — not in the Compression Streams
  spec). Exports `requestDecompression`, `decompressRequestBody`,
  `DecompressionBombError`, `UnsupportedContentEncodingError`,
  `MalformedCompressedBodyError`, and the `RequestDecompressionOptions`,
  `RequestDecompressionEncoding`, and `DecompressionBombInfo` types.
- **Per-route / per-client concurrency limits + queueing.** New dependency-free
  `@daloyjs/core/concurrency-limit` module adds `concurrencyLimit()`, HAProxy
  `maxconn` + request-queue parity at the app layer. Where the Node adapter's
  `maxConnections` caps sockets at accept time and `loadShedding()` rejects
  traffic under process pressure, `concurrencyLimit()` bounds the number of
  requests in flight through a given surface: each request acquires a slot from a
  per-bucket semaphore (`maxConcurrent`); if all slots are busy it waits in a
  bounded FIFO queue (`maxQueue`) for up to `queueTimeoutMs`; and it is rejected
  with a fast `503 Service Unavailable` (+ `Retry-After`) once the queue is full
  or the wait times out. The budget is partitioned by `scope`: `"global"`
  (default), `"route"` (per `method + path`, so one hot endpoint can't starve the
  others), `"client"` (per identity — requires `trustProxyHeaders` or a
  `keyGenerator`, so a heavy client can't consume everyone else's slots), or a
  custom function (return a bucket key, or `undefined` to skip limiting —
  fail-open). The slot is acquired in `beforeHandle` and released in `onSend`,
  which the framework runs on the success, error, and short-circuit response
  paths alike, so a slot is never leaked. Offers an `onReject` observability hook
  (bucket key, `"queue-full"` / `"queue-timeout"` reason, live active/queued
  counts) and configurable `retryAfterSeconds` / `message`. Exports
  `concurrencyLimit` and the `ConcurrencyLimitOptions` and `ConcurrencyRejection`
  types.
- **IP reputation / dynamic denylist feed.** New dependency-free
  `@daloyjs/core/ip-reputation` module adds `ipReputation()`. Where
  `ipRestriction()` enforces a static allow/deny list compiled once at startup,
  `ipReputation()` wires pluggable, periodically-refreshed abuse feeds — Tor exit
  lists, Spamhaus DROP, cloud-abuse ranges, or your own threat intelligence —
  into the request path without a redeploy, reusing the same SSRF-grade CIDR
  matcher as `ipRestriction()`. Feeds implement the `IpReputationFeed` interface;
  `urlFeed()` ships for the common case (fetch a newline / Spamhaus-DROP-style
  list over HTTP, understands the `<cidr> ; <annotation>` format, skips `#` / `;`
  / `//` comment lines, and keeps the good rows from a partially-malformed feed).
  **Fail-open by design** — a feed that cannot be loaded never blocks traffic: a
  failed initial load leaves an empty (permissive) denylist, a failed refresh
  retains that feed's last-known-good entries, and an unresolvable client IP is
  treated as not-listed. The denylist reloads on an `unref`'d timer
  (`refreshIntervalMs`, default hourly), with a per-feed `fetchTimeoutMs`
  abort. Returns an `IpReputationController` exposing `hooks` (for `app.use`),
  manual `refresh()`, `stop()`, `has()`, `size`, and a `ready` promise. Offers a
  `mode: "log"` monitor mode, `onMatch` / `onError` callbacks, and pluggable IP
  resolution (`trustProxyHeaders` / `resolveIp`). Exports `ipReputation`,
  `urlFeed`, and the `IpReputationOptions`, `IpReputationFeed`,
  `IpReputationMatch`, `IpReputationController`, and `UrlFeedOptions` types.
- **Bot / User-Agent management middleware.** New dependency-free
  `@daloyjs/core/bot-guard` module adds `botGuard()`, the in-app equivalent of
  the bot rules Nginx, Cloudflare, and other WAFs run at the edge — but inside
  the app, where the framework already owns request parsing and client-IP
  resolution. It does three opt-in jobs: blocks empty / missing `User-Agent`
  strings (on by default, a common scraper/scanner signature); blocks
  known-abusive `User-Agent` patterns (caller-supplied substrings or `RegExp`s);
  and **verifies declared crawlers** — when a request claims to be Googlebot or
  Bingbot, it is confirmed via reverse-DNS + forward-confirm (the method Google
  and Bing themselves document) so a spoofed `User-Agent` cannot impersonate a
  trusted crawler. Ships `GOOGLEBOT`, `BINGBOT`, and the `WELL_KNOWN_BOTS`
  bundle, and accepts custom `VerifiedBotRule`s. Allowlist-first:
  `allowUserAgents` is consulted before every other rule. Secure-by-default:
  `verifiedBots` refuses to construct without a client-IP source (`resolveIp` or
  `trustProxyHeaders`), and a crawler that cannot be verified — no client IP, or
  a DNS failure — is blocked unless `blockUnverifiableBots: false`. Domain
  matching is subdomain-boundary-safe (a leading dot in a rule domain stops
  `evil-googlebot.com` from satisfying `.googlebot.com`), verification results
  are cached per IP (default 1 h) to keep DNS off the hot path, a `mode: "log"`
  monitor mode reports matches via `onBlock` without blocking, and the DNS
  resolver is a pluggable `BotResolver` (default lazy `node:dns/promises`).
  Exports `botGuard`, `GOOGLEBOT`, `BINGBOT`, `WELL_KNOWN_BOTS`, and the
  `BotGuardOptions`, `BotGuardEvent`, `BotResolver`, and `VerifiedBotRule` types.
- **Adaptive auto-ban (fail2ban-style).** New dependency-free
  `@daloyjs/core/auto-ban` module adds `autoBan()`, a reusable escalating /
  decaying ban primitive that generalizes `loginThrottle()` beyond credential
  routes. It observes the outgoing response status via the `onSend` hook — so it
  counts suspicious statuses (default `401` / `403` / `429`, configurable via
  `watchStatuses`) produced by **any** downstream middleware or handler — and
  enforces the ban in `beforeHandle` before the handler runs. Each watched
  response is a strike; strikes accumulate inside a rolling `windowMs`
  (default 10 min) and reaching `maxStrikes` (default 5) issues a ban for `banMs`
  (default 15 min). With `escalate` (default `true`) each repeat ban doubles —
  `banMs` → `2×` → `4×`, capped at `maxBanMs` (default 24 h) — and the whole
  record **decays** once the client goes quiet, so a one-off burst is forgiven
  while a persistent attacker is locked out for progressively longer. Identity
  attribution is **secure-by-default**: the middleware refuses to construct
  unless a `keyGenerator` or `trustProxyHeaders: true` is provided, so a single
  offender can never collapse every caller into one `"global"` bucket; requests
  the key generator cannot attribute are skipped (never counted, never banned).
  A banned request returns `429 Too Many Requests` with `Retry-After` and
  `Cache-Control: no-store` by default, or `403 Forbidden` with a custom
  `message` when `banStatus: 403`. The pluggable `AutoBanStore` (`get` / `set`
  with variable TTL / `delete`) mirrors the `rateLimit()` store contract and is
  Redis-backable for multi-instance deployments; the in-memory default lazily
  expires records and opportunistically prunes. A shared `groupId` (default
  `"auto-ban"`) means a client banned on one route group is banned on all of
  them, and `onBan` / `onStrike` callbacks feed logging, alerting, or an external
  denylist. Exports `autoBan`, `MemoryAutoBanStore`, and the `AutoBanOptions`,
  `AutoBanStore`, `AutoBanRecord`, `AutoBanEvent`, and `AutoBanStrikeEvent`
  types.
- **mTLS / client-certificate auth.** New dependency-free `@daloyjs/core/mtls`
  module adds `clientCertAuth()`, a middleware that authenticates a request by
  its TLS client certificate for zero-trust / service-to-service deployments.
  The certificate is resolved from one of two sources: **native TLS** — the Node
  adapter lazily reads the peer certificate off the socket and normalizes it
  (subject, issuer, fingerprint, SANs, validity window, verified flag), behind a
  thunk so plain-HTTP requests pay nothing — or a **TLS-terminating proxy**, by
  parsing the verified identity forwarded in request headers (Envoy
  `X-Forwarded-Client-Cert`, or operator-named nginx/HAProxy/Traefik structured
  headers). Enforcement is opt-in per check: `requireVerified` (default `true`)
  refuses any chain the TLS terminator did not verify; `allowSubjectCNs` /
  `allowIssuerCNs` do exact CN matching; `allowFingerprints` matches the SHA-256
  fingerprint in **constant time** (separators/case ignored); `allowSANs`
  requires at least one Subject Alternative Name (SPIFFE/DNS/URI/IP, as
  `TYPE:value` or bare); `checkValidity` (default `true`) rejects certificates
  outside their `[notBefore, notAfter]` window; and a custom async
  `verify(cert, ctx)` hook runs last. A missing certificate yields `401`
  `application/problem+json` with `Cache-Control: no-store`; any failed check
  yields `403` without echoing certificate details. The accepted
  `ClientCertificate` is stamped on `ctx.state` (configurable `stateKey`). The
  building blocks `parseForwardedClientCert()`, `normalizePeerCertificate()`,
  and `setClientCertificate()` / `getClientCertificate()` are exported
  standalone for custom adapters. Zero runtime dependencies. _(`@since 0.37.0`)_
- **In-process scheduled tasks (cron).** New dependency-free
  `@daloyjs/core/scheduler` module adds a queue-agnostic schedule primitive for
  periodic housekeeping (cache sweeps, token refresh, reconciliation). Register
  tasks with `app.cron(def, handler)` — the first call lazily creates an
  app-managed `Scheduler`, starts it, and wires the graceful-shutdown drain — or
  drive a standalone `Scheduler` directly. Tasks run on a fixed `intervalMs` or
  a 5-field `cron` expression supporting wildcards, lists, ranges, steps
  (`*/5`), case-insensitive month/day names, `0`/`7` Sunday, and the
  `@yearly`/`@monthly`/`@weekly`/`@daily`/`@hourly` aliases, plus an optional
  IANA `timeZone`. Cron parsing is purely arithmetic (no backtracking regex) and
  rejects malformed or unsatisfiable expressions with a `CronParseError` at
  registration time. Scheduling is **fixed-rate with single-flight**: the next
  tick is armed before each run, and a tick that fires while the previous run is
  still in progress is skipped (and counted) rather than run concurrently, so a
  slow task can never pile up. An optional per-run `timeoutMs` aborts the run's
  `AbortSignal` and records the run as a timed-out failure. Timers are
  `unref`'d, so a scheduler never keeps an otherwise-idle process alive. On
  shutdown the scheduler stops arming new runs, awaits in-flight runs, and
  aborts any that outlast the grace period. The cron utilities `parseCron()` and
  `nextCronRun()` are exported standalone, and `app.scheduledTasks` exposes
  `list()` / `getState(name)` / `runNow(name)` for inspection and out-of-band
  runs. Zero runtime dependencies. _(`@since 0.37.0`)_

- **Outbound webhook delivery.** New dependency-free
  `@daloyjs/core/webhook-delivery` module adds `createWebhookSender()` — the
  outbound counterpart to the inbound `verifyWebhookSignature()` /
  `signWebhookPayload()` helpers. Each delivery is a `POST` carrying a stable
  `webhook-id`, a `webhook-timestamp`, and a `webhook-signature`
  (`sha256=…`) computed over `"<timestamp>.<body>"` and reused across retries so
  receivers can dedupe safely. Failed deliveries are retried with bounded
  exponential backoff + jitter, scoped to transient statuses
  (`408`/`429`/`5xx`) and network/timeout errors, honouring a `Retry-After`
  header; each attempt has its own `AbortController` timeout. Events that
  exhaust their attempts — or fail permanently — are handed to a
  `WebhookDeadLetterSink` (with a bounded `MemoryWebhookDeadLetterSink` built
  in). The transport defaults to `fetchGuard()`, so a subscriber URL resolving
  to cloud metadata or a private range is refused with a terminal
  `SsrfBlockedError` that is never retried and is dead-lettered once. Caller
  headers can never clobber the signature headers.

- **Outbound resilience for `fetch`.** New dependency-free
  `@daloyjs/core/fetch-resilience` module adds `resilientFetch()` — a circuit
  breaker, retry-with-backoff, and per-call timeout designed to layer **on top
  of** `fetchGuard()` (which only covers SSRF on egress). The per-call timeout
  uses an `AbortController` combined with any caller-supplied `signal` and
  surfaces as `FetchTimeoutError`; retries are exponential with full jitter,
  scoped to idempotent methods (`GET`/`HEAD`/`OPTIONS`/`PUT`/`DELETE`) and
  transient statuses (`408`/`429`/`5xx`), and honour a `Retry-After` header; the
  shared three-state `CircuitBreaker` (`closed → open → half-open`) fails fast
  with `CircuitOpenError` when an upstream is down and probes for recovery. SSRF
  protection stays intact: an `SsrfBlockedError` is a terminal refusal that is
  never retried and never trips the breaker, and a caller-initiated abort is
  neither retried nor counted as an upstream failure. `CircuitBreaker` is
  exported standalone (with `execute()` / `admit()` / `recordOutcome()` /
  `release()`) so the same semantics can protect any non-`fetch` dependency.

- **Metrics &amp; the `/metrics` endpoint.** New dependency-free
  `@daloyjs/core/metrics` module and `app.metrics()` route method add the third
  observability pillar alongside the structured logger and the OpenTelemetry
  tracer. `MetricsRegistry` holds memoized counters, gauges, and histograms and
  renders them to the Prometheus text exposition format; metric and label names
  are validated against the Prometheus grammar at definition time and label
  values are escaped, an exposition-injection defense, while a per-metric
  cardinality cap (`maxSeries`) drops overflowing label combinations and counts
  them in `daloy_metrics_series_dropped_total` to bound memory. `httpMetrics()`
  is a `Hooks` bundle that records RED metrics (`http_requests_total`,
  `http_request_duration_seconds`, `http_requests_in_flight`) with a
  cardinality-capped `route` label, plus scrape-time process gauges on
  Node-like runtimes. `app.metrics()` installs that instrumentation as a group
  hook and registers an opt-in `/metrics` scrape route that inherits the same
  hardened posture as `app.healthcheck()`: an optional bearer token compared
  with `timingSafeEqual` (`401` missing / `403` wrong), a per-IP fixed-window
  rate limit (`429` on overflow), and a refuse-to-boot guard that blocks an
  unauthenticated scrape endpoint in production unless a token is set or
  `acknowledgeUnauthenticated: true` is passed.
- **Pagination &amp; cursor helpers.** New dependency-free
  `@daloyjs/core/pagination` module for cursor-paginated list endpoints.
  `encodeCursor()` / `decodeCursor()` turn an arbitrary JSON-serializable sort
  key into an opaque, URL-safe base64url token and back; decoding is hardened
  with a 4 KiB length cap, malformed-input rejection, and prototype-pollution
  key stripping, so a tampered cursor surfaces as a `400` rather than a `500`.
  `buildLinkHeader()` / `buildPageLinks()` assemble an RFC 8288 `Link` header
  (with `next`/`prev`/`first` rels) from the current request URL — preserving
  all other query parameters — and reject CRLF, angle brackets, and quote
  characters to block header-injection. `paginationQuery()` is a Standard Schema
  for the `cursor` + `limit` query parameters that validates and clamps `limit`
  to a configurable `[minLimit, maxLimit]` range at the request boundary **and**
  advertises both parameters to the OpenAPI generator (and typed client) through
  a `toJSONSchema()` method — so `request: { query: paginationQuery() }` wires
  the contract with no duplicate declarations.
- **Response caching.** New dependency-free `responseCache()` middleware (also
  exported from `@daloyjs/core/response-cache`) caches rendered response bodies
  server-side so a fresh hit skips the handler entirely — the missing third
  piece alongside `etag()` (conditional `304`s) and `compression()` (wire
  bytes), neither of which cache bodies. Freshness is orchestrated from the
  response's own `Cache-Control` (`s-maxage` &gt; `max-age`) with a
  `ttlSeconds` fallback; request `Cache-Control: no-store`/`no-cache` bypass the
  cache; and `staleWhileRevalidateSeconds` + a `revalidate` callback serve stale
  content while a recursion-safe background refresh repopulates the entry. Ships
  a pluggable `ResponseCacheStore` (mirroring `SessionStore`) with an in-memory
  `MemoryResponseCacheStore` default, `Vary`-aware keying, a body-size cap, and
  an `X-Cache` HIT/MISS/STALE marker. Secure-by-default: responses carrying
  `Set-Cookie` or `Cache-Control: private`/`no-store`/`no-cache`, non-`200`
  statuses, and oversized bodies are never cached.
- **Idempotency keys.** New dependency-free `idempotency()` middleware (also
  exported from `@daloyjs/core/idempotency`) gives unsafe methods
  (`POST`/`PUT`/`PATCH`/`DELETE`) exactly-once semantics under retries. A
  client-supplied `Idempotency-Key` header drives request fingerprinting
  (method + path + body), byte-for-byte response replay (with an
  `Idempotency-Replayed: true` marker), an in-flight `409 Conflict`, and a
  `422` when a key is reused with a different payload. Ships a pluggable
  `IdempotencyStore` (mirroring `SessionStore`) with an in-memory
  `MemoryIdempotencyStore` default, plus a new `ConflictError` (`409`).
  Server errors and oversized responses are never cached so retries stay safe.
- **API lifecycle headers (RFC 8594).** Routes accept an optional `sunset`
  date (ISO-8601 string or `Date`). A route with a `sunset` is implicitly
  deprecated: every response carries a `Deprecation: true` header and a
  `Sunset: <HTTP-date>` header, and the generated OpenAPI operation gains
  `deprecated: true` plus an `x-sunset` extension. The value is validated and
  normalized once at `app.route(...)` registration time.
- **OpenAPI diff engine.** New pure, dependency-free `@daloyjs/core/openapi-diff`
  module exporting `diffOpenAPI(baseline, current)` and
  `hasBreakingChanges(baseline, current)` to classify added, removed, and
  changed operations as breaking or non-breaking.
- **`daloy diff <baseline> <current>` CLI command** and a
  `verify:breaking-changes` script that compares the generated spec against the
  last published one and exits non-zero on a breaking change, so CI can gate
  "did this PR break my published API?".

- **AsyncAPI 3.0 generation for WebSockets.** New pure, dependency-free
  `@daloyjs/core/asyncapi` module exporting `generateAsyncAPI(app, options)` and
  `asyncapiToYAML(doc)`. Every `app.ws()` route becomes an AsyncAPI channel
  (address + path parameters) with a `receive` operation for inbound client
  messages and an optional `send` operation for outbound messages. Payloads are
  taken from a new optional `meta` block on the WebSocket handler
  (`summary`, `description`, `tags`, `send`, `receive`, `operationId`), falling
  back to the handler's `request.body` schema for the inbound payload. A new
  `daloy inspect --asyncapi` flag (with `--format yaml`) prints the document.
  This extends the contract-first story past HTTP, mirroring the built-in
  OpenAPI generator.

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
