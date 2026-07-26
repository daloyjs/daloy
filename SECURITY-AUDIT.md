# Security Audit — `@daloyjs/core`

**Date:** 2026-07-25 (previous revision: 2026-06-18)
**Method:** Adversarial black/grey-box testing (a red-team suite across eleven waves) plus targeted source review of the security-critical paths (request pipeline, serialization, JWT/HMAC, SSRF guard, auth/authz middleware, router, access-control modules), plus a live over-the-wire engagement against a realistic multi-tenant app on the Node adapter (54 probes; see `red-team-live/`).
**Overall posture:** **Strong.** Six findings were identified, remediated, and verified closed: one response over-exposure (F-1) and five cross-principal cached-response disclosures (F-2 … F-6). Remaining items are documented residual risks with explicit owners and mitigations.

> **Lesson recorded from the F-4/F-5/F-6 round.** The F-3 remediation fixed the
> `Authorization` dimension of CWE-524 and was signed off as closed, while three
> other dimensions of the _same_ defect — the request authority, the resolved
> tenant, and cookie identity — stayed open in the same function. A cache is only
> as safe as its key, so the durable fix is to enumerate **every** input that
> varies the response and confirm each one is either in the key or fails closed,
> rather than patching the dimension the last exploit happened to use. The live
> engagement found all three; the in-process suites had not, because each asserted
> the dimension it was written for.

This document is generated and maintained alongside the red-team suite
(`tests/red-team-attacks*.test.ts`, run as the `pnpm test:red-team` CI gate)
and the `daloy doctor` posture audit. It is a point-in-time assessment; re-run
the suite and `daloy doctor` on every change to the security surface.

---

## Scope

In scope: the framework's first-party security controls and defaults — request
parsing and limits, header handling, JWT/HMAC/signing, SSRF guard, open-redirect
guard, CORS/CSRF/fetch-metadata, secure headers, rate limiting, auto-ban,
bot-guard, geo-block, IP reputation, mTLS, HTTP message signatures, session and
cookie integrity, multipart/upload validation, pagination cursors, idempotency,
decompression and concurrency limits, WebSocket frame/handshake parsing, error
redaction, and response/request schema enforcement.

Out of scope (operator/application responsibility, documented as such): object-
level authorization (BOLA/IDOR), business-logic abuse, data classification, and
the residual DNS-rebinding window noted under R-2.

---

## Control assessment — OWASP API Security Top 10 (2023)

| #     | Category                                 | Verdict           | Evidence (red-team coverage)                                                                                                                                                                                                                                                               |
| ----- | ---------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API1  | Broken Object-Level Authorization (BOLA) | Operator scope    | Framework enforces _who_ can call a route; _which records_ is application logic (documented)                                                                                                                                                                                               |
| API2  | Broken Authentication                    | Pass (remediated) | JWT (`none`/confusion/tamper/expiry/weak-key/**header key-injection**), bearer/basic, session signing, HTTP signatures; **cross-principal idempotency replay (F-2) and response-cache disclosure via `Authorization` (F-3), authority (F-4), tenant (F-5), and `Cookie` (F-6) all closed** |
| API3  | Broken Object **Property**-Level Auth    | Pass (remediated) | Request strips extra keys; **response strips undeclared fields at all depths** (F-1); schema-coverage audit (R-1); cached responses partitioned per authority/tenant/principal (F-4…F-6)                                                                                                   |
| API4  | Unrestricted Resource Consumption        | Pass              | body `413`, header-count `431`, decompression-bomb `413`, concurrency/load-shedding `503`, rate-limit `429`, ReDoS-bounded WAF                                                                                                                                                             |
| API5  | Broken Function-Level Authorization      | Pass              | `requireScopes`, exact case-sensitive routing, `except()` fail-closed path matching, no method-override                                                                                                                                                                                    |
| API6  | Unrestricted Access to Sensitive Flows   | Operator scope    | Business-logic abuse is application-specific (documented)                                                                                                                                                                                                                                  |
| API7  | Server-Side Request Forgery              | Pass (1 residual) | All documented cloud-metadata IPs, redirect re-validation, IPv4-mapped IPv6, protocol allowlist; TOCTOU residual (R-2)                                                                                                                                                                     |
| API8  | Security Misconfiguration                | Pass              | Auto secure-headers, refuse-to-boot, CORS `*`+credentials refusal, internal-service preset                                                                                                                                                                                                 |
| API9  | Improper Inventory Management            | Pass              | OpenAPI single-source, internal-route hiding                                                                                                                                                                                                                                               |
| API10 | Unsafe Consumption of APIs               | Pass              | `fetchGuard`, `resilientFetch`, webhook HMAC + replay window                                                                                                                                                                                                                               |

---

## Findings register

### F-1 — Excessive Data Exposure via response schema — HIGH — **CLOSED**

- **Class:** CWE-213 (Exposure of Sensitive Information Due to Incompatible Policies); OWASP API3.
- **Description:** Response schemas were validated but not used to filter output. A handler returning `passwordHash` against a `{ id }` response schema serialized the field to the client. The request side already stripped undeclared keys; the response side did not — an asymmetry that contradicted the documented "only fields you declare in the response schema are emitted" guarantee.
- **Root cause:** the serializer checked the validator result for issues but discarded the validator's parsed (key-stripped) `value`, then serialized the original handler return.
- **Remediation:** the serializer now serializes the validator's parsed `value`, so undeclared fields are stripped before the wire. Verified complete at all depths — top-level, nested objects, and arrays-of-objects — and `.passthrough()` opt-in is honored. A `.strict()` response schema converts over-exposure into a safe `500` instead of a leak.
- **Verification:** `tests/red-team-attacks.test.ts` (top-level + async + passthrough + strict) and `tests/red-team-attacks-4.test.ts` (nested + array).

### F-2 — Cross-tenant idempotent-response replay — HIGH — **CLOSED**

- **Class:** CWE-524 (Use of Cache Containing Sensitive Information); OWASP API2/API3.
- **Description:** `idempotency()` keyed its store solely on the `Idempotency-Key` header (plus optional `groupId`) and fingerprinted only `method + path + body`. A second principal that reused another principal's key with the same body on a shared path (`/me`, `/cart`) received the first principal's stored response. Confirmed with a live exploit: client B received `owner: "Bearer USER_A"` with `idempotency-replayed: true`.
- **Remediation:** the store key is now namespaced by the calling principal — the `Authorization` header by default (covering the dominant bearer / API-key idempotency case), or a caller-supplied `scope(ctx)` for cookie/custom identity. Same-principal retries still replay; unauthenticated idempotency still dedupes by key.
- **Verification:** `tests/red-team-attacks-5.test.ts`.

### F-3 — Cross-tenant response-cache disclosure — HIGH — **CLOSED**

- **Class:** CWE-524; OWASP API2/API3.
- **Description:** `responseCache()` keyed on `method + URL + varyHeaders` and did not refuse to cache `Authorization`-bearing requests. An authenticated response with no explicit `private`/`no-store` directive was cached and served to the next caller of the same URL. Confirmed with a live exploit (fully automatic, no attacker effort): client B received `owner: "Bearer USER_A"` with `x-cache: HIT`.
- **Remediation:** requests carrying an `Authorization` header now bypass the shared cache by default (RFC 9111 §3.5), with an explicit `cacheAuthenticatedRequests: true` opt-in for genuinely shareable content. Unauthenticated/public responses are still cached.
- **Verification:** `tests/red-team-attacks-5.test.ts`.
- **Follow-up:** this remediation was **incomplete**. It fixed the `Authorization` dimension only, while the cache key still omitted the request authority and the resolved tenant, and `Cookie` was not treated as a credential at all. See F-4, F-5, and F-6 — all three found by a later live engagement and closed in 1.0.0.

### F-4 — Response-cache key omits the request authority — HIGH — **CLOSED**

- **Class:** CWE-524; OWASP API2/API3. RFC 9111 §4 violation.
- **Description:** `defaultKey()` built the cache key from `method + pathname + search`, omitting the authority. RFC 9111 keys a cache on the _effective request URI_, which includes it. Any single process serving several hostnames — vanity domains, subdomain-per-customer, staging alongside production — therefore shared one entry across all of them. **No opt-in and no misconfiguration required: plain defaults.** Confirmed with a live exploit over raw sockets: `Host: customer-b.example.com` received `customer-a.example.com`'s body with `x-cache: HIT`.
- **Remediation:** the key is now built from the full effective request URI. As a side effect this removed a `new URL()` allocation from the hot path, so the key builder is ~9× faster than before the fix.
- **Verification:** `tests/red-team-attacks-11.test.ts` (cross-host isolation, plus same-host hit, scheme/port distinctness, and fragment-insensitivity happy paths).

### F-5 — Response-cache ignored the framework-resolved tenant — HIGH — **CLOSED**

- **Class:** CWE-524; OWASP API2/API3.
- **Description:** `tenancy()` resolved the tenant into `ctx.state.tenant`, and `responseCache()` then cached per-tenant responses under a tenant-less key. A second tenant — and even a caller supplying **no tenant at all** — received the first tenant's confidential body with `x-cache: HIT`. A documented `tenantScope()` `keyGenerator` recipe existed, but it was silently opt-in while the `Authorization` dimension of the same CWE fail-closed automatically, and nothing warned when the two middlewares were composed without it. Confirmed with a live exploit.
- **Remediation:** the resolved tenant is now folded into the cache key automatically, keyed off a `ctx.state` marker (`TENANCY_RESOLVED_MARKER`) rather than the configurable `stateKey`, so it works regardless of configuration. Tenant-less traffic gets its own partition instead of sharing the resolved ones. The partition is applied _around_ a custom `keyGenerator`, so a hand-written generator cannot widen it. Because the key is built in `beforeHandle`, a `responseCache()` mounted _ahead of_ `tenancy()` cannot see the tenant — that ordering now **refuses to boot** in production (boot guard 7) rather than leaking silently.
- **Verification:** `tests/red-team-attacks-11.test.ts` (cross-tenant, tenant-less-anonymous, custom-keyGenerator, and boot-guard cases, plus the same-tenant cache-hit happy path).

### F-6 — Response-cache treated cookie identity as anonymous — MEDIUM-HIGH — **CLOSED**

- **Class:** CWE-524; OWASP API2/API3.
- **Description:** the request `Cookie` header was never consulted — only response `Set-Cookie` was. A cookie-authenticated private response was stored in the shared cache and replayed to an anonymous stranger. The default `session({ rolling: true })` masked this (a rolling session re-emits `Set-Cookie` on every response, which blocks storage), but the documented `rolling: false` option removed that accidental protection. Notably the F-5 remediation does **not** cover this axis: `tenantScope()` partitions by tenant, not by user. Confirmed with a live exploit: an unauthenticated caller received `alice@acme.test`.
- **Remediation:** `Cookie` is now a credential alongside `Authorization` — a request carrying either bypasses the shared cache by default. `cacheAuthenticatedRequests` accepts `boolean | { authorization?, cookie? }` for per-header opt-in, and a new `principal` option lets an app name the caller so credentialed responses cache _per principal_ instead of merely being skipped. A `principal` that returns `null` for a credentialed request fails closed. Partition components are length-prefixed so a crafted id cannot collide with another partition (cache-key injection).
- **Verification:** `tests/red-team-attacks-11.test.ts` (anonymous-stranger, cross-user, null-principal fail-closed, and per-header opt-in isolation cases, plus per-principal hit and public-caching happy paths).

### F-7 — Response-cache ignored the response's own `Vary` header — MEDIUM-HIGH — **CLOSED**

- **Class:** CWE-524; OWASP API2/API8. RFC 9111 §4.1 violation.
- **Description:** `responseCache()` honoured only its own `varyHeaders` option and discarded the `Vary` header the response itself declared. `Vary` is the origin naming the request headers its content depends on, and two middlewares in the framework's own documented stack emit it: `cors()` writes `Vary: Origin` next to the reflected `Access-Control-Allow-Origin`, and `compression()` writes `Vary: Accept-Encoding` next to `Content-Encoding`. The cache stored the whole response — those headers included — under a key covering neither field and replayed it to every later caller. **No opt-in and no misconfiguration required: plain defaults, on the composition the docs recommend.** Confirmed live over the wire against a real Node listener:
  - a request from `https://partner.example.com` seeded the entry, and the next caller from `https://app.example.com` — and a caller sending no `Origin` at all — received `Access-Control-Allow-Origin: https://partner.example.com` with `x-cache: HIT`, so their browser rejected a response their origin was entitled to (cross-origin denial of service against a first-party origin, triggerable by any unauthenticated client for the whole TTL);
  - a client that sent `Accept-Encoding:` (identity only) received a gzip-compressed body — verified by the `1f8b` magic bytes — with `Content-Encoding: gzip` it never negotiated;
  - a handler that content-negotiated on `Accept-Language` and correctly declared `Vary: Accept-Language` served German content to an English-speaking client.
    The credential guard (F-6) holds, so this does not disclose a _private_ body through framework primitives; the impact is CORS-policy corruption, content-coding confusion, and cross-serving of any application-declared variant.
- **Remediation:** a response's `Vary` is now honoured as a secondary key with no configuration. The field list and the request's values for it are stored with the entry, and an entry is replayed only to a request whose values re-encode identically; values are length-prefixed with the same scheme as the tenant/principal partition, so a crafted header value cannot collide with another variant. `Vary: *` is never stored. Variants are written under their own store keys so several stay warm at once — a single slot per URL would have turned every alternation between (say) a gzip and an identity client into a miss and handed an attacker a cache-defeat DoS by rotating `Origin`. `varyHeaders` remains as the proactive, pre-handler dimension list and is additive. Measured at parity on `bench/response-cache.bench.ts` (the added work on a hit is one property access).
- **Verification:** `tests/response-cache.test.ts` — variant isolation, coexistence-without-eviction, absent-header-is-its-own-variant, case/order-insensitive field matching, `Vary: *`, and a crafted-collision case, plus the single-variant hit happy path.

### F-8 — Cached entries froze per-request and hop-by-hop headers — LOW-MEDIUM — **CLOSED**

- **Class:** CWE-524 (metadata), CWE-444 (framing).
- **Description:** every response header except `Age` was persisted in the entry and replayed verbatim. With `requestId()` mounted — the framework's own correlation middleware — every caller served from the cache received the `x-request-id` of the _one_ request that populated it, confirmed live across three consecutive hits. That breaks incident correlation (many principals reporting one trace id belonging to a request they never made) and gives an attacker a cache-state oracle: seeing their own seeded id come back tells them the entry is still live. Hop-by-hop headers were likewise storable, so a `Transfer-Encoding` or `Connection` token written by a handler would be replayed onto a fixed-length cached body.
- **Remediation:** a built-in deny list (`Age`, the RFC 9110 §7.6.1 hop-by-hop set, and `X-Request-Id`) is stripped before an entry is stored, so the live request's correlation id applies on a hit. A new `excludeHeaders` option extends it for a custom correlation header name. The origin `Date` is deliberately **kept**: RFC 9111 §4.2.3 computes age from the stored `Date`, so replacing it would corrupt a downstream cache's freshness maths.
- **Verification:** `tests/response-cache.test.ts` — correlation id differs across hits, hop-by-hop stripped while ordinary headers survive, and `excludeHeaders` honoured.

### F-9 — `MemoryResponseCacheStore` grew without bound — MEDIUM — **CLOSED**

- **Class:** CWE-770 (allocation without limits); DoS.
- **Description:** the store's TSDoc claimed the map "is opportunistically pruned so it cannot grow without bound", but `set()` only pruned **expired** entries, and only once size exceeded 10,000. Within the TTL nothing is expired, so the prune was a no-op and the map grew linearly. An unauthenticated attacker rotating a query string against any cached endpoint mints a fresh entry per request, each holding up to `maxBodyBytes` (default 1 MiB). Reproduced: 20,000 unexpired entries retained against a documented 10,000 cap. This is the same defect class deepsec flagged in `bot-guard`'s verification cache.
- **Remediation:** the store is now bounded on **both** entry count (`maxEntries`, default 10,000 — the previously documented figure) and retained body bytes (`maxBytes`, default 64 MiB), the latter being the limit that actually caps memory, since 10,000 × 1 MiB is 10 GB. Eviction is FIFO over `Map` insertion order, expired entries first. A running byte counter is kept in step across overwrite and delete. The same PoC now retains 256 entries (the byte cap binding first).
- **Verification:** `tests/response-cache.test.ts` — `maxEntries` enforced against a burst of unexpired entries, `maxBytes` enforced, byte accounting correct across overwrite/delete, and invalid limits rejected.

No other defects were identified across the eleven red-team waves.

### Verified-secure controls (wave 6 — no defects, locked as regression tests)

A further pass over session, cookie, compression, and multipart handling found
the existing defenses sound; they are now regression-locked in
`tests/red-team-attacks-6.test.ts`:

- **Session fixation / forgery.** A client-supplied session cookie is adopted only when its HMAC signature verifies _and_ the id exists in the store; otherwise a fresh id is issued. An attacker cannot plant a chosen id (no secret → no valid signature). `regenerate()` rotates the id on privilege change.
- **Cookie tossing.** The session cookie uses the `__Host-` prefix (host-only, `Path=/`, no `Domain`) plus `HttpOnly` + `Secure` + `SameSite`, so a sibling subdomain cannot inject it.
- **BREACH / CRIME.** `compression()` skips responses with `Set-Cookie`, requests with an `Authorization` header, and requests carrying a session/CSRF/`__Host-`/`__Secure-` cookie — credentialed, per-user bodies are never compressed.
- **Multipart DoS.** Per-file (`maxFileBytes` → `413`) and field/file-count (`maxFields`/`maxFiles` → `400`) caps are enforced when configured, with the always-on `bodyLimitBytes` (1 MiB) as the backstop.

---

## Residual risk register

| ID  | Risk                                                                                                                                                                  | Severity | Owner               | Status / mitigation                                                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-1 | Routes with no declared response `body` schema get **no** output filtering (API3 protection is opt-in)                                                                | Medium   | Developer           | **Remediated:** `daloy doctor` `audit.response.bodySchema` finding + dev-mode boot warning + `findRoutesMissingResponseBodySchema()` introspection helper               |
| R-2 | `fetchGuard` DNS-rebinding TOCTOU (validate-then-connect re-resolves the hostname)                                                                                    | Medium   | Operator            | Documented in `fetch-guard.ts`; mitigate via VPC/firewall egress rules or a pinned-IP `undici` dispatcher                                                               |
| R-3 | `bearerAuth`/`basicAuth` comparison timing-safety lives in the developer's `validate`/`verify` callback                                                               | Low      | Developer           | Framework ships `timingSafeEqual`; cannot force its use. Documented in the auth middleware TSDoc                                                                        |
| R-4 | `timingSafeEqual` is not a hardware constant-time primitive (compares UTF-16 code units)                                                                              | Low      | Framework           | Documented in TSDoc; for raw bytes use `crypto.timingSafeEqual`                                                                                                         |
| R-5 | In-memory rate-limit / autoBan / idempotency / response-cache stores are single-process                                                                               | Low      | Operator            | Documented; Redis adapters provided for multi-instance deployments                                                                                                      |
| R-6 | `trustProxyHeaders` / `behindProxy` misconfiguration affects IP-based controls (rate/geo/autoBan/bot)                                                                 | Low      | Operator            | Fails **closed** by default (`trustProxy: false`); `daloy doctor` flags an unset proxy config in production                                                             |
| R-7 | `waf()` is a signature engine: bounded multi-decode (max 2) + comment strip block classic double-encoding / `/**/` splits; triple+ encoding and novel evasions remain | Low      | Framework/Developer | Residual by design (unbounded recursive decoding causes false positives). WAF is defense-in-depth; rely on schemas + output escaping. Updated in multi-decode hardening |

---

## Red-team suite inventory

The adversarial suite (`pnpm test:red-team`, gated in CI) contains **176 attacks** across eleven files:

- **Wave 1** (`red-team-attacks.test.ts`): prototype pollution, body/header DoS, request smuggling and header injection, JWT, SSRF, open redirect, NoSQL operators, path traversal, constant-time compare, webhook HMAC, CORS, rate limit, CSRF, WAF, content-type, mass assignment, error redaction, secure headers, strong-secret guard, response over-exposure.
- **Wave 2** (`red-team-attacks-2.test.ts`): decompression bombs, signed-value/session integrity, cookie attribute guards, mTLS header spoofing, HTTP message signatures, bearer/basic/scopes/fetch-metadata, WebSocket frame protocol and CSWSH, pagination cursors, idempotency, concurrency, multipart magic-bytes, refuse-to-boot, internal-service preset.
- **Wave 3** (`red-team-attacks-3.test.ts`): bot-guard spoofed-crawler, geo-block allow/deny, IP-reputation denylist, auto-ban strike escalation, auto-ban shared-bucket footgun refusal.
- **Wave 4** (`red-team-attacks-4.test.ts`): nested/array response over-exposure (independent verification of F-1), JWT header key-injection (`jwk`/`jku`/`x5u`/`kid`), uppercase `NONE` bypass attempt, HTTP method-override smuggling, path-confusion `except()` fail-closed, WAF ReDoS bound.
- **Wave 5** (`red-team-attacks-5.test.ts`): cross-tenant cached-response disclosure — idempotency replay isolation (F-2) and response-cache Authorization bypass (F-3), including the same-principal/public happy paths and the explicit opt-in path.
- **Wave 6** (`red-team-attacks-6.test.ts`): defense verification — session fixation/forgery + `regenerate()` rotation, `__Host-` cookie scoping, BREACH-aware compression skips, multipart per-file cap, WAF single- and double-encoding catch (bounded multi-decode).
- **Wave 7** (`red-team-attacks-7.test.ts`): three-front offensive simulation — (R) production docs/OpenAPI hidden, error-response leak-free, forged-JWT privilege-escalation rejected; (C) request-timeout slowloris cutoff, deep-nest stack-bomb rejected fast, wide-JSON hash-flood bounded; (N) prototype-gadget pollutes nothing, no dynamic code-execution primitive on the public surface.
- **Wave 8** (`red-team-attacks-8.test.ts`): OWASP WSTG methodology sweep — rendered-HTML XSS in the API docs, HTTP Parameter Pollution, verb tampering / Cross-Site Tracing, CORS origin-matching bypasses.
- **Wave 9** (`red-team-attacks-9.test.ts`): Doyensec WAPT methodology, live-service pass — framework fingerprinting and error-code disclosure, plus the assessor-style categories waves 1–8 had not exercised end-to-end.
- **Wave 10** (`red-team-attacks-10.test.ts`): deep-dive campaigns — WAF multi-encoding evasion with the typed-contract backstop, and the full JWT algorithm matrix.
- **Wave 11** (`red-team-attacks-11.test.ts`): response-cache key completeness — the three remaining CWE-524 dimensions found by the live engagement: authority (F-4), resolved tenant (F-5), and cookie identity (F-6), including the cache-still-works happy paths (same-host hit, same-tenant hit, per-principal hit, public caching), the per-header opt-in, the ordering boot guard, and cache-key injection via a crafted principal.

---

## Recommendations / next steps

1. **(Done) R-1 coverage audit.** Surface schema-less `2xx` responses via `daloy doctor` and a dev boot warning so the API3 protection is never silently absent.
2. **Keep the gate green.** `pnpm test:red-team` runs as a dedicated, named CI step; a regression in any advertised guard fails the build with a security-specific label.
3. **Operator checklist for production deploys:** set `behindProxy`/`trustProxy` explicitly, enforce egress firewall rules (mitigates R-2), and use the Redis-backed stores for multi-instance rate-limit/idempotency/auto-ban (R-5).
4. **Re-audit cadence.** Re-run this assessment whenever `src/security.ts`, `src/jwt.ts`, `src/fetch-guard.ts`, `src/jwk.ts`, the serializer in `src/app.ts`, or the auth middleware change.
