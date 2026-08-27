# Live pentest engagement — 2026-08-27

**Scope:** `@daloyjs/core` framework defaults, attacked black-box over the
wire on `127.0.0.1` only (Node adapter `hostname: "127.0.0.1"`). No LAN
bind, no remote hosts.
**Driver:** offensive skills from
[mukul975/Anthropic-Cybersecurity-Skills](https://github.com/mukul975/Anthropic-Cybersecurity-Skills)
([catalog](https://www.mahipal.engineer/Anthropic-Cybersecurity-Skills/))
that the 2026-08-26 engagement did **not** load, plus a re-check of JWT /
CSWSH / CSRF / BOLA / SSRF against `red-team-live/target.ts`.

This pass does **not** change the 2026-08-26 verdict. It adds coverage.

## Verdict

**No exploitable framework weakness found.** 30 new probes, 0 `VULNERABLE`
after triage. `src/` was not changed. Earlier batteries remain 0 VULNERABLE.

| Battery | Probes | Defended | Vulnerable | Info |
| --- | --- | --- | --- | --- |
| `skill-wave2-attacks.ts` (**new**) | 30 | 24 | 0 | 6 |

Combined with the 2026-08-26 batteries (478 live probes once MCP review-pass
counts are included): still **0 VULNERABLE**.

## Skills used (this wave)

Picked from the repo’s web / API / JWT / WS / MCP-adjacent catalog. Kerberos,
AD, cloud IAM, malware, OT, and similar skills were skipped — they have no
HTTP surface on this framework.

| Skill | Used against |
| --- | --- |
| `testing-cors-misconfiguration` | bookstore + production refuse-to-boot of `cors({ origin: "*" })` |
| `performing-security-headers-audit` | bookstore `secureHeaders` |
| `performing-clickjacking-attack-test` | X-Frame-Options DENY + CSP `frame-ancestors 'none'` |
| `performing-http-parameter-pollution-attack` | `GET /books/1?id=2&id=1` |
| `performing-web-cache-poisoning-attack` | `X-Forwarded-Host` reflection (trustProxy off) |
| `performing-web-cache-deception-attack` | `GET /books/1/static.css` |
| `testing-for-xxe-injection-vulnerabilities` | `application/xml` POST |
| `exploiting-insecure-deserialization` | JSON `$type` gadget as `title` |
| `exploiting-race-condition-vulnerabilities` | 8 concurrent POST /books same id |
| `testing-api-authentication-weaknesses` | missing / guessed bearer on POST /books |
| `testing-for-broken-access-control` | alice → bob BOLA |
| `exploiting-idor-vulnerabilities` | public sequential `/books/:id` (example design) |
| `testing-jwt-token-security` | `alg:none` |
| `testing-websocket-api-security` | CSWSH Origin allowlist |
| `performing-csrf-attack-simulation` | cross-origin POST /csrf-act |
| `exploiting-prototype-pollution-in-javascript` | raw `__proto__` JSON |
| `testing-for-xss-vulnerabilities` | script payload in book id |
| `exploiting-api-injection-vulnerabilities` | SQLi-shaped id |
| `exploiting-http-request-smuggling` | TE+CL on a single Node origin |
| `testing-for-business-logic-vulnerabilities` | negative `/pay` + injected owner |
| `testing-for-open-redirect-vulnerabilities` | `?next=` on GET /books/:id |
| `testing-for-host-header-injection` | Origin + `X-Forwarded-Host` vs corsCrossOriginGuard |
| `performing-ssrf-vulnerability-exploitation` | link-local metadata |

The 2026-08-26 wave already covered OWASP API Top 10, mass assignment, JWT
alg-confusion/none, host-header, directory traversal, rate-limit bypass,
SSRF, forced browsing, excessive data exposure, MCP tool poisoning, and
NoSQL injection.

## What the probes showed

**Framework held:**

- Production **refuse-to-boot** if the shipped example is started with
  `NODE_ENV=production` and `cors({ origin: "*" })`. The example therefore
  cannot silently ship a wildcard CORS policy to prod.
- JSON-only parser → XXE is 415, never reaches an XML parser.
- `secureHeaders` default: `X-Frame-Options: DENY`, `nosniff`,
  `frame-ancestors 'none'`.
- Node adapter does **not** honor `X-Forwarded-Host` unless
  `serve({ trustProxy: true })` — App-level `trustProxy: true` alone did
  not make an evil Origin look same-origin (POST /login stayed 403).
- TE+CL on a single origin is 400 (no front-end to desync against).
- CSWSH: `Origin: https://evil.example` → 403 on `/ws`. Missing Origin is
  allowed for non-browser clients (INFO, same posture as wave 1).

**INFO (example-app design, not framework holes):**

- GET `/books/:id` is public; sequential ids enumerate. No object ACL in
  the bookstore example.
- `docs: true` mounts `/docs` and `/openapi.json` even when we wanted a
  “prod-like” surface; the example chooses that.
- CORS `ACAO=*` with `credentials: false` (ACAC absent) — browsers will
  not send cookies; production still refuses to boot this config.
- Concurrent same-id POSTs last-write-wins on an in-memory Map (no 5xx).

## Files added / changed (uncommitted)

| File | Change |
| --- | --- |
| `red-team-live/bookstore-target.ts` | **New.** Loopback-only bookstore (`examples/build-app.ts`). |
| `red-team-live/skill-wave2-attacks.ts` | **New.** 30-probe skill wave. |
| `red-team-live/README.md` | Documented the sixth sibling battery. |
| `package.json` | `red-team:live:wave2` script. |
| `red-team-live/COS-ENGAGEMENT-2026-08-27.md` | This summary. |

Still waiting from the 2026-08-26 review pass (unchanged this wave):
`mcp-target.ts`, `mcp-attacks.ts`, wave-5 JWT probe fixes, MCP CWE-22 unit
test.

**No `src/` edits.** Nothing to commit from this agent.

## Reproduce

```sh
# binds 127.0.0.1 only; kills children on exit
pnpm red-team:live:wave2
```

## Relation to 2026-08-26

The earlier engagement’s 0-VULNERABLE conclusion still holds. This wave
was the missing skill coverage (CORS/headers/clickjacking/XXE/HPP/cache/
CSWSH/CSRF/BOLA/smuggling on the *shipped example*, not only the custom
pentest app). It did not surface a framework defect to patch.
