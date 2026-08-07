# DaloyJS Live Pentest — COS-Methodology Engagement Report

> **Status (post-engagement): RESOLVED + FOLDED IN.** All six confirmed
> findings were fixed: four in `red-team-live/target.ts` application design
> (BOLA, global login lockout, unauthenticated `/pay`, PII harvest chain), and
> two at the framework layer via `trustedProxies` peer-verified forwarded-header
> trust (victim-IP framing, XFF-rotation ban/limit evasion). The attack battery
> lives permanently as `wave5Probes` in `red-team-live/run.ts` (**196 probes,
> 0 VULNERABLE** across three target apps) — the probes are the live regression
> tests for the fixes. Legacy app-A framing/evasion probes remain INFO
> documentation of the pre-`trustedProxies` deployment model; app C asserts the
> fix as DEFENDED. The standalone `cos-attacks.mts` used during the engagement
> was removed after the fold-in.

**Target:** `red-team-live/target.ts` — a production-configured `@daloyjs/core` app
(Node adapter, real TCP sockets, `env: "production"`, WAF, CORS allowlist,
rate-limited login, `fetchGuard`, `safeRedirect`, JWT admin route, response-body
schemas), attacked black-box from a separate process.

**Method:** [Snyk Evo Continuous Offensive Security](https://snyk.io/blog/evo-continuous-offensive-security/)
discipline — scanners/DAST own the commodity classes; reasoning owns the
architectural and business-logic layer ("if a bug is worth $1 and a flaw is
worth $100, why spend pentest cycles rediscovering $1 bugs"). Every finding
carries a runnable PoC and was re-verified by an independent validation pass —
the same AI that found a flaw was not trusted to confirm it
([generator ≠ validator](https://snyk.io/blog/remediation-agent-malicious-code-defense/)).

**Date:** 2026-08-05 · **Harness:** `red-team-live/run.ts` (waves 1–5; wave 5
is the folded engagement battery)

---

## 1. Baseline — commodity classes (existing 175-probe harness)

`pnpm red-team:live` → **158 DEFENDED · 0 VULNERABLE · 17 INFO**, target process
survived the full engagement. Request smuggling, desync, slowloris, CRLF
splitting, JWT forgery (`alg:none`, bad signature, `kid`/`jku`/`x5u`/`crit`/`zip`
header abuse, RS256 confusion), prototype pollution, mass assignment,
decompression bombs, CSWSH, multipart abuse, `except()` parser confusion,
header floods, TRACE/XST, HPP, method override — all held. The commodity layer
is genuinely hardened; attacking it further is the $1-bug trap.

## 2. Reasoning-layer engagement — 20 probes, 7 confirmed chains

New battery: `node --import tsx red-team-live/cos-attacks.mts` →
**10 DEFENDED · 6 VULNERABLE · 3 INFO · 1 false positive caught by validation**.

### 🔴 CHAIN 1 — BOLA / IDOR + PII harvesting (high) — CONFIRMED

`/users/:id` mounts **no authentication at all**. Anonymous enumeration of
`/users/{1,2,3,100,999999,alice,../admin}` returned 200 with PII for 7/8 ids;
a fresh id (`777`, then `5150` in validation) also returned 200. The email
pattern `u<id>@x.test` is predictable, turning the endpoint into a
credential-stuffing dictionary feed. This is the First American class from the
COS post: *the application did exactly what its code said; it just wasn't
supposed to let one customer read another's documents.* The framework's
response-schema filter correctly stripped `passwordHash` (baseline probe) —
the flaw is the **missing authorization decision**, which no scanner rule can
express. **Fix:** mount an auth hook and an ownership check
(`ctx.state.user.sub === params.id` or admin) on object routes.

### 🔴 CHAIN 2 — Weaponizing the defenses (high ×2, medium ×1) — CONFIRMED

The most interesting findings of the engagement: **the security controls
themselves became the attack surface**, because they trust the wrong thing
(BodySnatcher class).

- **2a. Global login bucket → total lockout (high).** The login rate limit
  keys on a constant (`keyGenerator: () => "login"`). Six bad attempts from an
  attacker, then the *real user with the correct password* got **429**. The
  limiter designed to stop brute force is a one-switch availability kill for
  every user. **Fix:** key by identity+IP (`user` claim + client IP), never a
  global constant on an auth endpoint.
- **2b. autoBan framing (high).** With `trustProxy: true`, three strikes with
  `X-Forwarded-For: <victim-ip>` banned the victim's IP from `/ab-public`
  (re-verified: still 429 seconds later). An attacker can mass-frame arbitrary
  IPs — e.g. a corporate egress gateway — and deny service to everyone behind
  it. **Fix:** only honor XFF from a *verified* proxy hop (CIDR allowlist of
  proxy addresses); the framework's prod default already refuses XFF — this
  bite happens the moment a deployment opts in without a real proxy
  overwriting the header.
- **2c. autoBan evasion (medium).** Rotating a spoofed XFF per request means
  strikes never accumulate: 6/6 attempts served 401, no ban, brute force
  continues unbounded. Same root cause as 2b.

### 🔴 CHAIN 3 — Business-logic abuse on `/pay` (critical) — CONFIRMED

A money route with **no auth**: `POST /pay {amount: 1000000}` with
`Authorization: Bearer CEO-OF-THE-COMPANY` returned 201 and recorded
`owner: "Bearer CEO-OF-THE-COMPANY"` — the "identity" is an unvalidated
caller-supplied string. Repeated in validation with a second forged payment.
The idempotency layer, by contrast, held: cross-tenant key guessing
(`order-1001` replayed by a different identity) did **not** disclose the
victim's stored response (isolation works). Sub-cent dust payments
(`1e-7`) were accepted — INFO-level ledger-rounding note.
**Fix:** require a verified JWT on money movement; derive `owner` from
verified claims; add a minimum-unit constraint at the schema boundary.

### ✅ CHAIN 4 — SSRF redirect re-validation — FALSE POSITIVE, caught by validation

First probe reported "redirect followed to 169.254.169.254 (200)".
Independent validation disproved it: `curl http://169.254.169.254` from this
host returns nothing (000), and all three discriminating hops
(private/metadata/public) returned identical `{fetched:true}` — httpbin was
returning a non-redirect error page, which `fetchGuard` correctly returned
as-is. Source (`src/fetch-guard.ts:42,449-500`) and the deterministic
in-process test (`tests/fetch-guard.test.ts:156` — "302 → metadata is
blocked") prove each redirect hop is re-validated with DNS pinning.
**Verdict: DEFENDED.** Kept in the report as evidence the validation phase
works — exactly the self-grading failure mode Snyk warns about.

### ✅ CHAINS 5–7 — Recon, JWT claim shapes, `except()` intent

- No anonymous OpenAPI/docs/MCP inventory on the target; the 422 validation
  oracle leaks only field types (INFO, by design for DX).
- Forged tokens with `scopes` as string/object and expired claims: all 403.
  The guard type-checks claims, not just their presence.
- Six `except()` intent-subversion probes (trailing slash, query smuggling,
  fragment, semicolon matrix, double slash, encoded dot-segment): all
  rejected. **Note:** `/api/%2e%2e/public/info` returned 200 — but that path
  *resolves to* `/public/info`, which is intentionally public, so this is
  correct normalization, not a bypass.

## 3. Prevent layer (Malicious Code Defense analog) — posture audit

Per the second reference (keyv install-time malware, valid-provenance
compromise, agentic config auto-fire), the repo's supply-chain posture was
checked against that threat model:

- **Install-time execution blocked by default:** every `create-daloy`
  template ships `_npmrc` with `ignore-scripts=true`; the repo itself runs
  `minimumReleaseAge: 1440` (24h release-age cooldown) in both
  `pnpm-workspace.yaml` and `.npmrc` — precisely the control that would have
  quarantined the poisoned `keyv@6.0.0` window described in the post.
- **`verify-no-lifecycle-scripts` CI gate** treats any new
  pre/post-install hook as a security event requiring a `SECURITY.md` note.
- `verify:no-runtime-deps`, SBOM generation, staged-secret scanning, and
  SHA-pinned actions round out the Prevent quadrant.

## 4. Verdict

| Layer | Result |
|---|---|
| Commodity classes (175 probes) | **Held — 0 vulnerable** |
| Wire/protocol (smuggling, slowloris, desync, CSWSH) | **Held** |
| Crypto/JWT (forgery, confusion, claim shapes) | **Held** |
| SSRF (direct, literal-tricks, redirect hops) | **Held** (1 false positive caught & retracted) |
| **BOLA / authorization design** | **6 confirmed chains** — all in *application intent*, not framework primitives |
| Supply-chain Prevent posture | **Strong** (ignore-scripts, 24h cooldown, lifecycle gate) |

The framework's security primitives held the line everywhere. Every confirmed
finding is a **trust-design flaw** — routes without an authorization decision,
defenses keyed on spoofable or global identities — the exact class the COS
post argues only reasoning-layer testing catches, and exactly the class that
chains into takeover at machine speed (BOLA → PII harvest → credential
stuffing → forged owner on a money route is one connected path here).

**Priority fixes:** (1) auth + ownership on `/users/:id` and `/pay`;
(2) identity-scoped rate-limit keys on `/login`; (3) proxy-CIDR verification
before honoring XFF for `autoBan`/`geoBlock` when `trustProxy` is enabled.

## Reproduce

```sh
pnpm red-team:live   # 196 probes — waves 1–5, including the reasoning-layer
                     # regression assertions for every finding in this report
```
