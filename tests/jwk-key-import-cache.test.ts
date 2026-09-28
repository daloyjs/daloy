import { test } from "node:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";

import { App, createJwtSigner, createJwtVerifier, jwk, type JwkSet } from "../src/index.js";

// Regression suite for the resolver-JWK import cache in createJwtVerifier and
// the per-request key binding in jwk(). Two properties matter:
//   1. Performance: a JWK is imported via WebCrypto once, not on every verify.
//   2. Safety: a cached key is only ever used when THIS verification's own
//      resolver returned identical key material. A same-kid rotation must
//      re-import, and one request must never verify against another request's
//      key set (the shared-state race that let a tenant-B token pass at tenant A).

type Pair = CryptoKeyPair;

async function genPair(): Promise<Pair> {
  return (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as Pair;
}

async function publicJwk(pair: Pair, kid: string, extra: Record<string, unknown> = {}) {
  const exported = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  return { ...exported, kid, alg: "ES256", ...extra } as JsonWebKey;
}

async function tokenFor(pair: Pair, kid: string, sub = "u"): Promise<string> {
  const signer = createJwtSigner({
    alg: "ES256",
    key: (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey,
    maxLifetimeSeconds: 3600,
    header: { kid },
  });
  const now = Math.floor(Date.now() / 1000);
  return signer.sign({ sub, iat: now, exp: now + 300 });
}

/** Count WebCrypto JWK verify-key imports while `fn` runs. */
async function countJwkImports(fn: () => Promise<void>): Promise<number> {
  const subtle = crypto.subtle as SubtleCrypto & { importKey: SubtleCrypto["importKey"] };
  const original = subtle.importKey;
  let count = 0;
  subtle.importKey = function (this: SubtleCrypto, ...args: Parameters<SubtleCrypto["importKey"]>) {
    if ((args[0] as string) === "jwk" && (args[4] as readonly string[]).includes("verify")) count++;
    return (original as (...a: unknown[]) => Promise<CryptoKey>).apply(this, args);
  } as SubtleCrypto["importKey"];
  try {
    await fn();
  } finally {
    delete (subtle as unknown as Record<string, unknown>).importKey;
  }
  assert.equal(crypto.subtle.importKey, original, "importKey spy restored");
  return count;
}

function appWith(jwks: Parameters<typeof jwk>[0]["jwks"], extra: Partial<Parameters<typeof jwk>[0]> = {}) {
  const app = new App({ logger: false });
  app.use(jwk({ jwks, algorithms: ["ES256"], ...extra }));
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  return app;
}

const call = (app: App<any>, token: string, host = "api.test") =>
  app.request(new Request(`http://${host}/`, { headers: { authorization: `Bearer ${token}` } }));

// ---------------------------------------------------------------------------
// createJwtVerifier: resolver JWK import cache
// ---------------------------------------------------------------------------

test("verifier: a resolver returning fresh but identical JWK objects imports once", async () => {
  const pair = await genPair();
  const pub = await publicJwk(pair, "k1");
  const token = await tokenFor(pair, "k1");
  const verifier = createJwtVerifier({ algorithms: ["ES256"], key: () => ({ ...pub }) });
  const imports = await countJwkImports(async () => {
    for (let i = 0; i < 10; i++) assert.equal((await verifier.verify(token)).payload.sub, "u");
  });
  assert.equal(imports, 1);
});

test("verifier: same kid with new key material re-imports and rejects the old key", async () => {
  const [a, b] = [await genPair(), await genPair()];
  const [pubA, pubB] = [await publicJwk(a, "k1"), await publicJwk(b, "k1")];
  const [tokenA, tokenB] = [await tokenFor(a, "k1"), await tokenFor(b, "k1")];
  let current = pubA;
  const verifier = createJwtVerifier({ algorithms: ["ES256"], key: () => current });
  const imports = await countJwkImports(async () => {
    await verifier.verify(tokenA);
    current = pubB;
    await verifier.verify(tokenB);
    await assert.rejects(verifier.verify(tokenA), /signature/i);
  });
  assert.equal(imports, 2);
});

test("verifier: import-relevant JWK members are part of the cache id", async () => {
  // A cached import must not let a JWK whose key_ops forbid verification skip
  // WebCrypto's usage check just because the same public key was seen before.
  const pair = await genPair();
  const plain = await publicJwk(pair, "k1");
  const signOnly = await publicJwk(pair, "k1", { key_ops: ["sign"] });
  const token = await tokenFor(pair, "k1");
  let current = plain;
  const verifier = createJwtVerifier({ algorithms: ["ES256"], key: () => current });
  await verifier.verify(token);
  current = signOnly;
  await assert.rejects(verifier.verify(token));
  current = plain;
  await verifier.verify(token);
});

test("verifier: the cache is bounded and evicts least recently used keys", async () => {
  const pairs = await Promise.all(Array.from({ length: 70 }, () => genPair()));
  const jwks = await Promise.all(pairs.map((p, i) => publicJwk(p, `k${i}`)));
  const tokens = await Promise.all(pairs.map((p, i) => tokenFor(p, `k${i}`)));
  const byKid = new Map(jwks.map((j) => [(j as { kid: string }).kid, j]));
  const verifier = createJwtVerifier({
    algorithms: ["ES256"],
    key: (header) => byKid.get(header.kid as string)!,
  });
  const firstPass = await countJwkImports(async () => {
    for (const token of tokens) await verifier.verify(token);
  });
  assert.equal(firstPass, 70);
  // k69 is still cached; k0 was evicted once the cache passed 64 entries.
  const hot = await countJwkImports(async () => {
    await verifier.verify(tokens[69]!);
  });
  assert.equal(hot, 0);
  const evicted = await countJwkImports(async () => {
    await verifier.verify(tokens[0]!);
  });
  assert.equal(evicted, 1);
});

test("verifier: JWKs that cannot be canonicalized are verified without caching", async () => {
  const pair = await genPair();
  const odd = await publicJwk(pair, "k1", { x5t_meta: { nested: true } });
  const token = await tokenFor(pair, "k1");
  const verifier = createJwtVerifier({ algorithms: ["ES256"], key: () => odd });
  const imports = await countJwkImports(async () => {
    await verifier.verify(token);
    await verifier.verify(token);
  });
  assert.equal(imports, 2);
});

// ---------------------------------------------------------------------------
// jwk(): per-request binding + import once across requests
// ---------------------------------------------------------------------------

test("jwk: every JWKS source imports each key once across many requests", async () => {
  const pair = await genPair();
  const pub = await publicJwk(pair, "k1");
  const token = await tokenFor(pair, "k1");
  const fakeFetch: typeof fetch = async () => Response.json({ keys: [pub] });
  const sources: Array<Parameters<typeof jwk>[0]["jwks"]> = [
    { keys: [pub] },
    async () => ({ keys: [{ ...pub }] }),
    "https://issuer.test/jwks.json",
  ];
  for (const source of sources) {
    const app = appWith(source, { fetch: fakeFetch });
    const imports = await countJwkImports(async () => {
      for (let i = 0; i < 8; i++) assert.equal((await call(app, token)).status, 200);
    });
    assert.equal(imports, 1, typeof source === "string" ? "url" : typeof source);
  }
});

test("jwk: a same-kid rotation from the resolver takes effect immediately", async () => {
  const [a, b] = [await genPair(), await genPair()];
  const [tokenA, tokenB] = [await tokenFor(a, "k1"), await tokenFor(b, "k1")];
  let current = await publicJwk(a, "k1");
  const app = appWith(async () => ({ keys: [current] }));
  assert.equal((await call(app, tokenA)).status, 200);
  current = await publicJwk(b, "k1");
  assert.equal((await call(app, tokenB)).status, 200);
  assert.equal((await call(app, tokenA)).status, 401);
});

test("jwk: concurrent requests never verify against another request's key set", async () => {
  // Multi-tenant resolver: the key set depends on the request's tenant, and
  // both tenants use kid "k1". A token signed by tenant B's key must be
  // rejected at tenant A no matter how requests interleave.
  const tenant = new AsyncLocalStorage<string>();
  const [a, b] = [await genPair(), await genPair()];
  const sets: Record<string, JwkSet> = {
    "a.test": { keys: [await publicJwk(a, "k1")] },
    "b.test": { keys: [await publicJwk(b, "k1")] },
  };
  const tokenB = await tokenFor(b, "k1", "tenant-b-user");
  const app = appWith(async () => {
    await Promise.resolve();
    return { keys: [...sets[tenant.getStore()!]!.keys] };
  });
  const hit = (host: string) => tenant.run(host, () => call(app, tokenB, host));
  for (const order of [["a.test", "b.test"], ["b.test", "a.test"]] as const) {
    const requests: Array<Promise<Response>> = [];
    const hosts: string[] = [];
    for (let i = 0; i < 100; i++) {
      for (const host of order) {
        hosts.push(host);
        requests.push(hit(host));
      }
    }
    const statuses = (await Promise.all(requests)).map((r) => r.status);
    statuses.forEach((status, i) => {
      assert.equal(status, hosts[i] === "b.test" ? 200 : 401, `${hosts[i]} request ${i}`);
    });
  }
});

test("jwk: a malformed token is rejected before the JWKS is loaded", async () => {
  let loads = 0;
  const app = appWith(async () => {
    loads++;
    return { keys: [] };
  });
  for (const token of ["not-a-jwt", "a.b.c", "eyJhbGciOiJub25lIn0.e30.x"]) {
    assert.equal((await call(app, token)).status, 401);
  }
  assert.equal(loads, 0);
});
