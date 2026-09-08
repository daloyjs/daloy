import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createJwtSigner,
  createJwtVerifier,
  type JwtAlgorithm,
} from "../src/jwt.js";

async function hmacToken(key: CryptoKey, alg: JwtAlgorithm): Promise<string> {
  const header = Buffer.from(JSON.stringify({ alg, typ: "JWT" })).toString(
    "base64url",
  );
  const payload = Buffer.from(
    JSON.stringify({
      sub: "test-user",
      exp: Math.floor(Date.now() / 1000) + 60,
    }),
  ).toString("base64url");
  const input = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(input),
  );
  return `${input}.${Buffer.from(signature).toString("base64url")}`;
}

for (const hash of ["SHA-1", "SHA-256"]) {
  test(`JWT rejects ${hash} CryptoKey used as HS512`, async () => {
    const key = await crypto.subtle.importKey(
      "raw",
      crypto.getRandomValues(new Uint8Array(64)),
      { name: "HMAC", hash },
      false,
      ["sign", "verify"],
    );
    const token = await hmacToken(key, "HS512");
    const verifier = createJwtVerifier({ algorithms: ["HS512"], key });
    await assert.rejects(verifier.verify(token), {
      code: "key_algorithm_mismatch",
    });
    const signer = createJwtSigner({
      alg: "HS512",
      key,
      maxLifetimeSeconds: 60,
    });
    await assert.rejects(
      signer.sign({ exp: Math.floor(Date.now() / 1000) + 30 }),
      { code: "key_algorithm_mismatch" },
    );
  });
}

test("JWT rejects a short pre-imported HMAC key", async () => {
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array([1]),
    { name: "HMAC", hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const token = await hmacToken(key, "HS256");
  await assert.rejects(
    createJwtVerifier({ algorithms: ["HS256"], key }).verify(token),
    { code: "weak_hs_secret" },
  );
  await assert.rejects(
    createJwtSigner({ alg: "HS256", key, maxLifetimeSeconds: 60 }).sign({
      exp: Math.floor(Date.now() / 1000) + 30,
    }),
    { code: "weak_hs_secret" },
  );
  const jwk = await crypto.subtle.exportKey("jwk", key);
  await assert.rejects(
    createJwtSigner({ alg: "HS256", key: jwk, maxLifetimeSeconds: 60 }).sign({
      exp: Math.floor(Date.now() / 1000) + 30,
    }),
    { code: "weak_hs_secret" },
  );
  await assert.rejects(
    createJwtVerifier({
      algorithms: ["HS256"],
      key: jwk,
      refuseSymmetricWithJwk: false,
    }).verify(token),
    { code: "weak_hs_secret" },
  );
});

test("JWT accepts a correctly bound nonextractable HMAC CryptoKey", async () => {
  const key = await crypto.subtle.importKey(
    "raw",
    crypto.getRandomValues(new Uint8Array(32)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const token = await createJwtSigner({
    alg: "HS256",
    key,
    maxLifetimeSeconds: 60,
  }).sign({ sub: "test-user", exp: Math.floor(Date.now() / 1000) + 30 });
  const verified = await createJwtVerifier({
    algorithms: ["HS256"],
    key,
  }).verify(token);
  assert.equal(verified.payload.sub, "test-user");
});

for (const [alg, keyAlgorithm, signingAlgorithm] of [
  [
    "RS512",
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    { name: "RSASSA-PKCS1-v1_5" },
  ],
  [
    "PS512",
    {
      name: "RSA-PSS",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    { name: "RSA-PSS", saltLength: 64 },
  ],
  [
    "ES256",
    { name: "ECDSA", namedCurve: "P-384" },
    { name: "ECDSA", hash: "SHA-256" },
  ],
] satisfies Array<
  [
    JwtAlgorithm,
    RsaHashedKeyGenParams | EcKeyGenParams,
    AlgorithmIdentifier | RsaPssParams | EcdsaParams,
  ]
>) {
  test(`JWT rejects a mismatched ${alg} asymmetric CryptoKey, including resolver keys`, async () => {
    const pair = (await crypto.subtle.generateKey(keyAlgorithm, false, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const header = Buffer.from(JSON.stringify({ alg })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60 }),
    ).toString("base64url");
    const input = `${header}.${payload}`;
    const signature = await crypto.subtle.sign(
      signingAlgorithm,
      pair.privateKey,
      new TextEncoder().encode(input),
    );
    const token = `${input}.${Buffer.from(signature).toString("base64url")}`;
    for (const key of [pair.publicKey, () => pair.publicKey]) {
      await assert.rejects(
        createJwtVerifier({ algorithms: [alg], key }).verify(token),
        { code: "key_algorithm_mismatch" },
      );
    }
    await assert.rejects(
      createJwtSigner({
        alg,
        key: pair.privateKey,
        maxLifetimeSeconds: 60,
      }).sign({ exp: Math.floor(Date.now() / 1000) + 30 }),
      { code: "key_algorithm_mismatch" },
    );
  });
}

test("JWT rejects a key from another algorithm family", async () => {
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(32),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  await assert.rejects(
    createJwtSigner({ alg: "HS256", key, maxLifetimeSeconds: 60 }).sign({
      exp: Math.floor(Date.now() / 1000) + 30,
    }),
    { code: "key_algorithm_mismatch" },
  );
});
