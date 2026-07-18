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
  admin route, response-body schemas). It is *not* deliberately weakened — the
  point is to attack the **framework's defaults**.
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

It prints a bounty-hunter-style report and exits non-zero if any finding is
`VULNERABLE`. The current run is **68 probes over the wire** across two target
apps.

## What is covered live vs. in-process

This harness fires every attack class from the `tests/red-team-attacks-*.test.ts`
suites that is **reachable black-box over a socket**. The remainder of those
suites assert **library / construction-level** behavior that has no HTTP surface
and is therefore covered only in-process (by `app.request()` and direct API
calls), for example:

- refuse-to-boot guards, weak-secret rejection, cookie-attribute asserts
  (all throw at *construction*, never over the wire);
- `timingSafeEqual`, signed-value/HMAC primitives, WebSocket frame
  parse/encode, pagination cursor decode (pure library functions);
- JWT temporal / issuer-audience / tampered-payload rejection (forging a
  *validly signed* but expired/tampered token requires the server's secret,
  which an external attacker does not have — the forgery-rejection path *is*
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
> `package.json` ships only `dist/`, `bin/`, `README.md`) and is excluded from
> the build/typecheck.
