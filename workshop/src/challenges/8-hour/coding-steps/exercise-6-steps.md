# 8-Hour · Exercise 6 — Step-by-Step

> Goal: sign and verify JWTs with an explicit algorithm allowlist that defeats `alg:none` and alg-confusion attacks.

## Step 1 — Wire `POST /auth/login`

```ts
app.post(
  "/auth/login",
  {
    operationId: "login",
    ...
  },
  async ({ body }) => {
    if (USERS.get(body.username) !== body.password) {
      throw new UnauthorizedError("Bad credentials");
    }
    const now = Math.floor(Date.now() / 1000);
    const token = await signer.sign({ sub: body.username, iat: now, exp: now + 60 * 60 });
    return { status: 200 as const, body: { token } };
  },
);
```

**Workshop simplification:** `USERS` is an in-memory map and the password check uses `===`. In production, hash the password (argon2id) and compare with the verifier's built-in constant-time check.

## Step 2 — Write the JWT hook

```ts
const jwtAuth: Hooks = {
  async beforeHandle(ctx) {
    const header = ctx.request.headers.get("authorization");
    if (!header || !header.startsWith("Bearer ")) {
      throw new UnauthorizedError("Missing bearer token");
    }
    const token = header.slice("Bearer ".length);
    try {
      const verified = await verifier.verify(token);
      const sub = verified.payload.sub;
      if (typeof sub !== "string") throw new Error("missing sub");
      ctx.state.user = sub;
    } catch {
      throw new UnauthorizedError("Invalid token");
    }
  },
};
```

Create the signer and verifier once near the top of the file:

```ts
const signer = createJwtSigner({ alg: "HS256", key: JWT_KEY, maxLifetimeSeconds: 60 * 60 });
const verifier = createJwtVerifier({ algorithms: ["HS256"], key: JWT_KEY });
```

**Why `algorithms: ["HS256"]` and not a broad allowlist:**

- An attacker can forge a token with header `{"alg":"none"}` and an empty signature. Without an allowlist, some libraries _accept_ this.
- An attacker can sign a token using RS256 with the public key as if it were an HMAC secret — this is "alg confusion".
- An allowlist with exactly one entry makes both attacks impossible to express.

## Step 3 — Apply to `/me`

```ts
auth: { scheme: "bearer" },
hooks: jwtAuth,
```

## Step 4 — Try to forge an `alg:none` token

```bash
NONE_TOKEN=$(echo -n '{"alg":"none","typ":"JWT"}' | base64).$(echo -n '{"sub":"alice"}' | base64).
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/me -H "authorization: Bearer $NONE_TOKEN"
# 401
```

The verifier rejects it because `"none"` is not in `algorithms`.

## Step 5 — Bonus: JWKS verifier (asymmetric, production pattern)

The commented `jwk(...)` block at the bottom of the solution is what you actually use against Auth0, Cognito, Keycloak, etc. The pattern is the same — explicit `algorithms: ["RS256"]` allowlist, plus JWKS fetching, caching, and key rotation.

## Common mistakes

- **Building a verifier with a broad algorithm list.** This is the bug pattern.
- **Allowing `algorithms: ["HS256", "RS256"]` "to be safe".** This is exactly how alg confusion is enabled. Pick one shape of key (symmetric vs asymmetric) per verifier.
- **Using the same `SECRET` constant across services.** Each issuer gets its own key, rotated regularly.
- **`expiresIn: "30d"`.** Short-lived access tokens + a refresh-token flow is the right shape. A 30-day access token is a 30-day window of compromise.
