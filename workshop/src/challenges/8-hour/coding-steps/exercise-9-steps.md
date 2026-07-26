# 8-Hour · Exercise 9 — Step-by-Step

> Goal: configure the three browser-facing defenses correctly — CSP, CORS, and CSRF.

## Step 1 — Tight `secureHeaders` with CSP

```ts
app.use(
  secureHeaders({
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'"],
        "frame-ancestors": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
      },
    },
  })
);
```

**Why `'unsafe-inline'` on `style-src` only:** Scalar (the `/docs` renderer) injects style tags. Allowing it for styles is low-risk; allowing it for `script-src` is catastrophic. The rest of the policy stays strict.

## Step 2 — Explicit CORS origin list

```ts
app.use(
  cors({
    origin: ["https://app.example.com", "http://localhost:5173"],
    credentials: true,
  })
);
```

**Why a list and not a wildcard:** combining `credentials: true` with `origin: "*"` is rejected by browsers and is also genuinely unsafe (it lets any origin send authenticated requests). Enumerate the real origins.

## Step 3 — Write the CSRF hook

```ts
const csrf: Hooks = {
  beforeHandle(ctx) {
    const cookies = parseCookies(ctx.request.headers.get("cookie"));
    const headerToken = ctx.request.headers.get("x-csrf-token");
    if (!cookies.csrf || !headerToken || !safeEqual(cookies.csrf, headerToken)) {
      throw new ForbiddenError("CSRF token missing or mismatched");
    }
  },
};
```

**Why `safeEqual` (timingSafeEqual under the hood):** the CSRF token is functionally a per-session secret. Don't leak its bytes through string comparison timing.

## Step 4 — Issue and verify

```ts
// GET /csrf — issues the cookie + body
const token = randomBytes(32).toString("base64url");
return {
  status: 200 as const,
  body: { token },
  headers: { "set-cookie": `csrf=${token}; Path=/; SameSite=Strict; Secure` },
};

// POST /actions — protected
hooks: csrf,
```

**Why `SameSite=Strict; Secure`:** `SameSite` blocks the cookie on cross-origin POSTs (defense in depth), and `Secure` prevents transmission over plain HTTP.

## Common mistakes

- **`origin: true` everywhere** — this allows credentialed requests from any origin that asks. Useful in localhost development; never in production.
- **Marking the CSRF cookie `HttpOnly`.** The double-submit pattern _requires_ JavaScript to read the cookie and put it in the header. Omit `HttpOnly` for this cookie; use `HttpOnly` for the session cookie.
- **Using `Set-Cookie` without `Secure` in production.** A network attacker can downgrade the connection and steal the cookie.
- **Reusing the same CSRF token forever.** Rotate per-session, ideally per-form-page-load.
