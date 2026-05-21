import { test } from "node:test";
import assert from "node:assert/strict";

import {
  App,
  createJwtSigner,
  createJwtVerifier,
  DEFAULT_JWT_MAX_LIFETIME_SECONDS,
  JwtError,
  bearerAuth,
  requireScopes,
  REQUIRE_SCOPES_AGGREGATE_KEY,
  etag,
} from "../src/index.js";

// ============================================================
// JWT — algorithm discipline + sign/verify
// ============================================================

const subtle = (globalThis as unknown as { crypto: Crypto }).crypto.subtle;

async function genHs256Key(): Promise<Uint8Array> {
  const bytes = new Uint8Array(32);
  (globalThis as unknown as { crypto: Crypto }).crypto.getRandomValues(bytes);
  return bytes;
}

async function genRs256Pair(): Promise<CryptoKeyPair> {
  return (await subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
}

async function genEs256Pair(): Promise<CryptoKeyPair> {
  return (await subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
}

test("createJwtSigner: refuses missing options object", () => {
  assert.throws(() => createJwtSigner(undefined as unknown as Parameters<typeof createJwtSigner>[0]), JwtError);
});

test("createJwtSigner: refuses alg 'none'", () => {
  assert.throws(
    () =>
      createJwtSigner({
        alg: "none" as unknown as "HS256",
        key: new Uint8Array(32),
        maxLifetimeSeconds: 60,
      }),
    /alg_none_refused/,
  );
});

test("createJwtSigner: refuses unknown algorithm", () => {
  assert.throws(
    () =>
      createJwtSigner({
        alg: "HS999" as unknown as "HS256",
        key: new Uint8Array(32),
        maxLifetimeSeconds: 60,
      }),
    /invalid_alg/,
  );
});

test("createJwtSigner: refuses missing maxLifetimeSeconds", () => {
  assert.throws(
    () => createJwtSigner({ alg: "HS256", key: new Uint8Array(32) } as never),
    /missing_max_lifetime/,
  );
  assert.throws(
    () => createJwtSigner({ alg: "HS256", key: new Uint8Array(32), maxLifetimeSeconds: 0 }),
    /missing_max_lifetime/,
  );
  assert.throws(
    () => createJwtSigner({ alg: "HS256", key: new Uint8Array(32), maxLifetimeSeconds: Number.POSITIVE_INFINITY }),
    /missing_max_lifetime/,
  );
});

test("createJwtSigner: refuses acknowledgeNoExp: true in production", () => {
  assert.throws(
    () =>
      createJwtSigner({
        alg: "HS256",
        key: new Uint8Array(32),
        maxLifetimeSeconds: 60,
        acknowledgeNoExp: true,
        env: "production",
      }),
    /ack_no_exp_refused_in_production/,
  );
});

test("createJwtSigner: acknowledgeNoExp allowed when secureDefaults: false", async () => {
  const signer = createJwtSigner({
    alg: "HS256",
    key: await genHs256Key(),
    maxLifetimeSeconds: 60,
    acknowledgeNoExp: true,
    env: "production",
    secureDefaults: false,
  });
  const tok = await signer.sign({ sub: "u" });
  assert.equal(tok.split(".").length, 3);
});

test("createJwtSigner: rejects payload missing exp", async () => {
  const signer = createJwtSigner({
    alg: "HS256",
    key: await genHs256Key(),
    maxLifetimeSeconds: 60,
  });
  await assert.rejects(() => signer.sign({ sub: "u" }), /missing_exp/);
});

test("createJwtSigner: rejects non-object payload", async () => {
  const signer = createJwtSigner({
    alg: "HS256",
    key: await genHs256Key(),
    maxLifetimeSeconds: 60,
  });
  await assert.rejects(() => signer.sign(null as unknown as Record<string, unknown>), /invalid_payload/);
});

test("createJwtSigner: rejects non-numeric exp", async () => {
  const signer = createJwtSigner({
    alg: "HS256",
    key: await genHs256Key(),
    maxLifetimeSeconds: 60,
  });
  await assert.rejects(() => signer.sign({ exp: "soon" }), /invalid_exp/);
});

test("createJwtSigner: rejects exp exceeding maxLifetime", async () => {
  const signer = createJwtSigner({
    alg: "HS256",
    key: await genHs256Key(),
    maxLifetimeSeconds: 60,
  });
  const now = Math.floor(Date.now() / 1000);
  await assert.rejects(() => signer.sign({ iat: now, exp: now + 600 }), /exp_exceeds_max_lifetime/);
});

test("createJwtSigner: rejects exp <= iat", async () => {
  const signer = createJwtSigner({
    alg: "HS256",
    key: await genHs256Key(),
    maxLifetimeSeconds: 60,
  });
  const now = Math.floor(Date.now() / 1000);
  await assert.rejects(() => signer.sign({ iat: now, exp: now }), /exp_in_past/);
});

test("createJwtSigner: copies extra header fields", async () => {
  const signer = createJwtSigner({
    alg: "HS256",
    key: await genHs256Key(),
    maxLifetimeSeconds: 60,
    header: { kid: "k1" },
  });
  const now = Math.floor(Date.now() / 1000);
  const tok = await signer.sign({ sub: "u", exp: now + 30 });
  const [headerB64] = tok.split(".");
  const headerJson = JSON.parse(Buffer.from(headerB64!, "base64url").toString("utf8"));
  assert.equal(headerJson.kid, "k1");
  assert.equal(headerJson.alg, "HS256");
  assert.equal(headerJson.typ, "JWT");
});

test("createJwtSigner: ignores non-object header option", async () => {
  const signer = createJwtSigner({
    alg: "HS256",
    key: await genHs256Key(),
    maxLifetimeSeconds: 60,
    header: null as unknown as Record<string, unknown>,
  });
  const now = Math.floor(Date.now() / 1000);
  const tok = await signer.sign({ exp: now + 5 });
  assert.equal(tok.split(".").length, 3);
});

test("createJwtSigner: rejects Uint8Array key for asymmetric algorithm", async () => {
  await assert.rejects(async () => {
    const signer = createJwtSigner({
      alg: "RS256",
      key: new Uint8Array(64),
      maxLifetimeSeconds: 60,
    });
    const now = Math.floor(Date.now() / 1000);
    await signer.sign({ exp: now + 5 });
  }, /invalid_key/);
});

test("createJwtSigner: rejects unsupported key material", async () => {
  await assert.rejects(async () => {
    const signer = createJwtSigner({
      alg: "HS256",
      key: "not-a-key" as unknown as Uint8Array,
      maxLifetimeSeconds: 60,
    });
    const now = Math.floor(Date.now() / 1000);
    await signer.sign({ exp: now + 5 });
  }, /invalid_key/);
});

test("DEFAULT_JWT_MAX_LIFETIME_SECONDS is 30 days", () => {
  assert.equal(DEFAULT_JWT_MAX_LIFETIME_SECONDS, 30 * 24 * 60 * 60);
});

// ---------- verify ----------

test("createJwtVerifier: refuses missing options", () => {
  assert.throws(
    () => createJwtVerifier(undefined as unknown as Parameters<typeof createJwtVerifier>[0]),
    /invalid_options/,
  );
});

test("createJwtVerifier: requires non-empty algorithms allowlist", () => {
  assert.throws(
    () => createJwtVerifier({ algorithms: [], key: new Uint8Array(32) }),
    /missing_algorithms/,
  );
  assert.throws(
    () =>
      createJwtVerifier({
        algorithms: undefined as unknown as never,
        key: new Uint8Array(32),
      }),
    /missing_algorithms/,
  );
});

test("createJwtVerifier: refuses 'none' in allowlist", () => {
  assert.throws(
    () =>
      createJwtVerifier({
        algorithms: ["none" as unknown as "HS256"],
        key: new Uint8Array(32),
      }),
    /alg_none_refused/,
  );
});

test("createJwtVerifier: refuses unknown alg in allowlist", () => {
  assert.throws(
    () =>
      createJwtVerifier({
        algorithms: ["HS999" as unknown as "HS256"],
        key: new Uint8Array(32),
      }),
    /invalid_alg/,
  );
});

test("createJwtVerifier: refuses HS+JWK combination at construction", () => {
  assert.throws(
    () =>
      createJwtVerifier({
        algorithms: ["HS256"],
        key: { kty: "oct", k: "AAAA" } as JsonWebKey,
      }),
    /sym_with_jwk_refused/,
  );
});

test("createJwtVerifier: refuses HS + resolver function combination at construction", () => {
  assert.throws(
    () =>
      createJwtVerifier({
        algorithms: ["HS256"],
        key: () => new Uint8Array(32),
      }),
    /sym_with_jwk_refused/,
  );
});

test("createJwtVerifier: HS+JWK can be opted in via refuseSymmetricWithJwk: false", () => {
  const v = createJwtVerifier({
    algorithms: ["HS256"],
    key: { kty: "oct", k: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" } as JsonWebKey,
    refuseSymmetricWithJwk: false,
  });
  assert.equal(typeof v.verify, "function");
});

test("createJwtVerifier: refuses invalid clockSkewSeconds", () => {
  assert.throws(
    () =>
      createJwtVerifier({
        algorithms: ["HS256"],
        key: new Uint8Array(32),
        clockSkewSeconds: -1,
      }),
    /invalid_clock_skew/,
  );
  assert.throws(
    () =>
      createJwtVerifier({
        algorithms: ["HS256"],
        key: new Uint8Array(32),
        clockSkewSeconds: Number.NaN,
      }),
    /invalid_clock_skew/,
  );
});

test("createJwtVerifier: normalizes issuer/audience and rejects empty arrays/strings", () => {
  assert.throws(
    () =>
      createJwtVerifier({
        algorithms: ["HS256"],
        key: new Uint8Array(32),
        issuer: [],
      }),
    /invalid_string_set/,
  );
  assert.throws(
    () =>
      createJwtVerifier({
        algorithms: ["HS256"],
        key: new Uint8Array(32),
        issuer: ["" as string],
      }),
    /invalid_string_set/,
  );
  // Valid string form is accepted.
  const v = createJwtVerifier({
    algorithms: ["HS256"],
    key: new Uint8Array(32),
    issuer: "https://issuer",
    audience: ["aud-a", "aud-b"],
  });
  assert.equal(typeof v.verify, "function");
});

test("jwt: full sign + verify round-trip (HS256)", async () => {
  const key = await genHs256Key();
  const signer = createJwtSigner({ alg: "HS256", key, maxLifetimeSeconds: 60 });
  const verifier = createJwtVerifier({ algorithms: ["HS256"], key });
  const now = Math.floor(Date.now() / 1000);
  const tok = await signer.sign({ sub: "u", iat: now, exp: now + 30, iss: "i", aud: "a" });
  const { header, payload } = await verifier.verify(tok);
  assert.equal(header.alg, "HS256");
  assert.equal(payload.sub, "u");
  // Second verify hits cache path
  const v2 = await verifier.verify(tok);
  assert.equal(v2.payload.sub, "u");
});

test("jwt: round-trip with RS256 (asymmetric)", async () => {
  const pair = await genRs256Pair();
  const signer = createJwtSigner({ alg: "RS256", key: pair.privateKey, maxLifetimeSeconds: 60 });
  const verifier = createJwtVerifier({ algorithms: ["RS256"], key: pair.publicKey });
  const now = Math.floor(Date.now() / 1000);
  const tok = await signer.sign({ sub: "u", exp: now + 30 });
  const { payload } = await verifier.verify(tok);
  assert.equal(payload.sub, "u");
});

test("jwt: round-trip with ES256 and JWK resolver", async () => {
  const pair = await genEs256Pair();
  const jwk = await subtle.exportKey("jwk", pair.publicKey);
  const signer = createJwtSigner({ alg: "ES256", key: pair.privateKey, maxLifetimeSeconds: 60 });
  // Function resolver path
  const verifier = createJwtVerifier({
    algorithms: ["ES256"],
    key: (h) => {
      assert.equal(h.alg, "ES256");
      return jwk;
    },
  });
  const now = Math.floor(Date.now() / 1000);
  const tok = await signer.sign({ exp: now + 30 });
  const r = await verifier.verify(tok);
  assert.ok(r.payload);
});

test("jwt verify: rejects empty / malformed tokens", async () => {
  const v = createJwtVerifier({ algorithms: ["HS256"], key: await genHs256Key() });
  await assert.rejects(() => v.verify("" as string), /invalid_token/);
  await assert.rejects(() => v.verify(123 as unknown as string), /invalid_token/);
  await assert.rejects(() => v.verify("only.two"), /three dot-separated/);
  await assert.rejects(() => v.verify("!!!.aaa.bbb"), /base64url/);
});

test("jwt verify: rejects non-JSON header / payload", async () => {
  const v = createJwtVerifier({ algorithms: ["HS256"], key: await genHs256Key() });
  // valid base64url but not JSON
  const seg = Buffer.from("not-json").toString("base64url");
  await assert.rejects(() => v.verify(`${seg}.${seg}.${seg}`), /not valid JSON/);
});

test("jwt verify: rejects non-object header / payload", async () => {
  const v = createJwtVerifier({ algorithms: ["HS256"], key: await genHs256Key() });
  const arr = Buffer.from(JSON.stringify([1, 2])).toString("base64url");
  await assert.rejects(() => v.verify(`${arr}.${arr}.AAAA`), /JSON objects/);
});

test("jwt verify: rejects token with alg 'none'", async () => {
  const v = createJwtVerifier({ algorithms: ["HS256"], key: await genHs256Key() });
  const h = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const p = Buffer.from(JSON.stringify({ sub: "u" })).toString("base64url");
  await assert.rejects(() => v.verify(`${h}.${p}.`), /alg_none_refused/);
});

test("jwt verify: rejects token alg not in allowlist", async () => {
  const v = createJwtVerifier({ algorithms: ["RS256"], key: { kty: "RSA" } as JsonWebKey });
  const h = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
  const p = Buffer.from(JSON.stringify({})).toString("base64url");
  await assert.rejects(() => v.verify(`${h}.${p}.AAAA`), /alg_not_allowed/);
  // non-string alg
  const h2 = Buffer.from(JSON.stringify({ alg: 5 })).toString("base64url");
  await assert.rejects(() => v.verify(`${h2}.${p}.AAAA`), /alg_not_allowed/);
});

test("jwt verify: signature mismatch -> invalid_signature", async () => {
  const k1 = await genHs256Key();
  const k2 = await genHs256Key();
  const signer = createJwtSigner({ alg: "HS256", key: k1, maxLifetimeSeconds: 60 });
  const verifier = createJwtVerifier({ algorithms: ["HS256"], key: k2 });
  const now = Math.floor(Date.now() / 1000);
  const tok = await signer.sign({ exp: now + 30 });
  await assert.rejects(() => verifier.verify(tok), /invalid_signature/);
});

test("jwt verify: subtle.verify thrown error is wrapped", async () => {
  // Construct a verifier with a bad key shape that will cause subtle.verify to throw.
  const v = createJwtVerifier({
    algorithms: ["RS256"],
    key: { kty: "RSA", n: "AAAA", e: "AQAB" } as JsonWebKey, // malformed RSA JWK
  });
  const h = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
  const p = Buffer.from(JSON.stringify({})).toString("base64url");
  await assert.rejects(() => v.verify(`${h}.${p}.AAAA`), /jwt\(\)/);
});

test("jwt verify: expired token (with skew)", async () => {
  const key = await genHs256Key();
  const signer = createJwtSigner({ alg: "HS256", key, maxLifetimeSeconds: 60 });
  // Force "now" forward in the verifier so an exp 30s ahead becomes expired.
  const verifier = createJwtVerifier({
    algorithms: ["HS256"],
    key,
    clockSkewSeconds: 0,
    now: () => Math.floor(Date.now() / 1000) + 10_000,
  });
  const now = Math.floor(Date.now() / 1000);
  const tok = await signer.sign({ exp: now + 30 });
  await assert.rejects(() => verifier.verify(tok), /token_expired/);
});

test("jwt verify: non-number exp/nbf/iat -> errors", async () => {
  const key = await genHs256Key();
  // Craft tokens with bad claim types by signing externally with the same alg.
  const cryptoKey = await subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  async function craft(payload: Record<string, unknown>): Promise<string> {
    const h = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = new Uint8Array(
      await subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(`${h}.${p}`) as BufferSource),
    );
    return `${h}.${p}.${Buffer.from(sig).toString("base64url")}`;
  }
  const verifier = createJwtVerifier({ algorithms: ["HS256"], key });
  const badExp = await craft({ exp: "soon" });
  const badNbf = await craft({ nbf: "later" });
  const badIat = await craft({ iat: "now" });
  await assert.rejects(() => verifier.verify(badExp), /invalid_exp/);
  await assert.rejects(() => verifier.verify(badNbf), /invalid_nbf/);
  await assert.rejects(() => verifier.verify(badIat), /invalid_iat/);
});

test("jwt verify: nbf in future rejects; iat in future rejects", async () => {
  const key = await genHs256Key();
  const signer = createJwtSigner({
    alg: "HS256",
    key,
    maxLifetimeSeconds: 60,
    acknowledgeNoExp: true,
  });
  const verifier = createJwtVerifier({ algorithms: ["HS256"], key });
  const now = Math.floor(Date.now() / 1000);
  const nbfFuture = await signer.sign({ nbf: now + 10_000 });
  const iatFuture = await signer.sign({ iat: now + 10_000 });
  await assert.rejects(() => verifier.verify(nbfFuture), /token_not_yet_valid/);
  await assert.rejects(() => verifier.verify(iatFuture), /iat_in_future/);
});

test("jwt verify: issuer / audience validation paths", async () => {
  const key = await genHs256Key();
  const signer = createJwtSigner({
    alg: "HS256",
    key,
    maxLifetimeSeconds: 60,
    acknowledgeNoExp: true,
  });
  const verifier = createJwtVerifier({
    algorithms: ["HS256"],
    key,
    issuer: "https://issuer",
    audience: ["aud-a", "aud-b"],
  });
  const now = Math.floor(Date.now() / 1000);
  const noIss = await signer.sign({ exp: now + 30, aud: "aud-a" });
  const wrongIss = await signer.sign({ exp: now + 30, iss: "x", aud: "aud-a" });
  const wrongAudStr = await signer.sign({ exp: now + 30, iss: "https://issuer", aud: "other" });
  const wrongAudArr = await signer.sign({ exp: now + 30, iss: "https://issuer", aud: ["other"] });
  const missingAud = await signer.sign({ exp: now + 30, iss: "https://issuer" });
  const okStr = await signer.sign({ exp: now + 30, iss: "https://issuer", aud: "aud-a" });
  const okArr = await signer.sign({ exp: now + 30, iss: "https://issuer", aud: ["x", "aud-b"] });
  await assert.rejects(() => verifier.verify(noIss), /invalid_issuer/);
  await assert.rejects(() => verifier.verify(wrongIss), /invalid_issuer/);
  await assert.rejects(() => verifier.verify(wrongAudStr), /invalid_audience/);
  await assert.rejects(() => verifier.verify(wrongAudArr), /invalid_audience/);
  await assert.rejects(() => verifier.verify(missingAud), /invalid_audience/);
  await verifier.verify(okStr);
  await verifier.verify(okArr);
});

test("jwt verify: clockSkewSeconds tolerates small drift", async () => {
  const key = await genHs256Key();
  const signer = createJwtSigner({
    alg: "HS256",
    key,
    maxLifetimeSeconds: 60,
    acknowledgeNoExp: true,
  });
  const verifier = createJwtVerifier({
    algorithms: ["HS256"],
    key,
    clockSkewSeconds: 60,
  });
  const now = Math.floor(Date.now() / 1000);
  // iat in the past keeps lifetime positive even with exp slightly in the past.
  const expPast = await signer.sign({ iat: now - 10, exp: now - 5 });
  const nbfNear = await signer.sign({ nbf: now + 5 });
  // exp slightly in the past but within skew
  await verifier.verify(expPast);
  // nbf slightly in the future but within skew
  await verifier.verify(nbfNear);
});

// ============================================================
// requireScopes
// ============================================================

test("requireScopes: refuses construction with invalid scope list", () => {
  assert.throws(() => requireScopes([] as readonly string[]), /non-empty array/);
  assert.throws(() => requireScopes("read" as unknown as readonly string[]), /non-empty array/);
  assert.throws(() => requireScopes(["" as string]), /non-empty string/);
  assert.throws(() => requireScopes([5 as unknown as string]), /non-empty string/);
  assert.throws(() => requireScopes(['bad"scope']), /illegal character/);
});

test("requireScopes: 401 with Bearer challenge when user is absent", async () => {
  const app = new App({ env: "development" });
  app.use(requireScopes(["users:read"]));
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.fetch(new Request("http://x/"));
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate") ?? "", /Bearer scope="users:read", error="insufficient_scope"/);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = (await res.json()) as { detail: string; status: number };
  assert.equal(body.status, 401);
  assert.match(body.detail, /users:read/);
});

test("requireScopes: 403 when user lacks required scopes", async () => {
  const app = new App({ env: "development" });
  app.use(
    bearerAuth({
      validate: () => true,
    }),
  );
  app.use({
    beforeHandle(ctx) {
      (ctx.state as Record<string, unknown>).user = { id: "u", scopes: ["other"] };
    },
  });
  app.use(requireScopes(["users:write"]));
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.fetch(new Request("http://x/", { headers: { authorization: "Bearer t" } }));
  assert.equal(res.status, 403);
});

test("requireScopes: 403 when user has no scopes array at all", async () => {
  const app = new App({ env: "development" });
  app.use({
    beforeHandle(ctx) {
      (ctx.state as Record<string, unknown>).user = { id: "u" };
    },
  });
  app.use(requireScopes(["x"]));
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.fetch(new Request("http://x/"));
  assert.equal(res.status, 403);
});

test("requireScopes: passes when user has all required scopes; deduplicates", async () => {
  const app = new App({ env: "development" });
  app.use({
    beforeHandle(ctx) {
      (ctx.state as Record<string, unknown>).user = {
        id: "u",
        scopes: ["a", "b", "c"],
      };
    },
  });
  // Two requireScopes hooks: aggregated to ["a","b"] for the challenge.
  app.use(requireScopes(["a"]));
  app.use(requireScopes(["b", "a"])); // duplicate "a" deduped
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: (ctx) => ({
      status: 200 as const,
      body: { agg: (ctx.state as Record<string, unknown>)[REQUIRE_SCOPES_AGGREGATE_KEY] },
    }),
  });
  const res = await app.fetch(new Request("http://x/"));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { agg: string[] };
  assert.deepEqual(body.agg, ["a", "b"]);
});

test("requireScopes: aggregates across two hooks into one combined Bearer challenge", async () => {
  const app = new App({ env: "development" });
  // No user — hook metadata is pre-aggregated before beforeHandle can short-circuit.
  app.use(requireScopes(["me"]));
  app.use(requireScopes(["items"]));
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.fetch(new Request("http://x/"));
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate") ?? "", /scope="me items"/);
  const body = (await res.json()) as { detail: string };
  assert.match(body.detail, /me, items/);
});

// ============================================================
// etag
// ============================================================

test("etag: generates strong ETag for GET 200", async () => {
  const app = new App({ env: "development" });
  app.use(etag());
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { hello: "world" } }),
  });
  const res = await app.fetch(new Request("http://x/"));
  assert.equal(res.status, 200);
  const tag = res.headers.get("etag");
  assert.ok(tag);
  assert.match(tag!, /^"[0-9a-f]{40}"$/);
});

test("etag: weak option emits W/ prefix", async () => {
  const app = new App({ env: "development" });
  app.use(etag({ weak: true }));
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { a: 1 } }),
  });
  const res = await app.fetch(new Request("http://x/"));
  assert.match(res.headers.get("etag") ?? "", /^W\/"[0-9a-f]+"$/);
});

test("etag: custom generator wins", async () => {
  const app = new App({ env: "development" });
  app.use(etag({ generator: () => "deadbeef" }));
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { a: 1 } }),
  });
  const res = await app.fetch(new Request("http://x/"));
  assert.equal(res.headers.get("etag"), '"deadbeef"');
});

test("etag: 304 on matching If-None-Match (and on wildcard *)", async () => {
  const app = new App({ env: "development" });
  app.use(etag());
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { v: 1 } }),
  });
  const first = await app.fetch(new Request("http://x/"));
  const tag = first.headers.get("etag")!;
  const second = await app.fetch(new Request("http://x/", { headers: { "if-none-match": tag } }));
  assert.equal(second.status, 304);
  // Wildcard
  const third = await app.fetch(new Request("http://x/", { headers: { "if-none-match": "*" } }));
  assert.equal(third.status, 304);
  // List with one matching tag
  const fourth = await app.fetch(
    new Request("http://x/", { headers: { "if-none-match": `"nope", ${tag}` } }),
  );
  assert.equal(fourth.status, 304);
  // Weak comparison: W/"x" matches "x"
  const fifth = await app.fetch(
    new Request("http://x/", { headers: { "if-none-match": `W/${tag}` } }),
  );
  assert.equal(fifth.status, 304);
});

test("etag: If-None-Match list with empty entries does not 304", async () => {
  const app = new App({ env: "development" });
  app.use(etag());
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { v: 1 } }),
  });
  const res = await app.fetch(new Request("http://x/", { headers: { "if-none-match": " , " } }));
  assert.equal(res.status, 200);
});

test("etag: skips when Set-Cookie is present", async () => {
  const app = new App({ env: "development" });
  app.use({
    onSend(res) {
      res.headers.append("set-cookie", "a=b");
    },
  });
  app.use(etag());
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { v: 1 } }),
  });
  const res = await app.fetch(new Request("http://x/"));
  assert.equal(res.headers.get("etag"), null);
});

test("etag: skips when Cache-Control: private | no-store | no-cache", async () => {
  for (const directive of ["private", "no-store", "no-cache", "max-age=0, no-store"]) {
    const app = new App({ env: "development" });
    app.use({
      onSend(res) {
        res.headers.set("cache-control", directive);
      },
    });
    app.use(etag());
    app.route({
      method: "GET",
      path: "/",
      responses: { 200: { description: "ok" } },
      handler: () => ({ status: 200 as const, body: { v: 1 } }),
    });
    const res = await app.fetch(new Request("http://x/"));
    assert.equal(res.headers.get("etag"), null, `directive=${directive}`);
  }
});

test("etag: skips non-2xx", async () => {
  const app = new App({ env: "development" });
  app.use(etag());
  app.route({
    method: "GET",
    path: "/",
    responses: { 404: { description: "nope" } },
    handler: () => ({ status: 404 as const, body: { ok: false } }),
  });
  const res = await app.fetch(new Request("http://x/"));
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("etag"), null);
});

test("etag: skips when ETag already set", async () => {
  const app = new App({ env: "development" });
  app.use({
    onSend(res) {
      res.headers.set("etag", '"preset"');
    },
  });
  app.use(etag());
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { v: 1 } }),
  });
  const res = await app.fetch(new Request("http://x/"));
  assert.equal(res.headers.get("etag"), '"preset"');
});

test("etag: skips non-GET/HEAD methods", async () => {
  const app = new App({ env: "development" });
  app.use(etag());
  app.route({
    method: "POST",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { v: 1 } }),
  });
  const res = await app.fetch(
    new Request("http://x/", { method: "POST", headers: { origin: "http://x" } }),
  );
  assert.equal(res.headers.get("etag"), null);
});

test("etag: HEAD returns 200 with no body and the GET representation ETag", async () => {
  const app = new App({ env: "development" });
  app.use(etag());
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { v: 1 } }),
  });
  const get = await app.fetch(new Request("http://x/"));
  const head = await app.fetch(new Request("http://x/", { method: "HEAD" }));
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("etag"), get.headers.get("etag"));
  const body = await head.text();
  assert.equal(body, "");
});
