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
| Prototype pollution via JSON | Core `safeJsonParse` strips `__proto__` / `constructor` / `prototype` via reviver. |
| Header/response splitting | Core `sanitizeHeaderName` / `sanitizeHeaderValue` reject CRLF + NUL. |
| Path traversal | Router rejects `..` and `//` before walking. |
| Auth/router path-matching mismatch | Router is case-sensitive, performs no URL rewrites, and rejects `..` / `//` before walking. The `except()` matcher consumes the same `url.pathname` the router sees (no double-decode, no case folding), so case-mutated or rewrite-style paths cannot skip auth while still reaching a protected handler. Regression-tested against the Qinglong CVE-2026-3965 / CVE-2026-4047 class ([Snyk write-up](https://snyk.io/blog/qinglong-task-scheduler-rce-vulnerabilities/)) in [`tests/path-auth-bypass-regression.test.ts`](tests/path-auth-bypass-regression.test.ts). |
| Method confusion | Real **405** with `Allow` header. |
| Slow handlers / runaway loops | Core `requestTimeoutMs` aborts handlers (30 s default); Node adapter sets `requestTimeout` + `headersTimeout` + `maxHeaderSize`. |
| 5xx info disclosure | Production mode strips `detail` from 5xx problem+json automatically. |
| CRLF in user-controlled headers | All built-in middleware that emit headers from config (`basicAuth` realm, `csrf` cookie name, etc.) reject CRLF at construction time. |
| Credential timing attacks | First-party `timingSafeEqual()` plus `basicAuth()` verifier hooks designed for constant-time password checks. The CI gate `scripts/verify-secret-comparisons.ts` (run as `pnpm verify:secret-comparisons`) rejects the full family of short-circuiting comparisons exploited by the CCC CTF "Node.js timing attack" class ([Snyk write-up](https://snyk.io/blog/node-js-timing-attack-ccc-ctf/)) — `===`, `!==`, `==`, `!=`, `.startsWith()`, `.endsWith()`, `.includes()`, `.indexOf()`, and `.localeCompare()` against any header-derived value in `src/`. |
| Cross-origin forgery (CSRF) | First-party `csrf()` with two strategies (double-submit cookie + Fetch-Metadata, see [docs](https://daloyjs.dev/docs/security/csrf)). |
| Cross-Site WebSocket Hijacking (CSWSH) | `app.ws()` refuses-at-registration in production unless the route sets `allowedOrigins` (`"same-origin"`, a string allowlist, or a predicate) or explicitly opts in via `acknowledgeCrossOriginUpgrade: true`. The Origin check runs **before** `beforeUpgrade`, so an attacker's drive-by `new WebSocket(...)` is rejected with `403` before any cookie-bearing handler runs. Closes the Storybook [CVE-2026-27148](https://www.aikido.dev/blog/storybooks-websockets-attack) class of bug. |
| Clickjacking / MIME sniffing / cross-origin leakage | First-party `secureHeaders()` (CSP, HSTS, COOP, CORP, `X-Frame-Options`, `X-Content-Type-Options`, Permissions-Policy; CSP nonce + Trusted Types). |
| Malicious image uploads / ImageTragick (CVE-2016-3714) class | First-party `fileField()` validates magic bytes against the declared MIME and, by default whenever `magicBytes` is enabled, refuses scriptable image formats (SVG, MVG, MSL, PostScript / EPS) that ImageMagick and similar renderers can execute. See the [Snyk write-up on safe ImageMagick for Node](https://snyk.io/blog/safe-imagemagick-for-node/). Opt back in per route with `rejectScriptableImages: false` only if you sandbox the renderer (separate process, restricted ImageMagick `policy.xml`, no shell). |
| Uninitialized-memory leaks via the legacy `Buffer` API | Daloy's source is forbidden from calling `new Buffer(...)` or `Buffer.allocUnsafe*(...)` (both return memory that may contain bytes from previous allocations \u2014 cookies, tokens, decoded bodies). Enforced at PR time by `scripts/verify-no-unsafe-buffer.ts` (CI gate `pnpm verify:no-unsafe-buffer`), with a positive regression in [`tests/wave8-leftover-bake-ins.test.ts`](tests/wave8-leftover-bake-ins.test.ts) that walks the live `src/` tree. Adapter and binary code paths use `Uint8Array` or `Buffer.alloc(size)` instead. See the [Snyk write-up on exploiting `Buffer`](https://snyk.io/blog/exploiting-buffer/). |
| Trusted-proxy header spoofing | `rateLimit({ trustProxyHeaders })` and `requestId({ trustIncoming })` default OFF; key generators must be explicit. |
| Server-side template injection (SSTI) | DaloyJS ships **no** template engine and **no** string-eval rendering API. The framework is JSON-first; the only HTML emitted by core is the optional API-docs page, whose interpolated values (title, spec URL, Scalar configuration) are HTML-escaped via the helper in [`src/docs.ts`](src/docs.ts) and regression-tested against `<script>` / quote-break payloads in [`tests/docs-logger-adapters.test.ts`](tests/docs-logger-adapters.test.ts). The Thymeleaf / CVE-2026-40478 class ([Snyk write-up](https://snyk.io/blog/thymeleaf-injection/)) requires a template engine that compiles user-controlled expressions; that surface does not exist in core. |
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
- **SSRF guard** (`fetchGuard()`) blocking outbound `fetch` to RFC1918,
  loopback, link-local, and metadata-service IPs unless explicitly allowlisted.
- **Per-route capability-based body limits** derived from the route schema
  (override the global cap when the schema implies a tighter ceiling).
- **SLSA build-level-3 attestations** and **CycloneDX SBOM** generated and
  attested per release, beyond the existing npm provenance attestation.
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
  supply-chain attack from CI.
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
- **OpenSSF Scorecard** publishes a continuous scorecard
  (`.github/workflows/scorecard.yml`).
- **Dependabot** keeps actions and npm dependencies up to date weekly
  (`.github/dependabot.yml`).
- **`CODEOWNERS`** requires a maintainer to approve any change under
  `.github/`, `package.json`, the lockfile, or `.npmrc`.

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
| **Visibility** | Public source tree, public [`PROJECT_HISTORY.md`](PROJECT_HISTORY.md) changelog, `@daloyjs/core`'s **zero runtime dependencies** (enforced by [`pnpm verify:no-runtime-deps`](scripts/verify-no-runtime-deps.ts)) so the transitive tree is exactly the dev/test deps in [`pnpm-lock.yaml`](pnpm-lock.yaml). Every published tarball carries an npm **provenance attestation** (Sigstore + OIDC) that binds the bytes to the source commit and the `release.yml` run. `pnpm audit --prod` runs on every PR and every publish. Roadmap: CycloneDX SBOM attested per release (see roadmap above). | Inventorying the *consumer's* applications, cloud assets, or running deployments. That is an operator-side ASPM concern (Aikido, Snyk, Wiz, etc.) and the framework cannot do it for them. |
| **Early Feedback** | Security feedback runs **inside the PR**, not at release time: `zizmor` ([`.github/workflows/zizmor.yml`](.github/workflows/zizmor.yml)) statically rejects unsafe workflow patterns; CodeQL ([`.github/workflows/codeql.yml`](.github/workflows/codeql.yml)) runs JavaScript/TypeScript and `actions` queries; OpenSSF Scorecard ([`.github/workflows/scorecard.yml`](.github/workflows/scorecard.yml)) publishes a continuous score; `pnpm verify:wave9-audits` / `verify:wave10-audits` / `verify:wave11-audits` / `verify:wave12-audits` / `verify:secret-comparisons` / `verify:no-runtime-deps` / `verify:lockfile` enforce the documented security floor on every PR; Dependabot ([`.github/dependabot.yml`](.github/dependabot.yml)) opens PRs weekly for actions and npm deps. CODEOWNERS ([`.github/CODEOWNERS`](.github/CODEOWNERS)) requires a maintainer to approve any change under `.github/`, `package.json`, `pnpm-lock.yaml`, or `.npmrc`. | Author-time IDE feedback (SAST in the editor). We do not bundle a proprietary scanner — operators who want that should layer Snyk / Aikido / Semgrep / GitHub Advanced Security on top, none of which conflict with our gates. |
| **Developer Adoption** | Security gates live in the same commands developers already run: `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm coverage:branches`, and the `verify:*` family are documented in [`AGENTS.md`](AGENTS.md) as the quality gate for every change. The list is short and reused for human contributors, CI, and AI agents — there is no separate "security checklist" that drifts out of sync. The scaffolded templates ([`packages/create-daloy/templates/`](packages/create-daloy/templates)) inherit the same defaults (`.npmrc` with `ignore-scripts=true` and `minimum-release-age=1440`, `_gitignore` excluding `.env*`, etc.) so consumer apps start with the framework's security posture, not a stripped-down one. | Adoption inside the *consumer's* org. That is a cultural change owned by the consumer's engineering leadership; the most we can do is ship safe defaults and document them. |
| **Consistency** | The **governance floor** (above) is enforced by [`pnpm verify:wave10-audits`](scripts/verify-wave10-audits.ts) on every PR: it refuses to merge a change that removes top-level `permissions:`, `persist-credentials: false`, a SHA-pin on a third-party action, `step-security/harden-runner` on workflows that use third-party actions, a runtime dep on `@daloyjs/core`, [`SECURITY-CONTACTS.md`](SECURITY-CONTACTS.md), or [`.github/CODEOWNERS`](.github/CODEOWNERS). Removal of any control requires a documented `SECURITY.md` entry and maintainer-quorum sign-off. The same `verify:*` family runs identically in `ci.yml` and the pre-publish `verify` job in `release.yml`, so a PR cannot pass CI under one rule set and be published under a weaker one. | Enforcing the same rules across *consumer* repositories. We document the recommended posture (see § Supply-chain security and the per-incident tables above) and ship the same defaults in scaffolded templates, but we cannot police a downstream project's CI. |
| **Actionability** | When an incident in the broader ecosystem matches a Daloy-relevant attack pattern, we publish a step-by-step mapping table (see the `shopsprint`, `node-ipc 2026-05-14`, GitHub VS Code-extension, and ToxicSkills tables above) that says, per attack step, which Daloy control catches it and which steps are explicitly out of scope. The recurring quarterly **disclosure exercise** (above) verifies that the private-report inbox, the active maintainer rotation, the `npm-publish` Environment, the `verify:wave10-audits` gate, and every active contact's recovery-email domain are still working — a missed quarter fails CI loud. [`PROJECT_HISTORY.md`](PROJECT_HISTORY.md) records the date and outcome of each exercise. | Prioritizing findings *inside the consumer's* application. Daloy does not bundle an ASPM dashboard; consumers who need one should pair the framework with their existing AppSec stack. |

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
| **Attestations** | "Whether the project includes verifiable provenance to prove that builds are authentic and reproducible." | Every `@daloyjs/core` and `create-daloy` tarball is published with `--provenance` (root [`.npmrc`](.npmrc) sets `provenance=true`), which binds the bytes to the source commit and the `release.yml` workflow run via npm trusted publishing (OIDC) and Sigstore. Consumers can verify the published bytes against the source commit and reject any release whose attestation cannot be re-derived from the GitHub source (§ npm publishing). CycloneDX SBOM attestation per release is on the roadmap (above). |

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

### Governance floor (reaffirmed)

Every supply-chain control listed above is the documented governance floor.
Removal of any one of these requires an explicit `SECURITY.md` entry
justifying the removal and a maintainer-quorum sign-off on the PR. The
static gate that enforces this lives in
[`scripts/verify-wave10-audits.ts`](scripts/verify-wave10-audits.ts) and runs
in CI as `pnpm verify:wave10-audits`. It refuses a PR that:

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
4. `pnpm verify:wave10-audits` exits zero on `main`.
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
| Compromised release pulled from a non-registry source | `blockExoticSubdeps: true` (transitive deps refused unless they come from the configured registry) plus [`pnpm verify:lockfile`](scripts/verify-lockfile-sources.ts) (CI gate that rejects `git+`, `github:`, `ssh:`, and any tarball URL outside `registry.npmjs.org`). |
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
| Compromised package source is a `git+ssh://` / `github:owner/repo#<sha>` / non-registry tarball URL pulled through a transitive dep to evade registry-side scanning | `blockExoticSubdeps: true` in [`pnpm-workspace.yaml`](pnpm-workspace.yaml) and every template's `pnpm-workspace.yaml` refuses to install exotic sub-deps. `pnpm verify:lockfile` ([`scripts/verify-lockfile-sources.ts`](scripts/verify-lockfile-sources.ts)) runs in [`ci.yml`](.github/workflows/ci.yml) and the pre-publish `verify` job in [`release.yml`](.github/workflows/release.yml); it rejects `git+`, `github:`, `ssh:`, `http:` URLs and any tarball whose origin is not `registry.npmjs.org`. |
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
| Malicious extension silently mutates `package.json` / `pnpm-lock.yaml` to introduce a typosquatted dep | Caught at PR review: `package.json` and `pnpm-lock.yaml` are CODEOWNERS-protected ([`.github/CODEOWNERS`](.github/CODEOWNERS)), CI runs `pnpm install --frozen-lockfile`, and `pnpm verify:lockfile` ([`scripts/verify-lockfile-sources.ts`](scripts/verify-lockfile-sources.ts)) rejects any `git+`, `github:`, `ssh:`, or non-`registry.npmjs.org` source. `minimumReleaseAge: 1440` then blocks install of a freshly published trojan dep even if one slipped past review. |
| Malicious extension stages a commit to `.github/workflows/*` to weaken CI (e.g. drop `harden-runner`, add `pull_request_target`, unpin an action) | Caught at PR review: `.github/` is CODEOWNERS-protected, `zizmor` statically rejects unsafe workflow patterns ([`.github/workflows/zizmor.yml`](.github/workflows/zizmor.yml)), and `pnpm verify:wave10-audits` ([`scripts/verify-wave10-audits.ts`](scripts/verify-wave10-audits.ts)) refuses the PR if the top-level `permissions:` block, `persist-credentials: false`, the SHA-pin on a third-party action, or `step-security/harden-runner` is removed. |
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
| Poisoned skill silently edits `package.json`, `pnpm-lock.yaml`, `.npmrc`, or a workflow under `.github/` to weaken CI or introduce a typosquatted dep | Caught at PR review. Those paths are CODEOWNERS-protected ([`.github/CODEOWNERS`](.github/CODEOWNERS)); CI runs `pnpm install --frozen-lockfile`; `pnpm verify:lockfile` ([`scripts/verify-lockfile-sources.ts`](scripts/verify-lockfile-sources.ts)) rejects `git+`, `github:`, `ssh:`, and non-`registry.npmjs.org` sources; `pnpm verify:wave10-audits` ([`scripts/verify-wave10-audits.ts`](scripts/verify-wave10-audits.ts)) refuses removal of `permissions:`, `persist-credentials: false`, action SHA-pins, or `step-security/harden-runner`; `zizmor` statically rejects unsafe workflow patterns ([`.github/workflows/zizmor.yml`](.github/workflows/zizmor.yml)). Even with a fully compromised agent on a maintainer laptop, the malicious change has to clear a human review under those gates. |
| Poisoned skill stages a backdoor inside `src/` (e.g. weakens a header sanitizer, removes a rate-limit guard, downgrades a JWT algorithm allowlist) | Caught at PR review plus the static governance gates: `pnpm verify:wave9-audits`, `pnpm verify:wave10-audits`, `pnpm verify:wave11-audits`, `pnpm verify:wave12-audits`, and `pnpm verify:secret-comparisons` enforce the documented security floor. CodeQL and the test suite (with the 90% line / 90% function / 90% branch coverage gates) run on every PR. A backdoor that bypasses all of those would have to be subtle enough to pass code review on `src/security.ts`, `src/hashing.ts`, `src/jwt.ts`, etc. — review is the last line of defense and there is no shortcut around it. |
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
| Malicious package declares the trojan source via `git+ssh://` / `github:owner/repo#<sha>` / a non-`registry.npmjs.org` tarball URL to bypass registry-side scanning | `blockExoticSubdeps: true` in [`pnpm-workspace.yaml`](pnpm-workspace.yaml) and every template's `pnpm-workspace.yaml` refuses to install exotic sub-deps in the first place. `pnpm verify:lockfile` ([`scripts/verify-lockfile-sources.ts`](scripts/verify-lockfile-sources.ts)) is wired into [`ci.yml`](.github/workflows/ci.yml) and the pre-publish `verify` job in [`release.yml`](.github/workflows/release.yml); it rejects `git+`, `github:`, `ssh:`, `http:` URLs and any tarball whose origin is not the official npm registry. |
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
| Timing oracle on the auth comparison ("does this token exist? does this hash match?") | First-party `timingSafeEqual()` from [`src/hashing.ts`](src/hashing.ts) plus `basicAuth({ verify })` verifier hooks designed for constant-time password / API-key checks. `scripts/verify-secret-comparisons.ts` runs as `pnpm verify:secret-comparisons` and refuses any PR that introduces a non-constant-time comparison against a secret-shaped variable in `src/` — the gate catches `===`, `!==`, `==`, `!=`, **and** the short-circuiting `.startsWith()` / `.endsWith()` / `.includes()` / `.indexOf()` / `.localeCompare()` family that the CCC CTF "Node.js timing attack" challenge exploited ([Snyk write-up](https://snyk.io/blog/node-js-timing-attack-ccc-ctf/)). Regression-tested in [`tests/wave8-leftover-bake-ins.test.ts`](tests/wave8-leftover-bake-ins.test.ts). |
| RCE shell-out from a "convenient" handler that takes a user-supplied template/parameter and runs it through `exec` / `eval` / `new Function` | Out of scope as a generic eval defense, but `step-security/harden-runner` on the **publish** workflow blocks egress from CI — a compromised dev dep on the maintainer's machine cannot phone home from the publish runner. For consumer apps we recommend: never call `eval` / `new Function` on prompt content; never pass model output to `child_process.spawn`; and place the app behind `secureHeaders()` so a stored-XSS pivot through an admin dashboard is contained (CSP nonce + Trusted Types + COOP/CORP). |
| Stored / exfiltrated **provider API keys** appearing in structured logs (a single `logger.info({ headers: req.headers })` is enough) | The default logger from [`src/logger.ts`](src/logger.ts) redacts not just `authorization` / `cookie` / `x-api-key` / `token` but also **every common LLM-provider credential header** as of `@daloyjs/core` 0.34.0: `openai-api-key`, `x-openai-api-key`, `anthropic-api-key`, `x-anthropic-api-key`, `x-api-key-anthropic`, `x-goog-api-key`, `google-api-key`, `x-google-api-key`, `azure-api-key`, `x-azure-api-key`, `api-key-azure`, `cohere-api-key`, `x-cohere-api-key`, `mistral-api-key`, `x-mistral-api-key`, `groq-api-key`, `x-groq-api-key`, `replicate-api-token`, `huggingface-api-key`, `x-huggingface-api-key`, `x-litellm-master-key`, `litellm-master-key`, `litellm-api-key`. Matched case-insensitively at every depth of the log record. Locked by a regression test in [`tests/wave1-secure-defaults.test.ts`](tests/wave1-secure-defaults.test.ts). Combined with the existing JWT-shaped-string redaction (`redactJwtLikeStrings: true` by default), an accidental `logger.info({ req })` cannot leak a provider key into the log stream. |
| 5xx error pages leaking the SQL fragment / prompt / provider key in the `detail` field of a problem+json response | Production mode strips `detail` from every 5xx problem+json automatically (see § In scope — "5xx info disclosure"). Stack traces never reach the client in `NODE_ENV=production`. |
| Supply-chain compromise of the AI gateway itself (the LiteLLM CVE-2026-33634 path: a trojaned release executes on first import) | Same controls as every other supply-chain section above: `minimum-release-age=1440` (24 h cooldown) in root [`.npmrc`](.npmrc) and every template `_npmrc`; `ignore-scripts=true` in both; [`scripts/verify-no-lifecycle-scripts.ts`](scripts/verify-no-lifecycle-scripts.ts) refuses any install-time hook on a published manifest; `blockExoticSubdeps: true` in [`pnpm-workspace.yaml`](pnpm-workspace.yaml); [`pnpm verify:lockfile`](scripts/verify-lockfile-sources.ts) rejects any tarball whose origin is not `registry.npmjs.org`; `@daloyjs/core`'s zero-runtime-dep posture means importing the framework cannot transitively pull a trojanized package. |
| Outbound SSRF from a handler to a provider endpoint chosen by the attacker (`POST /chat { provider_url: "http://169.254.169.254/..." }`) | On the hardening roadmap as `fetchGuard()` (RFC1918 + loopback + link-local + metadata-service IP blocklist). Until it ships, the documented mitigation is "never accept a provider base URL from a request body; pick it server-side from an allowlist". |
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
- A handler that builds an outbound `fetch(req.body.provider_url, …)`. Until
  `fetchGuard()` ships, the runtime's network policy is the only line of
  defense.
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
| **4. Continuous, demonstrable evidence of controls — not annual compliance checks — plus customer-side options like confidential computing, self-hosting, and BYOC.** | **Continuous evidence**: [OpenSSF Scorecard](https://securityscorecards.dev/viewer/?uri=github.com/daloyjs/daloy) and CodeQL run on every push; [`zizmor`](.github/workflows/zizmor.yml) statically analyses every workflow on every PR; `pnpm typecheck` + `pnpm test` + `pnpm coverage` (≥90% line/function, ≥90% branch) + `pnpm verify:no-runtime-deps` + `pnpm verify:no-lifecycle-scripts` + `pnpm verify:lockfile` + `pnpm verify:secret-comparisons` + `pnpm verify:wave9-audits` … `pnpm verify:wave12-audits` all run in CI and on every release tag. Every published tarball carries an npm provenance attestation bound to its source commit and workflow run via Sigstore. `step-security/harden-runner` monitors and blocks egress on the publish workflow. **Customer self-hosting**: the framework's only contract with the runtime is `Request → Response`, so the same app runs on Node, Bun, Deno, Cloudflare Workers, and Vercel Edge — the consumer chooses **where** their data is processed, including fully on-prem or in a private VPC. There is no Daloy-operated SaaS control plane, no telemetry call-home, and no required cloud account; the [`AGENTS.md`](AGENTS.md) "Quality Gates" and `pnpm coverage` thresholds are the only continuous-evidence loop, and they run inside the consumer's CI. BYOC and confidential-compute deployments work because the framework never assumes egress to a vendor-owned service is available. |

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
