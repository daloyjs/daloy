# Security Audit — `@daloyjs/core`

**Date:** 2026-06-18
**Method:** Adversarial black/grey-box testing (a 104-attack red-team suite across four waves) plus targeted source review of the security-critical paths (request pipeline, serialization, JWT/HMAC, SSRF guard, auth/authz middleware, router, access-control modules).
**Overall posture:** **Strong.** Three High-severity findings were identified, remediated, and verified closed (one response over-exposure, two cross-tenant cached-response disclosures). Remaining items are documented residual risks with explicit owners and mitigations.

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

| #     | Category                                     | Verdict                     | Evidence (red-team coverage)                                                                                  |
| ----- | -------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| API1  | Broken Object-Level Authorization (BOLA)     | Operator scope              | Framework enforces *who* can call a route; *which records* is application logic (documented)                  |
| API2  | Broken Authentication                        | Pass (remediated)           | JWT (`none`/confusion/tamper/expiry/weak-key/**header key-injection**), bearer/basic, session signing, HTTP signatures; **cross-tenant idempotency replay (F-2) and response-cache disclosure (F-3) closed** |
| API3  | Broken Object **Property**-Level Auth        | Pass (remediated)           | Request strips extra keys; **response strips undeclared fields at all depths** (F-1); schema-coverage audit (R-1) |
| API4  | Unrestricted Resource Consumption            | Pass                        | body `413`, header-count `431`, decompression-bomb `413`, concurrency/load-shedding `503`, rate-limit `429`, ReDoS-bounded WAF |
| API5  | Broken Function-Level Authorization          | Pass                        | `requireScopes`, exact case-sensitive routing, `except()` fail-closed path matching, no method-override        |
| API6  | Unrestricted Access to Sensitive Flows       | Operator scope              | Business-logic abuse is application-specific (documented)                                                       |
| API7  | Server-Side Request Forgery                  | Pass (1 residual)           | All documented cloud-metadata IPs, redirect re-validation, IPv4-mapped IPv6, protocol allowlist; TOCTOU residual (R-2) |
| API8  | Security Misconfiguration                    | Pass                        | Auto secure-headers, refuse-to-boot, CORS `*`+credentials refusal, internal-service preset                     |
| API9  | Improper Inventory Management                | Pass                        | OpenAPI single-source, internal-route hiding                                                                   |
| API10 | Unsafe Consumption of APIs                   | Pass                        | `fetchGuard`, `resilientFetch`, webhook HMAC + replay window                                                   |

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

No other defects were identified across the six red-team waves.

### Verified-secure controls (wave 6 — no defects, locked as regression tests)

A further pass over session, cookie, compression, and multipart handling found
the existing defenses sound; they are now regression-locked in
`tests/red-team-attacks-6.test.ts`:

- **Session fixation / forgery.** A client-supplied session cookie is adopted only when its HMAC signature verifies *and* the id exists in the store; otherwise a fresh id is issued. An attacker cannot plant a chosen id (no secret → no valid signature). `regenerate()` rotates the id on privilege change.
- **Cookie tossing.** The session cookie uses the `__Host-` prefix (host-only, `Path=/`, no `Domain`) plus `HttpOnly` + `Secure` + `SameSite`, so a sibling subdomain cannot inject it.
- **BREACH / CRIME.** `compression()` skips responses with `Set-Cookie`, requests with an `Authorization` header, and requests carrying a session/CSRF/`__Host-`/`__Secure-` cookie — credentialed, per-user bodies are never compressed.
- **Multipart DoS.** Per-file (`maxFileBytes` → `413`) and field/file-count (`maxFields`/`maxFiles` → `400`) caps are enforced when configured, with the always-on `bodyLimitBytes` (1 MiB) as the backstop.

---

## Residual risk register

| ID  | Risk                                                                                                  | Severity | Owner     | Status / mitigation                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------- | -------- | --------- | --------------------------------------------------------------------------------------------------------- |
| R-1 | Routes with no declared response `body` schema get **no** output filtering (API3 protection is opt-in) | Medium   | Developer | **Remediated:** `daloy doctor` `audit.response.bodySchema` finding + dev-mode boot warning + `findRoutesMissingResponseBodySchema()` introspection helper |
| R-2 | `fetchGuard` DNS-rebinding TOCTOU (validate-then-connect re-resolves the hostname)                     | Medium   | Operator  | Documented in `fetch-guard.ts`; mitigate via VPC/firewall egress rules or a pinned-IP `undici` dispatcher  |
| R-3 | `bearerAuth`/`basicAuth` comparison timing-safety lives in the developer's `validate`/`verify` callback | Low      | Developer | Framework ships `timingSafeEqual`; cannot force its use. Documented in the auth middleware TSDoc           |
| R-4 | `timingSafeEqual` is not a hardware constant-time primitive (compares UTF-16 code units)               | Low      | Framework | Documented in TSDoc; for raw bytes use `crypto.timingSafeEqual`                                             |
| R-5 | In-memory rate-limit / autoBan / idempotency / response-cache stores are single-process                | Low      | Operator  | Documented; Redis adapters provided for multi-instance deployments                                         |
| R-6 | `trustProxyHeaders` / `behindProxy` misconfiguration affects IP-based controls (rate/geo/autoBan/bot)  | Low      | Operator  | Fails **closed** by default (`trustProxy: false`); `daloy doctor` flags an unset proxy config in production |
| R-7 | `waf()` is a signature engine: bounded multi-decode (max 2) + comment strip block classic double-encoding / `/**/` splits; triple+ encoding and novel evasions remain | Low | Framework/Developer | Residual by design (unbounded recursive decoding causes false positives). WAF is defense-in-depth; rely on schemas + output escaping. Updated in multi-decode hardening |

---

## Red-team suite inventory

The adversarial suite (`pnpm test:red-team`, gated in CI) contains **127 attacks** across seven files:

- **Wave 1** (`red-team-attacks.test.ts`): prototype pollution, body/header DoS, request smuggling and header injection, JWT, SSRF, open redirect, NoSQL operators, path traversal, constant-time compare, webhook HMAC, CORS, rate limit, CSRF, WAF, content-type, mass assignment, error redaction, secure headers, strong-secret guard, response over-exposure.
- **Wave 2** (`red-team-attacks-2.test.ts`): decompression bombs, signed-value/session integrity, cookie attribute guards, mTLS header spoofing, HTTP message signatures, bearer/basic/scopes/fetch-metadata, WebSocket frame protocol and CSWSH, pagination cursors, idempotency, concurrency, multipart magic-bytes, refuse-to-boot, internal-service preset.
- **Wave 3** (`red-team-attacks-3.test.ts`): bot-guard spoofed-crawler, geo-block allow/deny, IP-reputation denylist, auto-ban strike escalation, auto-ban shared-bucket footgun refusal.
- **Wave 4** (`red-team-attacks-4.test.ts`): nested/array response over-exposure (independent verification of F-1), JWT header key-injection (`jwk`/`jku`/`x5u`/`kid`), uppercase `NONE` bypass attempt, HTTP method-override smuggling, path-confusion `except()` fail-closed, WAF ReDoS bound.
- **Wave 5** (`red-team-attacks-5.test.ts`): cross-tenant cached-response disclosure — idempotency replay isolation (F-2) and response-cache Authorization bypass (F-3), including the same-principal/public happy paths and the explicit opt-in path.
- **Wave 6** (`red-team-attacks-6.test.ts`): defense verification — session fixation/forgery + `regenerate()` rotation, `__Host-` cookie scoping, BREACH-aware compression skips, multipart per-file cap, WAF single- and double-encoding catch (bounded multi-decode).
- **Wave 7** (`red-team-attacks-7.test.ts`): three-front offensive simulation — (R) production docs/OpenAPI hidden, error-response leak-free, forged-JWT privilege-escalation rejected; (C) request-timeout slowloris cutoff, deep-nest stack-bomb rejected fast, wide-JSON hash-flood bounded; (N) prototype-gadget pollutes nothing, no dynamic code-execution primitive on the public surface.

---

## Recommendations / next steps

1. **(Done) R-1 coverage audit.** Surface schema-less `2xx` responses via `daloy doctor` and a dev boot warning so the API3 protection is never silently absent.
2. **Keep the gate green.** `pnpm test:red-team` runs as a dedicated, named CI step; a regression in any advertised guard fails the build with a security-specific label.
3. **Operator checklist for production deploys:** set `behindProxy`/`trustProxy` explicitly, enforce egress firewall rules (mitigates R-2), and use the Redis-backed stores for multi-instance rate-limit/idempotency/auto-ban (R-5).
4. **Re-audit cadence.** Re-run this assessment whenever `src/security.ts`, `src/jwt.ts`, `src/fetch-guard.ts`, `src/jwk.ts`, the serializer in `src/app.ts`, or the auth middleware change.
