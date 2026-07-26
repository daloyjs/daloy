# Exercise 3: Security Middleware Stack

Wire the production security stack. This is what would otherwise be five plugins, three config files, and at least one "we forgot helmet" CVE in a typical Express codebase.

## Requirements

- Tighten the `App` constructor:
  - `bodyLimitBytes: 64 * 1024`
  - `requestTimeoutMs: 5_000`
- Register four middleware in this order:
  1. `requestId()` — assigns/propagates an `x-request-id` header on every response.
  2. `secureHeaders()` — Helmet-grade defaults (HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, etc.).
  3. `cors({ origin: "https://app.example.com", credentials: false })` — explicit allowlisted origin, not `"*"`.
  4. `rateLimit({ windowMs: 60_000, max: 60 })` — 60 requests per minute per ip.
- Verify each guardrail by hand (see "Verify" below).

## Verify

```bash
# 1. secureHeaders + requestId on every response
curl -sI http://localhost:3000/docs | grep -iE 'x-(content-type-options|frame-options|request-id)|strict-transport-security'

# 2. CORS preflight returns the explicit origin (not "*")
curl -s -X OPTIONS http://localhost:3000/echo \
  -H 'origin: https://app.example.com' \
  -H 'access-control-request-method: POST' -i | grep -i access-control

# 3. Body limit → 413
curl -s -i -X POST http://localhost:3000/echo \
  -H 'content-type: application/json' \
  --data "@<(printf '{\"payload\":\"%s\"}' $(head -c 100000 /dev/urandom | base64))" | head -n 1

# 4. Request timeout → 408
curl -sI -m 7 http://localhost:3000/slow | head -n 1

# 5. Rate limit → 429 (loop ~65 requests; the last few should be 429)
for i in $(seq 1 65); do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/docs; done | sort -u
```

## Discussion Prompt

`secureHeaders` is enabled with no per-route override. What is the smallest legitimate use case for relaxing it on one route, and how would you scope that override so the rest of the app stays safe?

## Why This Matters

Every entry in the stack closes a class of vulnerability:

| Middleware         | What it prevents                                                                 |
| ------------------ | -------------------------------------------------------------------------------- |
| `requestId`        | Hours of debugging — correlate logs to a specific request without re-deploying.  |
| `secureHeaders`    | Clickjacking, MIME-sniffing, mixed-content downgrades, leaky `Referer`s.         |
| `cors`             | Cross-origin token theft when a careless `Access-Control-Allow-Origin: *` ships. |
| `rateLimit`        | Credential-stuffing and scrape-bot floods.                                       |
| `bodyLimitBytes`   | Memory-exhaustion DoS via gigantic JSON payloads.                                |
| `requestTimeoutMs` | Hung-handler resource exhaustion (slowloris-style on the app tier).              |

The framework's posture is **bad defaults are bugs**. If a default blocks a legitimate use case, narrow the scope (per-route override) rather than disabling it globally.

## Training Resources

- [DaloyJS — Security overview](https://daloyjs.dev/docs/security)
- [DaloyJS — Runtime protections](https://daloyjs.dev/docs/security/runtime-protections)
- [DaloyJS — Secure defaults](https://daloyjs.dev/docs/security/secure-defaults)
- [DaloyJS — Rate limit](https://daloyjs.dev/docs/security/rate-limit-redis)
- [OWASP — API Security Top 10](https://owasp.org/API-Security/editions/2023/en/0x11-t10/)
