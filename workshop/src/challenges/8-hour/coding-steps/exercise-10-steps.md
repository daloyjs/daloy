# 8-Hour · Exercise 10 — Step-by-Step

> Goal: layer the three quantitative guards (body, time, rate) and tune them per route.

## Step 1 — App-level body + timeout

```ts
const app = new App({
  ...
  bodyLimitBytes: 64 * 1024,
  requestTimeoutMs: 5_000,
});
```

64 KB is a reasonable default for a JSON-only API. Bump it per route for endpoints that take attachments (multipart uploads, signed image URLs).

## Step 2 — Global rate limit

```ts
app.use(rateLimit({ windowMs: 60_000, max: 60 }));
```

60/min/IP. This is a starting point — for public APIs you'd pair it with a CDN-level limit (Cloudflare, Fastly) doing the heavy lifting at the edge.

## Step 3 — Per-route override on `/password-reset`

```ts
app.post(
  "/password-reset",
  {
    ...
    hooks: rateLimit({ windowMs: 60_000, max: 5 }),
    ...
  },
  handler,
);
```

**Why per-route is critical here:** sending a password-reset email is expensive and abusable. A user who already passed the global 60/min check can still be blocked by the stricter 5/min limit. Both run; the stricter one wins.

## Step 4 — Verify each guard

```bash
# 408 — timeout
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/slow

# 413 — payload too large
dd if=/dev/zero bs=1024 count=1024 2>/dev/null | base64 | jq -Rs '{blob: .}' \
  | curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/echo \
         -H 'content-type: application/json' --data-binary @-

# 429 — too many requests
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w "%{http_code} " -X POST http://localhost:3000/password-reset \
       -H 'content-type: application/json' -d '{"email":"a@b.c"}'
done
echo
```

Each guard renders RFC 9457 problem+json so consumers can detect the failure mode programmatically.

## Common mistakes

- **`requestTimeoutMs: 30_000` "to be safe".** A 30s budget means a single bad request can occupy a Node worker for 30 seconds. Pick the smallest value that supports your slowest legitimate route, and override per-route for the slow ones.
- **No `Retry-After` header on 429.** The framework sets it automatically; if you replace the rate-limit middleware with your own, set it yourself.
- **Per-route `hooks: rateLimit(...)` _replacing_ the global one.** Hooks run in addition. Both limits apply to that route — stricter wins.
- **Counting rate-limit hits in memory in a clustered deployment.** Fine for one node; broken across N replicas. Plug in a shared store (Redis) for production.
