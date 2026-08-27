# Live pentest engagement — 2026-08-26

**Scope:** `@daloyjs/core` framework defaults, attacked black-box over the wire
on `127.0.0.1` (localhost only) from separate attacker processes.
**Driver:** selected offensive skills from
[mukul975/Anthropic-Cybersecurity-Skills](https://github.com/mukul975/Anthropic-Cybersecurity-Skills)
(`testing-api-security-with-owasp-top-10`, `exploiting-mass-assignment-in-rest-apis`,
`exploiting-jwt-algorithm-confusion-attack`, `performing-jwt-none-algorithm-attack`,
`testing-for-host-header-injection`, `performing-directory-traversal-testing`,
`performing-api-rate-limiting-bypass`, `performing-ssrf-vulnerability-exploitation`,
`bypassing-authentication-with-forced-browsing`,
`exploiting-excessive-data-exposure-in-api`, `auditing-mcp-servers-for-tool-poisoning`,
`exploiting-nosql-injection-vulnerabilities`), cross-checked against the
existing `red-team-live/` coverage map.

## Verdict

**No exploitable framework weakness found.** 448 probes across six batteries
(after the review pass added two MCP probes), 0 `VULNERABLE` findings after
triage. The only defects were in the harness itself (stale probes, then two
MCP probes that were not actually exercising what they claimed) — fixed.

| Battery | Probes | Defended | Vulnerable | Info |
| --- | --- | --- | --- | --- |
| `run.ts` (main campaign) | 196 | 176 | 0 | 20 |
| `skill-attacks.ts` | 98 | 86 | 0 | 12 |
| `extended-attacks.ts` | 99 | 87 | 0 | 12 |
| `custom-attacks.ts` | 64 | 60 | 0 | 4 |
| `blackhat-attacks.ts` | 54 | 51 | 0 | 3 |
| `mcp-attacks.ts` (**new**) | 40 | 38 | 0 | 2 |

All six batteries were re-run independently after the review pass (the three
untouched files included). Counts above are from those runs.

## What the MCP battery covers

The MCP endpoint (`src/mcp.ts`, Streamable HTTP, protocol `2026-07-28`) is the
framework's agentic surface and previously had only in-process unit tests
(`tests/mcp.test.ts`, `tests/mcp-2026-07-28.test.ts`). `mcp-attacks.ts` spawns
`mcp-target.ts` — a production-posture app with bearer auth, strict tool
schemas, a destructive-annotated tool, a concrete resource, a resource
template, and a prompt — and attacks it from a separate process:

- **Auth gate:** no/wrong token refused (401/403); legacy-era `initialize`
  happy path; modern-era `initialize` correctly gone (stateless revision,
  HTTP 404 / `-32601`).
- **Tool poisoning / abuse:** description hygiene scan (no imperative
  injection markers), `destructiveHint` advertised for client gating (and an
  INFO note that the server still dispatches — annotations are advisory),
  unknown tool refused, arg type confusion refused, mass-assignment extra arg
  refused, `__proto__`/`constructor`/`prototype` arg keys stripped then the
  call succeeds, prompt-injection-shaped args documented as app-layer
  semantics (INFO), 400 KB body capped (413).
- **Resource exfiltration:** `file:///etc/passwd` refused, listed resource
  and template happy paths (so a missing template cannot vacuously "defend"
  traversal), five template path-traversal URI shapes yield no foreign
  `kind` marker.
- **Prompt abuse:** unknown prompt refused, missing required arg refused.
- **Protocol abuse:** JSON-RPC 1.0 / malformed JSON / batch / object `id` /
  unknown method all refused with the right error codes; notification storm
  (60 concurrent) absorbed; unsupported version header refused (`-32022`);
  version downgrade negotiates up; header/body method disagreement refused
  (`-32020`); empty `mcp-name` refused (`-32020`); 9 KB `requestState`
  refused (`-32602`, 8 KiB bound); 400-deep nested JSON bounded (`-32700`).
- **Transport:** GET → 405 with discovery hint, DELETE refused, evil `Origin`
  → 403 (DNS-rebinding defense), same-origin loopback works, and
  localhost-vs-127.0.0.1 mismatch **fails closed** via the App cross-origin
  guard.
- **Resilience:** target alive after all 40 probes.

## Findings triage (all harness-side, none in `src/`)

### Original engagement

1. **`custom-attacks.ts` — "Legitimate positive payment" flagged VULNERABLE.**
   Stale probe: it POSTed `/pay` with no `Authorization`. Since the wave-5
   hardening, `/pay` requires a verified JWT, so the probe saw 401 instead of
   201. Fixed: the battery now logs in as alice (own X-Forwarded-For hop, so
   the brute-force probes can't exhaust its bucket) and all three `/pay`
   probes authenticate. The negative/huge-amount verdicts were tightened to
   `=== 422` so they genuinely exercise the schema boundary instead of
   passing at the auth wall.
2. **`extended-attacks.ts` — "Idempotency replay + cross-tenant disclosure"
   flagged VULNERABLE.** Same root cause: raw `Bearer USER_A`/`USER_B`
   strings predate the wave-5 JWT requirement. Fixed to log in as alice/bob
   and assert `owner === "alice"` / `owner === "bob"`, matching the corrected
   twin probe in `run.ts`.
3. **Server crash suspicion — not a bug.** An early run died with
   `ECONNRESET` after the 413 body-cap probe. Root cause: the server
   legitimately answers 413 without draining the request body, which closes
   the socket; undici's keep-alive pool then handed the *next* probe a stale
   connection. Harness artifact — the target was alive throughout. Mitigated
   with a one-shot retry helper (now scoped to stale-keep-alive errors only)
   plus `Connection: close` on the 413 probe.

### Review pass (harness defects in the new MCP battery)

The original MCP battery reported 0 VULNERABLE, but two probes were not
doing what their titles claimed. Neither was a framework hole; both would
have let a future regression slip through as DEFENDED.

4. **Prototype-pollution probe never put `__proto__` on the wire.** A JS
   object literal's `__proto__` sets the object's prototype and is dropped
   by `JSON.stringify` — the in-process suite already documents this trap
   (`tests/mcp.test.ts`). The live probe now sends hand-written JSON with
   own-key `__proto__` / `constructor` / `prototype`, and requires the call
   to *succeed* (keys stripped before the strict echo schema) plus a clean
   follow-up with no leak.
5. **Resource-template traversal leak detector had a false-negative hole.**
   It ignored `"public":true` on any URI that started with `db://records/`,
   so a template that resolved to the other resource's body would have
   passed. Resources now carry unique `kind` markers (`app-info` vs
   `record`), the detector inspects `contents[].text` (not the escaped
   JSON-RPC envelope), and a template happy-path probe proves the template
   is actually mounted so traversal cannot pass vacuously.

## Files changed (uncommitted — for your review)

| File | Change |
| --- | --- |
| `red-team-live/mcp-target.ts` | **New.** MCP target app (production env, bearer auth, strict tools/resources/prompts, unique resource `kind` markers). |
| `red-team-live/mcp-attacks.ts` | **New.** 40-probe MCP attack battery. |
| `red-team-live/custom-attacks.ts` | Fixed stale `/pay` probes to authenticate; tightened 422 verdicts; login failure now throws. |
| `red-team-live/extended-attacks.ts` | Fixed stale idempotency probe to use real JWT logins; defensive owner parse. |
| `red-team-live/README.md` | Added "Sibling batteries" section documenting all five batteries; corrected the stale "excluded from typecheck" note. |
| `package.json` | Added `red-team:live:mcp` script (next to `red-team:live`). |
| `tests/mcp.test.ts` | In-process CWE-22 lock: `file://` + template path traversal. |

No changes to `src/` were needed — the framework held the line everywhere.

In-process MCP coverage already lives in `tests/mcp.test.ts` and
`tests/mcp-2026-07-28.test.ts`. The review pass added a CWE-22 case to
`tests/mcp.test.ts` (`file://` + template path traversal) because that
unhappy path was live-only. Duplicating the whole 40-probe battery into
`tests/red-team-attacks-mcp.test.ts` would not add coverage; the live
harness remains the socket/adapter complement (Origin vs Host, 413
keep-alive, process survival).

## Gates run

- `pnpm typecheck` (4 tsconfig projects, including `red-team-live`) — clean.
- New in-process case: `tests/mcp.test.ts` CWE-22 (`file://` + template
  traversal) — pass.
- All six live batteries re-run after the review pass, all exit 0.

## Pre-existing issue noticed (not mine, not fixed in tracked files)

`tests/sbom.test.ts` was failing before this engagement: the local
`dist/sbom.cdx.json` (gitignored build artifact) still said `1.1.1` while
`package.json` is `1.2.1`. Regenerating the local artifact with
`scripts/generate-sbom.ts` makes the suite green; nothing tracked changed.
If CI ever fails on this, the fix is `pnpm gen:sbom` after the version bump.

## Reproduce

```sh
pnpm red-team:live          # main campaign (196 probes)
node --import tsx red-team-live/skill-attacks.ts
node --import tsx red-team-live/extended-attacks.ts
node --import tsx red-team-live/custom-attacks.ts
node --import tsx red-team-live/blackhat-attacks.ts
pnpm red-team:live:mcp      # MCP battery (40 probes)
```
