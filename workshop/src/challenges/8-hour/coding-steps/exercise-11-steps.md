# 8-Hour · Exercise 11 — Step-by-Step

> Goal: outbound SSRF protection + signed-cookie sessions + authenticated WebSocket.

## Step 1 — Configure `fetchGuard`

```ts
const safeFetch = fetchGuard({
  allowProtocols: ["https:"],
  maxRedirects: 3,
});
```

The defaults are already strict — private IPv4 and IPv6 ranges blocked, plus link-local 169.254.0.0/16 (the AWS/Azure/GCP metadata service). You're adding:

- **`allowProtocols: ["https:"]`** — drop `http:` to prevent downgrade attacks and `file:` / `ftp:` shenanigans.
- **`maxRedirects: 3`** — a malicious server can return `Location: http://169.254.169.254/`. The guard re-checks every redirect target, but bounded redirects also prevent loops.
- Use `AbortSignal.timeout(5_000)` at call time when you need a per-fetch timeout.

## Step 2 — Session helpers

```ts
function signSession(username: string): string {
  const payload = Buffer.from(JSON.stringify({ sub: username, iat: Date.now() })).toString(
    "base64url"
  );
  const sig = createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifySession(cookie: string | undefined | null) {
  if (!cookie) return null;
  const [payload, sig] = cookie.split(".");
  const expected = createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  // ... timingSafeEqual + JSON.parse
}
```

**Why HMAC and not JWT here:** JWTs carry their algorithm in the header (`{"alg":"HS256"}`). For a server-issued cookie that never leaves your domain, you don't need the algorithm in the token at all — you _are_ the issuer and verifier. Bare `payload.hmac` is smaller, simpler, and harder to mis-implement.

## Step 3 — Set the cookie on `/login`

```ts
headers: { "set-cookie": `session=${token}; Path=/; HttpOnly; SameSite=Strict; Secure` },
```

All three attributes matter:

- `HttpOnly` — JS can't read it (defeats XSS-based theft).
- `SameSite=Strict` — browser won't send it on cross-origin requests (defeats CSRF for state-changing endpoints).
- `Secure` — never sent over HTTP.

## Step 4 — The WebSocket

```ts
app.ws("/ws", {
  allowedOrigins: "same-origin",
  beforeUpgrade(request, ctx) {
    const session = parseCookies(request.headers.get("cookie")).session;
    const claims = verifySession(session);
    if (!claims) return new Response("Unauthorized", { status: 401 });
    ctx.state.sub = claims.sub;
    return undefined;
  },
  open(conn, ctx) {
    conn.send(`hello ${ctx.state.sub}`);
  },
  message(conn, msg) {
    conn.send(`echo: ${msg}`);
  },
});
```

The `beforeUpgrade` callback runs during the upgrade handshake, before the socket is accepted. Returning a `Response` rejects the upgrade and never opens the WebSocket.

## Common mistakes

- **Disabling `fetchGuard`'s private-IP defaults to allow internal services.** If you _have_ to call internal services, do it directly without going through the user-supplied URL path. Don't relax the guard.
- **Storing `SESSION_SECRET` in your repo.** Use an env variable, rotate periodically, and accept N old secrets during rotation.
- **Verifying the WebSocket's session in `open` instead of `beforeUpgrade`.** By the time `open` runs, the upgrade has already succeeded — the client has an open socket and you've already paid for it.
- **Setting `SameSite=None` to "support more clients".** That removes the CSRF defense and only matters for cross-origin embeds. Default to `Strict`; relax to `Lax` only if you have a documented reason.
