# Changelog

All notable changes to **`@daloyjs/core`** (and its companion **`create-daloy`**
scaffolder, which ships in lockstep) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
For the forward-looking plan and the full thematic release log, see
[`ROADMAP.md`](ROADMAP.md).

> Now in the **1.0.0 release candidate**. The public API is feature-complete and
> stable for the 1.0 line; from 1.0 onward the API follows semver. `@daloyjs/core`
> and `create-daloy` ship together, so every release publishes a matching
> scaffolder and generated projects pin the latest peer.

## [Unreleased]

## [1.0.0-rc.9] - 2026-08-01

### Security

- **`responseCache()` / `idempotency()` mounted ahead of `rateLimit()` /
  `loginThrottle()` now refuses to boot in production (boot guard 8).** A cache
  hit and an idempotent replay are both returned from `beforeHandle`, and
  returning a response there ends the hook chain. The limiters enforce from that
  same phase, so one mounted _behind_ either never counted the requests it
  served. Measured: `rateLimit({ max: 2 })` admitted **six of six** requests
  behind a cache, and six of six behind a replay — the declared budget was
  silently unlimited for exactly the repeat traffic a rate limit exists to bound,
  with nothing in the response indicating it.
  - Same hazard as the `responseCache`-ahead-of-`tenancy()` guard, one phase
    later, and the same shape as the finding that moved the five
    network-identity gates to `preBody`. `rateLimit()` cannot follow them there:
    its `keyGenerator` is caller-supplied and may read `ctx.state` that
    `session()` or an auth layer populates in `beforeHandle`, which is precisely
    the regression that move caused for the gates. So the unsafe order is
    refused rather than silently reordered — no runtime behaviour changes for
    apps that already order the limiter first.
  - Ordering the limiter first does mean cache hits and replays spend budget.
    That is the intended reading: the cap is on what a caller may ask for, not
    on what happened to be expensive to produce.
  - Production-only and `secureDefaults`-gated, like every other boot guard.
    Documented as guard 8 on `/docs/security/boot-guards`, with mount-order
    notes added to the `responseCache()` and `idempotency()` quick-starts.
    Regression tests in `tests/replay-before-budget-guard.test.ts`, including
    both safe orders still enforcing the budget and each middleware alone still
    booting. Verified by ablation: disabling the guard lets both unsafe orders
    boot again.
  - Investigated in the same pass and found already safe, so no code changed:
    `idempotency()` ahead of `bearerAuth()` (its default `scope` partitions on
    the `Authorization` header, so an anonymous replay misses and auth still
    runs), and `etag()`, which acts only in `onSend` and so cannot preempt a
    gate or downgrade a `401` into a `304`.

### Tests

- **`responseCache()`'s credential bypass is now pinned by regression tests**
  (`tests/response-cache-credentials.test.ts`). Declining to store or serve a
  request that carries `Authorization` or `Cookie` is the CWE-524 protection
  that makes a cache mounted _ahead of_ auth safe: both run in `beforeHandle`,
  so a hit returned from there ends the hook chain and the auth layer never
  executes. Nothing covered it — zero tests referenced
  `cacheAuthenticatedRequests`, and the existing `Set-Cookie` test is about the
  _response_ header, not the request credential. An optimization that made the
  cache store everything would have turned the documented mount order into an
  authentication bypass with no test failing. Verified by ablation: neutralising
  the `authorization` bypass fails two of the six.
  - Also pins the deliberate footgun. `cacheAuthenticatedRequests: true`
    _without_ a partitioning key does reuse one caller's body for the next, as
    its own TSDoc documents; the test asserts that rather than treating it as a
    defect, so the opt-in's blast radius stays measured and anyone who later
    makes it partition automatically gets a prompt to update the guidance.
  - Investigated and found already safe, so no code changed: cache ahead of
    `bearerAuth`, and the per-dimension `{ cookie: true }` form not quietly
    enabling the `authorization` dimension.

### Security

- **The Node adapter no longer solicits a request body it is about to refuse.**
  Node answers `100 Continue` to anyone who sends `Expect: 100-continue`,
  including a request whose declared `Content-Length` already exceeds
  `bodyLimitBytes`. Measured on the wire, that produced `100` then `413`: the
  client was invited to stream ~100 MB that could only be discarded, and a
  hostile client could hold many such sockets open cheaply. `writeContinue()` is
  now deferred until the framework actually reaches for the body, so a request
  that is going to be refused is refused without the invitation.
  - **This is the second attempt, and the first one was reverted for a reason
    worth recording.** That attempt refused at header time by comparing
    `Content-Length` against `bodyLimitBytes` directly. It looks equivalent and
    is not: `bodyLimitBytes` is enforced where a body is _parsed_, so a route
    declaring no request-body schema never applies it. The early check therefore
    refused requests the framework would have served, and because only clients
    sending `Expect` took that path, the same request answered `413` from curl
    (which sends `Expect` for large bodies) and `200` from `fetch`. `Expect` is
    a hint about _when_ to send a body (RFC 9110 §10.1.1); it must never change
    the outcome.
  - The fix keys off the framework's own read decision instead, via a new
    internal `DALOY_REQUEST_BODY_SOLICIT` hook that the core invokes once it has
    decided the body is both wanted and within the limit. Because both paths now
    consult one decision, `Expect` changes only _when_ the client learns the
    answer — by construction, not by test coverage. `stepBody()` also refuses an
    over-limit declared length before firing that hook; `readBodyLimited()`
    already made the identical check on the identical boundary, so no outcome
    changes, but the ordering is what keeps the body from being solicited first.
  - Deliberately not done: turning `bodyLimitBytes` into a transport-level cap
    that applies to routes with no body schema. That would change documented
    behaviour for streaming routes and needs a per-route override, which does not
    exist today. The socket-holding risk it would additionally cover is already
    bounded by `connectionTimeoutMs` / `headersTimeout` / `keepAliveTimeout`.
  - Regression tests in `tests/node-adapter.test.ts`, including the schema-less
    route whose absence let the first attempt's own tests pass while it was
    broken, and a streaming in-limit upload that would hang if the hook ever
    stopped firing. The live probe in `red-team-live/run.ts` was upgraded from an
    INFO posture note to a `DEFENDED` assertion on the absence of the interim
    `100`.

## [1.0.0-rc.8] - 2026-07-30

### Security

- **`idempotency()` no longer stores or replays `Set-Cookie` (review of the
  cookie-scoping fix below).**

  `captureResponse()` stored every response header and replayed them verbatim, so
  a `Set-Cookie` issued to the first caller was re-issued to whoever replayed the
  record. Combined with any coarse namespace that turns a body disclosure into
  handing over a live session — account takeover rather than data leakage. It was
  wrong for a legitimate same-caller retry too, resurrecting a cookie the handler
  set once and rolling back a session rotation performed at login or on a
  privilege change. `Set-Cookie`/`Set-Cookie2` plus the hop-by-hop and
  per-request fields (`Connection`, `Transfer-Encoding`, `Age`, `X-Request-Id`, …)
  are now filtered on capture, so a credential never reaches the store at all,
  and re-filtered on replay so a record written by an older build — or any other
  writer sharing the same Redis store — cannot replay one either. Unlike
  `responseCache()`, which refuses to store such a response outright, idempotency
  strips and stores: declining would release the reservation and let a retry
  re-execute the handler, which is the double-charge the middleware exists to
  prevent.

  This also bounds the blast radius of a scope that resolves but is too _coarse_.
  A per-tenant API key with cookie-identified end users partitions per tenant
  while every user inside one shares a namespace — the guard below cannot see
  that, because a coarse scope is indistinguishable from a correctly per-user one
  (widening it to fire on any cookie-bearing request was tried and reverted: it
  rejects a per-user bearer token arriving with ordinary browser cookies, which is
  the far more common shape). That residual is now documented on
  `IdempotencyOptions.scope` as the app's call, and with `Set-Cookie` stripped it
  can no longer escalate from disclosing a body into handing over a live session.
  Regression tests in `tests/idempotency-replay-hardening.test.ts`.

- **`MemoryIdempotencyStore` is now actually bounded.** Its TSDoc claimed the map
  "cannot grow without bound", but the sweep only dropped _expired_ records and
  only ran past 10 000 entries, so a stream of unique keys inside the TTL grew it
  linearly — each entry pinning a stored response body up to `maxResponseBytes`
  (1 MiB by default). A `maxEntries` cap (default 10 000, constructor-validated)
  now sweeps expired records first and evicts the oldest survivor if the store is
  still full. Evicting a live record can only cost exactly-once semantics for a
  retry arriving after the eviction, which is the right trade against unbounded
  memory — and a reason to supply a shared store when key volume approaches the
  cap.
- **`autoBan()` retries a custom `keyGenerator` in `beforeHandle` when `preBody`
  cannot resolve an identity.** Moving the gate to `preBody` (below) silently
  changed what a custom generator can see: it now runs before body I/O and before
  every `beforeHandle` layer, so a generator keyed on state that `session()`
  resolves returned `undefined`, no key was stashed, and `onSend` — which reads
  that stashed key — recorded no strike. The ban never armed, with no error and no
  log. The generator is now called again in `beforeHandle` when, and only when,
  the `preBody` pass came up empty; the hook is registered only for a custom
  generator, so the default path costs nothing. Requests enforced by that second
  attempt are order-sensitive again (a `responseCache()` hit short-circuits
  `beforeHandle`), which is documented and strictly better than not enforcing at
  all. Regression tests in `tests/auto-ban-keygen-phase.test.ts`.
- **The resolver options of all five network-identity gates are typed on the
  phase they actually run in.** `geoBlock`'s `resolveIp`/`resolveCountry`,
  `ipRestriction`/`botGuard`/`ipReputation`'s `resolveIp`, and `autoBan`'s
  `keyGenerator` were typed on `BaseContext`, whose `body` widens to `any`. After
  the move to `preBody` that let `(ctx) => ctx.body.email` type-check and then
  evaluate to `undefined` at run time — and two of the five failed _silently_:
  `ipReputation` fails open on an unresolved IP, and `autoBan` stopped banning
  entirely. They now take the new `IdentityGateContext` (a `PreBodyContext`
  alias), so reading through `body` is a compile error instead of a security
  control that quietly switches itself off. Type-level regression tests in
  `tests/types/identity-gate-context.types.ts`.
- **`encodeClosePayload()` validates the close code, and a status-less CLOSE is no
  longer echoed as `1005`.** Close-code validation (below) landed on the decoder
  only, so the framework could emit a frame its own decoder — and any conforming
  peer — must reject with `1002`. `ws.close(1005)` was the obvious way to hit it,
  and `WS_CLOSE_CODE.NO_STATUS_RECEIVED`/`ABNORMAL_CLOSURE` are exported, so it
  was reachable by accident. Worse, the Node adapter's echo path already hit it on
  a completely benign request: a peer closing with an _empty_ payload surfaces as
  the `1005` sentinel, which was fed straight back into the encoder, so the most
  common close in existence was answered with an illegal `CLOSE(1005)`. The echo
  now answers a status-less close with a status-less close, both halves of the
  codec share the new exported `isValidWireCloseCode()` predicate, and
  `WS_CLOSE_CODE` documents `1005`/`1006` as receive-only sentinels. Verified over
  a real socket in `tests/websocket.test.ts` and by four live probes in
  `red-team-live/run.ts`.

- **The network-identity access-control gates now run in `preBody`, so a
  `responseCache()` mounted ahead of them can no longer disable them (live
  red-team finding, high).** `geoBlock()`, `ipRestriction()`, `botGuard()`,
  `autoBan()` and `ipReputation()` all enforced from `beforeHandle` — the _same_
  phase as `responseCache()`. A cache hit returns a `Response` from
  `beforeHandle` and ends the hook chain, so mounting the cache above a gate
  silently switched that gate off: a denied country, a deny-listed address, a
  blocked user agent and an actively-banned client each received `200` plus the
  cached body, with `X-Cache: HIT` the only trace. The response-cache
  quick-start mounts the cache first, so the documented pattern produced the
  vulnerable order, and the existing `App` boot guard for
  cache-ahead-of-`tenancy()` had no equivalent for access control. All five now
  enforce from `preBody`, which always precedes `beforeHandle`, so mount order
  cannot preempt them — the same reason `bearerAuth()` / `basicAuth()` /
  `clientCertAuth()` were already immune. Strike accounting in `autoBan()` stays
  in `onSend`. Cache behaviour for permitted callers is unchanged. Regression
  tests in `tests/access-control-cache-composition.test.ts`.
- **`autoBan()` now attributes strikes to the TCP peer when the forwarded
  identity cannot be resolved, instead of discarding the request (live red-team
  finding, medium).** `resolveForwardedClientIp()` fails closed past one hop, so
  a request whose `X-Forwarded-For` was shorter than the declared `trustedHops`
  resolved to no identity — and `autoBan()` treated that as "skip". An attacker
  who could reach the origin directly, past the CDN that appends the header,
  therefore got **unlimited credential attempts by simply omitting a header**:
  12 consecutive failed logins never produced a ban. The default is now
  `onUnresolvedIdentity: "peer"`, which keys such requests on the immediate TCP
  peer address in its own `peer:` keyspace. The peer cannot be spoofed, and in
  exactly the direct-to-origin case that produced the bypass the peer _is_ the
  attacker, so accounting becomes precise rather than absent. Set
  `onUnresolvedIdentity: "skip"` to restore the previous posture (documented
  trade-off: a load balancer that does not always set `X-Forwarded-For` would
  otherwise share one `peer:` bucket). Requests with neither a forwarded
  identity nor a peer — edge runtimes with no socket — are still skipped rather
  than collapsed into a shared bucket. A custom `keyGenerator` keeps its own
  posture.
- **`idempotency()` now refuses a cookie-bearing request whose calling principal
  the default `scope` cannot identify, instead of sharing one namespace across
  callers (live red-team finding, high).** `scope` defaults to the
  `Authorization` header, and the scope tag was only mixed into the store key
  when it resolved (`scopeRaw ? hash : ""`). A cookie-authenticated app sends no
  `Authorization`, so every caller collapsed into the unscoped namespace and the
  retry fingerprint (method + path + body) became the only thing separating two
  users — which two users submitting the same payload compute identically. The
  live probe had a second user receive the first user's stored order response:
  CWE-524 cross-principal disclosure, the exact failure `scope` exists to
  prevent. A request that carries a `Cookie` but yields no scope now throws with
  an actionable message naming `scope` and the new `allowUnscopedCallers` escape
  hatch. Deliberately narrow: the documented bearer path is untouched, a
  genuinely anonymous caller (no credential at all) still dedupes by key alone,
  and a custom `scope` bypasses the guard entirely — including when it returns
  `undefined` — because an explicit resolver owns its own posture. Mirrors
  `responseCache()`, which already treats `Cookie` as a credential alongside
  `Authorization` for the same reason. Regression tests in
  `tests/access-control-cache-composition.test.ts`.
- **Live red-team harness: the oversized-body probe now sends a `User-Agent`, and
  a second probe asserts the earlier perimeter refusal (175 probes).** Moving the
  access-control gates to `preBody` means they reject _before_ body I/O, so the
  raw `POST` advertising a 1 GiB `Content-Length` and no `User-Agent` is now
  refused `403` by `botGuard()`'s default `blockEmptyUserAgent` at header time
  instead of `413` after body parsing began — cheaper, not weaker
  (`bodyLimitBytes` still returns `413` once a UA is present). The probe had
  therefore been measuring `botGuard`, not the body limit. Rather than widen its
  accepted-status list, it now sends a plausible UA so it exercises the path it
  claims to, plus a companion probe pinning the earlier perimeter refusal so the
  ordering cannot silently regress. Worth knowing generally: raw-socket probes
  need a `User-Agent` or `botGuard` intercepts them first.
- **`waf()` now NFKC-normalizes inspection variants so fullwidth / compatibility
  homoglyph keywords cannot walk past ASCII-anchored signatures, and the fold
  composes with the other inspection passes (live red-team finding).** Payloads
  such as `ｕｎｉｏｎ ｓｅｌｅｃｔ` previously scored 0 and reached the handler
  because every built-in SQLi/XSS signature anchors on ASCII word boundaries.
  `inspectionVariants()` now adds an NFKC-folded form whenever a value contains
  non-ASCII code points (pure-ASCII traffic skips `String.prototype.normalize`
  entirely).

  The fold is applied to the decode chain **before** the `+` / comment-strip /
  control-character passes, and its output joins that chain, so the transforms
  compose. Closing the homoglyph evasion in isolation was not enough: the folded
  form was pushed as a leaf variant, so the other passes never ran on it and the
  fold never ran on theirs. Combining two individually-blocked techniques —
  `＇%00ＯＲ%00＇１＇＝＇１` (fold + NUL split) or `＇/**/ＯＲ/**/＇１＇＝＇１`
  (fold + comment split) — therefore walked straight through with a `200`. Order
  matters in one more way: NFKC _creates_ comment delimiters out of fullwidth
  solidus and asterisk, so `ｕｎｉｏｎ／＊ｘ＊／ｓｅｌｅｃｔ` only scores if the
  fold precedes the comment pass. Regression tests in `tests/waf.test.ts`; nine
  live probes in `red-team-live/run.ts` cover the fold and every composition.

- **`safeRedirect()` now refuses percent-encoded C0/DEL control characters in
  redirect targets (live red-team finding F2).** A still-encoded control such
  as the tab in `/%09/evil.com` previously passed the literal control-char
  check and was written verbatim into the `Location` header. Spec-compliant
  browsers keep it same-origin, but legacy WebKit stacks strip decoded
  tabs/newlines and can re-interpret the result as protocol-relative — the
  trick behind historical Safari open-redirect CVEs. Targets containing
  `%00`–`%1F` or `%7F` now throw `OpenRedirectBlockedError` with reason
  `invalid-control-characters`; the range is deliberately narrow so legitimate
  percent-encoded UTF-8 paths (continuation bytes live in `%80`–`%BF`) are
  unaffected. Regression tests in `tests/safe-redirect.test.ts` and live
  redirect-differential probes in `red-team-live/run.ts`.
- **WebSocket close-code validation in `decodeClosePayload` (live red-team
  finding F3).** The close-frame payload decoder never validated the 2-byte
  status code, so a peer could close with a code that is invalid on the wire
  (e.g. `999`, or `5001` above the private-use range) and the server would echo
  it back instead of failing the connection — a protocol-compliance gap that
  non-conforming clients could use to desynchronize close-handshake state
  machines. Codes are now validated per RFC 6455 §7.1.6 (`1000`–`1014` except
  the reserved `1004`/`1005`/`1006`, plus the application/private `3000`–`4999`
  ranges); an invalid code throws `WebSocketProtocolError`, which the frame
  sink maps to a `CLOSE(1002)` — verified live against a running server.
  Regression tests in `tests/websocket.test.ts`; live probes in
  `red-team-live/run.ts` (`wave4Probes`).
- **Live red-team harness expanded from 127 to 175 over-the-wire probes.** The
  new `wave4Probes` battery in `red-team-live/run.ts` fires attack classes the
  earlier waves never touched: race conditions (idempotency double-spend,
  rate-limit overrun, concurrency-limit overshoot — truly simultaneous bursts;
  exactly 1 / ≤5 / 1 admitted), CL/TE parser differentials (hex / plus-signed /
  leading-zero / decimal / space-padded `Content-Length`, TE+CL:0 desync pairs,
  pipelined-after-CL:0), post-upgrade WebSocket frame attacks (reserved
  opcodes, RSV bits, fragmented / oversized / unmasked control frames, invalid
  UTF-8, invalid close codes, 4 GiB declared lengths, new opcodes
  mid-fragment), multipart exotica (1000-part floods, embedded boundaries,
  truncation, traversal filenames), content-encoding confusion (gzip-labeled
  deflate, nested gzip, UTF-16 charset, BOM), protocol oddities (h2c upgrade,
  WS upgrade to non-WS routes, OPTIONS *, CONNECT, HTTP/0.9, obs-fold), and
  trailer-field smuggling. All 175 probes: **0 VULNERABLE** (the one genuine
  wave-4 finding, F3 above, was fixed before folding the battery in).
- **Live red-team harness expanded from 70 to 127 over-the-wire probes.**
  `red-team-live/run.ts` gained a `novelProbes` battery covering vectors found
  by going off-script against a running server: except() case /
  double-encoding / semicolon / fullwidth-solidus / overlong-UTF-8 confusion,
  HEAD-method and duplicate-`Authorization` bypass attempts, JWT `kid`/`jku`/
  `x5u`/`crit`/`zip` header abuse and RS256 confusion, open-redirect parser
  differentials, SSRF IP-literal differentials (decimal/hex/octal/short IPv4,
  IPv6-mapped, trailing-dot, userinfo-masked), one-sided CSRF tokens, WAF
  evasion encodings, production error redaction, CSWSH lookalike-subdomain /
  null / absent origins, `Expect: 100-continue` timing, chunk-framing abuse,
  and X-Forwarded-For chain posture. All 127 probes: **0 VULNERABLE**.
  The skills-driven second wave (`red-team-live/skill-attacks.ts`, built from
  `.claude/skills`: cure53-webapp-api-pentest, tob-insecure-defaults,
  tob-sharp-edges, tob-constant-time-analysis) grew to **98 probes** with a
  third battery drawn from tob-fuzzing-dictionary (path/query/JSON-body token
  sweeps), tob-constant-time-testing (dudect-style interleaved Welch's t-test
  against the basic-auth credential oracle — no network-detectable leak,
  |t| < 0.5 across all class pairs) and tob-insecure-defaults (dev-mode error
  verbosity, env-resolution posture), plus a tob-variant-analysis pass over the
  `safeRedirect()` fix above, which found no variants: `safeRedirect` is the
  only writer of a `Location` header in `src/` (`fetch-guard` only reads one,
  to re-validate a redirect hop). The same pass confirmed no runtime other than
  the Node adapter owns `Expect: 100-continue` handling at all — every other
  adapter receives an already-materialized `Request` with the body cap enforced
  in the shared core — which is background for the reverted header-time refusal
  described below, not a variant of a shipped fix. All 98 probes:
  **0 VULNERABLE**.

  This harness is now type-checked. `red-team-live/` sat outside every tsconfig
  project, so `pnpm typecheck` had never looked at roughly 100 KB of TypeScript
  and a contributor reasonably reported "typecheck passes" for changes to it. It
  is wired in as a fourth project (`red-team-live/tsconfig.json`, also runnable
  standalone as `pnpm typecheck:red-team-live`) and the errors that surfaced are
  fixed with real type conversions rather than casts — including a
  `body: opts.body as any` that could have let a probe report DEFENDED without
  actually sending its payload. The directory still ships in neither published
  artifact (npm `files: ["dist", "bin", "README.md"]`, JSR
  `include: ["src", "README.md", "LICENSE"]`).
  - Not every probe became a fix. A header-time `413` for `Expect:
100-continue` requests declaring an over-limit `Content-Length` was
    implemented and then reverted: `bodyLimitBytes` is enforced when the body is
    _parsed_, so a route that declares no request body schema never enforces it,
    and refusing at header time made an identical request resolve differently
    depending on a transport hint (curl, which sends `Expect` for large bodies,
    received `413` where `fetch` received `200`). The hand-rolled early response
    also bypassed `secureHeaders` and `requestId`. Closing this properly needs a
    uniform transport-level cap that applies with or without `Expect` and is
    emitted through the error pipeline; it is tracked as post-1.0 work and the
    harness records the current posture as an INFO probe.

### Changed

- **`red-team-live/` is now type-checked.** The root `tsconfig.json` excludes the
  directory (the harness runs through `tsx`, which strips types without checking
  them), so ~2 500 lines of attack-harness TypeScript were never checked anywhere.
  That is the wrong place to have no safety net: a probe that never compile-checks
  can stop exercising what its title claims — sending `undefined` as a body,
  reading the wrong field off a response — and still print `DEFENDED`, which reads
  as evidence the framework held. A new `red-team-live/tsconfig.json` (mirroring
  `tests/tsconfig.json`) is wired into `pnpm typecheck` as a fourth project and
  available on its own as `pnpm typecheck:red-team-live`.

  Enabling it surfaced six real errors, all now fixed: four `BodyInit`
  incompatibilities where `Buffer`/`Uint8Array` default to an `ArrayBufferLike`
  backing store (resolved with a `toBodyInit()` conversion at the `fetch`
  boundary — a real re-wrap, not a cast), and one `noUncheckedIndexedAccess`
  widening in an SSRF URL table (resolved by typing it as tuples). A
  `body: opts.body as any` in `blackhat-attacks.ts` was papering over the same
  mismatch and is gone — in an attack harness, a cast that lets `undefined`
  through means a probe can report `DEFENDED` without ever sending its payload.

## [1.0.0-rc.7] - 2026-07-29

### Security

- **Forwarded-header client-IP resolution is now spoof-resistant across every
  middleware that keys on it — closing two live red-team findings
  (`red-team-live/skill-attacks.ts`, cure53 EXP-23-005 / P11-02-005 class).**
  Every `trustProxyHeaders` resolver (`autoBan`, `rateLimit`, `loginThrottle`,
  `concurrencyLimit`, `geoBlock`, `ipRestriction`, `ipReputation`, `botGuard`)
  and `resolveClientIp({ behindProxy: "loopback" })` previously read the
  **leftmost** `X-Forwarded-For` entry — the most attacker-controllable slot
  in the header. Confirmed over the wire against a running server:
  - **autoBan strike evasion (HIGH):** rotating a spoofed leftmost entry on
    every attempt meant strikes never accumulated — unlimited brute force.
  - **autoBan victim-IP banning (MEDIUM):** spoofing a victim's IP in the
    leftmost entry got the _victim_ banned (pre-emptive DoS), and the same
    read let attackers dodge `geoBlock` / `ipRestriction` / `ipReputation`
    decisions with a spoofed left entry.
  - **Fix:** the default resolvers now read the **rightmost** entry — the one
    your immediate proxy actually appended — via the new exported
    `resolveForwardedClientIp(request, hops)` helper
    (`src/conn-info.ts`), and every affected middleware accepts a new
    `trustedHops?: number` option (integer in [1, 64], validated at
    construction) that declares exactly how many proxy hops sit between Daloy
    and the internet for multi-hop chains (CDN → LB → app). `trustedHops`
    implies proxy-header trust; `trustProxyHeaders: true` is equivalent to
    `trustedHops: 1`. Single-proxy deployments (the common case) are secure
    with no config change; multi-hop deployments behind an overwrite-mode CDN
    must set `trustedHops` to their hop count.
  - Note: with **no** proxy in front, forwarded-header trust remains
    attacker-controlled by definition — the option contract already requires
    a controlled proxy chain; this is now stated explicitly in every
    resolver's TSDoc.
  - Regression coverage: `tests/forwarded-client-ip.test.ts` (24 tests —
    rotation evasion, victim framing, multi-hop slot selection, fail-closed
    short chains, and construction validation for all eight middlewares) plus
    the live `red-team-live/skill-attacks.ts` suite (92 probes, 0 VULNERABLE).

- **`X-Real-IP` is no longer honoured past a single declared hop.**
  `resolveForwardedClientIp()` previously fell back to `X-Real-IP` whenever
  `X-Forwarded-For` was absent _or shorter than the declared hop count_. Under
  `trustedHops: 2+`, a request that reached the origin directly (skipping the
  CDN, a routinely reachable condition once an origin address leaks) carried a
  short chain, so the fallback handed back a fully attacker-settable header as
  the client identity — restoring the rotating-identity evasion the hop-aware
  read exists to prevent. The fallback is now scoped to `trustedHops: 1`, the
  only declaration `X-Real-IP` can actually satisfy (it carries exactly one hop
  of information, and the nginx `X-Real-IP`-only setup is the case it serves).
  Past one hop, a chain shorter than the declaration resolves to `undefined`:
  the request did not traverse the declared topology, so no value it carries is
  trustworthy. Callers keep their documented posture for an unresolved identity
  (`ipRestriction` / allow-list `geoBlock` refuse with `403`, `autoBan` and
  `concurrencyLimit` skip, `rateLimit` / `loginThrottle` use the shared
  `"global"` bucket). An attacker inside the chain cannot reach this path:
  conforming proxies append, so prepending entries only lengthens the header.

- **`trustProxyHeaders: false` combined with `trustedHops` now throws at
  construction** instead of silently resolving in favour of trust, which meant
  an explicit opt-out was ignored and forwarding headers were read anyway.
  Affects all eight middlewares.

### Changed

- **Forwarded-header trust resolution is now decided in one place.** The
  `trustedHops !== undefined || trustProxyHeaders` conditional was duplicated
  across all eight middlewares; it is now a single internal
  `resolveForwardedTrust(name, opts)` in `src/conn-info.ts` that validates the
  options and returns the resolved hop count (or `undefined` when trust is
  off). This is the same de-duplication argument as the fix above: the original
  vulnerability existed in nine independent copies of one bad read, which meant
  nine chances to get it wrong. The internal `assertTrustedHops()` helper it
  replaces has been removed from the public export surface — it was marked
  `@internal`, has no caller-facing use, and was never published.

### Added

- **MCP `2026-07-28` (the stateless revision) on the same endpoint as every
  earlier revision.** `createMcpHandler()` is now dual-era: a request whose
  `_meta` protocol version (or `MCP-Protocol-Version` header) is `2026-07-28`
  or later is served statelessly, and everything else keeps the `initialize`
  handshake path unchanged. No configuration; existing clients are unaffected.
  - `MCP_PROTOCOL_VERSION` is now `"2026-07-28"` and
    `MCP_PROTOCOL_VERSIONS` gained it.
  - **`server/discover`** (required of every modern server) answers with
    `supportedVersions`, `capabilities`, `instructions`, and the server
    identity, built from the options you already pass.
  - **Per-request metadata.** `io.modelcontextprotocol/protocolVersion` and
    `io.modelcontextprotocol/clientCapabilities` are required on every modern
    request (`-32602` + HTTP 400 when missing); `clientInfo` and `logLevel` are
    surfaced on `McpRequestContext` alongside a new `era` discriminator.
  - **Result envelope.** Modern results carry `resultType`, the server identity
    in `_meta`, and — on `server/discover`, the four list methods, and
    `resources/read` — `ttlMs` / `cacheScope` from the new `cache` option.
  - **Multi round-trip requests (MRTR).** Tool, resource, and prompt handlers
    may return `{ resultType: "input_required", inputRequests, requestState }`
    instead of a final result; the client answers on a retry via
    `ctx.inputResponses` / `ctx.requestState`. This replaces server-initiated
    `elicitation/create`, `sampling/createMessage`, and `roots/list`.
  - `capabilities.extensions` via the new `extensions` option (core implements
    no extension itself).
  - New exports: `MCP_MODERN_ERA_MIN_VERSION`, `MCP_META_KEYS`,
    `MCP_ERROR_CODES`, `MCP_MAX_REQUEST_STATE_LENGTH`,
    `isModernProtocolVersion()`, and the `McpCacheHints`, `McpImplementation`,
    `McpInputRequest`, `McpInputRequests`, `McpInputResponses`,
    `McpInputRequiredResult`, `McpProtocolEra` types.
  - Docs: rewritten [`/docs/mcp`](https://daloyjs.dev/docs/mcp) with protocol
    eras, discovery, required headers, caching hints, MRTR, mirrored
    parameters, and state-without-sessions; refreshed API reference.
  - Coverage: `tests/mcp-2026-07-28.test.ts` (24 tests) plus the existing MCP
    suite.

### Security

- **Standard-header validation on MCP requests, in both protocol eras.** A
  missing or disagreeing `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`, or
  `Mcp-Param-{Name}` header is rejected with HTTP 400 and JSON-RPC `-32020`
  (`HeaderMismatch`). Without this a gateway can authorize, route, or
  rate-limit on a mirrored header value while the server executes a different
  body value. `Mcp-Name` and `Mcp-Param-*` values in the `=?base64?…?=`
  sentinel form are decoded before comparison, and an undecodable payload is
  treated as a mismatch.
  - The agreement check deliberately goes **beyond** the specification, which
    scopes these headers to `2026-07-28`. Enforcing them only there would make
    the guarantee one downgrade away from useless: a client could declare
    `2025-11-25`, keep the gateway-satisfying header, and send a body that
    called a different method, a different tool, or a different region. Legacy
    requests are therefore not _required_ to carry the headers (they predate
    them) but are held to any they do carry. A genuine legacy client, which
    sends none, is unaffected.
  - Deployments that no longer need the older revisions can refuse them
    outright with `protocolVersions: ["2026-07-28"]`, so nothing reaches a tool
    without the full modern contract.
  - Regression coverage: `tests/mcp-2026-07-28.test.ts` — method-confusion,
    tool-confusion, and mirrored-parameter-confusion via downgrade, plus the
    unaffected genuine-legacy control.
- **`x-mcp-header` annotations are validated at construction.** Empty,
  non-token, case-insensitively duplicated, or non-primitive annotations throw
  from `createMcpHandler()`, so a server cannot advertise a mirroring contract
  it will not enforce.
- **Secure-by-default caching hints.** `cache` defaults to
  `{ ttlMs: 0, scope: "private" }`. MCP explicitly allows a tool list to vary
  with the credential on the request, so a `"public"` scope would let a shared
  proxy serve one caller's tools to another; widening it is opt-in.
- **MRTR guardrails.** DaloyJS refuses to emit an `inputRequests` entry whose
  method the client did not declare support for, answering `-32021`
  (`MissingRequiredClientCapability`) instead; an `input_required` result is
  rejected outside `tools/call` / `resources/read` / `prompts/get` and outside
  the modern era; and a client-supplied `requestState` is bounded at
  `MCP_MAX_REQUEST_STATE_LENGTH` (8 KiB). `requestState` round-trips through
  an untrusted client, and the docs state plainly that it must be
  integrity-protected, principal-bound, and short-lived.
- **No sessions, no resumability.** `Mcp-Session-Id` and `Last-Event-ID` from
  older clients are ignored and never echoed; `GET` and `DELETE` on the MCP
  endpoint answer `405`.

### Changed

- An unsupported `MCP-Protocol-Version` now returns JSON-RPC `-32022`
  (`UnsupportedProtocolVersion`) with `data.supported` / `data.requested`
  instead of `-32600`, so a client can retry on a mutually supported revision
  rather than guess. The HTTP status stays `400`.
- Modern requests for a method this server does not implement — including
  `initialize` and `ping`, which `2026-07-28` removed — answer HTTP `404` with
  `-32601`, the status the specification reserves so a client can distinguish
  a modern server from a legacy endpoint. Legacy requests are unchanged
  (HTTP `200`).

## [1.0.0-rc.6] - 2026-07-26

### Security

- **`responseCache()` cross-principal disclosure (CWE-524) closed on three more
  dimensions — F-4, F-5, F-6 in [`SECURITY-AUDIT.md`](SECURITY-AUDIT.md).** A
  live over-the-wire engagement against a realistic multi-tenant app found that
  the F-3 remediation (shipped in 0.40.0) had fixed only the `Authorization`
  dimension of the defect, while the same function still ignored three other
  inputs that vary a private response. All three were confirmed exploitable with
  no attacker sophistication — the leak fires on ordinary traffic, behind a
  perfectly normal-looking `x-cache: HIT`:
  - **The cache key omitted the request authority (F-4, HIGH).** The key was
    `method + pathname + search`, but RFC 9111 §4 keys a cache on the _effective
    request URI_, which includes the authority. Any one process serving several
    hostnames (vanity domains, subdomain-per-customer, staging beside
    production) shared a single entry across all of them. **Plain defaults — no
    opt-in and no misconfiguration required.**
  - **The resolved tenant was ignored (F-5, HIGH).** `tenancy()` resolved the
    tenant into `ctx.state`, then the cache keyed every tenant's response
    identically. A second tenant — and a caller supplying _no tenant at all_ —
    received the first tenant's confidential body.
  - **Cookie identity was treated as anonymous (F-6, MEDIUM-HIGH).** The request
    `Cookie` header was never consulted (only response `Set-Cookie` was), so a
    cookie-authenticated private response was stored and replayed to an
    anonymous stranger.

- **`responseCache()` now honours the response's own `Vary` header — F-7 in
  [`SECURITY-AUDIT.md`](SECURITY-AUDIT.md) (MEDIUM-HIGH).** A follow-up live
  engagement found the cache read only its own `varyHeaders` option and
  discarded the `Vary` the response declared for itself — even though two
  middlewares in the framework's own recommended stack emit one: `cors()` writes
  `Vary: Origin` beside the reflected `Access-Control-Allow-Origin`, and
  `compression()` writes `Vary: Accept-Encoding` beside `Content-Encoding`. The
  whole response, those headers included, was stored under a key covering
  neither field. **Plain defaults, on the composition the docs recommend.**
  Confirmed over the wire: a caller from one allowed origin seeded the entry and
  every later caller — including one sending no `Origin` — received _that_
  origin's `Access-Control-Allow-Origin` with `x-cache: HIT`, so their browser
  rejected a response they were entitled to; a client that negotiated no
  compression received a gzip body (`1f8b` magic bytes); and a handler that
  correctly declared `Vary: Accept-Language` served German to an English client.
  `Vary` is now a secondary key: an entry is replayed only to a request whose
  values for the declared fields match, values are length-prefixed so a crafted
  header cannot collide with another variant, and `Vary: *` is never stored.
  Variants live under their own store keys, so several stay warm at once rather
  than each evicting the last — a single slot would have handed an attacker a
  cache-defeat DoS by rotating `Origin`. Measured at parity on
  `bench/response-cache.bench.ts`.
- **Cached entries no longer freeze per-request or hop-by-hop headers — F-8
  (LOW-MEDIUM).** With `requestId()` mounted, every caller served from the cache
  received the `x-request-id` of the one request that populated it: broken
  incident correlation, and a cache-state oracle for whoever seeded it.
  Hop-by-hop headers were storable too, so a handler-written
  `Transfer-Encoding` would be replayed onto a fixed-length cached body. `Age`,
  the RFC 9110 §7.6.1 hop-by-hop set, and `X-Request-Id` are now stripped before
  storage. The origin `Date` is deliberately kept — RFC 9111 §4.2.3 computes age
  from it.
- **`MemoryResponseCacheStore` is now bounded — F-9 (MEDIUM).** Its TSDoc
  claimed the map "cannot grow without bound", but `set()` pruned only _expired_
  entries, and nothing is expired inside the TTL. An unauthenticated attacker
  rotating a query string minted a fresh entry per request, each holding up to
  `maxBodyBytes` (default 1 MiB); 20,000 unexpired entries were retained against
  a documented 10,000 cap. Both an entry-count and a byte ceiling are now
  enforced with FIFO eviction (expired first).
- **The unconfigured-`trustProxy` refusal no longer logs a stack trace per
  request.** The guard's behaviour is unchanged — a production app with
  `trustProxy` / `behindProxy` unset still returns `500 problem+json` to a
  request carrying `X-Forwarded-*` / `X-Real-IP` / a vendor client-IP header, and
  still logs one error line per refused request so an operator can see it is
  ongoing. But every one of those threw from the same framework line, so the
  logged stack was byte-identical each time, named framework internals rather
  than anything actionable, and let a client multiply the bytes it pushes into
  the error tier (the expensive, alerting one) just by replaying one header.
  Measured 3,718 → 1,416 bytes of error log for five refused requests. Genuine
  faults in application code keep their stacks; only errors the framework marks
  as "same line every time" are trimmed.
- **New boot guard (production, `secureDefaults` on): `responseCache()` mounted
  ahead of `tenancy()` refuses to boot.** The cache builds its key in
  `beforeHandle`, so in that order the tenant does not exist yet and automatic
  partitioning cannot protect the entry. Register `tenancy()` first. Joins the
  existing guards for `session()`-without-`csrf()` and `auth:`-without-an-auth-hook.
- **`waf()` SQLi signature evasions closed (found in the same live
  engagement).** Two payload shapes walked past the SQLi ruleset. A
  parenthesized subquery behind a boolean operator (`1 OR (SELECT 1)`) matched
  nothing, because every tautology signature anchored on a `= <digit>`
  comparison the payload never contained; a new high-confidence signature
  covers `OR`/`AND` immediately followed by `(SELECT`. Separately, embedded C0
  control bytes split keywords past the whitespace-anchored signatures
  (`1'%00OR%001=1`), because JavaScript `\s` does not match NUL — the inspected
  variant set now includes a control-character→space normalization. The class
  deliberately excludes `\t \n \v \f \r`, which `\s` already matches: adding
  them produced only variants that score identically to one already in the set
  and cost ~13% on every request carrying a multi-line body or query value.
- **A WebSocket frame declaring an oversized payload is rejected at the
  header, before its bytes are buffered.** `parseFrame()` enforced
  `maxPayloadLength` only once a frame had fully arrived, so a sender could
  declare a huge length and then trickle the payload, holding the assembled
  buffer open and growing in `FrameSink` the whole time. The declared length is
  now checked as soon as the frame header is complete — ahead of the mask and
  payload bytes — and fails with `WebSocketPayloadTooLargeError` (close 1009).
  Control frames are unaffected; they are already capped at 125 bytes. A
  declared length above the limit always implies the assembled message exceeds
  it, so cumulative fragment accounting stays where it was, with the caller.

### Added

- **`responseCache({ principal })`** — identify the caller so credentialed
  responses cache _per principal_ instead of bypassing the cache entirely.
  Return a stable id (user id, tenant, API-key fingerprint — never the raw
  credential), or `null` for anonymous. A `principal` that returns `null` for a
  request that _does_ carry credentials fails closed. This is what makes
  cookie-authenticated caching both possible and safe.
- **`responseCache({ excludeHeaders })`** — extra response headers to drop
  before an entry is stored, on top of the built-in `Age` / hop-by-hop /
  `X-Request-Id` set. Name a custom correlation or tracing header here so it is
  not frozen into the entry and replayed to every later caller — pair
  `requestId({ header: "x-correlation-id" })` with
  `excludeHeaders: ["x-correlation-id"]`.
- **`new MemoryResponseCacheStore({ maxEntries, maxBytes })`** — capacity limits
  for the default in-memory store, defaulting to 10,000 entries and 64 MiB of
  retained body bytes. The byte ceiling is the one that actually caps memory:
  an entry count alone permits 10,000 × 1 MiB.
- **`TENANCY_RESOLVED_MARKER` / `TENANT_UNRESOLVED` / `TENANCY_HOOK_MARKER`
  (`tenancy`) and `RESPONSE_CACHE_HOOK_MARKER` (`response-cache`)** — the
  `ctx.state` marker under which `tenancy()` records the tenant it resolved
  (independently of the configurable `stateKey`), plus the hook markers the boot
  guard reads. Exported so third-party middleware can participate in the same
  partitioning contract.

### Changed

- **The `responseCache()` key now includes the request authority.** Cache keys
  change shape, so the first deploy after upgrading sees a one-time cold cache
  (a miss storm, not a correctness problem). Nothing to migrate.
- **Requests carrying `Cookie` now bypass the shared cache by default**, exactly
  as `Authorization` already did. A route that was (unsafely) caching
  cookie-bearing traffic will stop caching it. To restore caching, add a
  `principal` — the safe fix — or, only for genuinely shareable content, opt in
  explicitly.
- **`cacheAuthenticatedRequests` widened to
  `boolean | { authorization?: boolean; cookie?: boolean }`.** `true` now opts
  in _both_ credential headers rather than just `Authorization`; pass
  `{ authorization: true }` for the narrower `Authorization`-only meaning.
  Declaring a credential header in `varyHeaders` also counts as handling it.
- **`keyGenerator` now derives the key _body_ only.** The tenant/principal
  partition is applied around whatever it returns, so a custom generator can no
  longer accidentally widen the partition — and the `tenantScope()`-based
  `responseCache` recipe previously documented for multitenancy is no longer
  needed. Existing generators keep working; the manual tenant prefix is now
  redundant but harmless.
- **`responseCache()` got faster.** Building the key from `Request.url` (already
  an absolute, normalized serialization) instead of allocating a `URL` makes the
  key builder ~9× faster with no `varyHeaders` and ~2.5× faster with two, so the
  security fix is a net hot-path win. The added per-request work is two
  `Headers.has()` probes (~60 ns) and a partition that costs nothing when
  absent. `App`'s import graph is unchanged, so serverless cold start is
  unaffected.
- **Version: `1.0.0-rc.5` → `1.0.0-rc.6`** across the lockstep packages
  (`@daloyjs/core`, `create-daloy`, JSR `@daloyjs/daloy`), the npm
  `create-daloy` templates, the website version reference, the workshop, and
  the SBOMs. The `deno-basic` template still resolves
  `jsr:@daloyjs/daloy@^1.0.0-rc.5`: its `deno.lock` carries an integrity hash
  that can only be computed once the version exists on JSR, and scaffolded Deno
  projects run `deno install --frozen=true`, so the pin is refreshed in a
  follow-up once `1.0.0-rc.6` is live on JSR. The range itself already admits
  `1.0.0-rc.6`.

## [1.0.0-rc.5] - 2026-07-20

### Changed

- **The toolchain now builds on TypeScript 7** (`typescript@7.0.2`, the
  native compiler). Full `pnpm typecheck` across all three projects and the
  `dist/` build each complete in under two seconds locally. Published
  packages are unaffected: `@daloyjs/core` ships pre-compiled `.js` and
  `.d.ts`, so projects consuming the framework on TypeScript 5.5 or 6 keep
  working unchanged.
- **Every `create-daloy` template and the workshop now scaffold with
  `typescript@^7.0.2`**, so new projects get native compiler speeds out of
  the box. (The docs site stays on TypeScript 6 until Next.js can run on the
  new compiler API planned for TypeScript 7.1.)
- **`@hey-api/openapi-ts` is pinned to `0.0.0-next-20260711024907`** — the
  first build that runs without the TypeScript compiler API, which
  TypeScript 7 no longer ships (0.99.0 crashes under TS7). Generated client
  output is byte-for-byte identical to 0.99.0's. Applies to the root,
  workshop, and the `node-basic` / `bun-basic` templates; switch to
  `^0.100.0` when the stable Hey API release is published and has cleared
  the 24h release-age cooldown.
- **Version: `1.0.0-rc.4` → `1.0.0-rc.5`** across the lockstep packages
  (`@daloyjs/core`, `create-daloy`, JSR `@daloyjs/daloy`), the `create-daloy`
  templates and their tests, the website version reference, the workshop, and
  the SBOMs.

### Fixed

- **Node adapter no longer drops all but the last `Set-Cookie` header.**
  `Headers.forEach` yields each `Set-Cookie` value separately while
  `ServerResponse.setHeader` overwrites repeated keys, so a response that set
  more than one cookie (the common `session()` + `csrf()` pairing) silently
  delivered only the last one. The adapter now collects cookies via
  `getSetCookie()` and writes them as one array, emitting every cookie as its
  own header line. Regression tests cover the multi-cookie and single-cookie
  paths.
- **A malformed `Host` header on a WebSocket upgrade no longer crashes the
  Node process.** Node's HTTP parser accepts `Host` values that WHATWG URL
  parsing rejects (e.g. containing a space); the upgrade path built a URL from
  that header outside any try/catch and discarded the promise, so one bad
  upgrade request became an unhandled rejection — fatal under the production
  crash-on-unhandledRejection posture. The upgrade path now answers `400 Bad
Request` and a call-site catch backstops any future throw.
- **Lambda adapter answers malformed events with `400` problem+json.** An
  event whose host/path cannot form a valid URL previously threw out of the
  handler, which API Gateway surfaces as an opaque `502`.
- **The typed in-process client preserves required request inputs.**
  `createInProcessClient(app)` / `createClient(app)` inputs no longer widen
  every `query` and `headers` to optional: a route whose contract requires
  `query` or `headers` now requires them on the client input too, while a
  schema that accepts an empty object keeps the field optional. Routes with no
  path parameters omit `params`, and a route with no required inputs at all can
  be called with no argument. Type-level tests pin the client surface against
  the route contracts so it cannot drift.
- **Node adapter exposes the OS-assigned ephemeral port.** `serve()` from
  `@daloyjs/core/node` now returns `handle.port` as a live getter over the
  server's bound address, so a caller that passes `port: 0` can read the real
  port after the server emits `listening` (before that it still reports the
  requested port). Previously `handle.port` always echoed the requested value,
  so `port: 0` callers had to reach into `handle.server.address()` themselves.
- **Deno adapter graceful shutdown no longer throws `BadResource`.** The
  adapter now aborts its listen signal only as a fallback for runtimes that
  lack `HttpServer.shutdown()`; Deno 2.9 closes the listener resource inside
  `shutdown()`, so aborting the same signal afterwards raised `BadResource`
  during an otherwise clean drain.

### Added

- **AWS Lambda response streaming now matches the documented adapter API.**
  `toLambdaStreamHandler(app)` wraps the managed Node.js runtime's
  `awslambda.streamifyResponse()`, preserves status, headers, and cookies via
  `HttpResponseStream.from()`, and pumps web-standard response bodies without
  buffering while respecting writable-stream backpressure. It refuses to
  construct outside the Lambda streaming runtime, and malformed events still
  receive a streamed `400` problem response.
- **Bun adapter graceful shutdown.** `serve()` from `@daloyjs/core/bun` now
  listens for `SIGTERM` / `SIGINT` by default (parity with the Node and Deno
  adapters), drains `app.shutdown()` hooks, and stops the Bun server — rolling
  deploys no longer hard-kill in-flight requests. New `handleSignals` (default
  `true`) and `shutdownTimeoutMs` (default `10000`) options mirror the Node
  adapter, and `handle.stop()` is idempotent.
- **create-daloy enforces a pnpm >= 11 floor for pnpm scaffolds.** The CLI now
  injects `engines.pnpm: ">=11.0.0"` into pnpm projects (pnpm always enforces
  the project's `engines.pnpm` at install time) and warns during scaffolding
  when the installed pnpm is older — matching the existing npm >= 12 floor for
  npm scaffolds. The floor is security-relevant: pnpm older than 11 silently
  ignores the `minimumReleaseAge` setting in the generated
  `pnpm-workspace.yaml`, quietly disabling the 24-hour release-age cooldown.
  Templates still ship without any package-manager engine floor so yarn/bun
  projects inherit nothing irrelevant.
- **Adapters now fulfil the conn-info contract.** The Node, Bun, Deno, and
  Lambda adapters attach the immediate peer address (`setConnInfo`) before
  dispatch, so `getConnInfo()`, `readRemoteAddress()`, `readRemotePort()`,
  `resolveClientIp()`, the `behindProxy` posture, and WAF client-IP audit
  attribution now return real data on those runtimes (Node: TCP socket; Bun:
  `server.requestIP()`; Deno: the serve handler's `remoteAddr`; Lambda: API
  Gateway `sourceIp`). The pure edge delegators (Cloudflare, Vercel, Fastly)
  expose no peer socket; on those platforms client addresses continue to
  arrive via platform headers governed by `behindProxy` / `trustProxyHeaders`.
- **`requestTimeoutMs` now aborts `ctx.request.signal` on timeout.** When a
  request exceeds `requestTimeoutMs`, the framework aborts the request signal
  with a `TimeoutError` `DOMException` (the same reason shape as
  `AbortSignal.timeout()`) before responding `408`, so downstream I/O a handler
  forwarded the signal to — `fetch`, a database driver — is cooperatively
  cancelled instead of running to completion after the client already gave up.
  The Node adapter wires the abort hook; on platform-managed runtimes
  (Bun / Deno / Workers) and direct `app.fetch()` callers the hook is a safe
  no-op and the timeout still resolves as a `408`. Single-threaded JS cannot
  preempt CPU-bound work, so this is cooperative teardown, not forced cancellation.
- **create-daloy preflights the Node and npm floors with clear, linked errors.**
  The scaffolder now checks Node >= 24 up front (and, for npm scaffolds,
  npm >= 12) and fails with an actionable, link-carrying message instead of a
  cryptic syntax error or npm's raw `EBADENGINE` dump mid-install. npm scaffolds
  also get `engines.npm: ">=12.0.0"` plus an `engine-strict=true` `.npmrc` so
  the floor is actually enforced at install time; the version check fails open
  when the runtime version can't be parsed.

### Security

Hardening from a focused security-audit pass across logging, sessions, HTTP
message signatures, mTLS header trust, MCP origin validation, compression
memory use, and bot detection. Most entries are internal hardenings; the ones
that adjust an observable default are called out with migration guidance
inline — review them if you depend on the prior behavior.

- **Request URLs are sanitized before they reach logs.** The per-request child
  logger now binds a redacted URL (`sanitizeUrlForLog`) instead of the raw
  `request.url`, keeping scheme / host / path but replacing the values of
  sensitive query parameters — OAuth `code` / `state`, `access_token`, API
  keys, session ids, and AWS SigV4 / GCS V4 presigned-URL signatures
  (`X-Amz-Signature`, `X-Amz-Credential`, `X-Goog-Signature`, …) — with
  `[REDACTED]`. Exported as `sanitizeUrlForLog` and `SENSITIVE_URL_QUERY_KEYS`.
  The default structured-log redaction set (`DEFAULT_REDACT_KEYS`) intentionally
  does **not** add generic names like `id`, `key`, or `state`: those are common
  non-secret field names, and redacting them at every depth would corrupt
  ordinary operational logs — query-string secrets are handled by the URL
  sanitizer instead.
- **HTTP message signatures bind the full request target by default.**
  `verifyMessage`'s default `requiredComponents` is now
  `["@method", "@target-uri"]` (was `["@method", "@path"]`), matching
  `signMessage`'s default covered set so scheme, authority, path, **and query**
  are all bound. A signature that only covers `@path` no longer satisfies a
  default verify. _Migration:_ if you intentionally sign only the path, pass
  `requiredComponents: ["@method", "@path"]` explicitly. Separately,
  `@query-param` now refuses to sign a parameter that appears more than once (a
  parameter-pollution differential) — cover `@query` or `@target-uri` for
  multi-valued queries.
- **mTLS structured identity headers require verification proof by default.**
  When `clientCertAuth()` reads a certificate from structured proxy headers and
  no verify header is configured, the certificate is now treated as
  **unverified**, so the default `requireVerified: true` rejects it (`403`).
  This closes an identity-only spoofing gap where a proxy forwards subject / SAN
  headers without proof the chain was validated. _Migration:_ if your terminator
  only forwards identity and you trust it, configure the verify header (`verify`
  - `verifySuccessValue`), or set `requireVerified: false` with a strict
    `behindProxy` posture.
- **Compression is bounded by response size.** `compression()` now leaves
  responses larger than `maxCompressibleBytes` (default `1_048_576` = 1 MiB)
  uncompressed instead of buffering an unbounded body into memory to compress
  it — trading bandwidth on very large responses for memory safety. A
  known-oversize body (via `Content-Length`) is skipped without buffering.
  _Migration:_ raise `maxCompressibleBytes` if you need to compress larger
  bodies and can afford the heap.
- **`exp` expiry is exclusive.** `assertTemporalClaims` now rejects a token when
  `now >= exp + skew` (was `now > exp + skew`), matching RFC 7519 §4.1.4
  ("current time MUST be before the expiration time"): a token is invalid at its
  exact expiration instant.
- **Session dirty-tracking covers nested mutations, with stable identity and
  lossless cloning.** Mutating a nested object or array under
  `ctx.state.session.data` (e.g. `data.profile.roles.push(...)`) now marks the
  session dirty and persists. Nested reads return a stable proxy so object
  identity holds (`data.user === data.user`); exotic values like `Date` are
  returned unwrapped so their methods keep working; and payloads are deep-cloned
  with `structuredClone` (JSON round-trip fallback) so `Date` / `Map` / `Set` /
  `BigInt` / `undefined` values survive load and store rather than being
  silently corrupted or rejected.
- **MCP Streamable HTTP rejects same-origin DNS rebinding.** A non-loopback
  browser `Origin` must appear in the configured allowlist; the endpoint no
  longer treats `Origin.host === Host` as sufficient (under DNS rebinding both
  can be the attacker hostname resolving to the target IP). Loopback origins
  stay allowed for local development. _Migration:_ public MCP endpoints serving
  real browser clients must set `allowedOrigins`.
- **Built-in observability routes only trust proxy client-IP headers under an
  explicit trusted-proxy posture.** The `/healthz`, `/readyz`, `/metrics`, and
  CSP-report rate-limit key falls back to a single shared `"global"` bucket
  unless the app sets `trustProxy: true` or `behindProxy`; spoofable `X-Real-IP`
  / `Fly-Client-IP` headers are ignored otherwise, so an attacker cannot rotate
  identities to bypass the probe rate cap.
- **`safeRedirect` fallbacks pass the same path-safety checks as primary
  targets** (no protocol-relative, backslash-confusion, or control characters),
  and `botGuard` resets stateful (`/g`, `/y`) user-agent regex `lastIndex`
  between requests so an allowlist match cannot flip-flop, and bounds its
  verification cache with write-recency eviction.
- **`fetchGuard()` refuses URLs carrying userinfo credentials.** A target like
  `http://user:pass@internal/` — a classic SSRF obfuscation that hides the real
  host after the `@` — is now rejected up front with a typed
  `SsrfBlockedError("credentials-in-url")` (new `SsrfBlockReason`) instead of
  letting undici's `Request` constructor throw a raw `TypeError` that escaped
  the SSRF-block contract and could misclassify a blocked attempt as an ordinary
  upstream failure. The credentials are stripped from the URL recorded on the
  error so a caller-supplied secret never reaches logs.
- **`safeRedirect()` refuses same-origin paths outside Latin-1.** A same-origin
  target containing any code point above `U+00FF` is rejected with a typed
  `OpenRedirectBlockedError` (`non-latin1-target` reason). Such characters
  cannot be written to the ISO-8859-1 `Location` header — `Headers.set` throws a
  raw `TypeError`, which previously escaped the helper's error contract and
  surfaced as an uncaught `500` — and they cover the Unicode slash homographs
  (`⁄` `U+2044`, `∕` `U+2215`, `／` `U+FF0F`) that `NFKC` normalization can fold
  into `/` to smuggle a protocol-relative redirect past a same-origin path check.

## [1.0.0-rc.4] - 2026-07-12

### Fixed

- **Type-level auto operation ids now match runtime inference for mixed
  `snake_case`/`kebab-case` segments.** For shorthand routes without an explicit
  `operationId`, a path segment containing `_` before `-` (e.g.
  `/legacy_admin-tools/export`) produced a typed-client key of
  `getLegacy_adminToolsExport` at the type level while the runtime operation id
  (OpenAPI spec and actual client key) was `getLegacyAdminToolsExport` — so the
  advertised method did not exist at runtime. The type-level encoding now
  recurses through both separators, and a sync-pin test asserts the type-level
  and runtime encodings against one shared literal list so any future drift
  fails `pnpm typecheck` or `pnpm test`.

### Added

- **Multi-file route contracts keep exact client types.** Export route objects
  with `defineRoute()`, compose literal tuples with `app.registerRoutes([...])`,
  and call them through `createInProcessClient(app)` without opening a socket.
  The full operation-id, request-schema, and response union surface now survives
  file and feature-module boundaries.
- **Progressive HTTP shorthands.** `get()`, `post()`, `put()`, `patch()`,
  `delete()`, and `head()` accept contract options plus a typed handler and
  derive stable operation ids from their method and path unless one is supplied
  explicitly. They deliberately do not provide a two-argument opaque overload:
  schema-less responses require `acknowledgeNoResponseBodySchema: true`.
- **Response descriptions are optional.** OpenAPI and AI contract output use a
  stable `HTTP <status> response` fallback when a response spec omits one.
- **A `preBody` lifecycle phase** runs after route matching but before body I/O
  or schema validation. It exposes raw params/query/headers, shared state and
  response helpers, while guaranteeing `ctx.body === undefined`.

### Changed

- **Built-in bearer, basic, JWK, and mTLS authentication now reject before
  request bodies are consumed.** Auth callbacks supplied to `bearerAuth()`,
  `basicAuth()`, `jwk()`, and `clientCertAuth()` run in `preBody`: they can read
  the raw request, route params, query, headers, and shared state, but
  `ctx.body` is always `undefined`, so payload-dependent authorization belongs
  in `beforeHandle`. Request IDs are established in the same early phase, and
  HTTP Message Signatures remain in `beforeHandle` where validated payloads are
  available.
- **`some()` / `except()` now gate `preBody` hooks** as well as `beforeHandle`
  hooks, so early-auth stacks can reject before validation or body I/O.
- **Built-in docs generation is runtime-portable.** OpenAPI/AsyncAPI metadata
  now comes from explicit options or portable defaults, with no host
  `package.json`/`deno.json`/`deno.jsonc` filesystem probing — set `openapi.info`
  (or top-level `title`/`version`) for branded metadata. The default Scalar,
  Swagger UI, Redoc, and AsyncAPI assets are version-pinned to reviewed releases
  with matching SHA-384 SRI hashes instead of floating to the latest upstream.
- **Raw web-standard `Response` values need explicit acknowledgement.** Handlers
  and `afterHandle` transforms that return a raw `Response` must set
  `acknowledgeNoResponseBodySchema: true` on the route; unacknowledged raw
  responses fail closed with `500` instead of silently bypassing response-body
  validation and field stripping. Successful (`2xx`/`3xx`) raw responses
  returned by `preBody` or `beforeHandle` hooks require the same acknowledgement,
  while security denials and errors (`4xx`/`5xx`) remain available without one so
  auth middleware can still reject safely by default.

### Security

- Unauthenticated uploads covered by built-in header/certificate auth are
  rejected before DaloyJS reads or parses their body, reducing avoidable CPU,
  memory, and bandwidth work at the application boundary.
- A `rateLimit()` or `loginThrottle()` layer registered before early auth still
  counts rejected credentials and can return `429` after the cap, without
  forcing request-body validation. This preserves brute-force lockout semantics
  across the new lifecycle phase.

## [1.0.0-rc.3] - 2026-07-09

### Fixed

- **Plugin decorations are now correctly encapsulated.** `app.decorate()` called
  inside a plugin/group is scoped to that plugin's routes as the docs promise:
  it no longer leaks sideways to sibling plugins or up to the root, and a
  plugin's own routes reliably see it (previously a decoration set inside a
  plugin was either invisible or, when the root also had a decoration, visible
  app-wide). Each route now snapshots the decorations of its registration scope,
  matching how group/route hooks are already scoped. Decorate before registering
  the routes that read the value (the same ordering Fastify requires).

### Changed

- **`toEdgeHandler` is removed from `@daloyjs/core/vercel`.** It was a plain
  alias of `toWebHandler`; use `toWebHandler` directly (with
  `export const runtime = "edge"`) for the Edge runtime, which Vercel now
  positions behind the recommended Node.js runtime (Fluid Compute).
- **Version: `1.0.0-rc.2` → `1.0.0-rc.3`** across the lockstep packages
  (`@daloyjs/core`, `create-daloy`, JSR `@daloyjs/daloy`), the `create-daloy`
  templates, the website version reference, the Deno adapter docs, the workshop,
  and the SBOMs.

## [1.0.0-rc.2] - 2026-07-07

### Changed

- **`daloy dev` on Node now spawns `node --watch <entry>`** instead of
  `node --import tsx --watch <entry>` — Node.js (>= 22.18, stable in 24+) runs
  erasable-only TypeScript entries natively via built-in type stripping, so no
  loader is required. Projects that rely on non-erasable syntax (enums, runtime
  namespaces, parameter properties) or extensionless relative imports can keep
  running a loader directly (`node --import tsx --watch <entry>`).
- **The `daloy` CLI shim loads TypeScript entries natively first** for
  `inspect` / `doctor` / `contract`, falling back to registering `tsx` (when
  installed in the consumer project) only if the native load fails.
- **`create-daloy` templates no longer depend on `tsx`** — the `node-basic`,
  `vercel`, and `cloudflare-worker` templates run tests (`node --test`), the
  OpenAPI dump script, and the Vercel dev server (`node --watch src/dev.ts`)
  through Node's native type stripping. Template `tsconfig.json`s adopt the
  Node-recommended `erasableSyntaxOnly` + `verbatimModuleSyntax` flags, and the
  `vercel` / `cloudflare-worker` templates now declare the same Node `engines`
  range as `node-basic`.
- **Template devDependencies refreshed** to match the versions the repo itself
  builds with: `@hey-api/openapi-ts` `^0.97.1` → `^0.99.0` (node-basic,
  bun-basic) and `@types/node` `^25.7.0` → `^26.1.0` (node-basic, vercel).

## [1.0.0-rc.1] - 2026-07-04

A security-hardening release from an internal audit against a 17-category threat
model. It tightens several secure-by-default guarantees and, because the
framework has no external users yet, makes those changes now rather
than deferring them past the stable release.

### Security

- **MCP `tools/call` arguments are now validated server-side** against the
  tool's `inputSchema` before the handler runs, via a new dependency-free
  JSON-Schema subset validator (`type` incl. `integer`, `required`,
  `properties`, `additionalProperties`, `enum`, `const`, and string/number/array
  bounds). A violation is rejected with JSON-RPC `-32602` and the handler never
  sees a non-conforming payload. `pattern` is intentionally not enforced
  (ReDoS-sink avoidance) — validate those constraints in your handler.
- **MCP JSON-RPC request bodies are parsed with `safeJsonParse`**, stripping
  `__proto__` / `constructor` / `prototype` keys before tool arguments reach a
  handler (parity with the REST body parsers).
- **HTTP Message Signatures enforce a 2048-bit RSA modulus floor** for
  `rsa-pss-sha512` / `rsa-v1_5-sha256`, matching the JWT verifier
  (NIST SP 800-131A).
- **`urlFeed()` (ip-reputation) is SSRF-hardened by default** — its outbound
  feed fetch now runs through `fetchGuard()` (per-hop redirect re-validation,
  cloud-metadata / internal targets refused). Override via `fetchImpl`.
- **The unconfigured-`trustProxy` production boot guard also refuses vendor
  client-IP headers** (`cf-connecting-ip`, `fly-client-ip`, `true-client-ip`)
  alongside `X-Forwarded-*` / `X-Real-IP`.

### Added

- **`markAuthHook(hooks)` + `AUTH_HOOK_MARKER`** to mark a custom (or
  upstream-gateway-enforced) authentication hook so it satisfies the new
  route-auth boot guard. The built-in auth middlewares (`bearerAuth`,
  `basicAuth`, `jwk`, `httpSignatureAuth`, `clientCertAuth`) carry the marker
  automatically.
- **`validateMcpInput(schema, value)`** — the reusable MCP input validator.
- **`mcpRoutes(path, handler, { public: true })`** (`McpRoutesOptions`) to opt a
  deliberately public MCP endpoint out of the new MCP auth boot guard.

### Changed

- **Production `secureDefaults` apps refuse to boot on shadow auth.** A
  route that declares an `auth:` requirement but installs no authentication hook
  to enforce it is now a boot error (previously `auth:` was OpenAPI-only
  documentation). Wire an auth middleware, mark a custom hook with
  `markAuthHook()`, or drop the `auth:` declaration.
- **Production `secureDefaults` apps refuse to boot on an
  unauthenticated `mcpRoutes()` endpoint.** Cover the route with auth or pass
  `{ public: true }`.
- **MCP `tools/call` rejects schema-violating arguments** with
  `-32602` before the handler runs (previously `inputSchema` was advertised to
  clients but never enforced). Handlers that relied on receiving unvalidated
  arguments must adjust.
- **Version: `1.0.0-rc.0` → `1.0.0-rc.1`** across the lockstep packages
  (`@daloyjs/core`, `create-daloy`, JSR `@daloyjs/daloy`), the `create-daloy`
  templates, the website version reference, the Deno adapter docs, and the SBOMs.

## [1.0.0-rc.0] - 2026-07-03

The **first `1.0.0` release candidate**. The public API is frozen: from here to
the stable release, only bug fixes and documentation land, no new surface. `@daloyjs/core`,
`create-daloy`, and the JSR package `@daloyjs/daloy` move to `1.0.0-rc.0` in
lockstep, and every `create-daloy` template now pins `@daloyjs/core@^1.0.0-rc.0`.
Projects on `^1.0.0-beta.7` upgrade with a version bump.

### Changed

- **Version: `1.0.0-beta.7` → `1.0.0-rc.0`** across the lockstep packages
  (`@daloyjs/core`, `create-daloy`, and JSR `@daloyjs/daloy`), with the
  `create-daloy` templates, workshop, README status line, website version
  reference, Deno adapter docs, and SBOMs synced to `1.0.0-rc.0`.
- **Scaffolder templates aligned with their own security + contract guidance.**
  The `node-basic`, `bun-basic`, `deno-basic`, `cloudflare-worker`, and `vercel`
  templates and their bundled `daloyjs-best-practices` skill were brought into
  agreement so a freshly scaffolded app follows the secure-by-default and
  contract-first patterns the docs describe out of the box.

### Performance

- **Faster Node hot path: lazy Request/Response shims + sync-first validation**
  (+21% on the full-contract benchmark, +53% on the bare echo path). No public
  API or behavior change; existing security checks (body limits, timeouts,
  validation, response-field stripping) are unchanged and still covered.

### Fixed

- **Docs site hydration stabilized** and the docs UX pass finished (navigation
  table of contents, pager, breadcrumb, and search components). Website only;
  not part of the `@daloyjs/core` / `create-daloy` package release.

## [1.0.0-beta.7] - 2026-07-02

### Added

- **MCP spec catch-up (2025-06-18 / 2025-11-25 server features).**
  `createMcpHandler()` now supports RFC 6570 resource templates
  (`resourceTemplates` + `resources/templates/list`, with `{name}` variable
  extraction on `resources/read`), tool `outputSchema` and `annotations`
  (read-only / destructive / idempotent / open-world hints), icons on the
  server, tools, resources, templates, and prompts, and `description` /
  `websiteUrl` on `serverInfo`. Tool results that return only
  `structuredContent` get a serialized text block backfilled for older
  clients; unknown pagination cursors are rejected with invalid-params on all
  list methods; `prompts/get` enforces `required` prompt arguments; and
  headerless non-`initialize` requests assume protocol `2025-03-26` per the
  Streamable HTTP backwards-compatibility rule.
- **`acknowledgeNoResponseBodySchema` route flag.** The documented escape
  hatch for the `security.response.bodySchemaMissing` boot warning and the
  `audit.response.bodySchema` doctor finding: set it on routes that
  intentionally return an opaque or framework-controlled body (a raw
  `Response`, HTML, a proxied payload). The warning message now names the
  flag and links to the OWASP API3 docs.

### Changed

- **Framework-mounted routes no longer trip the framework's own
  `bodySchemaMissing` warning.** The `docs: true` routes (`/openapi.json`,
  `/openapi.yaml`, `/docs`), the AsyncAPI surface (`/asyncapi.json`,
  `/asyncapi.yaml`, `/asyncapi`), and the health / metrics probes serialize
  framework-controlled bodies, so they now acknowledge themselves — the
  diagnostic only ever names routes the application authored. `mcpRoutes()`
  additionally exposes the JSON-RPC 2.0 envelope as a real JSON Schema in the
  generated OpenAPI document instead of an empty placeholder.

### Fixed

- **Multipart uploads from real-world clients no longer fail with `500`.** The
  request body parser lower-cased the whole `Content-Type` header for its
  case-insensitive media-type check and then reused that string — including the
  `boundary=` parameter — when reconstructing the request for `formData()`.
  Multipart boundaries are case-sensitive (RFC 2046 §5.1.1), so any upload whose
  boundary contained uppercase letters — every Chromium/WebKit browser
  (`----WebKitFormBoundary…`) and curl (`------------------------…`) — failed to
  parse and returned `500 Internal Server Error`. Native `fetch`/undici (which
  emits an all-lowercase boundary) worked, masking the bug. The parser now
  preserves the original-case `Content-Type` when reparsing, and a body the
  platform parser cannot read is surfaced as an RFC 9457 `400 Bad Request`
  instead of a generic `500`.
- **`discriminatedUnion()` no longer 500s on an inherited-property discriminator
  value.** The variant lookup used a bare `variants[discriminatorValue]`, so a
  request whose discriminator named an inherited `Object.prototype` member
  (`constructor`, `toString`, `valueOf`, `hasOwnProperty`, `__proto__`,
  `isPrototypeOf`) resolved to that member, slipped past the "unknown value"
  guard, and then threw an uncaught `TypeError` on `variant["~standard"]` —
  surfacing as an unauthenticated `500` (and error-log flood) on any route with
  a `discriminatedUnion` body schema. The lookup now requires an **own**
  property (`Object.hasOwn`), so these values return the intended clean
  `400`/validation issue.

### Security

- **MCP Streamable HTTP endpoints now validate `Origin` (DNS-rebinding
  defense).** The spec requires it; `createMcpHandler()` previously accepted
  any origin. Requests without an `Origin` header (non-browser MCP clients),
  same-origin requests, and loopback origins (`localhost`, `*.localhost`,
  `127.0.0.1`, `[::1]`) are allowed; every other browser origin is rejected
  with `403` unless listed in the new `allowedOrigins` option.
- **`waf()` query inspection now matches the application's own query parser.**
  The WAF decoded the query string with `decodeURIComponent`, which does **not**
  turn `+` into a space, while the framework parses the query with
  `URLSearchParams`, which does. An attacker could therefore replace spaces with
  `+` (`1+OR+1=1`) to slip a signature past the WAF while the handler still
  received the space-separated payload (`1 OR 1=1`) — a parser differential. The
  WAF now also scans each `URLSearchParams`-decoded key/value, closing the gap.
  (Decoding remains deliberately single-pass; recursive decoding is intentionally
  avoided to prevent false positives, and a double-encoded payload stays inert
  all the way to the handler.)
- **`waf()` inline-event-handler XSS signature broadened.** The handler
  allowlist covered only `onerror|onload|onclick|onmouseover|onfocus|onsubmit|ontoggle|onanimationstart`,
  letting paren-less evasions using other handlers (`onpointerover`, `onfocusin`,
  `onwheel`, `onauxclick`, `oncontextmenu`, `onbeforetoggle`, touch/drag/clipboard
  events, …) through. The signature now covers the commonly-abused handler set
  via an explicit alternation (still not `on\w+`, to avoid false-positives on
  benign params such as `online=`/`once=`), verified linear-time (no ReDoS).

## [1.0.0-beta.6] - 2026-07-01

The seventh **1.0.0 beta**. Adds a dependency-free **Model Context Protocol
(MCP)** Streamable HTTP server helper to `@daloyjs/core` and advances the
lockstep version train. Projects on `^1.0.0-beta.5` upgrade with a version
bump. `@daloyjs/core`, `create-daloy`, and the JSR package `@daloyjs/daloy`
move to `1.0.0-beta.6` in lockstep, and every `create-daloy` template now pins
`@daloyjs/core@^1.0.0-beta.6`.

### Added

- **MCP Streamable HTTP helpers** at `@daloyjs/core/mcp` (and the main barrel):
  `createMcpHandler()` exposes tools, resources, and prompts over JSON-RPC 2.0,
  and `mcpRoutes("/mcp", handler)` mounts the `POST` / `GET` / `OPTIONS` Daloy
  routes for a dedicated MCP service. `McpToolError` marks caller-correctable
  tool failures. The helper adds no runtime dependencies, ships protocol-level
  guards (256 KiB body cap, UTF-8/JSON validation, batch rejection,
  protocol-version allowlist, `application/json` enforcement, and prod-mode
  error redaction), and composes with existing middleware (`bearerAuth`,
  `rateLimit`, `secureHeaders`) for auth and rate limits.

### Changed

- **Version: `1.0.0-beta.5` → `1.0.0-beta.6`** across the lockstep packages
  (`@daloyjs/core`, `create-daloy`, and JSR `@daloyjs/daloy`), with the
  `create-daloy` templates, workshop, README status line, website version
  reference, Deno adapter docs, and SBOMs synced to `1.0.0-beta.6`.

## [1.0.0-beta.5] - 2026-07-01

The sixth **1.0.0 beta**. A lockstep maintenance release that advances the
version train and keeps every package, template, and doc reference in sync.
Projects on `^1.0.0-beta.4` upgrade with a version bump. `@daloyjs/core`,
`create-daloy`, and the JSR package `@daloyjs/daloy` move to `1.0.0-beta.5` in
lockstep, and every `create-daloy` template now pins
`@daloyjs/core@^1.0.0-beta.5`.

### Changed

- **Version: `1.0.0-beta.4` → `1.0.0-beta.5`** across the lockstep packages
  (`@daloyjs/core`, `create-daloy`, and JSR `@daloyjs/daloy`), with the
  `create-daloy` templates, workshop, README status line, website version
  reference, Deno adapter docs, and SBOMs synced to `1.0.0-beta.5`.

## [1.0.0-beta.4] - 2026-06-26

The fifth **1.0.0 beta**. Keeps the 1.0 line in beta while adding a handler
escape hatch, a routing-safety guard, and a broad documentation accuracy pass.
Projects on `^1.0.0-beta.3` upgrade with a version bump. `@daloyjs/core`,
`create-daloy`, and the JSR package `@daloyjs/daloy` move to `1.0.0-beta.4` in
lockstep, and every `create-daloy` template now pins
`@daloyjs/core@^1.0.0-beta.4`.

### Added

- **Raw `Response` return from handlers.** A route handler (or an `afterHandle`
  transform) may now return a web-standard `Response` directly, an escape hatch
  for streaming, proxying, or pre-built bodies (for example a Vercel AI SDK
  `result.toUIMessageStreamResponse()` or a forwarded upstream `fetch()`). A
  returned `Response` bypasses response-schema validation by design (no schema
  can describe an opaque stream), but is finalized through the exact same
  pipeline as every other response, so no security control is skipped: `ctx.set`
  headers (`secureHeaders` / CORS) are copied on, `x-request-id` is added when
  absent, `onSend` / `onResponse` hooks run, server-fingerprint headers are
  stripped, and a `HEAD` request still yields an empty body. Prefer the
  structured `{ status, body }` result whenever a schema can describe the payload.
- **AI SDK, auth, and database guides.** New website docs for the Vercel AI SDK
  integration, Better Auth, LoginRadius, DuckDB, and Replit deployment, plus a
  streaming docs refresh.

### Fixed

- **Routing-safety guard: array or keyless `hooks` no longer silently no-op.**
  `app.route({ hooks })` now throws when `hooks` is an array, or an object that
  carries none of the recognized hook keys (`onRequest`, `beforeHandle`,
  `afterHandle`, `onError`, `onSend`, `onResponse`). Previously such a value was
  read as `undefined` and applied nothing, so a route that looked guarded
  (`hooks: [ipRestriction(...), bearerAuth(...)]`) could ship wide open. Compose
  multiple bundles with `every(...)` (all must pass) or `some(...)` (any may
  pass). An empty `{}` stays an explicit, allowed no-op.
- **Documentation accuracy pass.** Verified and corrected concrete examples
  across the docs against the published framework: the errors page now lists
  `ConflictError` (409) and `RequestHeaderFieldsTooLargeError` (431); the
  response-cache `X-Cache` marker claim is scoped to requests the cache actually
  handles; and the API reference plus the security, auth, geo-block,
  webhook-delivery, and database guides were corrected to match the real route,
  hook, and middleware APIs.

### Changed

- **Version: `1.0.0-beta.3` → `1.0.0-beta.4`** across the lockstep packages
  (`@daloyjs/core`, `create-daloy`, and JSR `@daloyjs/daloy`), with the
  `create-daloy` templates, workshop, README status line, website version
  reference, Deno adapter docs, and SBOMs synced to `1.0.0-beta.4`.

## [1.0.0-beta.3] - 2026-06-24

The fourth **1.0.0 beta**. This keeps the 1.0 line in beta, not release
candidate, while shipping hardening and docs polish gathered after
`1.0.0-beta.2`. Projects on `^1.0.0-beta.2` upgrade with a version bump.
`@daloyjs/core`, `create-daloy`, and the JSR package `@daloyjs/daloy` move to
`1.0.0-beta.3` in lockstep, and every `create-daloy` template now pins
`@daloyjs/core@^1.0.0-beta.3`.

### Added

- **End-of-life runtime scanning for generated apps.** The `create-daloy`
  `--with-ci` templates now include runtime EOL checks for Node, Bun, and Deno,
  with matching SECURITY.md guidance and template coverage. Generated projects
  can catch unsupported runtime majors before they become a deployment risk.
- **Stripe payment integration docs.** The website now includes a Stripe guide
  and navigation/sitemap entries alongside the existing payment docs.

### Fixed

- **Safe redirects reject encoded backslashes and protocol-relative paths.**
  The redirect helper now blocks more bypass forms that can otherwise collapse
  into attacker-controlled absolute URLs in downstream clients or proxies.
- **Node adapter request-target normalization.** Malformed request targets are
  normalized before URL construction so invalid paths no longer surface as
  unexpected 500 responses.

### Changed

- **Version: `1.0.0-beta.2` → `1.0.0-beta.3`** across the lockstep packages
  (`@daloyjs/core`, `create-daloy`, and JSR `@daloyjs/daloy`), with the
  `create-daloy` templates, workshop, README status line, website version
  reference, Deno adapter docs, and SBOMs synced to `1.0.0-beta.3`.
- **Template pre-push hooks and docs were refreshed** to match the current
  verification workflow and reduce stale generated-project guidance before the stable release.
- **Framework docs received broad polish** across routing, validation, CLI,
  AsyncAPI, plugins, testing, pagination, config, and migration pages.

## [1.0.0-beta.2] - 2026-06-22

The third **1.0.0 beta**. The public API remains feature-complete and stable for
the 1.0 line, but the release train stays open for final polish before the stable release.
Projects on `^1.0.0-beta.1` upgrade with a version bump. `@daloyjs/core`,
`create-daloy`, and the JSR package `@daloyjs/daloy` move to `1.0.0-beta.2` in
lockstep, and every `create-daloy` template now pins
`@daloyjs/core@^1.0.0-beta.2`.

### Added

- **Continuous fuzzing via ClusterFuzzLite.** The untrusted-input parsers in
  `@daloyjs/core` are now continuously fuzzed with Jazzer.js, wired through
  [ClusterFuzzLite](https://google.github.io/clusterfuzzlite/): a per-PR
  `code-change` run on `src/` changes plus a daily batch run that persists a
  growing corpus. Six targets in [`.clusterfuzzlite/`](.clusterfuzzlite/) cover
  `safeJsonParse` (prototype-pollution gate), the cookie/header sanitizers,
  `decodeCursor`, `parseCron`, and `parseIp`. Each target asserts the function's
  documented contract — a declared rejection (e.g. `BadRequestError` on
  malformed input) is correct behavior, so only an undocumented throw or a hang
  is a finding. This is also what earns the OpenSSF Scorecard **Fuzzing** check.
  The OSS-Fuzz base image is digest-pinned and all workflow actions are
  SHA-pinned.

### Removed

- **The deprecated `--template vercel-edge` scaffolder alias.** The template was
  renamed `vercel-edge` → `vercel` back in `0.38.2`; the leftover back-compat
  alias (and its test) are now gone. Scaffold with `--template vercel`. This is a
  `create-daloy` CLI change only — the framework's `@daloyjs/core/vercel` adapter
  surface is unchanged.

### Changed

- **Version: `1.0.0-beta.1` → `1.0.0-beta.2`** across the lockstep
  packages (`@daloyjs/core`, `create-daloy`, and JSR `@daloyjs/daloy`), with the
  `create-daloy` templates, workshop, README status line, and website version
  reference synced to `1.0.0-beta.2`.
- **Swagger UI option types are exported from the package barrel.**
  `SwaggerUiConfiguration` and `SwaggerUiHtmlOptions` were already documented
  and implemented in `@daloyjs/core/docs`; they now flow through the root
  `@daloyjs/core` type export list as well.
- **OpenSSF Scorecard now uses an optional `SCORECARD_TOKEN`** (a read-only admin
  PAT) for fuller Branch-Protection evaluation, falling back to `GITHUB_TOKEN`
  when the secret is absent — safe to run before the secret exists.

### Notes

- Source files carry an internal formatting normalization (no behavior change)
  and a TSDoc wording fix (“Vercel Edge Functions” → “Vercel Functions”).

## [1.0.0-beta.1] - 2026-06-21

The second **1.0.0 beta** — a small, security-leaning patch on top of
`1.0.0-beta.0`. No public API changes or additions; projects on
`^1.0.0-beta.0` upgrade with a version bump. `@daloyjs/core`, `create-daloy`,
and the JSR package `@daloyjs/daloy` move to `1.0.0-beta.1` in lockstep, and
every `create-daloy` template now pins `@daloyjs/core@^1.0.0-beta.1`.

### Added

- **Indeterminate-environment security warning.** When a production-only
  refuse-to-boot guard (a wildcard `cors({ origin: "*" })`, a weak `session()`
  secret) is bypassed _only_ because the runtime environment is indeterminate
  (no `env` option and no `NODE_ENV`, the default on edge runtimes such as
  Cloudflare Workers / Deno Deploy / Vercel), the framework now logs a
  single once-per-process warning pointing at `app({ env: "production" })`.
  Enforcement is unchanged and the runtime is deliberately not sniffed (which
  would break portability); the warning only surfaces a previously silent skip,
  and only when a risky config is actually present.

### Fixed

- **Node adapter: Fetch-forbidden methods (`TRACE` / `CONNECT` / `TRACK`) are
  refused with `501 Not Implemented`** instead of surfacing a generic `500`.
  The WHATWG `Request` constructor throws on these methods, so the adapter now
  refuses them cleanly before constructing a `Request` (which also closes
  Cross-Site Tracing). Other unsupported verbs continue to return `405`.
- **`multipart/form-data` bodies are capped at `bodyLimitBytes` even without a
  `Content-Length`.** Chunked or mislabeled multipart uploads were handed to the
  platform `formData()` parser uncapped on runtimes without a socket-layer limit
  (Workers / Deno / Vercel); the actual bytes are now bounded before
  parsing. Web-standard only (`Request` + `formData`), so it stays
  runtime-portable.

### Changed

- **Version: `1.0.0-beta.0` → `1.0.0-beta.1`** across the lockstep packages
  (`@daloyjs/core`, `create-daloy`, and JSR `@daloyjs/daloy`), with the
  `create-daloy` templates, workshop, README status line, and website version
  reference synced to `1.0.0-beta.1`.

## [1.0.0-beta.0] - 2026-06-21

The first public **1.0.0 beta**. After the `0.x` preview line, the public API is
now feature-complete and considered stable for the 1.0 release. This is the build
we want people to test in anger and report back on before the `1.0.0` stable release. There
are no functional code changes from `0.44.0`: every guardrail, adapter, and
helper that shipped across `0.x` is here, unchanged. What changed is the promise.
From 1.0 onward, the API follows SemVer (compatible within a `1.x`
minor).

### Changed

- **Version milestone: `0.44.0` → `1.0.0-beta.0`.** `@daloyjs/core`,
  `create-daloy`, and the JSR package `@daloyjs/daloy` all move to
  `1.0.0-beta.0` in lockstep, and every `create-daloy` template now pins
  `@daloyjs/core@^1.0.0-beta.0`. Published to the npm `latest` tag (and JSR), so
  `pnpm create daloy@latest` and a plain `npm i @daloyjs/core` resolve the beta.
- Workshop, README status, and website version references synced to
  `1.0.0-beta.0`.

### Notes

- **No API changes from `0.44.0`.** If you are on `^0.44.0` today, nothing
  breaks; the upgrade is a version bump.
- Still pre-1.0: small adjustments are possible before `1.0.0` final if beta
  feedback surfaces something. Once `1.0.0` ships, deprecations follow the
  one-minor-cycle policy.

## [0.44.0] — 2026-06-21

A security-hardening release driven by a live black-box red-team engagement
against a running server: a slowloris fix in the Node adapter and an opt-in
SSRF DNS-pinning knob that closes the documented rebinding window for `http:`.

### Added

- **`fetchGuard({ pinDns: true })` — DNS-rebinding (TOCTOU) protection for
  `http:`.** The SSRF guard validates a hostname's resolved address and then,
  by default, hands the original `Request` to `fetch`, which re-resolves the
  hostname at connect time — the documented residual rebinding window. With
  `pinDns: true`, `http:` requests are dispatched through Node's built-in
  `node:http` with the socket **pinned to the validated IP** and the original
  `Host` header preserved (so virtual-host routing still works), so an
  attacker's TTL=0 rebind to `127.0.0.1` / `169.254.169.254` can no longer take
  effect between validation and connect. Scope: `http:` only (the prime
  metadata vector), Node only, opt-in (default `false` — zero behavior change
  for existing callers); `https:` retains the documented caveat. Covered by new
  tests in [`tests/fetch-guard.test.ts`](tests/fetch-guard.test.ts) and a
  regression that proves re-encoded internal IPs (decimal/hex/octal/short form)
  are normalized and blocked.

### Security

- **The Node adapter now enforces `connectionTimeoutMs` promptly (slowloris
  fix).** `serve()` derived `headersTimeout` / `requestTimeout` from
  `connectionTimeoutMs`, but left Node's `connectionsCheckingInterval` at its
  30-second default — so Node only _checked_ for timed-out connections every
  30s. A client that stalled (or trickled its request headers a byte at a time)
  held a socket open until the next sweep, far past the configured timeout. The
  adapter now lowers `connectionsCheckingInterval` to a fraction of
  `connectionTimeoutMs` (bounded to 1–5s), so a stalled connection is reaped
  with `408` close to its deadline. `connectionTimeoutMs: 0` still disables the
  timeouts entirely. This is a setup-time change only (no per-request hot-path
  cost) and the `connectionTimeoutMs` contract is unchanged. New regression
  tests in [`tests/node-adapter.test.ts`](tests/node-adapter.test.ts) cover the
  idle and active-trickle slowloris variants and the disable path. A live
  attack harness, `pnpm red-team:live`, reproduces the engagement end-to-end.

## [0.43.0] — 2026-06-20

A maintenance release focused on **scaffolder onboarding** and **runtime
portability**. `create-daloy` now points you at the official install guide for
any runtime or package manager the chosen template needs but that isn't on your
`PATH`, and `@daloyjs/core`'s startup banner is now safe under Deno's
capability-based `--allow-env` permission model. The unused `/app` package
export was removed and is now guarded by an exports-parity test. `@daloyjs/core`
and `create-daloy` publish at the same version in lockstep.

### Added

- **Missing-tooling install links in `create-daloy`.** After scaffolding, the
  CLI probes `PATH` (without executing anything) for the runtime and package
  manager the generated project's "Next steps" rely on — Node, npm, pnpm, Yarn,
  Bun, or Deno depending on the template — and prints the official install URL
  for any that are absent. When the selected package manager itself is missing,
  the dependency install is skipped with a clear pointer instead of failing on
  an opaque spawn error.

### Fixed

- **Startup banner under Deno `--allow-env`.** The cosmetic startup banner read
  environment variables (`NO_COLOR`, `FORCE_COLOR`, `LANG`, `TERM_PROGRAM`, …)
  directly. On Deno's capability-based permission model, reading a variable not
  granted via `--allow-env` throws `NotCapable` and could crash the host app.
  Banner env reads are now wrapped defensively so a denied read is treated as
  "unset" — never a crash. No-op on Node and Bun, where `process.env` access
  never throws.

### Changed

- **Removed the unused `/app` package subpath export.** `@daloyjs/core/app` was
  never a documented entrypoint; the public surface is unchanged for every
  supported import. A new exports-parity test now guards the export map against
  drift, and subpath imports are documented.
- **CLI TSDoc:** corrected the documented `daloy doctor` exit codes and the
  `--json` `ok` semantics.

## [0.42.0] — 2026-06-19

A feature release that rounds out two areas: **multitenancy** and **real-time
docs**. `@daloyjs/core` gains a secure-by-default `tenancy()` primitive and an
auto-mounted interactive **AsyncAPI UI** (the WebSocket counterpart to the
Scalar / Swagger / Redoc OpenAPI viewers), plus a WebSocket close-lifecycle fix.
`create-daloy` publishes at the same version in lockstep.

### Added

- **Multitenancy via `tenancy()`** at `@daloyjs/core/tenancy` — a dependency-free
  `Hooks` bundle that resolves the calling tenant once per request and exposes
  it on `ctx.state.tenant`. Pluggable resolution (`tenantFromSubdomain`
  PSL-aware, `tenantFromHeader`, `tenantFromPathPrefix`, `tenantFromClaim`, or a
  custom `(ctx) => string`, tried in array order). Secure-by-default:
  **refuse-unresolved** (no ambient "default" tenant leak), **format-validated
  ids** (rejects key/log-injection and cache-poisoning payloads before they
  reach a key), **no-enumeration `404`** for unknown tenants, and
  **host-spoof-safe** subdomain resolution. A `tenantScope()` key helper drops
  straight into `rateLimit` `keyGenerator` and `concurrencyLimit` /
  `idempotency` / `responseCache` `scope` to partition each per tenant
  (CWE-524 cross-tenant cached-response defense). Runnable
  `examples/multitenancy-demo.ts`.
- **Interactive AsyncAPI UI** via `asyncapi: true` (mirroring `docs: true`) —
  auto-mounts `GET /asyncapi` (the official AsyncAPI React component, loaded from
  a CDN via a `<script>` tag exactly like the OpenAPI viewers — no build step, no
  runtime dependency), plus `GET /asyncapi.json` and `GET /asyncapi.yaml`. The
  document is generated lazily so `app.ws()` routes registered after construction
  are included. `"auto"` skips production; the object form
  (`AsyncAPIRouteOptions`) exposes custom paths, `servers`, UI `configuration`,
  and SRI-pinnable `assets`. The UI page ships the same hardened response as the
  OpenAPI docs (strict CSP scoped to the asset origin + `connect-src 'self'`,
  `nosniff`, `no-referrer`). HTTP `openapi.servers` are mapped to AsyncAPI
  `ws`/`wss` servers when none are given. Runnable `examples/websocket-demo.ts`
  and `examples/scheduler-demo.ts`.

### Fixed

- **WebSocket close lifecycle (Node adapter).** A socket error arriving _after_
  the close handshake — e.g. a peer that resets the TCP connection right after
  closing, or a `terminate()` racing the OS — no longer fires the handler's
  `error()` callback after `close()` already fired. This restores the "no events
  after close" contract and prevents double-running handler cleanup.

## [0.41.0] — 2026-06-18

A tooling release for the **`create-daloy`** scaffolder: every generated project
now gates its OpenAPI contract automatically, and gets an opt-in localhost
`pre-push` hook. `@daloyjs/core` publishes at the same version in lockstep — there
is **no runtime code change** this release (the `runContractTests` runner and
`daloy inspect --check` already shipped in 0.40.0); only the scaffolder, its
templates, the docs, and the package README change.

### Added

- **Contract gate in every template.** Each scaffold now ships a
  `tests/contract.test.ts` (`tests/contract_test.ts` on Deno) that runs
  `runContractTests` against the real app and proves the gate rejects a broken
  contract. It runs under the project's `test` task, so a missing or duplicate
  `operationId`, a response example that doesn't match its schema, or a route
  with no declared responses fails CI from the first commit.
- **Opt-in `pre-push` contract hook.** Templates ship `.githooks/pre-push` plus a
  `hooks:install` script that points `core.hooksPath` at it — a localhost-only
  gate that runs the contract check before a push (`daloy inspect --check` on
  Node / Vercel / Cloudflare, the contract test on Bun / Deno). It skips
  gracefully when tooling is absent (never blocks a push over a missing
  dependency) and is bypassable with `git push --no-verify`. A new `contract`
  script/task runs the same check on demand.
- **Example-app contract gated in CI.** The framework's own CI now runs
  `daloy inspect --check examples/app.ts` after the build, guarding the showcase
  app's contract (and the `daloy inspect --check` path itself) against regressions.

### Changed

- The scaffolder preserves file modes when copying templates (so the executable
  `pre-push` hook survives scaffolding) and maps the authored `_githooks/`
  directory to `.githooks/` in generated projects.

## [0.40.0] — 2026-06-18

A security-hardening release focused on **response-side data exposure** and
**cross-tenant cache isolation** (OWASP API3 / API2, CWE-524 / CWE-213), plus a
large internal quality pass that brings the entire test suite and build scripts
under type-checking in CI.

> **Behavior changes (pre-1.0 minor).** Three secure-by-default changes may
> affect apps that relied on the previous looser behavior — see **Changed**
> below. Each has an explicit opt-out where a legitimate use case exists.

### Security

- **Response schemas now filter output, not just validate it (OWASP API3 /
  CWE-213).** Response-body validation previously checked the handler's return
  against the declared schema but serialized the original object, so fields a
  handler returned that were **not** declared in the response schema (a stray
  `passwordHash`, a spread ORM row) were emitted to the client. The serializer
  now emits the validator's parsed value, so **only declared fields are sent**,
  at every nesting depth (objects and arrays). Schemas that opt into
  pass-through keep their extra fields.
- **`idempotency()` keys are now namespaced per principal (CWE-524).**
  Previously a client that reused another client's `Idempotency-Key` with the
  same request shape received the other client's stored response. The store key
  is now scoped by the caller — the `Authorization` header by default, or a new
  `scope(ctx)` option for cookie/custom identity. Same-principal retries still
  replay; unauthenticated idempotency still dedupes by key alone.
- **`responseCache()` no longer caches `Authorization`-bearing requests by
  default (CWE-524, RFC 9111 §3.5).** A shared cache keyed on method + URL would
  otherwise serve one user's private response to the next caller of the same
  URL. Opt back in with `cacheAuthenticatedRequests: true` for genuinely
  shareable content (pair it with `varyHeaders: ["authorization"]`).

### Added

- **`findRoutesMissingResponseBodySchema()`** introspection helper, a
  `daloy doctor` **`audit.response.bodySchema`** finding, and a development-mode
  boot warning that surface routes whose `2xx` responses declare no body schema
  (where the new output filtering above cannot run).
- **`idempotency({ scope })`** — namespace idempotency keys by a caller-supplied
  identity.
- **`responseCache({ cacheAuthenticatedRequests })`** — opt in to caching
  responses for `Authorization`-bearing requests.
- **`typecheck:tests`** package script (and `pnpm typecheck` now also
  type-checks `tests/**` and `scripts/**`).

### Changed

- See **Security** above: response field stripping, per-principal idempotency
  keys, and the response-cache `Authorization` bypass are all enabled by
  default.

### Fixed

- **`MemoryIdempotencyStore` / `MemoryResponseCacheStore` method arity** now
  matches the `IdempotencyStore` / `ResponseCacheStore` interfaces (the
  `ttlMs` parameter the framework's own call sites already pass).
- **Synthetic 404 / preflight contexts** in the request pipeline now compile
  when a consumer augments `AppState` (the documented
  `interface AppState extends SessionState {}` pattern).
- **The test suite and build scripts are now type-checked in CI.** They were
  previously excluded from `pnpm typecheck`, which let ~64 latent type errors
  accumulate — including a Zod v4 `z.record(key, value)` arity break,
  `@types/node` v22 `Dirent` / `parseInt` drift in `scripts/`, and a real
  test bug that passed an object to `app.close(timeoutMs: number)`. All fixed
  and gated.

### Tests

- Expanded the adversarial red-team suite to **127 attacks across 7 waves**
  (injection, SSRF, DoS, auth/authz, smuggling, cross-tenant isolation, and a
  three-front offensive simulation covering exfiltration, denial of service,
  and code execution), run as a dedicated `pnpm test:red-team` CI gate.

## [0.39.1] — 2026-06-17

`@daloyjs/core` has no runtime changes; this is a lockstep re-release whose only
purpose is to ship the **JSR** package [`@daloyjs/daloy`](https://jsr.io/@daloyjs/daloy)
with a **Sigstore provenance attestation**.

### Security

- **The JSR build now ships with a provenance attestation.** `@daloyjs/daloy@0.39.0`
  published to JSR but _without_ provenance: the `publish-jsr` CI job's hardened
  egress allowlist was missing the Sigstore hosts (`fulcio.sigstore.dev`,
  `rekor.sigstore.dev`, `tuf-repo-cdn.sigstore.dev`), so `jsr publish` created the
  version and then failed attaching its attestation. The allowlist is fixed, so
  `0.39.1` is published to JSR with verifiable provenance — matching the npm
  packages, which already shipped `0.39.0` with an SLSA provenance attestation.

`create-daloy` is a lockstep `0.39.1` bump: every template now pins
`@daloyjs/core@^0.39.1` (`jsr:@daloyjs/daloy@^0.39.1` for the Deno template).

## [0.39.0] — 2026-06-17

### Added

- **Redoc is now a third built-in OpenAPI docs UI**, alongside Scalar (default)
  and Swagger UI. Set `docs: { ui: "redoc" }` on the `App` constructor to render
  Redoc at `/docs`, and pass Redoc options through `docs.redoc` (forwarded to
  `Redoc.init`). A new `redocHtml` helper is exported from `@daloyjs/core/docs`
  for manual mounting, with matching `RedocConfiguration` and `RedocHtmlOptions`
  types. Because Redoc spins up a `blob:` Web Worker for search, the
  auto-mounted `/docs` CSP widens with `worker-src 'self' blob:` **for
  `ui: "redoc"` only** — Scalar and Swagger UI keep the tighter default.

### Fixed

- **`otelTracing` now follows the OTel HTTP semantic conventions for
  `server.address`/`server.port`.** The span attribute `server.address`
  previously carried the host _with_ its port (e.g. `api.example.com:8443`);
  it now holds the bare hostname and the port is emitted separately as the
  numeric `server.port`, so traces line up with conformant backends.
- **`httpMetrics` no longer drives the in-flight gauge negative on OPTIONS
  preflight.** A CORS preflight handled by the framework's `preflightHooks`
  (when no `OPTIONS` route is registered) calls `onSend` without a prior
  `onRequest`, so the gauge is now only balanced — and request/duration metrics
  recorded — when a matching `onRequest` actually ran for that request.

### Documentation

- Added runnable observability example stacks: an OpenTelemetry tracing demo
  wired to Jaeger over OTLP, and a Prometheus + Grafana metrics integration
  stack.

`create-daloy` is a lockstep `0.39.0` bump: every template now pins
`@daloyjs/core@^0.39.0` (`jsr:@daloyjs/daloy@^0.39.0` for the Deno template).

## [0.38.3] — 2026-06-16

`@daloyjs/core` has no runtime changes; this is a lockstep bump alongside the
`create-daloy` Vercel-template fixes below, so a freshly scaffolded Vercel
project deploys cleanly.

### Fixed

- **The `vercel` template now deploys cleanly on Vercel out of the box.** Two
  issues made a freshly scaffolded Vercel project error on deploy:
  - **Root routing.** Vercel maps `api/<file>` to `/api/<file>`, but a DaloyJS
    app routes at the root, so the old `api/[...path].ts` only answered
    `/api/*` and the deployed root domain returned a Vercel 404. The template
    now ships a single `api/index.ts` plus a `vercel.json` rewrite
    (`/(.*)` → `/api`) — the canonical Vercel "framework owns routing"
    pattern — so the app's routes (`/healthz`, `/docs`, …) are served at the
    site root.
  - **Proxy posture.** Vercel always proxies through its edge and sets
    `x-forwarded-for`, so DaloyJS's production boot guard returned 500 on every
    request. The template now sets
    `behindProxy: { hops: Number(process.env.TRUST_PROXY_HOPS ?? "1") }`
    (Vercel is one trusted edge hop; override the env var if another proxy sits
    in front).
- **The `cloudflare-worker` template no longer 500s on deploy.** Cloudflare
  Workers always run behind Cloudflare's edge (which sets `x-forwarded-for`), so
  the same unconfigured-proxy boot guard returned 500 on every request. The
  template now sets `behindProxy: { hops: 1 }` (Cloudflare is one trusted edge
  hop). It also now enables `docs: true` for parity with the other templates, so
  `/docs`, `/openapi.json`, and `/openapi.yaml` are served (the Scalar UI loads
  from a CDN, so the Worker bundle cost is negligible).
- **The `vercel` template's `pnpm dev` no longer recurses.** It previously
  aliased `vercel dev`, which Vercel rejects (`vercel dev must not recursively
invoke itself`) because it re-reads that script as its dev command. `pnpm dev`
  now runs a local Node dev server (`src/dev.ts`) that serves the same app over
  `@daloyjs/core/node` at the site root — fast iteration with no `vercel dev` or
  Vercel login.
- **Scalar's "Try it" panel works on every deploy target.** The `node-basic`,
  `bun-basic`, and `deno-basic` templates previously set an OpenAPI `servers`
  URL that fell back to `localhost`, which the browser's `connect-src 'self'`
  CSP blocked once deployed where no `PUBLIC_URL` / `RAILWAY_PUBLIC_DOMAIN` was
  set (e.g. Deno Deploy). They now leave `servers` unset by default so Scalar
  calls the origin the docs are served from (the deployed domain in production,
  localhost in dev); set `PUBLIC_URL` to pin an absolute base URL.

### Security

- Pin transitive, dev-only dependencies to clear OSV advisories via pnpm
  overrides: `esbuild` >= 0.28.1 (GHSA-gv7w-rqvm-qjhr, GHSA-g7r4-m6w7-qqqr) and
  `js-yaml` >= 4.2.0 (GHSA-h67p-54hq-rp68). Both are build-time only and not
  part of the published `@daloyjs/core` surface.

### Documentation

- Refreshed the Vercel adapter, scaffolder, and deployment docs to the single
  `api/index.ts` + rewrite pattern.

## [0.38.2] — 2026-06-16

`@daloyjs/core` has no runtime changes in this release; it is a lockstep version
bump published alongside the `create-daloy` scaffolder fixes below, so newly
scaffolded projects pin the latest peer.

### Fixed

- **Scaffolded apps now boot cleanly behind a PaaS edge proxy** (Railway,
  Render, Fly, Heroku). Three deploy-blocking issues in the `create-daloy`
  templates are resolved:
  - The reverse-proxy posture is now an opt-in env knob: set
    `TRUST_PROXY_HOPS` (a single PaaS edge is `1`) and the template wires
    `behindProxy: { hops: N }`. Previously, with the posture unconfigured, the
    production boot guard returned `500 problem+json` on every request carrying
    an `X-Forwarded-*` header (which, behind such a proxy, is every request).
    The secure default is preserved when the variable is unset.
  - The OpenAPI `servers` URL is resolved at runtime
    (`PUBLIC_URL` → `RAILWAY_PUBLIC_DOMAIN` → localhost) so the Scalar "Try it"
    panel targets the deployed origin instead of `localhost` (which the browser
    blocked under the `connect-src 'self'` CSP).
  - The `node-basic` production build now emits a flat `dist/index.js`
    (`tsconfig.build.json` roots at `src`), matching the `start` script and
    Dockerfile `CMD` (`node dist/index.js`). It previously emitted
    `dist/src/index.js`, crashing the container with `MODULE_NOT_FOUND`.
- **Bun template no longer crashes on startup.** Removed the `export default app`
  line from the Bun entrypoint: Bun auto-starts a second server from any module
  whose default export has a `fetch` method, colliding with the explicit
  `serve()` on the same port (`EADDRINUSE`) and surfacing on Railway as an
  "Uncaught exception — exiting" restart loop.

### Changed

- **The Vercel template now targets Vercel's Node.js runtime** (on Fluid
  Compute), which Vercel recommends for standalone functions after deprecating
  standalone Edge Functions. The template was renamed `vercel-edge` → `vercel`
  and now exports `toFetchHandler(app)` (the `{ fetch }` shape Node.js Functions
  expect, no `runtime` export needed); opting into the Edge runtime stays

### Documentation

- New Railway deployment guidance (the `TRUST_PROXY_HOPS` posture and public-URL
  resolution) and a corrected start command; the deployment-overview "Reverse
  proxy" section now documents the real `behindProxy` API instead of a
  nonexistent option. Refreshed the Vercel adapter and scaffolder docs for the
  Node.js-runtime template, and corrected the `SECURITY.md` container-hardening
  section (every scaffolded template ships a hardened `Dockerfile`; the
  `HEALTHCHECK` targets `/healthz`).

## [0.38.1] — 2026-06-11

### Changed

- **Refuse-to-boot / refuse-to-sign guardrails now explain themselves.** The
  error messages thrown by the framework's fail-fast security checks are now
  actionable instead of terse: a weak `session()` secret, `jwt()` configured
  with `alg: "none"` (both the signer and the verifier allowlist),
  `secureDefaults: false` in production, a `session()` chain on a state-changing
  route without `csrf()`, and an unconfigured `trustProxy` when a forwarded
  header is present each now describe the concrete risk (forged sessions,
  signature-stripping / algorithm-confusion, cross-site state changes, spoofed
  client IPs), suggest a fix (e.g. `openssl rand -base64 32`, picking HS256 /
  RS256 / ES256, the right `trustProxy` value), and link to the relevant docs
  page. The error **codes** (`alg_none_refused`, …) and the validation behavior
  are unchanged — only the human-readable guidance improved, so existing
  programmatic checks keep working.
- **`create-daloy --with-ci` workflow templates and the repo's own workflows
  refresh their pinned GitHub Actions SHAs** (CodeQL, OpenGrep, Scorecard, and
  the container-scan jobs) to current upstream releases. Actions remain fully
  SHA-pinned; only the pinned commits moved forward.

### Documentation

- **New "where DaloyJS fits in OAuth2 & OpenID Connect" auth-architecture
  guide** clarifies that DaloyJS is a resource-server / relying-party toolkit
  rather than an identity provider or authorization server, with managed-vs
  self-hosted IdP guidance and the two recommended designs. It is linked from
  the auth overview and summarized in the `@daloyjs/core` and `create-daloy`
  READMEs and every scaffolded template README.
- **New "Coming from ts-rest?" comparison** on the typed-client docs page, plus
  a ts-rest row in the README framework-comparison table.

## [0.38.0] — 2026-06-10

### Added

- **End-to-end inference for the in-process typed client.** `App` is now
  generic over the tuple of routes it has registered: each `app.route(...)`
  call returns an `App` type that accumulates the new route (capturing its
  literal `operationId`, params, and response schemas). `createClient(app)` and
  `ClientFor<App>` recover that tuple, so methods such as
  `client.getBookById({ params: { id } })` are now fully typed end-to-end —
  precise `operationId` keys, typed params, and a discriminated response union —
  with **zero codegen and no runtime change**. Inference relies on **chaining**
  the `route()` calls and letting TypeScript infer the variable type; a widening
  `const app: App` annotation or a `: App` factory return type erases the tuple
  and collapses the client back to an untyped surface. New type-level regression
  test under `tests/types/` plus a dedicated `tsconfig.typetest.json` lock the
  behavior. TSDoc on `createClient` / `ClientFor`, the README, and the
  `/docs/typed-client` and `/docs/getting-started` pages document the chaining
  requirement.

### Changed

- **`create-daloy` templates now use `.ts` relative import specifiers** (for
  example `./build-app.ts` and `../api/[...path].ts`) instead of `.js`, so the
  files you import match the files on disk. The `node-basic` and `vercel`
  templates gain the required `allowImportingTsExtensions` (and, where it emits,
  `rewriteRelativeImportExtensions`) tsconfig flags; `bun-basic` and
  `deno-basic` already used `.ts` natively. npm + JSR publish output for
  `@daloyjs/core` itself is unchanged (source keeps `.js` specifiers). The base
  `tsconfig.json` enables the same flags so authored examples can use `.ts`.

### Fixed

- **`create-daloy` Dockerfile package-manager scaffolding on CRLF working
  trees.** `patchDockerfileForPackageManager` used `\n`-only regular
  expressions and a literal `"...\n"` string replace, so on a Windows checkout
  (CRLF line endings, no `.gitattributes` normalization) npm/yarn/bun scaffolds
  kept the pnpm `COPY pnpm-lock.yaml*` / `corepack ... pnpm install` lines and
  the bun image swap silently no-op'd. The substitutions are now CRLF-tolerant
  (`\r?\n`). Linux/macOS (LF) output is unchanged; this fixes scaffolding on
  Windows and any package published from a Windows host.

## [0.37.0] — 2026-05-31

### Added

- **GeoIP / geo-blocking middleware at `@daloyjs/core/geo-block`.** New
  dependency-free `geoBlock()` enforces ISO 3166-1 alpha-2 country allow/deny
  lists without bundling any GeoIP database. Pick exactly one resolution
  strategy: `lookupCountry(ip)` (you bring a MaxMind / `ip2location` reader or
  your own table — Daloy resolves the client IP first, reusing the trusted-proxy
  `X-Forwarded-For` / `X-Real-IP` handling) or `resolveCountry(ctx)` (read an
  edge-injected header such as Cloudflare `CF-IPCountry`, AWS CloudFront
  `CloudFront-Viewer-Country`, or Vercel `x-vercel-ip-country`). `deny` wins
  over `allow` (least privilege); allow-lists **fail closed** on an unknown
  country while deny-only configurations **fail open** (overridable via
  `allowUnknownCountry`). Country codes are validated at construction so typos
  throw instead of silently never matching. Adds a `mode: "log"` monitor mode
  with an `onBlock` decision hook (`denied_country` / `not_in_allowlist` /
  `unknown_country`), stamps the resolved country on `ctx.state.geo` for allowed
  requests, and rejects blocked traffic with a `403`
  `application/problem+json` (`Cache-Control: no-store`) that never echoes the
  country or IP. New docs page: **GeoIP / geo-blocking**.

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
  are enforced _during_ inflation so a bomb is aborted long before it is fully
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

### Security

- **Safe percent-decoding of path segments.** The router now decodes each URL
  path segment defensively: a malformed percent-escape (e.g. a stray `%` or an
  invalid `%XY` sequence) no longer throws a `URIError` that would surface as an
  unhandled `500`, and an over-decoded segment can no longer smuggle a path
  separator. Malformed segments are rejected at the boundary instead of being
  passed through, keeping route matching and downstream handlers from operating
  on attacker-shaped paths.
- **`fetchGuard()` drains intermediate 3xx redirect bodies.** When following a
  redirect chain the guard now fully drains each intermediate `3xx` response
  body before issuing the next hop, preventing a slow/never-ending redirect
  response body from pinning a socket open (a resource-exhaustion vector).
- **Hardened defenses against AI-agent credential theft and expanded
  agent-instruction surface scanning.** The supply-chain governance gates grew
  new coverage: `verify-no-registry-exfiltration.ts` now flags registry
  credential-exfiltration patterns, and the `verify-no-leaky-agent-skills.ts` /
  `verify-no-toxic-agent-skills.ts` scanners broadened the agent-instruction
  surfaces they inspect (each backed by new tests). A new
  `examples/residential-proxy-defense.ts` demonstrates blocking residential-proxy
  credential-harvesting traffic.

### Fixed

- **Redis rate-limit fail-open posture is now documented.** The Redis-backed
  `rateLimit()` store clarifies in its docs and code comments that a Redis
  outage degrades **open** (requests are allowed rather than blocked), so
  operators can make an informed availability-vs-enforcement trade-off.
- **4xx error-detail security note clarified.** The error module documents that
  `4xx` problem details are returned to the client by design and must not carry
  internal/sensitive context, matching the prod-mode redaction posture.
- **Multipart `fileField()` format-option assignment normalized.** Internal
  cleanup so the `format` option is assigned consistently; no behavior change.

### Docs

- **`pnpm verify:docs-links` — docs link / nav / sitemap parity gate.** New
  dependency-free `scripts/verify-docs-links.ts` statically validates the
  documentation site: every internal `/docs/...` link inside a docs page, every
  `docsNav` sidebar entry, every `sitemap.ts` path, and every `#anchor` target
  is checked against the real `website/app/docs/**/page.tsx` tree. It fails CI
  on broken links, dangling nav/sitemap entries, docs pages missing from the
  sitemap, and nav↔sitemap drift — replacing the manual "navigation, sitemap,
  and search discovery are manually maintained" process noted in
  `website/AGENTS.md`. The first per-surface freshness sweep across all 119 docs
  pages passed clean.
- **Roadmap "Integrations & docs" standing track.** `ROADMAP.md` now carries a
  dedicated track enumerating the documentation surfaces the core release log
  never tracked — Email (6 providers), Payments (9), Database hosting (5), ORM
  (6), ODM (2), Authentication (5), Deployment platforms (4), Adapters/runtimes
  (8), the compliance/security-posture slice, and the tutorials — so adding or
  removing a documented provider is reviewed as a roadmap change instead of
  staying invisible to planning. Counts mirror the live docs navigation
  (`website/components/docs-nav.ts`).

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
  - DAST workflows; Log4Shell / Spring4Shell regression tests.

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
  (`node-basic`, `bun-basic`, `deno-basic`, `cloudflare-worker`, `vercel`)
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
  - per-IP rate limit), prod refuse-to-boot without
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
  `vercel`, `cloudflare-worker`), docs metadata + ORM guides.

[Unreleased]: https://github.com/daloyjs/daloy/compare/v1.0.0-rc.6...HEAD
[1.0.0-rc.9]: https://github.com/daloyjs/daloy/compare/v1.0.0-rc.8...v1.0.0-rc.9
[1.0.0-rc.8]: https://github.com/daloyjs/daloy/compare/v1.0.0-rc.7...v1.0.0-rc.8
[1.0.0-rc.7]: https://github.com/daloyjs/daloy/compare/v1.0.0-rc.6...v1.0.0-rc.7
[1.0.0-rc.6]: https://github.com/daloyjs/daloy/compare/v1.0.0-rc.5...v1.0.0-rc.6
[1.0.0-rc.5]: https://github.com/daloyjs/daloy/compare/v1.0.0-rc.4...v1.0.0-rc.5
[1.0.0-rc.4]: https://github.com/daloyjs/daloy/compare/v1.0.0-rc.3...v1.0.0-rc.4
[1.0.0-rc.3]: https://github.com/daloyjs/daloy/compare/v1.0.0-rc.2...v1.0.0-rc.3
[1.0.0-rc.2]: https://github.com/daloyjs/daloy/compare/v1.0.0-rc.1...v1.0.0-rc.2
[1.0.0-rc.1]: https://github.com/daloyjs/daloy/compare/v1.0.0-rc.0...v1.0.0-rc.1
[1.0.0-rc.0]: https://github.com/daloyjs/daloy/compare/v1.0.0-beta.7...v1.0.0-rc.0
[1.0.0-beta.7]: https://github.com/daloyjs/daloy/compare/v1.0.0-beta.6...v1.0.0-beta.7
[1.0.0-beta.6]: https://github.com/daloyjs/daloy/compare/v1.0.0-beta.5...v1.0.0-beta.6
[1.0.0-beta.5]: https://github.com/daloyjs/daloy/compare/v1.0.0-beta.4...v1.0.0-beta.5
[1.0.0-beta.4]: https://github.com/daloyjs/daloy/compare/v1.0.0-beta.3...v1.0.0-beta.4
[1.0.0-beta.3]: https://github.com/daloyjs/daloy/compare/v1.0.0-beta.2...v1.0.0-beta.3
[1.0.0-beta.2]: https://github.com/daloyjs/daloy/compare/v1.0.0-beta.1...v1.0.0-beta.2
[1.0.0-beta.1]: https://github.com/daloyjs/daloy/compare/v1.0.0-beta.0...v1.0.0-beta.1
[1.0.0-beta.0]: https://github.com/daloyjs/daloy/compare/v0.44.0...v1.0.0-beta.0
[0.44.0]: https://github.com/daloyjs/daloy/compare/v0.43.0...v0.44.0
[0.43.0]: https://github.com/daloyjs/daloy/compare/v0.42.0...v0.43.0
[0.42.0]: https://github.com/daloyjs/daloy/compare/v0.41.0...v0.42.0
[0.41.0]: https://github.com/daloyjs/daloy/compare/v0.40.0...v0.41.0
[0.40.0]: https://github.com/daloyjs/daloy/compare/v0.39.1...v0.40.0
[0.39.1]: https://github.com/daloyjs/daloy/compare/v0.39.0...v0.39.1
[0.39.0]: https://github.com/daloyjs/daloy/compare/v0.38.3...v0.39.0
[0.38.3]: https://github.com/daloyjs/daloy/compare/v0.38.2...v0.38.3
[0.38.2]: https://github.com/daloyjs/daloy/compare/v0.38.1...v0.38.2
[0.38.1]: https://github.com/daloyjs/daloy/compare/v0.38.0...v0.38.1
[0.38.0]: https://github.com/daloyjs/daloy/compare/v0.37.0...v0.38.0
[0.37.0]: https://github.com/daloyjs/daloy/compare/f37ce20...v0.37.0
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
