import { test } from "node:test";
import assert from "node:assert/strict";

import {
  App,
  basicAuth,
  bearerAuth,
  createJwtSigner,
  jwk,
  type JwkSet,
} from "../src/index.js";

// ============================================================
// bearerAuth — verify() revalidation hook
// ============================================================

test("bearerAuth: 401 challenge carries cache-control: no-store", async () => {
  const app = new App();
  app.use(bearerAuth({ validate: () => true }));
  app.route({
    method: "GET",
    path: "/x",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.request(new Request("http://x/x"));
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.ok(res.headers.get("www-authenticate")?.startsWith("Bearer "));
});

test("bearerAuth: refuses missing validate and header-breaking realm", () => {
  assert.throws(
    () => bearerAuth(undefined as unknown as Parameters<typeof bearerAuth>[0]),
    /validate/,
  );
  assert.throws(
    () => bearerAuth({ validate: () => true, realm: 'bad"\r\n' }),
    /realm/,
  );
});

test("bearerAuth: verify hook accepts when returns true / void / undefined", async () => {
  for (const result of [true, undefined as unknown as true]) {
    const app = new App();
    app.use(
      bearerAuth({
        validate: () => true,
        verify: async () => result,
      }),
    );
    app.route({
      method: "GET",
      path: "/",
      responses: { 200: { description: "ok" } },
      handler: () => ({ status: 200 as const, body: { ok: true } }),
    });
    const res = await app.request(
      new Request("http://x/", { headers: { authorization: "Bearer abc" } }),
    );
    assert.equal(res.status, 200);
  }
});

test("bearerAuth: verify hook returning false rejects with 403", async () => {
  const app = new App();
  app.use(
    bearerAuth({
      validate: () => true,
      verify: () => false,
    }),
  );
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.request(
    new Request("http://x/", { headers: { authorization: "Bearer abc" } }),
  );
  assert.equal(res.status, 403);
});

test("bearerAuth: validate rejection still wins before verify runs", async () => {
  let verifyCalled = false;
  const app = new App();
  app.use(
    bearerAuth({
      validate: () => false,
      verify: () => {
        verifyCalled = true;
        return true;
      },
    }),
  );
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.request(
    new Request("http://x/", { headers: { authorization: "Bearer abc" } }),
  );
  assert.equal(res.status, 403);
  assert.equal(verifyCalled, false);
});

// ============================================================
// basicAuth — onAuthSuccess typed callback
// ============================================================

test("basicAuth: onAuthSuccess fires after verify and after default user stamp", async () => {
  const seen: Array<{ user: string; pass: string; stateUser: unknown }> = [];
  const app = new App();
  app.use(
    basicAuth({
      verify: () => true,
      onAuthSuccess: (creds, ctx) => {
        seen.push({
          user: creds.username,
          pass: creds.password,
          stateUser: (ctx.state as Record<string, unknown>).user,
        });
        (ctx.state as Record<string, unknown>).extra = "yes";
      },
    }),
  );
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: (ctx) => ({
      status: 200 as const,
      body: { extra: (ctx.state as Record<string, unknown>).extra ?? null },
    }),
  });
  const auth = `Basic ${Buffer.from("alice:p1").toString("base64")}`;
  const res = await app.request(
    new Request("http://x/", { headers: { authorization: auth } }),
  );
  assert.equal(res.status, 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.user, "alice");
  assert.equal(seen[0]!.pass, "p1");
  assert.deepEqual(seen[0]!.stateUser, { username: "alice" });
  assert.deepEqual(await res.json(), { extra: "yes" });
});

test("basicAuth: 401 challenge carries cache-control: no-store", async () => {
  const app = new App();
  app.use(basicAuth({ verify: () => true }));
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.request(new Request("http://x/"));
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

// ============================================================
// jwk() — construction-time refusals
// ============================================================

test("jwk: refuses missing options", () => {
  assert.throws(() => jwk(undefined as unknown as Parameters<typeof jwk>[0]));
});

test("jwk: refuses empty/missing algorithms allowlist", () => {
  assert.throws(() => jwk({ jwks: { keys: [] }, algorithms: [] as never }));
  assert.throws(() =>
    jwk({ jwks: { keys: [] }, algorithms: undefined as unknown as never }),
  );
});

test("jwk: refuses symmetric HS* algorithms outright", () => {
  assert.throws(
    () => jwk({ jwks: { keys: [] }, algorithms: ["HS256" as never] }),
    /asymmetric|HS\*/,
  );
});

test("jwk: refuses unknown algorithm", () => {
  assert.throws(
    () => jwk({ jwks: { keys: [] }, algorithms: ["RS999" as never] }),
  );
});

test("jwk: refuses plaintext http:// JWKS URL", () => {
  assert.throws(
    () => jwk({ jwks: "http://idp/keys.json", algorithms: ["RS256"] }),
    /https:\/\//,
  );
});

test("jwk: refuses non-JwkSet jwks option", () => {
  assert.throws(
    () => jwk({ jwks: 42 as unknown as JwkSet, algorithms: ["RS256"] }),
  );
});

test("jwk: refuses invalid realm characters", () => {
  assert.throws(
    () =>
      jwk({
        jwks: { keys: [] },
        algorithms: ["RS256"],
        realm: 'bad"\r\n',
      }),
  );
});

test("jwk: refuses negative fetchTtlSeconds", () => {
  assert.throws(
    () =>
      jwk({
        jwks: { keys: [] },
        algorithms: ["RS256"],
        fetchTtlSeconds: -1,
      }),
  );
  assert.throws(
    () =>
      jwk({
        jwks: { keys: [] },
        algorithms: ["RS256"],
        fetchTtlSeconds: Number.POSITIVE_INFINITY,
      }),
  );
});

// ============================================================
// jwk() — happy path with ES256 + scopes + revocation hook
// ============================================================

async function genEs256Pair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
}

async function publicJwkFor(pair: CryptoKeyPair, kid: string, alg: string): Promise<JsonWebKey> {
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  return { ...jwk, kid, alg, use: "sig" };
}

async function privateJwkFor(pair: CryptoKeyPair): Promise<JsonWebKey> {
  return (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
}

test("jwk: verifies ES256 token through static JWKS, stamps user + scopes", async () => {
  const pair = await genEs256Pair();
  const pub = await publicJwkFor(pair, "k1", "ES256");
  const priv = await privateJwkFor(pair);
  const jwks: JwkSet = { keys: [pub] };

  const signer = createJwtSigner({
    alg: "ES256",
    key: priv,
    maxLifetimeSeconds: 3600,
    header: { kid: "k1" },
  });
  const now = Math.floor(Date.now() / 1000);
  const token = await signer.sign({
    sub: "user-1",
    iss: "https://issuer",
    aud: "books",
    scope: "items:read items:write items:read",
    iat: now,
    exp: now + 300,
  });

  const app = new App();
  app.use(
    jwk({
      jwks,
      algorithms: ["ES256"],
      issuer: "https://issuer",
      audience: "books",
    }),
  );
  app.route({
    method: "GET",
    path: "/me",
    responses: { 200: { description: "ok" } },
    handler: (ctx) => ({
      status: 200 as const,
      body: { user: (ctx.state as Record<string, unknown>).user },
    }),
  });
  const res = await app.request(
    new Request("http://x/me", { headers: { authorization: `Bearer ${token}` } }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { sub: string; scopes: string[] } };
  assert.equal(body.user.sub, "user-1");
  assert.deepEqual([...body.user.scopes].sort(), ["items:read", "items:write"]);
});

test("jwk: missing Authorization → 401 with WWW-Authenticate: Bearer realm", async () => {
  const app = new App();
  app.use(jwk({ jwks: { keys: [] }, algorithms: ["RS256"], realm: "scoped" }));
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.request(new Request("http://x/"));
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const wa = res.headers.get("www-authenticate") ?? "";
  assert.ok(wa.includes('realm="scoped"'));
  assert.ok(!wa.includes("error="));
});

test("jwk: token without kid → 401 invalid_token", async () => {
  const pair = await genEs256Pair();
  const priv = await privateJwkFor(pair);
  const signer = createJwtSigner({
    alg: "ES256",
    key: priv,
    maxLifetimeSeconds: 3600,
    // intentionally no kid header
  });
  const now = Math.floor(Date.now() / 1000);
  const token = await signer.sign({ sub: "u", exp: now + 100, iat: now });

  const pub = await publicJwkFor(pair, "k1", "ES256");
  const app = new App();
  app.use(jwk({ jwks: { keys: [pub] }, algorithms: ["ES256"] }));
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.request(
    new Request("http://x/", { headers: { authorization: `Bearer ${token}` } }),
  );
  assert.equal(res.status, 401);
  const wa = res.headers.get("www-authenticate") ?? "";
  assert.ok(wa.includes('error="invalid_token"'));
});

test("jwk: kid not in JWKS → 401 invalid_token", async () => {
  const pair = await genEs256Pair();
  const priv = await privateJwkFor(pair);
  const signer = createJwtSigner({
    alg: "ES256",
    key: priv,
    maxLifetimeSeconds: 3600,
    header: { kid: "unknown" },
  });
  const now = Math.floor(Date.now() / 1000);
  const token = await signer.sign({ sub: "u", exp: now + 100, iat: now });

  const pub = await publicJwkFor(pair, "different", "ES256");
  const app = new App();
  app.use(jwk({ jwks: { keys: [pub] }, algorithms: ["ES256"] }));
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.request(
    new Request("http://x/", { headers: { authorization: `Bearer ${token}` } }),
  );
  assert.equal(res.status, 401);
});

test("jwk: attacker-controlled kid text is sanitized from WWW-Authenticate", async () => {
  const pair = await genEs256Pair();
  const priv = await privateJwkFor(pair);
  const signer = createJwtSigner({
    alg: "ES256",
    key: priv,
    maxLifetimeSeconds: 3600,
    header: { kid: 'bad"\r\nkid\\' },
  });
  const now = Math.floor(Date.now() / 1000);
  const token = await signer.sign({ sub: "u", exp: now + 100, iat: now });

  const pub = await publicJwkFor(pair, "different", "ES256");
  const app = new App();
  app.use(jwk({ jwks: { keys: [pub] }, algorithms: ["ES256"] }));
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.request(
    new Request("http://x/", { headers: { authorization: `Bearer ${token}` } }),
  );
  assert.equal(res.status, 401);
  const challenge = res.headers.get("www-authenticate") ?? "";
  assert.ok(challenge.includes('error="invalid_token"'));
  assert.ok(!/["\r\n\\]/.test(challenge.replace('Bearer realm="api", error="invalid_token", error_description="', "").slice(0, -1)));
});

test("jwk: token alg ≠ JWK alg → 401 invalid_token", async () => {
  const pair = await genEs256Pair();
  const priv = await privateJwkFor(pair);
  const signer = createJwtSigner({
    alg: "ES256",
    key: priv,
    maxLifetimeSeconds: 3600,
    header: { kid: "k1" },
  });
  const now = Math.floor(Date.now() / 1000);
  const token = await signer.sign({ sub: "u", exp: now + 100, iat: now });

  // JWK advertises a different alg than the token header
  const pub = await publicJwkFor(pair, "k1", "ES384");
  const app = new App();
  app.use(jwk({ jwks: { keys: [pub] }, algorithms: ["ES256", "ES384"] }));
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.request(
    new Request("http://x/", { headers: { authorization: `Bearer ${token}` } }),
  );
  assert.equal(res.status, 401);
});

test("jwk: per-request verify() returning false → 403", async () => {
  const pair = await genEs256Pair();
  const pub = await publicJwkFor(pair, "k1", "ES256");
  const priv = await privateJwkFor(pair);
  const signer = createJwtSigner({
    alg: "ES256",
    key: priv,
    maxLifetimeSeconds: 3600,
    header: { kid: "k1" },
  });
  const now = Math.floor(Date.now() / 1000);
  const token = await signer.sign({ sub: "u-revoked", exp: now + 100, iat: now });

  let seenSub: unknown;
  const app = new App();
  app.use(
    jwk({
      jwks: { keys: [pub] },
      algorithms: ["ES256"],
      verify: (payload) => {
        seenSub = payload.sub;
        return payload.sub !== "u-revoked";
      },
    }),
  );
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.request(
    new Request("http://x/", { headers: { authorization: `Bearer ${token}` } }),
  );
  assert.equal(res.status, 403);
  assert.equal(seenSub, "u-revoked");
});

test("jwk: per-request verify() returning void/true accepts", async () => {
  const pair = await genEs256Pair();
  const pub = await publicJwkFor(pair, "k1", "ES256");
  const priv = await privateJwkFor(pair);
  const signer = createJwtSigner({
    alg: "ES256",
    key: priv,
    maxLifetimeSeconds: 3600,
    header: { kid: "k1" },
  });
  const now = Math.floor(Date.now() / 1000);
  const token = await signer.sign({
    sub: "ok",
    scp: ["a", 42, "a", { nested: true }, "b"],
    exp: now + 100,
    iat: now,
  });

  const app = new App();
  app.use(
    jwk({
      jwks: { keys: [pub] },
      algorithms: ["ES256"],
      verify: () => undefined,
    }),
  );
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: (ctx) => ({
      status: 200 as const,
      body: {
        scopes: ((ctx.state as Record<string, unknown>).user as { scopes: string[] }).scopes,
      },
    }),
  });
  const res = await app.request(
    new Request("http://x/", { headers: { authorization: `Bearer ${token}` } }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { scopes: string[] };
  assert.deepEqual(body.scopes, ["a", "b"]);
});

test("jwk: 'scopes' array claim is normalized to deduped scope list", async () => {
  const pair = await genEs256Pair();
  const pub = await publicJwkFor(pair, "k1", "ES256");
  const priv = await privateJwkFor(pair);
  const signer = createJwtSigner({
    alg: "ES256",
    key: priv,
    maxLifetimeSeconds: 3600,
    header: { kid: "k1" },
  });
  const now = Math.floor(Date.now() / 1000);
  const token = await signer.sign({
    sub: "ok",
    scopes: ["x", "y"],
    exp: now + 100,
    iat: now,
  });

  const app = new App();
  app.use(jwk({ jwks: { keys: [pub] }, algorithms: ["ES256"] }));
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: (ctx) => ({
      status: 200 as const,
      body: { user: (ctx.state as Record<string, unknown>).user },
    }),
  });
  const res = await app.request(
    new Request("http://x/", { headers: { authorization: `Bearer ${token}` } }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { scopes: string[] } };
  assert.deepEqual(body.user.scopes, ["x", "y"]);
});

test("jwk: no scope claim → scopes is empty array", async () => {
  const pair = await genEs256Pair();
  const pub = await publicJwkFor(pair, "k1", "ES256");
  const priv = await privateJwkFor(pair);
  const signer = createJwtSigner({
    alg: "ES256",
    key: priv,
    maxLifetimeSeconds: 3600,
    header: { kid: "k1" },
  });
  const now = Math.floor(Date.now() / 1000);
  const token = await signer.sign({ sub: "ok", exp: now + 100, iat: now });

  const app = new App();
  app.use(jwk({ jwks: { keys: [pub] }, algorithms: ["ES256"] }));
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: (ctx) => ({
      status: 200 as const,
      body: { user: (ctx.state as Record<string, unknown>).user },
    }),
  });
  const res = await app.request(
    new Request("http://x/", { headers: { authorization: `Bearer ${token}` } }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { scopes: string[] } };
  assert.deepEqual(body.user.scopes, []);
});

// ============================================================
// jwk() — JWKS resolver function + URL fetch path
// ============================================================

test("jwk: accepts a JWKS resolver function", async () => {
  const pair = await genEs256Pair();
  const pub = await publicJwkFor(pair, "k1", "ES256");
  const priv = await privateJwkFor(pair);
  const signer = createJwtSigner({
    alg: "ES256",
    key: priv,
    maxLifetimeSeconds: 3600,
    header: { kid: "k1" },
  });
  const now = Math.floor(Date.now() / 1000);
  const token = await signer.sign({ sub: "ok", exp: now + 100, iat: now });

  let calls = 0;
  const app = new App();
  app.use(
    jwk({
      jwks: async () => {
        calls += 1;
        return { keys: [pub] };
      },
      algorithms: ["ES256"],
    }),
  );
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.request(
    new Request("http://x/", { headers: { authorization: `Bearer ${token}` } }),
  );
  assert.equal(res.status, 200);
  assert.ok(calls >= 1);
});

test("jwk: resolver returning a non-JwkSet rejects requests", async () => {
  const app = new App();
  app.use(
    jwk({
      jwks: () => ({ notKeys: true } as unknown as JwkSet),
      algorithms: ["RS256"],
    }),
  );
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.request(
    new Request("http://x/", { headers: { authorization: "Bearer x.y.z" } }),
  );
  assert.equal(res.status, 401);
});

test("jwk: https URL is fetched, cached for TTL, and serves verification", async () => {
  const pair = await genEs256Pair();
  const pub = await publicJwkFor(pair, "k1", "ES256");
  const priv = await privateJwkFor(pair);
  const signer = createJwtSigner({
    alg: "ES256",
    key: priv,
    maxLifetimeSeconds: 3600,
    header: { kid: "k1" },
  });
  const now = Math.floor(Date.now() / 1000);
  const token = await signer.sign({ sub: "ok", exp: now + 100, iat: now });

  let fetchCalls = 0;
  const fakeFetch: typeof fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ keys: [pub] }), {
      headers: { "content-type": "application/json" },
    });
  };

  const app = new App();
  app.use(
    jwk({
      jwks: "https://issuer/.well-known/jwks.json",
      algorithms: ["ES256"],
      fetch: fakeFetch,
      fetchTtlSeconds: 60,
    }),
  );
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const auth = `Bearer ${token}`;
  for (let i = 0; i < 3; i++) {
    const res = await app.request(
      new Request("http://x/", { headers: { authorization: auth } }),
    );
    assert.equal(res.status, 200, `request ${i} should be 200`);
  }
  assert.equal(fetchCalls, 1);
});

test("jwk: https URL fetch returning non-2xx → request fails 401", async () => {
  const fakeFetch: typeof fetch = async () => new Response("nope", { status: 500 });
  const app = new App();
  app.use(
    jwk({
      jwks: "https://issuer/keys",
      algorithms: ["ES256"],
      fetch: fakeFetch,
    }),
  );
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.request(
    new Request("http://x/", { headers: { authorization: "Bearer a.b.c" } }),
  );
  assert.equal(res.status, 401);
});

test("jwk: https URL fetch returning malformed JSON → 401", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ notKeys: 1 }), {
      headers: { "content-type": "application/json" },
    });
  const app = new App();
  app.use(
    jwk({
      jwks: "https://issuer/keys",
      algorithms: ["ES256"],
      fetch: fakeFetch,
    }),
  );
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.request(
    new Request("http://x/", { headers: { authorization: "Bearer a.b.c" } }),
  );
  assert.equal(res.status, 401);
});

test("jwk: concurrent requests share a single in-flight JWKS fetch", async () => {
  const pair = await genEs256Pair();
  const pub = await publicJwkFor(pair, "k1", "ES256");
  const priv = await privateJwkFor(pair);
  const signer = createJwtSigner({
    alg: "ES256",
    key: priv,
    maxLifetimeSeconds: 3600,
    header: { kid: "k1" },
  });
  const now = Math.floor(Date.now() / 1000);
  const token = await signer.sign({ sub: "ok", exp: now + 100, iat: now });

  let fetchCalls = 0;
  const fakeFetch: typeof fetch = async () => {
    fetchCalls += 1;
    await new Promise((r) => setTimeout(r, 10));
    return new Response(JSON.stringify({ keys: [pub] }), {
      headers: { "content-type": "application/json" },
    });
  };

  const app = new App();
  app.use(
    jwk({
      jwks: "https://issuer/keys",
      algorithms: ["ES256"],
      fetch: fakeFetch,
      fetchTtlSeconds: 60,
    }),
  );
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const auth = `Bearer ${token}`;
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      app.request(new Request("http://x/", { headers: { authorization: auth } })),
    ),
  );
  for (const r of results) assert.equal(r.status, 200);
  assert.equal(fetchCalls, 1);
});
