# Security Policy

DaloyJS is a backend framework, so security issues are treated as release-blocking work. Please report suspected vulnerabilities privately before opening public issues or pull requests.

---

## Reporting a Vulnerability

Use GitHub's private vulnerability reporting for this repository:

<https://github.com/daloyjs/daloy/security/advisories/new>

If that link is unavailable, open a minimal public issue asking for a private security contact without sharing exploit details.

Please include:

- Affected version or commit.
- Runtime and adapter involved, if any.
- Reproduction steps or a small proof of concept.
- Expected impact and any known mitigations.

The RFC 9116 discovery entry point is [`security.txt`](https://daloyjs.dev/.well-known/security.txt). The maintainer rotation lives in [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md) and is audit-gated quarterly by `pnpm verify:governance-audits`.

## Supported Versions

DaloyJS is currently pre-1.0. Security fixes target the latest published `0.x` release and `main`.

| Version | Supported |
| --- | --- |
| Latest `0.x` | Yes |

## Response Target

- Initial acknowledgement: within 3 business days.
- Triage decision: within 7 business days.
- Fix release: as soon as practical, prioritized ahead of normal roadmap work.

### Patch SLA (NIS2 / EU CRA procurement)

Commitments for the **upstream patch** — a new `@daloyjs/core` / `create-daloy` version on npm with a matching GitHub Security Advisory. Timers start once triage confirms the report is in-scope and reproducible. The consumer's own deploy window is the consumer's responsibility.

| Severity (CVSS v3.1) | Patch released within |
| --- | --- |
| **Critical** (9.0–10.0) | **48 hours** |
| **High** (7.0–8.9) | **7 days** |
| **Medium** (4.0–6.9) | **30 days** |
| **Low** (0.1–3.9) | **90 days** |

When a fix slips the SLA, the GitHub Security Advisory carries a visible `slo-breach: …` note explaining why.

See Aikido's ["Your Client Requires NIS2 Vulnerability Patching. Now What?"](https://www.aikido.dev/blog/your-client-requires-nis2-vulnerability-patching-now-what) for the procurement context.

### Evidence per advisory

Every confirmed vulnerability is published as a [GitHub Security Advisory](https://github.com/daloyjs/daloy/security/advisories) (GHSA) with a CVE requested through GitHub's CNA. Each advisory carries:

1. **Discovered** — date the private report landed (or the first internal PR/commit).
2. **Patch available** — published version + npm publish timestamp, bound to the source commit by the npm `--provenance` Sigstore attestation.
3. **Fix deployed** — for the framework, identical to (2); for the consumer, evidenced by their lockfile diff.

Each advisory also lists the CVSS v3.1 vector, the affected version range, the fixed version, and the `pnpm` / `npm` upgrade command. The CycloneDX 1.5 + SPDX 2.3 SBOM shipped with every tarball is the dependency-inventory of record. The daily [`vuln-scan.yml`](.github/workflows/vuln-scan.yml) (`pnpm audit --prod`) is the upstream continuous-monitoring signal.

---

## EU Cyber Resilience Act (CRA) mapping

Regulation [(EU) 2024/2847](https://eur-lex.europa.eu/eli/reg/2024/2847/oj) (the European Commission's [Cyber Resilience Act policy hub](https://digital-strategy.ec.europa.eu/en/policies/cyber-resilience-act)) places binding cybersecurity obligations on the manufacturer of any "product with digital elements" placed on the EU market. Key deadlines:

- **2026-09-11** — mandatory 24-hour reporting of actively exploited vulnerabilities and severe incidents to ENISA and the national CSIRT (Article 14).
- **2027-12-11** — full conformity with Annex I before a product may bear the CE mark (Article 13).

DaloyJS is free OSS under MIT, so Recital 16 / Article 3(18) exempts non-commercial OSS from "manufacturer" liability — but downstream commercial consumers who integrate the framework into a CE-marked product inherit the Annex I obligations. This section is the evidence pack a downstream conformity assessment can quote. See the [Aikido CRA write-up](https://www.aikido.dev/blog/cyber-resilience-act-compliance) for a plain-language summary.

### Annex I, Part I — essential cybersecurity requirements

| CRA requirement | DaloyJS evidence |
| --- | --- |
| **(1)(a) Delivered without known exploitable vulnerabilities** | `pnpm audit --audit-level=high` in [`ci.yml`](.github/workflows/ci.yml) + pre-publish `verify` in [`release.yml`](.github/workflows/release.yml); daily [`vuln-scan.yml`](.github/workflows/vuln-scan.yml); `@daloyjs/core` declares **zero** runtime dependencies (`pnpm verify:no-runtime-deps`). |
| **(1)(b) Secure-by-default configuration** | Documented in § Threat model. Body cap (1 MiB), `requestTimeoutMs` (30 s), `secureHeaders()`, `fetchGuard()` SSRF defaults, prototype-pollution stripping, real 405, prod 5xx redaction, CRLF/NUL rejection, CORS opt-in. Scaffolded projects inherit `ignore-scripts=true` + `minimum-release-age=1440` in `_npmrc`. |
| **(1)(c) Security updates installable separately from feature updates** | SemVer with patch releases (`0.x.Y`) reserved for security/regression fixes. Patch releases never change OpenAPI surface or route signatures. |
| **(1)(d) Authentication, identity, access management** | First-party `bearerAuth`, `basicAuth`, `jwt()` (`src/jwt.ts` with `kid`-pinned JWKS + optional `isRevoked` hook), signed-cookie `session()`, `timingSafeEqual()`. `pnpm verify:secret-comparisons` refuses short-circuiting comparisons in `src/**`. Middleware runs unconditionally (no internal-header bypass — see Next.js [CVE-2025-29927](https://nvd.nist.gov/vuln/detail/CVE-2025-29927)). |
| **(1)(e) Confidentiality of data in transit** | TLS terminated at the operator's edge; `secureHeaders()` ships HSTS (`max-age=31536000; includeSubDomains`). Secrets processed with `timingSafeEqual()`; the logger's `redactRecord()` masks documented secret-shaped fields. At-rest encryption is below the framework layer. |
| **(1)(f) Integrity of data, configuration, and code** | Standard Schema validation (Zod 4 / Valibot / ArkType / TypeBox) on body / query / params **before** the handler, plus response-body schema on the way out. JSON parser strips `__proto__`/`constructor`/`prototype`. Router rejects `..` / `//`. Webhook HMAC parses only known algorithm prefixes (`sha256=`). Tarballs carry npm `--provenance` Sigstore attestations. |
| **(1)(g) Process only data that is adequate and necessary** | Response schemas validate on the way out. OpenAPI 3.1 lists every documented field. Framework collects no telemetry, no phone-home, no error-reporting endpoint. |
| **(1)(h) Availability + DoS resilience** | Body cap, `requestTimeoutMs`, `maxHeaderCount` (header-count flood / HTTP/2-Bomb guard, `431`), Node `requestTimeout` / `headersTimeout` / `maxHeaderSize` / `maxHeadersCount`, `rateLimit()` with optional Redis store, `loadShedding()`, multipart per-field cap. Network-layer DoS is the operator's CDN/WAF. |
| **(1)(i) Minimize impact on other networks** | `fetchGuard()` default-denies loopback, RFC1918, link-local (cloud metadata IPs), unique-local, CGNAT, Oracle `192.0.0.0/24`, IANA-reserved, multicast, and non-http(s) schemes. Manual redirect follow re-validates each hop; IPv4-mapped IPv6 is recursively re-checked. |
| **(1)(j) Limit attack surfaces** | Tarball ships only `dist/` + `bin/` + `README.md` (`package.json#files`). No template engine, no string-eval, no shell helper, no `child_process` / `vm` / `eval` / `new Function` / remote `import` in `src/**` (`verify:no-remote-exec`); no legacy `Buffer` API (`verify:no-unsafe-buffer`); no in-process JS sandbox with CVEs (`verify:no-vulnerable-sandboxes`). |
| **(1)(k) Reduce impact via exploitation mitigations** | Prod-mode `detail` redaction on 5xx problem+json. Structured JSON logs with request IDs. Reserved `x-daloy-internal-*` header namespace rejected at the boundary. |
| **(1)(l) Record relevant internal activity** | First-party structured logger emits one JSON record per request (method, path, status, duration, request ID). Logging is on by default; operators can substitute pino / bunyan / OpenTelemetry. Request/response bodies are opt-in. |

### Annex I, Part II — vulnerability-handling requirements

| CRA requirement | DaloyJS evidence |
| --- | --- |
| **(2)(1) SBOM in a commonly-used machine-readable format** | Every published tarball includes `dist/sbom.cdx.json` (CycloneDX 1.5) and `dist/sbom.spdx.json` (SPDX 2.3) — generated by [`scripts/generate-sbom.ts`](scripts/generate-sbom.ts), locked by `pnpm verify:sbom`. |
| **(2)(2) Address vulnerabilities without delay; separate security updates** | CVSS-keyed Patch SLA above. Patch releases (`0.x.Y`) ship security fixes independently of minor / major releases. |
| **(2)(3) Effective and regular testing** | Full test + coverage on Node 22 / 24 / 26, Bun, Deno on every push/PR. `pnpm coverage` enforces 90% lines/functions on tsx and 90% branches on compiled JS. The full `verify:*` family runs in `ci.yml` and both publish jobs of `release.yml`. Weekly DAST job ([`dast.yml`](.github/workflows/dast.yml)) runs OWASP ZAP baseline against the bookstore example. |
| **(2)(4) Public disclosure of fixed vulnerabilities** | GHSAs with CVSS v3.1 vector, affected range, fixed version, and upgrade command — see § Evidence per advisory. |
| **(2)(5) Coordinated disclosure policy** | This file. Entry point is [`security.txt`](https://daloyjs.dev/.well-known/security.txt). Rotation in [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md), tested quarterly. |
| **(2)(6) Facilitate information sharing about vulnerabilities** | Private-disclosure form accepts third-party reports about transitive deps. The published SBOM lets reporters identify the exact dep chain. |
| **(2)(7) Securely distribute updates** | npm over HTTPS + npm `--provenance` Sigstore attestation bound to the `release.yml` workflow run on the Rekor transparency log. Dependabot / Renovate / `pnpm update --latest` deliver patches; the framework does not auto-update at runtime. |
| **(2)(8) Updates free of charge with advisory messages** | All updates are MIT-licensed and free. GHSA carries the advisory message. |

### Article 14 — 24-hour reporting

From 2026-09-11, manufacturers must notify ENISA and the national CSIRT within 24 hours of becoming aware of an actively exploited vulnerability or severe incident. For DaloyJS:

1. Confirmed report lands in the private-disclosure inbox.
2. Rotation triages within 3 business days for routine cases; for **actively exploited** reports, triage SLA collapses to best-effort within 24 h.
3. Once active exploitation is confirmed, the maintainer files an early-warning notification via the [ENISA Single Reporting Platform](https://www.enisa.europa.eu/topics/cra) within the 24-hour window.
4. Follow-up within 72 hours adds CVSS, scope of impact, and planned remediation per the Patch SLA.
5. GHSA and ENISA notification ID are cross-linked.

This is the maintainer's upstream commitment. Downstream commercial consumers remain responsible for Article 14 notifications about *their* product.

### Support lifetime

CRA Article 13(8) requires a "support period" reflecting expected product lifetime, with **5 years** as the regulatory floor for most consumer products.

DaloyJS commits to a **minimum 5-year security-update support period** for every major release line starting with `1.0`, measured from that line's first GA release. The current `0.x` line is security-supported on the latest minor until `1.0` ships; the 5-year clock starts at `1.0` and resets on every subsequent major. End-of-support dates will be published here and on [`/docs/security/compliance`](https://daloyjs.dev/docs/security/compliance) once `1.0` lands.

---

## Scope

Security reports are especially useful for:

- Request parsing, body limits, content-type bypasses.
- Prototype pollution, unsafe JSON.
- Header injection, response splitting.
- Path traversal, router confusion.
- Authentication, timing, CORS, rate limit, secure-header middleware.
- Adapter-specific behavior changing security guarantees across runtimes.

Please do not run destructive tests against systems you do not own.

---

## Threat model

DaloyJS is designed for the threat model of an **internet-facing HTTP API on a trusted runtime** (Node, Bun, Deno, or a managed serverless edge). The framework assumes the runtime is not actively malicious; the network and every HTTP client (browser, mobile, CLI, attacker) are untrusted.

### Trust boundaries

```
[ Untrusted client ] --HTTPS--> [ Trusted reverse proxy / edge ]
          |
          v
        [ DaloyJS App.fetch ]   <- request/header sanitization,
          |                       body-size cap, timeouts, problem+json
          v
        [ User handlers ]
          |
          v
        [ Trusted data store ]   <- caller's responsibility
```

### In scope: request-path classes the framework defends

Each subsection names the class, a one-line description, the framework primitive that defends it, and where the regression tests live.

#### Body-size DoS + structural DoS
Streamed body read with hard cap (default 1 MiB); `Content-Length` rejected pre-read when oversize. Core-enforced.

In addition, `jsonMaxKeys` (default 10 000 total object keys across the parsed tree) and `jsonMaxDepth` (default 50) bound "hash flood" wide objects and deeply nested structures even when they fit inside the byte limit. `safeJsonParseLimited` enforces both with a single allocation-free pre-parse scan of the raw text (object keys counted via structural `:` delimiters, depth via `{`/`[` balance), so an oversized structure is rejected in bounded time **before** it is parsed into memory. Applied to JSON bodies, MCP envelopes, CSP reports, and pagination cursors. Can be raised per `App()` or disabled (0). See `getSecurityPosture()`.

#### Prototype pollution via JSON
`safeJsonParse` (and the limited variant) strips `__proto__` / `constructor` / `prototype` via reviver on every parsed body. JWT verification applies the same reviver to header + payload so polluted keys cannot ride into user code via `Object.assign` / spread on the returned claims. See [Aikido's write-up](https://www.aikido.dev/blog/prevent-prototype-pollution).

#### Parameter-binding RCE (Spring4Shell-class)
The three non-JSON parsers in [`src/app.ts`](src/app.ts) (`queryToObject`, urlencoded, multipart) funnel keys through `isForbiddenObjectKey` and drop `__proto__` / `constructor` / `prototype` before assignment. Tested in [`tests/security.test.ts`](tests/security.test.ts).

#### Header / response splitting
Core `sanitizeHeaderName` / `sanitizeHeaderValue` reject CRLF + NUL.

#### HTTP request smuggling / desync
Core rejects duplicate singleton framing headers (`Host`, `Content-Length`, `Transfer-Encoding`) before user hooks run. Regression in [`tests/logger-redaction-and-header-smuggling.test.ts`](tests/logger-redaction-and-header-smuggling.test.ts).

#### Path traversal
Router rejects `..` and `//` before walking.

#### Auth/router path-matching mismatch
Router is case-sensitive, performs no URL rewrites. The `except()` matcher consumes the same `url.pathname` the router sees (no double-decode, no case folding). Regression against Qinglong [CVE-2026-3965 / CVE-2026-4047](https://snyk.io/blog/qinglong-task-scheduler-rce-vulnerabilities/) in [`tests/path-auth-bypass-regression.test.ts`](tests/path-auth-bypass-regression.test.ts).

#### Internal-header middleware bypass (Next.js [CVE-2025-29927](https://nvd.nist.gov/vuln/detail/CVE-2025-29927) class)
`dispatch()` runs `onRequest` / `beforeHandle` / route middleware **unconditionally**. The `internal: true` route flag is code-only (reachable via `app.inject()`, returns 404 via `app.fetch()`). The framework reserves the `x-daloy-internal-*` / `x-daloyjs-internal-*` namespace and rejects any request that carries one with 400 problem+json. Regression in [`tests/reserved-internal-headers.test.ts`](tests/reserved-internal-headers.test.ts).

#### Method confusion
Real **405** with `Allow` header.

#### Slow handlers / runaway loops
`requestTimeoutMs` aborts handlers (30 s default); Node adapter sets `requestTimeout` + `headersTimeout` + `maxHeaderSize`.

#### HTTP/2 Rapid Reset DDoS ([CVE-2023-44487](https://nvd.nist.gov/vuln/detail/CVE-2023-44487))
Not exploitable against `@daloyjs/core`: the framework never speaks HTTP/2 at its layer. The Node adapter uses `node:http` (HTTP/1.1) only; Bun/Deno adapters delegate to runtimes that shipped the upstream mitigation. `engines.node` is pinned `>=24.0.0` and `pnpm verify:runtime-eol` refuses EOL Node majors. Network-layer DDoS absorption is the operator's CDN/WAF.

#### HTTP/2 Bomb — HPACK header-count amplification ([Calif, 2026](https://blog.calif.io/p/codex-discovered-a-hidden-http2-bomb))
The "HTTP/2 Bomb" amplifies through **per-header server-side bookkeeping** (header *count*), not header *size*, then pins the allocation open with a Slowloris-style zero-byte flow-control window — so the classic "cap total decoded header bytes" defense never fires. The vulnerable layer is the **HTTP/2 + HPACK decoder** in the runtime/proxy (NGINX, Apache, IIS, Envoy, Cloudflare, or `node:http2`), not the framework's web-standard request pipeline. Two layers of defence:

- **Application tier (portable, every runtime):** `maxHeaderCount` (default **100**) rejects any request carrying more than that many distinct header fields with `431 Request Header Fields Too Large` before routing. The Node adapter additionally sets `server.maxHeadersCount` (default **100**) so a flood is dropped by the HTTP parser before it becomes a `Request`. `daloy doctor` warns when the cap is disabled or raised above 1000.
- **Runtime / proxy tier (operator):** when something upstream terminates HTTP/2, apply the vendor fix — **NGINX ≥ 1.29.8** (`max_headers`, default 1000) or `http2 off;`; **Apache `mod_http2` ≥ 2.0.41** or `Protocols http/1.1`; edge platforms (Cloudflare, Vercel) mitigate at their tier. The framework's count cap is defence-in-depth; it cannot undo native HPACK session-memory pinning that happens before the request reaches the runtime.

#### ReDoS — catastrophic backtracking
Four layers: (a) no user-supplied regex meets user-supplied input in core; the only `new RegExp(...)` is in [`src/combine.ts`](src/combine.ts) and translates `*` / `**` linearly. (b) Input is bounded by `bodyLimitBytes`. (c) `requestTimeoutMs` is a wall-clock backstop. (d) `pnpm verify:no-redos-patterns` walks `src/**`, extracts every regex literal (slash + `new RegExp("…")`), and refuses nested unbounded quantifiers or overlapping alternation under unbounded quantifier. Opt-in `// daloy-allow-redos: <reason>` marker. See [Snyk's write-up](https://snyk.io/blog/timing-out-synchronous-functions-with-regex/). For user-supplied regex, use [RE2](https://github.com/google/re2) or `vm.runInContext({ timeout })`.

#### 5xx info disclosure
Production mode strips `detail` from 5xx problem+json automatically.

#### CRLF in user-controlled headers
All built-in middleware emitting headers from config (`basicAuth` realm, `csrf` cookie name, etc.) reject CRLF at construction time.

#### Log injection via attacker-controlled strings
`createLogger` is the article's three recommendations by default ([Snyk write-up](https://snyk.io/blog/prevent-log-injection-vulnerability-javascript-node-js/)): structured JSON output (`JSON.stringify` escapes every control byte U+0000..U+001F including CR/LF/NUL/ESC), key-based redaction (`DEFAULT_REDACT_KEYS`, JWT-shaped strings, opaque provider tokens), and a logging library instead of `console.log`. Regression in [`tests/logger-redaction-and-header-smuggling.test.ts`](tests/logger-redaction-and-header-smuggling.test.ts). Apps that pipe raw user input directly to `console.log` opt out of this defense.

#### Credential timing attacks
`timingSafeEqual()` plus `basicAuth()` verifier hooks for constant-time checks. `pnpm verify:secret-comparisons` rejects `===`, `!==`, `==`, `!=`, `.startsWith()`, `.endsWith()`, `.includes()`, `.indexOf()`, `.localeCompare()` against any header-derived value in `src/`. See [Snyk's Node.js timing-attack write-up](https://snyk.io/blog/node-js-timing-attack-ccc-ctf/).

#### Cross-origin forgery (CSRF)
`csrf()` ships two strategies: double-submit cookie (default) and Fetch-Metadata (`Sec-Fetch-Site`-based, tokenless). See [docs](https://daloyjs.dev/docs/security/csrf).

#### Cross-Site WebSocket Hijacking (CSWSH)
`app.ws()` refuses-at-registration in production unless `allowedOrigins` is set (`"same-origin"`, allowlist, or predicate) or `acknowledgeCrossOriginUpgrade: true`. The Origin check runs **before** `beforeUpgrade`. Closes the Storybook [CVE-2026-27148](https://www.aikido.dev/blog/storybooks-websockets-attack) class.

#### Scripted carding / card-testing
Three primitives close the script-driven half end-to-end:
- `csrf({ strategy: "fetch-metadata" })` rejects server-side bots without `Sec-Fetch-Site` and falls back to an Origin/Referer allowlist.
- `rateLimit({ key, windowMs, max })` per-IP / per-account / per-card-bin caps the velocity carding kits need.
- `loadShedding()` caps concurrent in-flight checkout work.

CAPTCHA, ML fraud scoring, PSP-specific velocity rules, and AVS heuristics are the application's responsibility. See the Socket [`disgrasya` write-up](https://socket.dev/blog/malicious-pypi-package-targets-woocommerce-stores-with-automated-carding-attacks) and [WooCommerce's prevention guide](https://woocommerce.com/document/woopayments/fraud-and-disputes/card-testing/).

#### Clickjacking / MIME sniffing / cross-origin leakage
`secureHeaders()` ships CSP nonce + Trusted Types, HSTS, COOP, CORP, `X-Frame-Options`, `X-Content-Type-Options`, Permissions-Policy.

#### ClickFix social-engineering (clipboard-stuffing)
The Ghost CMS [CVE-2026-26980](https://nvd.nist.gov/vuln/detail/CVE-2026-26980) campaign (May 2026, 700+ domains including Harvard, Oxford, DuckDuckGo) chained pre-auth SQLi → stolen admin API keys → injected `<script>` that overlaid a fake Cloudflare "verify you are human" iframe and silently called `navigator.clipboard.writeText()` to stuff a PowerShell one-liner into the victim's clipboard. `secureHeaders()` now ships `clipboard-write=()` in the default Permissions-Policy so a Daloy-served HTML surface refuses the clipboard write at the browser layer even if attacker JS slips past CSP. Override `permissionsPolicy:` if your page legitimately needs "Copy" buttons.

#### Malicious image uploads / ImageTragick ([CVE-2016-3714](https://www.cve.org/CVERecord?id=CVE-2016-3714)) class
`fileField()` validates magic bytes against declared MIME and, when `magicBytes` is enabled, refuses scriptable image formats (SVG, MVG, MSL, PostScript, EPS) by default. Opt back in with `rejectScriptableImages: false` only when the renderer is sandboxed. See [Snyk's ImageMagick write-up](https://snyk.io/blog/safe-imagemagick-for-node/).

#### Uninitialized-memory leaks via legacy `Buffer` API
`pnpm verify:no-unsafe-buffer` refuses `new Buffer(...)` and `Buffer.allocUnsafe*(...)` in `src/`. Adapter and binary paths use `Uint8Array` or `Buffer.alloc(size)`. See [Snyk's write-up](https://snyk.io/blog/exploiting-buffer/).

#### Weak cryptographic randomness (`Math.random()` for tokens)
`pnpm verify:no-weak-random` refuses `Math.random()` in `src/**` without an inline `// daloy-allow-weak-random: <reason>` marker. `randomId()` in [`src/security.ts`](src/security.ts) prefers `crypto.randomUUID()` and falls back to `crypto.getRandomValues()`. Combined with `verify:secret-comparisons` and the `timingSafeEqual()` / `hashing.ts` (scrypt) primitives.

#### Known-vulnerable in-process JavaScript sandboxes
`vm2` sandbox-escape class ([CVE-2026-26956](https://github.com/patriksimek/vm2/security/advisories/GHSA-ffh4-j6h5-pg66), [Socket](https://socket.dev/blog/free-certified-patches-for-critical-vm2-sandbox-escape)): `pnpm verify:no-vulnerable-sandboxes` refuses `vm2`, `vm2-sandbox-escape`, `safe-eval`, `notevil`, `static-eval`, `eval-sandbox` as direct deps or in the lockfile. For untrusted code use real isolation (separate process, container, fresh `isolated-vm` isolate).

#### Trusted-proxy header spoofing
`rateLimit({ trustProxyHeaders })` and `requestId({ trustIncoming })` default OFF. Key generators must be explicit.

#### Server-side template injection (SSTI)
Core ships **no** template engine and **no** string-eval rendering. The only HTML emitted by core is the optional API-docs page; values are HTML-escaped in [`src/docs.ts`](src/docs.ts) and tested against `<script>` / quote-break payloads in [`tests/docs-logger-adapters.test.ts`](tests/docs-logger-adapters.test.ts). The Thymeleaf / [CVE-2026-40478](https://snyk.io/blog/thymeleaf-injection/) class requires a template engine; that surface does not exist in core.

#### Log4Shell-class expression injection
Requires both an expanding logger (`${jndi:…}`) and a runtime classloader. Neither exists in core. `createLogger` is a pure JSON sink — no `util.format`, no template compiler, no JNDI/env/sys lookup, no string-eval over message or field values. An attacker-planted `${jndi:ldap://…}` in `User-Agent` that user code logs is serialized verbatim. `verify:no-remote-exec` ensures there is no equivalent of Java's network classloader anywhere in `src/**`. Tested in [`tests/logger-redaction-and-header-smuggling.test.ts`](tests/logger-redaction-and-header-smuggling.test.ts).

#### OWASP API Security Top 10 (2023)
DaloyJS ships first-party middleware for the surface the "API security tools" market bolts on at runtime. See the [docs page](website/app/docs/security/owasp-api-top-10/page.tsx) for the per-item mapping. Headlines:

- **API1 BOLA / API3 BOPLA / API5 Function-level auth** — typed `params` from the request schema, explicit `beforeHandle` per route, response-body schemas validate on the way out.
- **API2 Broken Authentication** — `bearerAuth`, `basicAuth`, `jwt()`, signed-cookie `session()`, `timingSafeEqual()`. Production-mode `csrf({ strategy: "fetch-metadata" })`.
- **API4 Unrestricted Resource Consumption** — body cap, request timeout, `rateLimit()` + Redis store, `loadShedding()`, response `compression()`, multipart per-field cap.
- **API6 Sensitive Business Flows** — `rateLimit({ key })` per-account / per-card-bin + Fetch-Metadata `csrf()`.
- **API7 SSRF** — `fetchGuard()`. See the SSRF entries below.
- **API8 Misconfiguration** — `secureHeaders()`, CORS opt-in, prod 5xx redaction, default body cap + timeout, hardened `.npmrc`.
- **API9 Improper Inventory** — OpenAPI 3.1 from the same `app.route({...})`; `pnpm gen` emits Hey API; `app.introspect()` is public.
- **API10 Unsafe API Consumption** — outbound calls through `fetchGuard()`; JWT verifier applies the prototype-pollution reviver to attacker-controlled claims.

### In scope: outbound request classes (SSRF)

#### Cloud metadata SSRF (Capital One 2019, Pandoc [CVE-2025-51591](https://www.aikido.dev/blog/top-cloud-security-vulnerabilities))
`fetchGuard()` default-denies AWS/Azure/DO `169.254.169.254`, GCP `metadata.google.internal`, Alibaba `100.100.100.200`, Oracle `192.0.0.192`, loopback, RFC1918, link-local, unique-local, CGNAT, IANA-reserved, multicast, and non-http(s) schemes. Redirects follow manually with re-validation at every hop; IPv4-mapped IPv6 is recursively re-checked. Regression in [`tests/fetch-guard.test.ts`](tests/fetch-guard.test.ts). IMDSv2-only is still required on the underlying compute (operator concern).

### Red-team verification (adversarial test suite)

The in-scope classes above are not merely asserted by unit tests — they are continuously **attacked**. A ten-wave red-team suite plays the external assessor against the framework inside the test harness, organized around the [Doyensec Web Application & API methodology](https://www.doyensec.com/services/web-applications-and-apis.html) (the OWASP WSTG categories Doyensec co-authors). In every wave the **secure outcome is the passing outcome**, so a regression that re-opens a defense turns the suite red. Run the waves on their own with `pnpm test:red-team` — wired as a dedicated gate in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

| Wave | Focus | File |
|------|-------|------|
| 1 | Core controls — prototype pollution, DoS, smuggling, JWT, SSRF, open-redirect, NoSQL, WAF, CSRF, response over-exposure | [`red-team-attacks.test.ts`](tests/red-team-attacks.test.ts) |
| 2 | Decompression bombs, session/cookie integrity, mTLS spoofing, HTTP Message Signatures, scopes, WebSocket protocol, idempotency replay | [`red-team-attacks-2.test.ts`](tests/red-team-attacks-2.test.ts) |
| 3 | Access control — spoofed crawlers (bot-guard), geo-block, IP reputation, auto-ban | [`red-team-attacks-3.test.ts`](tests/red-team-attacks-3.test.ts) |
| 4 | Auditor-grade cross-control logic — nested response stripping, JWT `jwk`/`jku` key-injection, method-override, path-confusion, ReDoS bounds | [`red-team-attacks-4.test.ts`](tests/red-team-attacks-4.test.ts) |
| 5 | Cross-tenant cached-response disclosure (CWE-524) — idempotency + response-cache namespacing | [`red-team-attacks-5.test.ts`](tests/red-team-attacks-5.test.ts) |
| 6 | Session fixation / cookie-tossing, BREACH, multipart DoS, single-encoded WAF decoding | [`red-team-attacks-6.test.ts`](tests/red-team-attacks-6.test.ts) |
| 7 | Three-front offensive simulation — exfiltration, denial of service, RCE / persistence | [`red-team-attacks-7.test.ts`](tests/red-team-attacks-7.test.ts) |
| 8 | OWASP WSTG pass — docs XSS, HTTP Parameter Pollution, verb tampering / Cross-Site Tracing, CORS origin matching | [`red-team-attacks-8.test.ts`](tests/red-team-attacks-8.test.ts) |
| 9 | Doyensec live-service pass — framework fingerprinting, account enumeration, id entropy, session puzzling, XXE impossibility, log injection, clickjacking/HSTS, Host-header injection, CORS preflight disclosure | [`red-team-attacks-9.test.ts`](tests/red-team-attacks-9.test.ts) |
| 10 | Deep-dive campaigns — WAF multi-encoding evasion + the typed-contract backstop, JWT algorithm matrix, constant-time comparison timing analysis | [`red-team-attacks-10.test.ts`](tests/red-team-attacks-10.test.ts) |

Waves 9–10 also record the framework's honest limitations rather than papering over them: the conservative signature WAF is evadable by double-encoding and comment-split keywords (the typed schema contract is the real backstop — see § Out of scope, "Insecure handler code"), and the XXE / SOAP / WSDL family is **structurally inapplicable** because the framework speaks JSON only and rejects every non-JSON content type with `415`, leaving no XML parser to attack.

### Live black-box engagement (over-the-wire, not in-process)

The waves above exercise the framework through its in-memory dispatch
(`app.request()`). [`red-team-live/`](red-team-live) goes one level further: it
boots a **real server on a real TCP port** via the Node adapter's `serve()`,
then attacks it from a **separate attacker process** the way a bug-bounty hunter
would — `fetch()` over the wire for application-layer attacks and raw `net`
sockets for the wire-level classes the in-memory path can never model (request
smuggling, slowloris, header floods, malformed framing, the WebSocket upgrade
handshake). Because the target is its own process, a crash surfaces as
connection-refused — a real DoS finding — instead of taking the harness down.
Run it with `pnpm red-team:live`; it exits non-zero on any `VULNERABLE` finding.
The current engagement fires **60 probes** and the framework holds every one.

This is the layer that found and closed the one real defect of the campaign:
the Node adapter set `headersTimeout`/`requestTimeout` from `connectionTimeoutMs`
but left Node's `connectionsCheckingInterval` at its 30 s default, so a slowloris
survived far past the configured timeout. Fixed in
[`src/adapters/node.ts`](src/adapters/node.ts) (regression tests in
[`tests/node-adapter.test.ts`](tests/node-adapter.test.ts)).

**Coverage split — what is proven live vs. in-process.** Every in-scope class
that is reachable black-box over a socket is fired live; the remainder is
verified in-process because it has no HTTP surface to attack:

| Verified live over the wire (`red-team-live/`) | Verified in-process (no socket surface) |
|---|---|
| Auth bypass, JWT forgery (`alg:none` / bad-sig / scope escalation), privilege escalation, credential brute force | JWT expiry / `nbf` / issuer-audience / tampered-payload rejection (forging a *validly signed* token needs the server secret) |
| SSRF (metadata / loopback / private / `file:`), open redirect | `timingSafeEqual`, signed-value / HMAC primitives, WebSocket frame parse/encode, pagination cursor decode (pure library functions) |
| Injection (SQLi / XSS / cmdi / NoSQL), WAF, CSRF, CORS (simple + preflight) | Refuse-to-boot guards, weak-secret rejection, cookie-attribute asserts (throw at construction) |
| Prototype pollution, mass assignment, response over-exposure (API3) | Nested/array response-stripping depth, WAF multi-encoding evasion nuance |
| Smuggling (dup `CL`, `TE`+`CL`), reserved-internal-header, CRLF splitting, TRACE/XST | Docs-HTML XSS escaping (`scalarHtml` / `redocHtml`) |
| Header floods, oversized body, **slowloris**, rapid-connect/reset churn | HTTP Message Signatures verify, secret-rotation arrays |
| Method-override, HPP, content-type confusion, stack-bomb / hash-flood JSON | |
| Decompression bombs, idempotency replay + cross-tenant, concurrency shedding | |
| bot-guard / geo-block / auto-ban, basic-auth enumeration, spoofed mTLS (XFCC) | |
| CSWSH handshake, multipart magic-byte / size abuse, `except()` path-confusion | |
| Request-id entropy, clickjacking / HSTS posture, framework fingerprinting | |

Two findings during the live run were **false positives from the test target,
not the framework** — and both were a secure default catching sloppy app code:
returning an undeclared status code (caught by the response-contract guard,
OWASP API9) and trusting `X-Forwarded-For` in production without declaring a
proxy (refused by default; the IP-based middleware fail *closed* rather than
trust a spoofable header). Documented residual limitations (the DNS-rebinding
TOCTOU window in `fetchGuard`, requiring an operator egress firewall or a pinned
dispatcher) are spelled out at their source rather than hidden.

### Out of scope (the framework will NOT defend)

- **Network-layer DoS** (SYN floods, amplification). Place DaloyJS behind a reverse proxy / WAF / DDoS service.
- **Insecure handler code.** SQL string concatenation, secrets in error messages, unvalidated input to OS shell.
- **Integrated template engines.** If you add `ejs` / `handlebars` / `pug` / `nunjucks`, you own the SSTI surface.
- **Credential storage and rotation.** Use `jose` / `argon2` / a dedicated IdP. The framework provides `bearerAuth`, `basicAuth`, signed-cookie `session`, and `jwt`/`jwk` helpers.
- **TLS termination.** Run behind HTTPS; the Node adapter speaks plain HTTP.
- **Runtime compromise.** If the Node/Bun/Deno binary or the host is compromised, no framework can help.

### AI-accelerated attackers

LLMs and agentic tooling find subtle variants faster than humans. DaloyJS does not treat "AI on the other end" as a separate threat class — the same bug classes still get exploited. Our response is to shrink the surface and make defaults default-deny rather than to bolt on an "AI WAF":

- **No string-eval, no template engine, no shell helper in core.** SSTI and Thymeleaf-class bugs have no surface to land on.
- **Default-deny request path.** Body cap, header CRLF/NUL rejection, path-traversal rejection, real 405, per-handler timeout — all run in core before user code.
- **Constant-time secret handling, enforced by CI.** `timingSafeEqual()` plus `pnpm verify:secret-comparisons`.
- **Auth/router parity.** `except()` consumes the same `url.pathname` the router sees (Qinglong CVE class).
- **CSWSH blocked at registration.** `app.ws()` refuses-at-registration unless an origin policy is set.
- **Magic-byte file validation rejects scriptable images.**
- **No legacy `Buffer` API.** No uninitialized-memory leaks via response.
- **Webhook signature parsing is prefix-locked.** Padded-base64 signatures are not truncated into forged matches.
- **Supply chain treated as part of the request path.** See § Supply-chain security.
- **Documented operator boundary.** § Out of scope says what core does not defend.

### AI-assisted developers (Cursor / Copilot / Claude Code / Devin)

The mirror threat: an LLM IDE writes the code that ends up in production. Aikido x Windsurf's [joint write-up](https://www.aikido.dev/blog/security-ai-development-windsurf-aikido) catalogs the failure modes. The framework's posture:

- **Committed `.env` / private keys** — three-layer `verify:no-leaked-credentials` (filename + content gate at publish), daily `gitleaks` workflow, scaffolded `_gitignore` excludes `.env`.
- **Route reaches production without auth** — auth is **always explicit** via `beforeHandle`. `app.introspect()` and the OpenAPI spec list every route's `security` annotation. `except()` consumes the same pathname the router sees.
- **AI suggests raw SQL / shell / weak validation** — input validation is contract-first (Standard Schema before the handler). `pnpm verify:no-remote-exec` refuses `child_process` / `vm` / `eval` / `new Function` / remote `import` in core itself. Raw SQL in user handlers is the app's responsibility; docs point at parameterized queries.
- **AI pulls a vulnerable / typosquatted package** — `@daloyjs/core` has zero runtime deps. Across the repo: `ignore-scripts=true`, `minimum-release-age=1440`, `frozen-lockfile=true`, `verify-store-integrity=true`, `verify:lockfile-sources`, `verify:known-dep-names`, daily `vuln-scan.yml`.
- **AI Dockerfile / IaC exposes broad network access** — `create-daloy` does not scaffold IaC; if added later, the scaffolded `container-scan.yml` catches misconfigurations via Trivy on every PR.
- **AI weakens a built-in primitive** — caught by CODEOWNERS on sensitive paths + `verify:parity-audits` / `verify:governance-audits` / `verify:runtime-parity-audits` / `verify:routing-hardening-audits`.

What the framework **cannot** stop: an application author accepting an AI-suggested change that returns a password hash in a `GET`, hard-codes a production API key in an env-var default, or wires an LLM prompt to unvalidated input. Pair Daloy with an external SAST/SCA service (Aikido, Snyk, Socket, GitHub Advanced Security).

### Hardening roadmap (tracked, not yet shipped)

Items kept here briefly when shipped so the history remains auditable.

- **First-party JWT verification** with mandatory `alg` allowlist and first-party JWKS. **(shipped)**
- **Auto-shedding under pressure** (event-loop lag, RSS, heap) returning 503. Exposed as `loadShedding()`. **(shipped)**
- **CycloneDX 1.5 + SPDX 2.3 SBOM** in every tarball. **(shipped 0.34.0)**
- **First-party WebAuthn / passkeys** via a thin wrapper over a vetted library. *(tracked)*
- **Per-route capability-based body limits** derived from the route schema. *(tracked)*
- **SLSA build-level-3 attestations** beyond the existing npm provenance. *(tracked)*
- **Registry-signature verification for the pnpm lockfile.** *(tracked — blocked on a pnpm-native verifier; npm's `npm audit signatures` expects an npm lockfile and re-resolves a divergent graph.)*
- **Continuous fuzzing** of the untrusted-input parsers (JSON gate, cookie/header sanitizers, pagination cursor, cron, IP) via Jazzer.js, wired through [ClusterFuzzLite](https://google.github.io/clusterfuzzlite/) ([`.clusterfuzzlite/`](.clusterfuzzlite/)): a per-PR `code-change` run on `src/` changes plus a daily batch run. **(shipped)**
- **Third-party audit** once the API stabilizes around `1.0`. *(tracked)*
- **Public bug bounty** through huntr.dev (or equivalent) after the audit. *(tracked)*

---

## Supply-chain security (how DaloyJS is built and published)

We treat the package supply chain as an attack surface. Most controls below were designed against patterns documented in [`otherdocs/security-incidence.md`](otherdocs/security-incidence.md), most recently the TanStack 2026-05-11 worm ([postmortem](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem)) and the chalk/debug/node-ipc phishing campaigns.

### CI/CD

- **No `pull_request_target` anywhere.** Fork PRs run with the default `pull_request` trigger and have no access to repo secrets, GHA cache scope shared with `main`, or any publish-capable token.
- **Top-level `permissions: {}`** in every workflow; jobs opt in to the minimum scopes.
- **`actions/checkout` with `persist-credentials: false`.**
- **Third-party Actions are SHA-pinned.** `pnpm verify:actions-pinned` ([`scripts/verify-actions-pinned.ts`](scripts/verify-actions-pinned.ts)) refuses any `uses:` that is not a 40-char lowercase hex commit SHA, that interpolates `${{ … }}`, or that references a known-compromised action (`tj-actions/changed-files` per [CVE-2025-30066](https://nvd.nist.gov/vuln/detail/CVE-2025-30066), `reviewdog/action-setup` per CVE-2025-30154; see Socket's [tj-actions write-up](https://socket.dev/blog/github-actions-supply-chain-attack-puts-thousands-of-projects-at-risk)).
- **`step-security/harden-runner`** monitors and (on publish) blocks egress to anything other than the npm registry, GitHub, and Sigstore.
- **No GHA cache** in CI. Cache scope is shared between fork PRs and `main` — the bridge the TanStack 2026-05-11 worm used.
- **`zizmor`** statically analyses every workflow on every PR.
- **CodeQL** runs JS/TS and `actions` queries.
- **Opengrep** runs a second SAST engine (Aikido's LGPL-2.1 fork of Semgrep) with `p/security-audit`, `p/owasp-top-ten`, `p/cwe-top-25`, `p/javascript`, `p/typescript`, `p/nodejs`, `p/secrets`. Binary is verified with cosign keyless against `opengrep/opengrep`. See ["Launching Opengrep"](https://www.aikido.dev/blog/launching-opengrep-why-we-forked-semgrep).
- **ClusterFuzzLite** continuously fuzzes the untrusted-input parsers (JSON gate, cookie/header sanitizers, pagination cursor, cron, IP) with Jazzer.js: a per-PR `code-change` run on `src/` changes plus a daily batch run. Each target asserts the parser's documented contract, so a declared rejection is fine but any other throw or hang is a finding. Targets live in [`.clusterfuzzlite/`](.clusterfuzzlite/).
- **OpenSSF Scorecard** publishes continuously.
- **Daily SCA** runs `pnpm audit --prod` against the committed lockfile (cadence required by SOC 2 CC7.1; see Aikido's [SOC 2 automation guide](https://www.aikido.dev/blog/a-guide-to-automating-technical-vulnerability-management-for-soc-2)).
- **`gitleaks` secret scan** on every PR/push plus a daily full-history sweep. Binary verified by SHA-256.
- **OSV-Scanner** queries [OSV.dev](https://osv.dev/) + the OpenSSF [`malicious-packages`](https://github.com/ossf/malicious-packages) corpus, providing a second independent SCA feed.
- **Dependabot** weekly for npm + GitHub Actions.
- **`CODEOWNERS`** requires maintainer approval for `.github/`, `package.json`, the lockfile, `.npmrc`, and sensitive `src/` paths.

### npm publishing

- **Triggered only by a signed `v*` tag push or maintainer dispatch.** Never from a PR, branch, or shared fork runner.
- **`id-token: write` granted only on the publish job**, only after the protected `npm-publish` GitHub Environment requires explicit maintainer approval. No long-lived `NPM_TOKEN` anywhere.
- **CI stages; npm MFA approves.** The workflow uses `npm stage publish` rather than direct `npm publish`. The version is not installable until a maintainer runs `npm stage approve <stage-id>` (or approves on npmjs.com) with MFA. The tarball still comes from `release.yml`; the registry approval only promotes it.
- **Trusted Publisher must allow staging.** Each npm package must allow `npm stage publish` for repository `daloyjs/daloy`, workflow `release.yml`, environment `npm-publish`. Old "publish-only" configs fail with `OIDC permission denied for this action`.
- **`--provenance`** on every staged publish (Sigstore + OIDC bound to source commit + workflow run on Rekor).
- **Tag/version match verified** before `npm stage publish` runs.
- **No third-party install scripts run.** Install uses `--ignore-scripts`; required builders are allowlisted in `allowBuilds` in [`pnpm-workspace.yaml`](pnpm-workspace.yaml).
- **`@daloyjs/core` and `create-daloy` ship together.** A signed `v*` tag stages both; follow-up `workflow_dispatch` can narrow scope.

### Maintainer accounts

- **Hardware-backed 2FA mandatory** on npm and GitHub for every account with write access to the repo and every npm account with publish rights to `@daloyjs/core` or `create-daloy`. SMS factors are not permitted.
- **Active rotation** lives in [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md). The pre-publish `verify` job refuses to publish unless `github.actor` is in the `<!-- BEGIN ACTIVE -->` block.
- **Quarterly disclosure exercise** re-verifies the private-disclosure inbox, the active rotation, the `npm-publish` Environment reviewers, and that every active contact's account-recovery-email domain still resolves to a domain they control. A lapsed-domain finding blocks the next publish.

### CI/CD platform compromise

If GitHub Actions itself is breached at the platform level, the worst-case exposure for a Daloy release is: an attacker who has bypassed `harden-runner`'s egress block AND the `npm-publish` Environment approval AND GitHub's OIDC issuer would still produce a tarball carrying a valid Sigstore provenance attestation bound to the malicious workflow run — visible publicly on the npm package page and on Rekor, and rejectable by consumer-side OIDC subject-claim policies. That is the residual risk; we deliberately accept it rather than run a self-hosted publish runner.

See [Aikido's "Preventing fallout from your CI/CD platform being hacked"](https://www.aikido.dev/blog/prevent-fallout-when-cicd-platform-hacked) for the recommendation set this section implements.

### Supply-chain attack classes blocked

The gates below close many specific campaigns. Rather than narrate each one, this section lists the **gate** once and the **campaigns it blocks**. Detailed campaign IOCs live in the regression tests cited.

#### `ignore-scripts=true` + `pnpm verify:no-lifecycle-scripts`
No `preinstall` / `install` / `postinstall` / `prepare` runs on install (root `.npmrc`, every scaffolded template `_npmrc`, framework's own publish). Blocks: `ua-parser-js` hijack, `coa` hijack, 60-package Discord-webhook campaign, Jade Sleet/Lazarus paired packages, BeaverTail/InvisibleFerret, Beamglea, RATatouille's install path, Qix/DuckDB future variants, GemStuffer, generic PoC archetype.

#### `minimum-release-age=1440` (24h cooldown)
Refuses any dependency published less than 24 h ago. Most worm versions (Shai-Hulud, BlokTrooper, TanStack 2026-05-11, Qix 19-package + DuckDB, `node-ipc` 9.1.6/9.2.3/12.0.1, `xrpl@2.14.2`/`4.2.x`, Lazarus typosquats, `nayflore` packages, RATatouille, Telegram-bot SSH backdoor) are detected and yanked inside this window.

#### `pnpm verify:no-runtime-deps` (zero runtime deps)
`@daloyjs/core` has zero runtime deps; only `zod` is a peer. A consumer of `@daloyjs/core` carries no transitive runtime tree via us. Blocks every "transitive entry through the framework" scenario.

#### `pnpm verify:lockfile-sources` ([`scripts/verify-lockfile-sources.ts`](scripts/verify-lockfile-sources.ts))
Refuses lockfile entries from `git+` / `git://` / `ssh://` / `github:` / `gitlab:` / `bitbucket:` / `gist:` / raw `git@…` / tarball URLs outside `registry.npmjs.org`. Refuses `npm:<real>@<range>` aliasing without an explicit allowlist edit. Carries an exact-name blocklist of documented Lazarus / RATatouille / `node-ipc` / Telegram-bot / `nayflore` / `xuxingfeng` / Qix `name@version` / `string-width-cjs` family / Beamglea `redirect-[a-z0-9]{6}` IOCs.

#### `pnpm verify:known-dep-names` ([`scripts/verify-known-dep-names.ts`](scripts/verify-known-dep-names.ts))
Top-level deps must be on an explicit allowlist. Defeats slopsquatting / AI-hallucinated package names (catches the 60-package Discord-webhook names, `string-width-cjs` aliases, `xuxingfeng` typosquats, etc.).

#### `pnpm verify:no-remote-exec` ([`scripts/verify-no-remote-exec.ts`](scripts/verify-no-remote-exec.ts))
Refuses `node:child_process` / `child_process`, `node:vm` / `vm`, bare `eval(...)`, `new Function(...)` from a string, dynamic `import("https://...")` in `src/**`. Blocks BlokTrooper-style import-time payloads, Shai-Hulud, generic `curl … | sh` carriers, Lazarus `child_process.exec("node …")` second stages, Advcash `cp.spawn("/bin/sh")` reverse shells, `eval()`-decoded payloads, the "Hidden Trojan" archetype.

#### `pnpm verify:no-registry-exfiltration` ([`scripts/verify-no-registry-exfiltration.ts`](scripts/verify-no-registry-exfiltration.ts))
Refuses `rejectUnauthorized: false` / `NODE_TLS_REJECT_UNAUTHORIZED` mutation, `process.env.HOME = …`, references to host credential files (`~/.npmrc`, `~/.netrc`, `~/.gem/credentials`, `~/.yarnrc[.yml]`), `~/.ssh/authorized_keys`, AI-coding-agent credential directories (`~/.codex/` holding OpenAI Codex's `auth.json` OAuth/refresh token, `~/.claude/`), public IP-discovery endpoints, registry publish URLs, `global.X = require` / `globalThis['X'] = require` aliasing, `module.paths.push/.unshift`, leading-dot `.node_modules` paths, raw-IPv4 URLs (loopback/`0.0.0.0`/`localhost` allowed), `discord.com/api/webhooks`, `polyfill` campaign hosts. Carries campaign-specific IOC literals: GemStuffer paths, Jade Sleet `npmjsregister.com` + `~/.vscode/`, RATatouille C2 `85.239.62.36`, Telegram-bot `solana.validator.blog`, 60-package `ipinfo.io/json`, Discord-webhook URLs, Advcash `65.109.184.223` + shell-name literals (`/bin/sh`, `/bin/bash`, …), Lazarus BeaverTail `172.86.84.38` + browser-credential / wallet-keypair paths, xrpl `0x9c.xyz`, `nayflore`'s `api.verylinh.my.id` + `seska.json` + `rm -rf *`, Beamglea's 7 phishing hosts + `nb830r6x` + `beamglea.js` + `unpkg.com/redirect-<6char>`, Go-package Lazarus campaign's 7 C2 hosts + 2 path signatures + `wget … | bash` + `certutil -urlcache -split -f` LOLBin, and the `codexui-android` AI-token-theft class (`~/.codex/auth.json` Codex OAuth/refresh-token read exfiltrated as fake Sentry telemetry, plus the `~/.claude/` sibling target).

#### `pnpm verify:no-vulnerable-sandboxes` ([`scripts/verify-no-vulnerable-sandboxes.ts`](scripts/verify-no-vulnerable-sandboxes.ts))
Refuses `vm2`, `vm2-sandbox-escape`, `safe-eval`, `notevil`, `static-eval`, `eval-sandbox` as direct deps or in `pnpm-lock.yaml` (66 vulnerable `vm2` versions per [Socket](https://socket.dev/blog/free-certified-patches-for-critical-vm2-sandbox-escape)).

#### `pnpm verify:no-leaked-credentials` ([`scripts/verify-no-leaked-credentials.ts`](scripts/verify-no-leaked-credentials.ts))
Three layers: `package.json#files` whitelist, filename gate (`.env*` except `.env.example`/`.sample`/`.template`, `id_rsa*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `.npmrc`, `.netrc`, `credentials*.json`, `secrets*.json`, `service-account*.json`, `*.kdbx`), content gate (AWS `AKIA…`, GitHub PATs, npm `npm_…`, Slack `xox?-…`, Stripe `sk_live_…`, Google `AIza…`, JWT-shaped strings, PEM private keys, `_authToken=` lines). Runs after `pnpm build` in publish jobs.

#### `pnpm verify:no-invisible-unicode` ([`scripts/verify-no-invisible-unicode.ts`](scripts/verify-no-invisible-unicode.ts))
Refuses Unicode Tag (U+E0000–U+E007F, GlassWorm carrier), zero-width / word-joiner mid-stream, bidi-override (Trojan Source), Private Use Area, mid-file BOM. See [GlassWorm](https://www.aikido.dev/blog/glassworm-strikes-react-packages-phone-numbers), [GlassWorm-2026](https://www.aikido.dev/blog/glassworm-returns-unicode-attack-github-npm-vscode), [Trojan Source](https://trojansource.codes).

#### `pnpm verify:no-encoded-payloads` ([`scripts/verify-no-encoded-payloads.ts`](scripts/verify-no-encoded-payloads.ts))
Refuses ≥4 consecutive `\xXX` hex escapes, ≥4 consecutive `\u00XX` printable-ASCII escapes, opaque base64/base64url blobs ≥200 chars. Closes the visible-carrier half of the Socket [Obfuscation 101](https://socket.dev/blog/obfuscation-101-the-tricks-behind-malicious-code) catalog. Real URLs, JWTs, short hashes, and non-ASCII Unicode escapes are unaffected.

#### `pnpm verify:no-redos-patterns`, `verify:no-weak-random`, `verify:no-unsafe-buffer`
Static gates against ReDoS-shape regexes in `src/**`, `Math.random()` for security uses, and `new Buffer(...)` / `Buffer.allocUnsafe*(...)`. See § Threat model for details.

#### `pnpm verify:no-polyfill-cdns` ([`scripts/verify-no-polyfill-cdns.ts`](scripts/verify-no-polyfill-cdns.ts))
Refuses references repo-wide (`src/`, `packages/create-daloy/templates/`, `website/`, `examples/`, blog posts, top-level docs) to 11 documented hijacked-CDN hosts (`cdn.polyfill.io`, `polyfill.io`, `polyfill.com`, `polyfillcache.com`, `polyfill-cdn.com`, `bootcss.com`, `bootcdn.net`, `staticfile.org`, `staticfile.net`, `unionadjs.com`, `xhsbpza.com`). See the [polyfill.io supply-chain attack write-up](https://www.aikido.dev/blog/polyfill-io-supply-chain-attack-what-do-you-need-to-do) and [Sansec's investigation](https://sansec.io/research/polyfill-supply-chain-attack). DNS-label boundary so legitimate hosts that merely share a suffix are not flagged.

#### `pnpm verify:no-bin-shadowing`, `verify:no-native-addons`, `verify:no-shrinkwrap`
Bin-script confusion ([Socket](https://socket.dev/blog/npm-bin-script-confusion)), native-addon toolchain (`node-gyp`, `node-pre-gyp`, `bindings`, `nan`, `node-addon-api`, …), and any `npm-shrinkwrap.json` in published packages.

#### `pnpm verify:no-toxic-skills`, `verify:no-toxic-agent-skills`, `verify:no-leaky-agent-skills`
Refuses AI-agent skill files (under `.agents/` or templates) that contain remote-exec, registry-exfiltration, weakened-defaults instructions, or credential prompts. The agent-instruction surface includes `SKILL.md`, `AGENTS.md`, `copilot-instructions.md`, `.cursorrules`, `CLAUDE.md`, `*.instructions.md`, and `*.prompt.md` — the `.cursorrules` / `CLAUDE.md` filenames were added after the **TrapDoor** crypto-stealer campaign ([Socket, 2026-05-24](https://socket.dev/blog/trapdoor-crypto-stealer)) weaponized them to smuggle zero-width-Unicode-hidden prompt injection that coaxes an AI assistant into exfiltrating SSH keys, wallet data, and cloud credentials.

#### `pnpm verify:no-agent-config-autorun` ([`scripts/verify-no-agent-config-autorun.ts`](scripts/verify-no-agent-config-autorun.ts))
Closes the surface the **Miasma** worm (a Mini Shai-Hulud variant) weaponized in June 2026: editor / AI-coding-agent *config files* that silently auto-execute a command on folder open or agent-session start ([SafeDep, 2026-06-05](https://safedep.io/miasma-worm-ai-coding-agent-config-injection/)). Where the agent-skill gates above scan instruction *markdown*, this gate scans the *config* triggers — the worm's "five launchers, one payload" commit. It refuses, repo-wide (including `_`-prefixed `packages/create-daloy/templates/` dotfiles): a `.vscode/tasks.json` task with `"runOn": "folderOpen"`; a `.claude/` or `.gemini/` `settings.json` carrying a `"type": "command"` hook (`SessionStart` is "a `postinstall` for your editor"); a `.cursor/rules/*.mdc` rule with `alwaysApply: true` that tells the agent to run a script; a `package.json` script that executes a JS/TS entrypoint out of a config directory (the `"test": "node .github/setup.js"` hijack); and a loose executable script dropped directly under `.github/` (the `.github/setup.js` dropper IoC). "Cloning the repo is safe. Opening it is not" — so a poisoned `create-daloy` template file would auto-run on the user's machine the instant they open the scaffold; this gate is the publish-blocking regression net. The detectors flag the *auto-run wiring*, not the mere presence of a `.vscode/` / `.claude/` directory, so a `settings.json` that only sets a theme or a `.mdc` rule that only states a convention does not trip it.

#### `pnpm verify:dep-licenses`
SPDX allowlist; rejects copyleft and unknown licenses.

#### Parity / governance audits
- `verify:parity-audits` — refuses public setters on `request.url` / `request.path` / `request.method`, `ctx.respond = false`-style bypasses, `Referer`-based redirects, `AES-CBC` / `SHA-1` / third-party crypto in the cookie module, `allowInternal: true` / `app.inject()` dispatch.
- `verify:governance-audits` — refuses missing/stale `SECURITY-CONTACTS.md`, runtime deps in `@daloyjs/core`, removal of plugin-prerequisite refuse-to-boot or `topoSortExtensions` cycle detection, missing `permissions:` / `persist-credentials: false` / SHA pinning / `harden-runner` / `CODEOWNERS`.
- `verify:runtime-parity-audits` — `Cache-Control: no-store` on 401/403/429, `cspReportRoute()` discipline, `cors()` `allowMethods` discipline, reverse-proxy-helper absence, compression skip-already-encoded.
- `verify:routing-hardening-audits` — `useSemicolonDelimiter: false`, `allowErrorHandlerOverride: false`, `requestId()` `trustIncoming: false`, RFC 7231/5789 method allowlist, `Connection: close` on shutdown.

#### `daloy doctor --audit-defaults` (live config check)
Flags wildcard-credentials CORS, >24 h CORS `maxAge`, >25 MiB blanket body limits, zero `idleTimeoutMs` in production, and undocumented `allowUnsafeValidationDetails` / `exposeFrameworkIdentity` / `enableServerTimingInProduction` opt-ins.

### CPDoS (npm registry cache poisoning)
The registry-side bug ([Socket](https://socket.dev/blog/npm-registry-vulnerability-to-cache-poisoning-and-dos-attacks), [Lupin & Holmes](https://www.landh.tech/blog/20240603-npm-cache-poisoning/)) is not ours to patch, but the **consequences** are closed by existing gates:

- **Tarball substitution rejected** by `frozen-lockfile=true` + `prefer-frozen-lockfile=true` + `verify-store-integrity=true` (sha512 integrity in `pnpm-lock.yaml`).
- **Resolution pinned to `registry.npmjs.org`** by `verify:lockfile-sources`.
- **Availability bounded** by `minimum-release-age=1440` + the local pnpm content-addressed store (`pnpm install --offline` works during outages).
- **Surface minimized** by `verify:no-runtime-deps`.
- **Publish is registry-resilient** because the publish job runs `pnpm install --frozen-lockfile --ignore-scripts` and `pnpm verify:sbom` re-validates the SBOM before provenance signing.

### Token-value leaks in log lines (Composer/Packagist 2026-05-13 pattern)

See the [Socket write-up](https://socket.dev/blog/packagist-urges-immediate-composer-update). Two lessons: never embed a credential value in an error message; never validate a credential against a hardcoded format. DaloyJS posture:

- Every credential-rejection path in [`src/jwt.ts`](src/jwt.ts) / [`src/jwk.ts`](src/jwk.ts) / [`src/middleware.ts`](src/middleware.ts) / [`src/time-claims.ts`](src/time-claims.ts) throws fixed-string error messages. The rejected value is never interpolated.
- `bearerAuth()` and `jwk()` parse only `^Bearer\s+(.+)$` and hand the verbatim value to the verifier — no hardcoded length/charset/prefix check, so new token shapes (GitHub `ghs_APPID_JWT`-style) flow straight through.
- Key-based redaction in [`src/logger.ts`](src/logger.ts) masks `authorization`, `cookie`, `set-cookie`, `token`, `access_token`, `refresh_token`, `id_token`, `password`, `client_secret`, `x-api-key`, and LLM-provider headers at every depth.
- `redactJwtLikeStrings: true` (default) masks any `eyJ…\.eyJ…\.…` value under any key.
- `redactCredentialLikeStrings: true` (default) redacts substrings matching published opaque-credential shapes (GitHub `gh[opru]_…` / `github_pat_…`, Slack, AWS `AKIA…`/`ASIA…`, Stripe, npm, GitLab, Google, OpenAI, Anthropic) so an interpolated `"got token: ghs_…"` cannot leak. The `ghs_` matcher accepts `[A-Za-z0-9._-]{36,}` (not just opaque alphanumerics) so the [2026 stateless installation-token format](https://github.blog/changelog/2026-05-15-github-app-installation-tokens-per-request-override-header/) — a ~520-char `ghs_`-prefixed JWT with two dots, including the Actions `GITHUB_TOKEN` going forward — is redacted in full rather than truncated at the first `.`. Conservative lengths avoid false positives on UUIDs and short prefixes.

A custom logger plugged in via `new App({ logger: myPino })` bypasses these — `redactRecord()` is exported so a custom logger can apply the same policy in one line. Stack traces from `process.on("uncaughtException")` are out of scope; treat as fatal-shutdown in production.

### `fsnotify`-style governance disputes

Can a maintainer-dispute attack happen inside DaloyJS itself?

- The active rotation lives in [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md), CODEOWNERS-protected; off-boarding is on the release checklist; `verify:governance-audits` refuses removing either file.
- Branch protection requires PR review; CODEOWNERS enforces for `package.json` / `pnpm-lock.yaml` / `.npmrc` / `.github/`. Release commits and `v*` tags are signed. The `npm-publish` Environment requires a second-maintainer approval. A single-maintainer push-then-tag does not produce a release on its own.
- `verify:governance-audits` + `zizmor` refuse silently weakening workflows; both gates run in CI and the pre-publish `verify` job.
- The pre-publish `verify` job refuses to publish unless the actor is in the **Active** block.
- Release authority moves in three places together: `SECURITY-CONTACTS.md`, `.github/CODEOWNERS`, and the signed-tag chain. we have never force-pushed `main` or deleted a published npm version.
- Quarterly disclosure exercise verifies recovery-email-domain ownership for every active contact.

What this does **not** cover: a consumer who depends on a different low-level package that hits its own fsnotify-shaped dispute (the consumer re-pins on a known-good lockfile, waits the 24 h cooldown, verifies provenance before adopting); two compromised Daloy maintainers acting in concert (mandatory hardware 2FA + off-boarding checklist make that expensive).

### AI-generated-code incident risk (Aikido State-of-AI 2026 survey)

Not an attack — a 450-practitioner survey ([State of AI in Security & Development 2026](https://www.aikido.dev/state-of-ai-security-development-2026)) whose findings (69% of orgs found AI-introduced vulnerabilities; 1 in 5 had a serious incident; tool sprawl and false positives drive risk; automated CI gates beat manual review) describe what *reduces* incidents. DaloyJS's design is that prescription: secure-by-default output means AI-generated code on DaloyJS starts safe, and the [`AGENTS.md`](AGENTS.md) "do not weaken a check" rule plus the fail-closed `verify:*` gates are automated, low-false-positive, in-pipeline guardrails on a single `pnpm verify:*` surface. NB: this survey does not itself cover slopsquatting — that thread is the ENISA §5.2 mapping above, defended by `verify:known-dep-names` + `minimum-release-age`.

### Container & base-image hardening

`create-daloy` scaffolded container templates close most of this gap with free, open-source controls. Detailed mapping to Aikido x Root.io's hardening guide and Aikido's container-scanning guide is in [`website/app/docs/security`](website/app/docs/security). Highlights:

- **`_Dockerfile`** uses `NODE_IMAGE` build-arg for digest pinning (`node:24-alpine@sha256:…`), two-stage build, `pnpm install --frozen-lockfile --ignore-scripts`, runner adds only `tini`, runs as non-root UID 1001, `STOPSIGNAL SIGTERM`, `HEALTHCHECK` against `/healthz`.
- **`container-scan.yml`** runs hadolint, Trivy filesystem (`scanners: vuln,secret,misconfig`, IaC misconfigurations in Terraform / Kubernetes / Helm / Dockerfile / CloudFormation), and Trivy image (`severity: HIGH,CRITICAL`, blocking on CRITICAL, `ignore-unfixed: true` for signal quality) on every PR, every push to `main`, and weekly cron.
- **Pin check** annotates unpinned `FROM` lines as PR warnings (skips `scratch` and ARG-templated images).
- **`docker` Dependabot ecosystem** opens digest-bump PRs.
- **Scaffolded `SECURITY.md`** prescribes runtime hardening: `--read-only`, `--cap-drop=ALL`, `--security-opt=no-new-privileges:true`, `--security-opt=seccomp=default`, `--pids-limit`, memory/CPU limits, `--tmpfs /tmp:noexec,nosuid`. Kubernetes equivalents (`runAsNonRoot`, `readOnlyRootFilesystem`, `allowPrivilegeEscalation: false`, `capabilities: { drop: ["ALL"] }`, `automountServiceAccountToken: false`) are documented in the same file.
- **`_dockerignore`** excludes `.env*` (except `.env.example`), `.git`, `node_modules`, `coverage`, `dist`, `*.log`.

Every scaffolded template ships the hardened `_Dockerfile` and `_dockerignore` above (with a runtime-appropriate base image via the `NODE_IMAGE` / `BUN_IMAGE` / `DENO_IMAGE` build-arg); the create-daloy test suite enforces this for all of them. For the serverless / edge platform templates (`vercel`, `cloudflare-worker`), production still rides the platform's managed runtime (`vercel deploy`, `wrangler deploy`), and their `Dockerfile` targets reproducible local development, CI, and self-hosting rather than the production runtime.

### ENISA Technical Advisory for Secure Use of Package Managers (March 2026) mapping

ENISA's [Technical Advisory for Secure Use of Package Managers](https://www.enisa.europa.eu/publications/enisa-technical-advisory-for-secure-use-of-package-managers) (v1.1, March 2026, [PDF](https://www.enisa.europa.eu/sites/default/files/2026-03/ENISA%20Technical%20Advisory%20-%20Package_Managers_Final.pdf)) is the EU reference checklist for *consuming* third-party packages. It organises controls across a four-stage life cycle — **Select → Integrate → Monitor → Mitigate**. DaloyJS implements the advisory's integration checklist **as shipped defaults**, including the two controls ENISA itself flags as "optional / situational" or "more suited for high-security environments." This is the evidence map.

#### §4.1 Package selection / §4.2 Package integration

| ENISA recommendation | DaloyJS control |
| --- | --- |
| **Installation script prevention** — `ignore-scripts=true` (ENISA: *"may be more suited for high-security or isolated environments"*) | **Default, not opt-in.** `ignore-scripts=true` in root [`.npmrc`](.npmrc) + every scaffolded template `_npmrc` + the publish flow; `pnpm verify:no-lifecycle-scripts` is the regression net. |
| **Pinning versions + release-age delay** — lockfile + `npm ci`; ENISA also lists `npm install --before=<date>` to *"avoid newly published versions"* as "optional and situational" | **Default, not manual.** Committed `pnpm-lock.yaml` + `frozen-lockfile=true`; the cooldown is a standing policy: `minimum-release-age=1440` (24 h). |
| **Integrity enforcement** — hash / lockfile verification (SHA-512) | `frozen-lockfile=true` + `verify-store-integrity=true` + committed lockfile + `pnpm verify:lockfile`. |
| **Package source enforcement** — restrict to trusted registry, validate source URLs, reject tarball/`github:` installs | `registry=` pinned in `.npmrc`; `pnpm verify:lockfile-sources` ([`scripts/verify-lockfile-sources.ts`](scripts/verify-lockfile-sources.ts)) refuses any non-`registry.npmjs.org` source; `blockExoticSubdeps: true`. |
| **SBOM creation** | Every tarball ships `dist/sbom.cdx.json` (CycloneDX 1.5) + `dist/sbom.spdx.json` (SPDX 2.3); `pnpm verify:sbom`. |
| **Vulnerability checks in CI** — block builds on known-vulnerable components | `pnpm audit --prod` daily + in `ci.yml` and the pre-publish `verify` job; OSV-Scanner against the OpenSSF `malicious-packages` corpus. |
| **Trusted source / Trusted Publishing + provenance** (ENISA cites npm Trusted Publishing) | **OIDC trusted publishing** (no long-lived `NPM_TOKEN`) + `--provenance` Sigstore attestation on every staged publish. See § npm publishing. |
| **Package signing & integrity verification** | `--provenance` (Sigstore + Rekor) + SHA-512 lockfile integrity + `verify-store-integrity`. |
| **Maintainer reputation / internal allowlist** (ENISA: *"where feasible, maintain an internal allowlist of approved packages or maintainers"*) | `pnpm verify:known-dep-names` ([`scripts/verify-known-dep-names.ts`](scripts/verify-known-dep-names.ts)) — exact-match top-level name allowlist; `@daloyjs/*` scope owned at the registry. |
| **Reduce dependencies / "assess whether the dependency is actually needed"** | `@daloyjs/core` ships **zero runtime dependencies** (`pnpm verify:no-runtime-deps`) — the strongest possible form of attack-surface reduction. |
| **Avoid pre/post-install scripts that download code from external URLs** | `pnpm verify:no-lifecycle-scripts` + `verify:no-remote-exec` + `verify:no-registry-exfiltration`. |

#### §4.3 Package monitoring / §4.4 Vulnerability mitigation

| ENISA recommendation | DaloyJS control |
| --- | --- |
| **Automate vulnerability scanning in CI; track CVEs/advisories; monitor outdated versions; SBOM-driven monitoring** | Daily `pnpm audit --prod` + OSV-Scanner (OSV.dev + `malicious-packages`) + Dependabot (npm + Actions, weekly) + the published SBOM as the correlation source. |
| **Set alerts on maintainer ownership change / lapsed maintainer activity** | The quarterly disclosure exercise verifies every active contact's recovery-email-domain ownership (the `node-ipc` account-recovery-takeover vector); CODEOWNERS guards `package.json` / lockfile / `.npmrc`. |
| **Assess — exploitability + reachability (CVSS / EPSS / KEV / VEX, call-graph analysis)** | CodeQL + Opengrep run reachability/SAST on DaloyJS's own `src/**`. **Per-app reachability triage of a CVE in a consumer's dependency tree is the consumer's job** — a framework cannot perform it for downstream apps. |
| **Prioritise / Mitigate / Document & notify** | CVSS-keyed Patch SLA (§ Response Target); GHSA disclosure with CVSS vector + fixed version; SBOM updated on every release. |

#### §5.2 AI-assisted development & "vibe-coding" — slopsquatting

ENISA §5.2 names **slopsquatting** (attackers pre-registering hallucinated package names that AI tools confidently emit) as a first-class AI-era threat, and recommends: maintain visibility over AI-selected packages, review their necessity, automate selection/integration controls in CI, and strengthen vulnerability assessment since upfront scrutiny is reduced. DaloyJS closes both axes:

- **Name axis** — `pnpm verify:known-dep-names` forces every top-level dependency onto an explicit allowlist, so a hallucinated `pnpm add <name>` cannot land without a reviewed PR diff.
- **Time axis** — `minimum-release-age=1440` waits out the window in which a freshly-registered slop-squat is typically detected and unpublished.
- ENISA's other three AI-dev mitigations (visibility, necessity review, CI automation) are exactly what the `verify:*` gate family enforces mechanically, plus the zero-runtime-deps posture that minimises what an AI can pull in through the framework.

**Net:** DaloyJS meets or exceeds the ENISA integration checklist as defaults. The one area it does not (and structurally cannot) build in is per-consumer-app CVE reachability triage. Cross-references: the binding-law view of the same controls is the [§ EU Cyber Resilience Act (CRA) mapping](#eu-cyber-resilience-act-cra-mapping) above; the gate-by-gate campaign coverage is § Supply-chain attack classes blocked.

### Vibe-coder checklist (Aikido)

Mapping to [Aikido's "Vibe Check"](https://www.aikido.dev/blog/vibe-check-the-vibe-coders-security-checklist):

- **XSS / SSTI / path traversal** — see § Threat model. Core has no template engine; the docs page HTML-escapes interpolated values. Router rejects `..` / `//`. `fileField()` validates magic bytes.
- **SQL injection** — out of scope (no ORM); docs and blog posts use parameterized queries.
- **Secrets leakage** — scaffolded `_gitignore`, `_env.example`, `verify:no-leaked-credentials`, daily gitleaks.
- **Supply chain** — see § Supply-chain attack classes blocked.
- **Level 0 git hygiene + secrets + DDoS + don't roll your own auth/crypto** — covered by `_gitignore`, signed commits, body cap / timeout / `rateLimit` / `loadShedding`, first-party `bearerAuth` / `basicAuth` / `jwt` / `session` / `timingSafeEqual`.
- **Level 1 CI/CD + dependency monitoring + lockfiles + WAF** — CodeQL + Opengrep (SAST), DAST workflow (ZAP baseline), daily `pnpm audit` + OSV-Scanner, committed `pnpm-lock.yaml` + `verify-store-integrity` + `verify:lockfile`. WAF is operator territory; Daloy keeps its job small.
- **Level 2 containers + cloud** — see § Container & base-image hardening. Cloud account separation, CSPM, budget alerts are operator territory.

### Local secret pre-commit hook (Aikido Expansion Packs)

Optional defense-in-depth at the developer's keyboard:

- `pnpm scan:staged-secrets` runs the same credential patterns as `verify:no-leaked-credentials` against `git diff --cached`.
- `pnpm hooks:install` writes a `.git/hooks/pre-commit` shim. Refuses to overwrite a non-Daloy hook without `--force`.
- Paired with: CI-side `gitleaks` workflow, publish-time `verify:no-leaked-credentials`, `verify:secret-comparisons`, GitHub-native push protection.
- Bypass with `git commit --no-verify` (standard).
- Not auto-installed on `pnpm install` (the framework forbids install-time scripts).

---

## Quick reference

| Area | Where |
| --- | --- |
| Disclosure policy | This file, top |
| Patch SLA | § Response Target → Patch SLA |
| CRA Annex I evidence | § EU Cyber Resilience Act (CRA) mapping |
| ENISA package-manager checklist | § ENISA Technical Advisory for Secure Use of Package Managers (March 2026) mapping |
| Threat-class coverage | § Threat model → In scope |
| Out-of-scope items | § Out of scope |
| Supply-chain gates | § Supply-chain attack classes blocked |
| AI-attacker posture | § AI-accelerated attackers |
| AI-developer posture | § AI-assisted developers |
| Container hardening | § Container & base-image hardening |
| Maintainer rotation | [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md) |
| `security.txt` | [https://daloyjs.dev/.well-known/security.txt](https://daloyjs.dev/.well-known/security.txt) |
| GHSA list | [https://github.com/daloyjs/daloy/security/advisories](https://github.com/daloyjs/daloy/security/advisories) |
| Private report form | [https://github.com/daloyjs/daloy/security/advisories/new](https://github.com/daloyjs/daloy/security/advisories/new) |
| Incident archive | [`otherdocs/security-incidence.md`](otherdocs/security-incidence.md) |
