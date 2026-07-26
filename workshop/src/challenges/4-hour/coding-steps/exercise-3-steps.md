# Exercise 3 — Step-by-Step

> Goal: stand up the production middleware stack — `requestId`, `secureHeaders`, `cors`, `rateLimit` — plus the two App-level guardrails `bodyLimitBytes` and `requestTimeoutMs`. Then verify each one rejects what it's supposed to reject.

You are editing [`exercise-3.ts`](../exercise-3.ts). Reference: [`solutions/exercise-3-end.ts`](../solutions/exercise-3-end.ts).

---

## Mental model first

DaloyJS middleware composes outside-in. The order you call `app.use()` is the order they wrap a request:

```
client → requestId → secureHeaders → cors → rateLimit → bodyLimit → handler
                                                          ↑
                                            (App-level, not a middleware)
```

Two App-level options live on `new App({ ... })` instead of `app.use()`:

- `bodyLimitBytes` — checked _before_ the body is parsed. Saves you memory.
- `requestTimeoutMs` — wraps the handler in a race; loser becomes a 408.

They are App-level because they're not optional in production. Putting them in the constructor makes "we forgot to enable it" impossible.

Order of work:

1. Tighten the `App` constructor.
2. Register the four middleware in the right order.
3. Verify each guardrail by hand.

---

## Step 1 — Tighten the `App` constructor

**Why first:** these don't depend on anything else, and they apply to every route automatically.

Change:

```ts
const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: { info: { title: "Workshop API", version: "0.1.0" } },
  docs: true,
});
```

to:

```ts
const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: { info: { title: "Workshop API", version: "0.1.0" } },
  docs: true,
  bodyLimitBytes: 64 * 1024, // 64 KB — generous for a JSON API
  requestTimeoutMs: 5_000, // 5 seconds — anything slower is a real bug
});
```

**Why 64 KB:** most JSON APIs have a 95th-percentile body well under 4 KB. 64 KB gives plenty of headroom for legitimate inputs while still rejecting megabyte payloads. (If you build a media upload endpoint, narrow the limit further on that one route — see exercise 11 in the 8-hour track.)

**Why 5 seconds:** the framework's posture is that any handler taking longer than five seconds has a real problem — a hung database call, a runaway loop, a missing index. The right answer is to fix the handler, not raise the limit.

---

## Step 2 — Add the imports

Replace:

```ts
import { App, NotFoundError } from "@daloyjs/core";
```

with:

```ts
import { App } from "@daloyjs/core";
import { requestId, secureHeaders, cors, rateLimit } from "@daloyjs/core";
```

(You can keep one combined import line — the two are split here just for visual grouping.)

---

## Step 3 — Register the middleware (order matters)

Below the `const app = ...` block:

```ts
app.use(requestId());
app.use(secureHeaders());
app.use(cors({ origin: "https://app.example.com", credentials: false }));
app.use(rateLimit({ windowMs: 60_000, max: 60 }));
```

**Why this order:**

1. **`requestId` first** so the id is in scope for every later middleware's logs (and for the rate-limit 429 response body).
2. **`secureHeaders` second** so the headers apply to _all_ responses including CORS preflights and rate-limit rejections.
3. **`cors` third** — it has to run before any handler that might respond, but after `secureHeaders` so `Access-Control-Allow-Origin` doesn't get overwritten.
4. **`rateLimit` last** so it doesn't waste a token on requests that would have been rejected by CORS anyway.

**Why explicit origin and not `"*"`:** `*` is the single most common reason an API gets pulled into a credential-theft incident report. If you genuinely need many origins, build an allowlist; never use a wildcard with `credentials: true`.

---

## Step 4 — Verify the secureHeaders + requestId

```bash
curl -sI http://localhost:3000/docs | grep -iE 'x-(content-type-options|frame-options|request-id)|strict-transport-security'
```

You should see at least:

- `x-content-type-options: nosniff`
- `x-frame-options: DENY`
- `strict-transport-security: max-age=…; includeSubDomains`
- `x-request-id: <ulid or uuid>`

If any are missing, your middleware order is wrong, or you forgot a `.use()` call.

---

## Step 5 — Verify the rest of the guardrails

```bash
# CORS preflight: explicit origin echoes back
curl -s -X OPTIONS http://localhost:3000/echo \
  -H 'origin: https://app.example.com' \
  -H 'access-control-request-method: POST' -i | grep -i access-control
# access-control-allow-origin: https://app.example.com   ← not "*"

# Body limit: 413
curl -s -i -X POST http://localhost:3000/echo \
  -H 'content-type: application/json' \
  --data "@<(printf '{\"payload\":\"%s\"}' $(head -c 100000 /dev/urandom | base64))" | head -n 1
# HTTP/1.1 413 Payload Too Large

# Request timeout: 408
curl -sI -m 7 http://localhost:3000/slow | head -n 1
# HTTP/1.1 408 Request Timeout

# Rate limit: 429 after the 61st request in a minute
for i in $(seq 1 65); do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/docs; done | sort | uniq -c
#   60 200
#    5 429
```

Each rejection comes back as `application/problem+json` with a proper `status`, `title`, and `requestId`.

---

## Code-change cheat sheet

| Step | Where             | Change                                                   |
| ---- | ----------------- | -------------------------------------------------------- |
| 1    | `new App({...})`  | Add `bodyLimitBytes: 64 * 1024, requestTimeoutMs: 5_000` |
| 2    | Imports           | Add `requestId, secureHeaders, cors, rateLimit`          |
| 3    | Below `const app` | Four `app.use(...)` calls in the documented order        |

---

## Common mistakes

- **`cors({ origin: "*", credentials: true })`.** This is invalid per the spec and most browsers reject it — but every quarter, someone ships it anyway. Use a real origin or an allowlist.
- **Forgetting `requestId` because "we have a logger".** The logger needs the id to thread requests across services. Without `requestId`, your downstream calls inherit nothing to correlate on.
- **Disabling `bodyLimitBytes` on the App "for the upload route".** Don't. Keep the global limit; override _only_ on the upload route with a larger limit. Otherwise every endpoint inherits the unsafe value.
- **Putting `rateLimit` first.** A blocked request now wastes the slot you could have given to a real customer. Always rate-limit after CORS rejects the obvious garbage.
