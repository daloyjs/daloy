# Challenge 2 — Bug: Annotated Walkthrough

> Do not read this until you've spent at least 20 minutes attempting the fixes yourself. The five regressions are intentional and the muscle memory matters more than the answer.

---

## Regression #1 — `bodyLimitBytes: 0` + `requestTimeoutMs: 0`

```ts
bodyLimitBytes: 0,
requestTimeoutMs: 0,
```

**Why it's dangerous:** `0` reads as "no limit" to most JavaScript code, including this framework. That means:

- A single attacker can send a 4 GB JSON body and OOM the process.
- A handler with an infinite loop or a hung downstream call holds the event loop forever.

**Fix:**

```ts
bodyLimitBytes: 64 * 1024,
requestTimeoutMs: 5_000,
```

Don't disable the guardrail. If one specific route genuinely needs a 10 MB upload, override `bodyLimitBytes` on that one route only — keep the safe default for everyone else.

---

## Regression #2 — `scheme: "none"` in `securitySchemes`

```ts
securitySchemes: { bearer: { type: "http", scheme: "none" as any } },
```

**Why it's dangerous:** this is the HTTP analogue of the JWT [alg-confusion attack](https://daloyjs.dev/docs/auth). A `"none"` scheme tells the OpenAPI tooling there's no real auth — generated clients won't send headers, and Scalar's lock icon is misleading.

**Fix:**

```ts
securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
```

Also remove the `as any` — if you find yourself reaching for `as any` to satisfy a security typing, the type system is telling you the truth.

---

## Regression #3 — `secureHeaders()` missing

The middleware stack used to be four items. Now it's two.

**Why it's dangerous:** without `secureHeaders()` the response is missing:

- `X-Content-Type-Options: nosniff` (mime-sniffing attacks).
- `X-Frame-Options: DENY` (clickjacking).
- `Strict-Transport-Security` (downgrade attacks).
- `Referrer-Policy` (leaky `Referer` headers across origins).

**Fix:** restore the middleware in the correct order:

```ts
app.use(requestId());
app.use(secureHeaders());
app.use(cors({ ... }));
app.use(rateLimit({ ... }));
```

`requestId` first so the id propagates into every later log line and response header. `secureHeaders` second so the headers apply to CORS preflights and rate-limit rejections too.

---

## Regression #4 — `cors({ origin: "*", credentials: true })`

```ts
app.use(cors({ origin: "*", credentials: true }));
```

**Why it's dangerous:** this exact combination is _invalid_ per the CORS spec. Most browsers ignore the `Access-Control-Allow-Origin: *` when `credentials: true`, which means:

- In development, your app silently appears to work because the dev origin is the same as the API.
- In production, customers complain that "the API broke their app" — actually the browser is refusing to send cookies.

Worse, if a teammate ever switches to `origin: req.headers.origin` to "fix" the credentials bug, you now reflect every origin. That's a credential-theft vulnerability.

**Fix:** allowlist real origins.

```ts
app.use(cors({ origin: "https://app.example.com", credentials: true }));
```

Or a function form for multiple legitimate origins. Never `*` with credentials.

---

## Regression #5 — Handler returns a hand-rolled error with a path leak

```ts
return {
  status: 404 as const,
  body: {
    error: `Lookup failed in books.get() at /app/src/books.ts:42 for id=${params.id}`,
  } as any,
};
```

**Why it's dangerous:** three things at once.

1. **Server path disclosure.** `/app/src/books.ts:42` tells an attacker your deployment layout.
2. **Bypasses RFC 9457.** The framework's problem+json pipeline never runs because the handler took ownership of the body.
3. **Drops `requestId`.** Now your logs and the error response have no shared correlation id.

**Fix:**

```ts
if (!b) throw new NotFoundError(`No book with id ${params.id}`);
```

Let the framework render the 404. The `detail` will be redacted in production but visible in development. Everyone gets a `requestId` for correlation.

---

## Bonus regressions on `POST /books`

### Bonus A — No `.strict()` on the request body

```ts
request: { body: z.object({ id: z.string(), title: z.string() }) },
```

**Why it's dangerous:** Zod silently accepts `{ id, title, isAdmin: true }`. The `isAdmin` field would be discarded by the schema, but if any code downstream destructures `body` and passes it to a database write, the extra fields land in the DB. This is mass-assignment, the third item on the [OWASP API Top 10](https://owasp.org/API-Security/editions/2023/en/0xa3-broken-object-property-level-authorization/).

**Fix:**

```ts
request: { body: z.object({ id: z.string().min(1), title: z.string().min(1) }).strict() },
```

### Bonus B — Missing `auth: { scheme: "bearer" }` on the route

The route enforces the token via `hooks: bearerAuth(...)` at runtime, but the OpenAPI spec has no `security` field on the operation.

**Why it's dangerous:** the generated typed client doesn't know to send `Authorization`. Frontend devs hit runtime 401s in prod because the contract lied.

**Fix:**

```ts
auth: { scheme: "bearer" },
hooks: bearerAuth({ validate: (token) => token === "demo-token" }),
```

Add the `auth` field. Same enforcement at runtime; now the contract matches reality.

---

## After the fix

Run the verification commands from `instructions/challenge-2-bug.md`. All five (or seven, counting bonuses) checks should pass without any default being weakened.

Then ask yourself: which of these regressions would your **current** code review catch? Which would slip through? The whole point of the framework's defaults is that those answers should be "all of them" and "none of them", respectively — but only if you keep the guardrails on.
