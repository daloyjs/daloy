import assert from "node:assert/strict";
import { test } from "node:test";
import { signMessage, verifyMessage } from "../src/http-signatures.js";
import type { HttpSignatureAlgorithm } from "../src/http-signatures.js";

for (const [alg, params, operation] of [
  [
    "rsa-pss-sha512",
    {
      name: "RSA-PSS",
      hash: "SHA-256",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    { name: "RSA-PSS", saltLength: 64 },
  ],
  [
    "rsa-v1_5-sha256",
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-512",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    { name: "RSASSA-PKCS1-v1_5" },
  ],
  [
    "ecdsa-p256-sha256",
    { name: "ECDSA", namedCurve: "P-384" },
    { name: "ECDSA", hash: "SHA-256" },
  ],
  [
    "ecdsa-p384-sha384",
    { name: "ECDSA", namedCurve: "P-256" },
    { name: "ECDSA", hash: "SHA-384" },
  ],
] satisfies [
  HttpSignatureAlgorithm,
  RsaHashedKeyGenParams | EcKeyGenParams,
  Algorithm | RsaPssParams | EcdsaParams,
][]) {
  test(`HTTP signatures reject mismatched imported ${alg} keys`, async () => {
    const keys = (await crypto.subtle.generateKey(params, false, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const message = { method: "GET", url: "https://service.test/protected" };
    const signatureParams = `("@method" "@target-uri");created=${Math.floor(Date.now() / 1000)};alg="${alg}"`;
    const base = `"@method": GET\n"@target-uri": ${message.url}\n"@signature-params": ${signatureParams}`;
    const signature = await crypto.subtle.sign(
      operation,
      keys.privateKey,
      new TextEncoder().encode(base),
    );
    const result = await verifyMessage({
      ...message,
      headers: {
        "signature-input": `sig1=${signatureParams}`,
        signature: `sig1=:${Buffer.from(signature).toString("base64")}:`,
      },
      algorithms: [alg],
      resolveKey: () => ({ alg, key: keys.publicKey }),
    });
    assert.deepEqual(result, { valid: false, reason: "invalid_key" });
    await assert.rejects(
      signMessage({ ...message, alg, key: keys.privateKey }),
      TypeError,
    );
  });
}

for (const [hash, size] of [
  ["SHA-1", 32],
  ["SHA-512", 64],
  ["SHA-256", 1],
] as const) {
  test(`HTTP signatures reject an imported ${hash}/${size}-byte key for hmac-sha256`, async () => {
    const key = await crypto.subtle.importKey(
      "raw",
      crypto.getRandomValues(new Uint8Array(size)),
      { name: "HMAC", hash },
      true,
      ["sign", "verify"],
    );
    const message = { method: "GET", url: "https://service.test/protected" };
    const valid = await signMessage({
      ...message,
      alg: "hmac-sha256",
      key: crypto.getRandomValues(new Uint8Array(32)),
    });
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(valid.signatureBase),
    );
    const result = await verifyMessage({
      ...message,
      headers: {
        "signature-input": valid.signatureInput,
        signature: `sig1=:${Buffer.from(signature).toString("base64")}:`,
      },
      algorithms: ["hmac-sha256"],
      resolveKey: () => key,
    });
    assert.deepEqual(result, { valid: false, reason: "invalid_key" });
    await assert.rejects(
      signMessage({ ...message, alg: "hmac-sha256", key }),
      TypeError,
    );
    if (size === 1) {
      const jwk = await crypto.subtle.exportKey("jwk", key);
      await assert.rejects(
        signMessage({ ...message, alg: "hmac-sha256", key: jwk }),
        TypeError,
      );
      const jwkResult = await verifyMessage({
        ...message,
        headers: {
          "signature-input": valid.signatureInput,
          signature: `sig1=:${Buffer.from(signature).toString("base64")}:`,
        },
        algorithms: ["hmac-sha256"],
        resolveKey: () => jwk,
      });
      assert.deepEqual(jwkResult, { valid: false, reason: "invalid_key" });
    }
  });
}

test("HTTP signatures accept a correctly bound nonextractable imported HMAC key", async () => {
  const key = await crypto.subtle.importKey(
    "raw",
    crypto.getRandomValues(new Uint8Array(32)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const message = { method: "GET", url: "https://service.test/protected" };
  const signature = await signMessage({ ...message, alg: "hmac-sha256", key });
  const result = await verifyMessage({
    ...message,
    headers: {
      "signature-input": signature.signatureInput,
      signature: signature.signature,
    },
    algorithms: ["hmac-sha256"],
    resolveKey: () => key,
  });
  assert.equal(result.valid, true);
});
