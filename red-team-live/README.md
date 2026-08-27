# `red-team-live/` — black-box live attack harness

This is **not** a unit-test suite. It is a real, over-the-wire penetration test
against a running `@daloyjs/core` server, the way an external bug-bounty hunter
would attack a deployed service.

```sh
pnpm red-team:live
```

## How it works

- **`target.ts`** boots a realistic, idiomatically-secured daloyjs API on a
  real TCP port via the Node adapter's `serve()` (production env, WAF, CORS
  allowlist, rate-limited login, `fetchGuard`, `safeRedirect`, JWT-protected
  admin route, response-body schemas, **authenticated object/money routes
  with ownership checks**). It is _not_ deliberately weakened — the point is
  to attack the **framework's defaults**.
- **`run.ts`** is the attacker. It spawns `target.ts` as a **separate process**,
  waits for it to listen, then attacks it over the wire:
  - `fetch()` for application-layer attacks — auth bypass, JWT forgery
    (`alg:none`, forged signature, scope escalation), SQLi/XSS/cmdi/NoSQL
    injection, SSRF, open redirect, excessive data exposure (API3), mass
    assignment, prototype pollution, CORS (including a **null-origin bypass**
    probe), credential brute force, CSRF, decompression bombs, idempotency
    replay + cross-tenant disclosure, concurrency shedding, content-type
    confusion, HTTP Parameter Pollution, method-override smuggling, stack-bomb /
    hash-flood JSON, request-id entropy, clickjacking/HSTS posture, bot-guard /
    geo-block / auto-ban, basic-auth account enumeration, spoofed mTLS
    client-cert, and `except()` path-confusion auth bypass (probed against a
    second app on a second port).
  - raw `net` TCP sockets for wire-level attacks the in-memory dispatch can
    never model — HTTP request smuggling (duplicate `Content-Length`,
    `Transfer-Encoding`+`Content-Length` desync), reserved-internal-header
    smuggling, header byte/count floods and **oversized single-header values**,
    oversized-body framing, **slowloris**, CRLF response splitting,
    **TRACE / Cross-Site Tracing**, **Cross-Site WebSocket Hijacking** (raw
    cross-origin upgrade handshake), **multipart upload abuse** (magic-byte /
    size bypass), an **HTTP/2 rapid-reset** probe (confirms the adapter is
    HTTP/1.1-only, plus a connect/reset connection-churn flood), **absolute-URI
    request lines**, **multiple Host headers**, **null-byte path injection**,
    **backslash path traversal**, and **malformed Host port-suffix** handling.

  Because the target runs in its own process, a crash shows up as
  connection-refused — a real DoS **finding** — instead of killing the harness.
  A post-engagement liveness probe records whether the target survived.

  A second battery (`novelProbes`) adds vectors found by going off-script:
  except() case / double-encoding / semicolon / fullwidth-solidus / overlong
  UTF-8 confusion, HEAD-method and duplicate-`Authorization` bypass attempts,
  JWT `kid` / `jku` / `x5u` / `crit` / `zip` header abuse and RS256 confusion,
  oversized (1 MB) tokens over raw sockets, open-redirect parser differentials
  (userinfo, backslash-after-host, ideographic full stop, scheme smuggling,
  encoded control characters), SSRF IP-literal differentials (decimal / hex /
  octal / short IPv4, IPv6-mapped, trailing-dot, userinfo-masked), one-sided
  CSRF tokens, WAF evasion encodings, production error-redaction checks,
  CSWSH lookalike-subdomain / null / absent origins, `Expect: 100-continue`
  timing, chunk-framing abuse, and X-Forwarded-For chain parsing posture.

  A third battery (`wave4Probes`) goes further off-script: **race conditions**
  (idempotency double-spend, rate-limit overrun, concurrency-limit overshoot —
  fired as truly simultaneous request bursts), **CL/TE parser differentials**
  (hex / plus-signed / leading-zero / decimal / space-padded `Content-Length`,
  TE+CL:0 desync pairs, pipelined-after-CL:0), **post-upgrade WebSocket frame
  attacks** (reserved opcodes, RSV bits, fragmented/oversized/unmasked control
  frames, invalid UTF-8, invalid close codes, 4 GiB declared lengths, new
  opcodes mid-fragment), **multipart exotica** (1000-part floods, embedded
  boundaries, truncation, traversal filenames), **content-encoding confusion**
  (gzip-labeled deflate, nested gzip, UTF-16 charset, BOM), protocol oddities
  (h2c upgrade, WS upgrade to non-WS routes, OPTIONS *, CONNECT, HTTP/0.9,
  obs-fold), and **trailer-field smuggling**. The invalid-close-code probe
  doubles as the live regression test for the wave-4 finding (close codes are
  now validated in `decodeClosePayload` per RFC 6455 §7.1.6).

  A fourth battery (`wave5Probes`) is the **reasoning layer** — the
  architectural and business-logic flaw class no scanner signature can
  express, folded in from the 2026-08-05 COS-methodology engagement
  ([COS-ENGAGEMENT-2026-08-05.md](COS-ENGAGEMENT-2026-08-05.md)): BOLA/IDOR
  (anonymous + cross-tenant object reads), defensive-control weaponization
  (a global login rate-limit bucket turned into an availability kill-switch
  for every user), business-logic abuse (unauthenticated money movement with
  a caller-chosen owner identity, sub-cent dust amounts), JWT claim
  type-confusion, and `except()` intent subversion. The engagement confirmed
  the first three as VULNERABLE **in the target's application design** (not
  in framework primitives) and fixed them in `target.ts`; the probes are the
  live regression tests that keep those fixes from silently reverting. Its
  one false positive (SSRF redirect-hop re-validation, self-retracted under
  independent re-verification) is deliberately not a live probe — it is
  pinned deterministically in `tests/fetch-guard.test.ts`.

  Wave 5 also covers the framework-level `trustedProxies` fix: a third target
  app (`appC`) mounts `autoBan({ trustedProxies: ["10.0.0.0/8"] })` so
  loopback harness peers fall outside the allowlist; victim-IP framing and
  XFF-rotation ban evasion are asserted as DEFENDED. The same attacks against
  the legacy app-A posture (rightmost hop only, no peer verification) remain
  INFO documentation of the pre-fix deployment model.

  Some of these are deliberately recorded as `INFO` posture notes rather than
  pass/fail assertions, because the safe fix is a design change rather than a
  patch. The `Expect: 100-continue` probe is one: refusing an over-limit
  declared `Content-Length` at header time was implemented and reverted, since
  `bodyLimitBytes` is enforced at body-parse time and the early refusal made an
  identical request resolve differently depending on whether the client sent
  `Expect`. The probe documents the current posture so the eventual uniform
  transport cap has a baseline to measure against.

It prints a bounty-hunter-style report and exits non-zero if any finding is
`VULNERABLE`. The current run is **196 probes over the wire** across **three**
target apps (primary, `except()` second port, and `trustedProxies` third port).

## Sibling batteries

`run.ts` is the main campaign; six sibling batteries run the same way
(`node --import tsx red-team-live/<file>.ts`) and each exits non-zero on any
`VULNERABLE` finding:

- `skill-attacks.ts` — probes mapped to the `.claude/skills` offensive
  playbooks (cure53 / Trail of Bits patterns).
- `extended-attacks.ts`, `custom-attacks.ts`, `blackhat-attacks.ts` —
  off-script parser-differential, business-logic, and campaign-style waves.
- `skill-wave2-attacks.ts` (`pnpm red-team:live:wave2`) — second skill wave
  against a loopback-only bookstore (`bookstore-target.ts`) plus `target.ts`,
  covering CORS/headers/clickjacking, HPP, cache poisoning/deception, XXE,
  deserialization, race, JWT, CSWSH, CSRF, IDOR/BOLA, smuggling, and the
  production refuse-to-boot of `cors({ origin: "*" })`.
- `mcp-attacks.ts` (`pnpm red-team:live:mcp`) — attacks the **MCP surface**:
  it spawns `mcp-target.ts` (a daloyjs app exposing a bearer-authenticated
  Streamable HTTP MCP endpoint) and fires tool-poisoning hygiene scans,
  tool-call abuse (type confusion, mass-assignment args, prototype-pollution
  keys, oversized bodies), resource-exfiltration attempts (`file://`,
  template path traversal), prompt abuse, JSON-RPC protocol abuse (downgrade,
  header/body disagreement, batch, notification storms, oversized
  `requestState`), and DNS-rebinding Origin probes over the wire. Driven by
  the community skill `auditing-mcp-servers-for-tool-poisoning`
  (mukul975/Anthropic-Cybersecurity-Skills). The protocol and URI-matching
  classes are also locked in-process by `tests/mcp.test.ts` and
  `tests/mcp-2026-07-28.test.ts` so they run on every PR; this battery is the
  real-socket complement (Origin vs Host, 413 keep-alive, process survival).

## What is covered live vs. in-process

This harness fires every attack class from the `tests/red-team-attacks-*.test.ts`
suites that is **reachable black-box over a socket**. The remainder of those
suites assert **library / construction-level** behavior that has no HTTP surface
and is therefore covered only in-process (by `app.request()` and direct API
calls), for example:

- refuse-to-boot guards, weak-secret rejection, cookie-attribute asserts
  (all throw at _construction_, never over the wire);
- `timingSafeEqual`, signed-value/HMAC primitives, WebSocket frame
  parse/encode, pagination cursor decode (pure library functions);
- JWT temporal / issuer-audience / tampered-payload rejection (forging a
  _validly signed_ but expired/tampered token requires the server's secret,
  which an external attacker does not have — the forgery-rejection path _is_
  exercised live via `alg:none` and forged-signature tokens).

## Relationship to the unit suites

`tests/red-team-attacks-*.test.ts` are in-process assertions (`app.request()`)
that lock individual defenses against regression. This harness complements them
by exercising the **real socket + real Node HTTP adapter** path end-to-end —
which is how the slowloris-enforcement gap (Node's 30s `connectionsCheckingInterval`
leaving the configured `connectionTimeoutMs` unenforced) was found and fixed.
That fix has its own regression test in
[`tests/node-adapter.test.ts`](../tests/node-adapter.test.ts).

> This directory is not part of the published package (`files` in
> `package.json` ships only `dist/`, `bin/`, `README.md`). It is type-checked
> via `pnpm typecheck` / `pnpm typecheck:red-team-live` (`red-team-live/tsconfig.json`)
> but is not part of the `tsc` build that emits `dist/`.
