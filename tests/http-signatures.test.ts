import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  signMessage,
  signRequest,
  verifyMessage,
  verifyRequest,
  httpSignatureAuth,
  contentDigest,
  verifyContentDigest,
  DEFAULT_SIGNATURE_LABEL,
  DEFAULT_MAX_SIGNATURE_AGE_SECONDS,
  type HttpSignatureAlgorithm,
} from "../src/index.js";

// ---------- helpers ----------

const HMAC_SECRET = new Uint8Array(32).fill(7);

function fixedNow(seconds: number): () => number {
  return () => seconds * 1000;
}

async function genEd25519(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
}

async function genEcdsaP256(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
}

// ---------- happy path: HMAC roundtrip ----------

test("signMessage + verifyMessage HMAC roundtrip succeeds", async () => {
  const created = 1_700_000_000;
  const sig = await signMessage({
    method: "POST",
    url: "https://api.example.com/transfer?amount=100",
    headers: { host: "api.example.com", "content-type": "application/json" },
    components: ["@method", "@path", "@authority", "content-type"],
    alg: "hmac-sha256",
    key: HMAC_SECRET,
    keyid: "svc-a",
    created,
    now: fixedNow(created),
  });

  assert.ok(sig.signatureInput.startsWith(`${DEFAULT_SIGNATURE_LABEL}=`));
  assert.match(sig.signature, /^sig1=:.+:$/);
  assert.match(sig.signatureBase, /"@method": POST/);
  assert.match(sig.signatureBase, /"@signature-params": /);

  const result = await verifyMessage({
    method: "POST",
    url: "https://api.example.com/transfer?amount=100",
    headers: {
      host: "api.example.com",
      "content-type": "application/json",
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["hmac-sha256"],
    resolveKey: () => ({ alg: "hmac-sha256", key: HMAC_SECRET }),
    now: fixedNow(created + 10),
  });

  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.alg, "hmac-sha256");
    assert.equal(result.keyid, "svc-a");
    assert.equal(result.created, created);
    assert.deepEqual(result.components, [
      '"@method"',
      '"@path"',
      '"@authority"',
      '"content-type"',
    ]);
  }
});

test("signRequest attaches headers and verifyRequest accepts them", async () => {
  const created = 1_700_000_500;
  const req = new Request("https://api.example.com/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  const signed = await signRequest(req, {
    components: ["@method", "@target-uri", "content-type"],
    alg: "hmac-sha256",
    key: HMAC_SECRET,
    keyid: "svc-a",
    created,
    now: fixedNow(created),
  });
  assert.ok(signed.headers.get("signature-input"));
  assert.ok(signed.headers.get("signature"));
  // Original request is not mutated.
  assert.equal(req.headers.get("signature"), null);

  const result = await verifyRequest(signed, {
    algorithms: ["hmac-sha256"],
    requiredComponents: ["@method", "@target-uri"],
    resolveKey: () => HMAC_SECRET,
    now: fixedNow(created + 5),
  });
  assert.equal(result.valid, true);
});

// ---------- happy path: asymmetric ----------

test("ed25519 sign + verify roundtrip", async () => {
  const { privateKey, publicKey } = await genEd25519();
  const created = 1_700_001_000;
  const sig = await signMessage({
    method: "GET",
    url: "https://api.example.com/me",
    headers: { host: "api.example.com" },
    components: ["@method", "@path", "@authority"],
    alg: "ed25519",
    key: privateKey,
    keyid: "ed-1",
    created,
    now: fixedNow(created),
  });
  const result = await verifyMessage({
    method: "GET",
    url: "https://api.example.com/me",
    headers: {
      host: "api.example.com",
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["ed25519"],
    resolveKey: () => ({ alg: "ed25519", key: publicKey }),
    now: fixedNow(created + 1),
  });
  assert.equal(result.valid, true);
});

test("ecdsa-p256-sha256 sign + verify roundtrip", async () => {
  const { privateKey, publicKey } = await genEcdsaP256();
  const created = 1_700_001_100;
  const sig = await signMessage({
    method: "PUT",
    url: "https://api.example.com/widgets/1",
    components: ["@method", "@path"],
    alg: "ecdsa-p256-sha256",
    key: privateKey,
    keyid: "ec-1",
    created,
    now: fixedNow(created),
  });
  const result = await verifyMessage({
    method: "PUT",
    url: "https://api.example.com/widgets/1",
    headers: {
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["ecdsa-p256-sha256"],
    resolveKey: () => publicKey,
    now: fixedNow(created + 1),
  });
  assert.equal(result.valid, true);
});

test("@query-param and @query derived components round-trip", async () => {
  const created = 1_700_002_000;
  const url = "https://api.example.com/search?q=shoes&page=2";
  const sig = await signMessage({
    method: "GET",
    url,
    components: ['@query', '@query-param;name="q"'],
    alg: "hmac-sha256",
    key: HMAC_SECRET,
    created,
    now: fixedNow(created),
  });
  assert.match(sig.signatureBase, /"@query": \?q=shoes&page=2/);
  assert.match(sig.signatureBase, /"@query-param";name="q": shoes/);
  const result = await verifyMessage({
    method: "GET",
    url,
    headers: {
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["hmac-sha256"],
    requiredComponents: ["@query"],
    resolveKey: () => HMAC_SECRET,
    now: fixedNow(created),
  });
  assert.equal(result.valid, true);
});

// ---------- unhappy path: tampering & wrong key ----------

test("tampered method is rejected", async () => {
  const created = 1_700_003_000;
  const sig = await signMessage({
    method: "POST",
    url: "https://api.example.com/transfer",
    components: ["@method", "@path"],
    alg: "hmac-sha256",
    key: HMAC_SECRET,
    created,
    now: fixedNow(created),
  });
  const result = await verifyMessage({
    method: "GET", // changed
    url: "https://api.example.com/transfer",
    headers: {
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["hmac-sha256"],
    resolveKey: () => HMAC_SECRET,
    now: fixedNow(created),
  });
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.reason, "invalid_signature");
});

test("wrong HMAC key is rejected", async () => {
  const created = 1_700_003_100;
  const sig = await signMessage({
    method: "POST",
    url: "https://api.example.com/transfer",
    components: ["@method", "@path"],
    alg: "hmac-sha256",
    key: HMAC_SECRET,
    created,
    now: fixedNow(created),
  });
  const result = await verifyMessage({
    method: "POST",
    url: "https://api.example.com/transfer",
    headers: {
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["hmac-sha256"],
    resolveKey: () => new Uint8Array(32).fill(9),
    now: fixedNow(created),
  });
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.reason, "invalid_signature");
});

// ---------- unhappy path: freshness / replay ----------

test("stale created is rejected", async () => {
  const created = 1_700_004_000;
  const sig = await signMessage({
    method: "GET",
    url: "https://api.example.com/x",
    components: ["@method", "@path"],
    alg: "hmac-sha256",
    key: HMAC_SECRET,
    created,
    now: fixedNow(created),
  });
  const result = await verifyMessage({
    method: "GET",
    url: "https://api.example.com/x",
    headers: {
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["hmac-sha256"],
    resolveKey: () => HMAC_SECRET,
    now: fixedNow(created + DEFAULT_MAX_SIGNATURE_AGE_SECONDS + 5),
  });
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.reason, "signature_stale");
});

test("created in the future is rejected", async () => {
  const created = 1_700_005_000;
  const sig = await signMessage({
    method: "GET",
    url: "https://api.example.com/x",
    components: ["@method", "@path"],
    alg: "hmac-sha256",
    key: HMAC_SECRET,
    created,
    now: fixedNow(created),
  });
  const result = await verifyMessage({
    method: "GET",
    url: "https://api.example.com/x",
    headers: {
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["hmac-sha256"],
    resolveKey: () => HMAC_SECRET,
    now: fixedNow(created - 600),
  });
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.reason, "created_in_future");
});

test("expired signature is rejected", async () => {
  const created = 1_700_006_000;
  const sig = await signMessage({
    method: "GET",
    url: "https://api.example.com/x",
    components: ["@method", "@path"],
    alg: "hmac-sha256",
    key: HMAC_SECRET,
    created,
    expires: created + 30,
    now: fixedNow(created),
  });
  const result = await verifyMessage({
    method: "GET",
    url: "https://api.example.com/x",
    headers: {
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["hmac-sha256"],
    maxAgeSeconds: Infinity,
    resolveKey: () => HMAC_SECRET,
    now: fixedNow(created + 200),
  });
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.reason, "signature_expired");
});

test("missing created is rejected by default", async () => {
  const sig = await signMessage({
    method: "GET",
    url: "https://api.example.com/x",
    components: ["@method", "@path"],
    alg: "hmac-sha256",
    key: HMAC_SECRET,
    includeAlg: true,
    created: 1,
  });
  // Hand-craft Signature-Input without created.
  const inputNoCreated = sig.signatureInput.replace(/;created=\d+/, "");
  // Re-sign over the modified params so the signature is internally valid but
  // simply lacks `created`.
  const result = await verifyMessage({
    method: "GET",
    url: "https://api.example.com/x",
    headers: {
      "signature-input": inputNoCreated,
      signature: sig.signature,
    },
    algorithms: ["hmac-sha256"],
    resolveKey: () => HMAC_SECRET,
  });
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.reason, "missing_created");
});

test("replay nonce is rejected when isReplay reports a hit", async () => {
  const created = 1_700_007_000;
  const sig = await signMessage({
    method: "GET",
    url: "https://api.example.com/x",
    components: ["@method", "@path"],
    alg: "hmac-sha256",
    key: HMAC_SECRET,
    created,
    nonce: "abc123",
    now: fixedNow(created),
  });
  const result = await verifyMessage({
    method: "GET",
    url: "https://api.example.com/x",
    headers: {
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["hmac-sha256"],
    resolveKey: () => HMAC_SECRET,
    isReplay: (nonce) => nonce === "abc123",
    now: fixedNow(created),
  });
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.reason, "replay_detected");
});

test("isReplay requires a nonce", async () => {
  const created = 1_700_007_500;
  const sig = await signMessage({
    method: "GET",
    url: "https://api.example.com/x",
    components: ["@method", "@path"],
    alg: "hmac-sha256",
    key: HMAC_SECRET,
    created,
    now: fixedNow(created),
  });
  const result = await verifyMessage({
    method: "GET",
    url: "https://api.example.com/x",
    headers: {
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["hmac-sha256"],
    resolveKey: () => HMAC_SECRET,
    isReplay: () => false,
    now: fixedNow(created),
  });
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.reason, "missing_nonce");
});

// ---------- unhappy path: algorithm discipline ----------

test("algorithm not in allowlist is rejected", async () => {
  const created = 1_700_008_000;
  const sig = await signMessage({
    method: "GET",
    url: "https://api.example.com/x",
    components: ["@method", "@path"],
    alg: "hmac-sha256",
    key: HMAC_SECRET,
    created,
    now: fixedNow(created),
  });
  const result = await verifyMessage({
    method: "GET",
    url: "https://api.example.com/x",
    headers: {
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["ed25519"],
    resolveKey: () => HMAC_SECRET,
    now: fixedNow(created),
  });
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.reason, "alg_not_allowed");
});

test("pinned key alg mismatching declared alg is rejected", async () => {
  const created = 1_700_008_500;
  const sig = await signMessage({
    method: "GET",
    url: "https://api.example.com/x",
    components: ["@method", "@path"],
    alg: "hmac-sha256",
    key: HMAC_SECRET,
    created,
    now: fixedNow(created),
  });
  const result = await verifyMessage({
    method: "GET",
    url: "https://api.example.com/x",
    headers: {
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["hmac-sha256", "ed25519"],
    resolveKey: () => ({ alg: "ed25519", key: HMAC_SECRET }),
    now: fixedNow(created),
  });
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.reason, "alg_mismatch");
});

test("empty algorithms allowlist throws", async () => {
  await assert.rejects(
    verifyMessage({
      method: "GET",
      url: "https://api.example.com/x",
      headers: {},
      algorithms: [] as HttpSignatureAlgorithm[],
      resolveKey: () => HMAC_SECRET,
    }),
    /non-empty `algorithms` allowlist/,
  );
});

// ---------- unhappy path: required components & resolution ----------

test("missing required component is rejected", async () => {
  const created = 1_700_009_000;
  const sig = await signMessage({
    method: "GET",
    url: "https://api.example.com/x",
    components: ["@method"],
    alg: "hmac-sha256",
    key: HMAC_SECRET,
    created,
    now: fixedNow(created),
  });
  const result = await verifyMessage({
    method: "GET",
    url: "https://api.example.com/x",
    headers: {
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["hmac-sha256"],
    requiredComponents: ["@method", "@path"],
    resolveKey: () => HMAC_SECRET,
    now: fixedNow(created),
  });
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.reason, "missing_required_component");
});

test("unknown key (resolveKey undefined) is rejected", async () => {
  const created = 1_700_009_500;
  const sig = await signMessage({
    method: "GET",
    url: "https://api.example.com/x",
    components: ["@method", "@path"],
    alg: "hmac-sha256",
    key: HMAC_SECRET,
    keyid: "unknown",
    created,
    now: fixedNow(created),
  });
  const result = await verifyMessage({
    method: "GET",
    url: "https://api.example.com/x",
    headers: {
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["hmac-sha256"],
    resolveKey: () => undefined,
    now: fixedNow(created),
  });
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.reason, "key_not_found");
});

test("missing Signature / Signature-Input headers are rejected", async () => {
  const r1 = await verifyMessage({
    method: "GET",
    url: "https://api.example.com/x",
    headers: {},
    algorithms: ["hmac-sha256"],
    resolveKey: () => HMAC_SECRET,
  });
  assert.equal(r1.valid, false);
  if (!r1.valid) assert.equal(r1.reason, "missing_signature_input");

  const r2 = await verifyMessage({
    method: "GET",
    url: "https://api.example.com/x",
    headers: { "signature-input": 'sig1=("@method");created=1' },
    algorithms: ["hmac-sha256"],
    resolveKey: () => HMAC_SECRET,
  });
  assert.equal(r2.valid, false);
  if (!r2.valid) assert.equal(r2.reason, "missing_signature");
});

test("malformed Signature-Input is rejected", async () => {
  const result = await verifyMessage({
    method: "GET",
    url: "https://api.example.com/x",
    headers: {
      "signature-input": "sig1=not-an-inner-list",
      signature: "sig1=:AAAA:",
    },
    algorithms: ["hmac-sha256"],
    resolveKey: () => HMAC_SECRET,
  });
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.reason, "malformed_signature_headers");
});

test("covered header missing from message fails resolution", async () => {
  const created = 1_700_010_000;
  const sig = await signMessage({
    method: "GET",
    url: "https://api.example.com/x",
    headers: { "x-trace": "abc" },
    components: ["@method", "@path", "x-trace"],
    alg: "hmac-sha256",
    key: HMAC_SECRET,
    created,
    now: fixedNow(created),
  });
  // Verify without the x-trace header present.
  const result = await verifyMessage({
    method: "GET",
    url: "https://api.example.com/x",
    headers: {
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["hmac-sha256"],
    requiredComponents: [],
    resolveKey: () => HMAC_SECRET,
    now: fixedNow(created),
  });
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.reason, "component_resolution_failed");
});

test("ambiguous label without explicit selection is rejected", async () => {
  const result = await verifyMessage({
    method: "GET",
    url: "https://api.example.com/x",
    headers: {
      "signature-input":
        'a=("@method");created=1, b=("@method");created=1',
      signature: "a=:AAAA:, b=:BBBB:",
    },
    algorithms: ["hmac-sha256"],
    resolveKey: () => HMAC_SECRET,
  });
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.reason, "ambiguous_label");
});

test("required tag mismatch is rejected", async () => {
  const created = 1_700_010_500;
  const sig = await signMessage({
    method: "GET",
    url: "https://api.example.com/x",
    components: ["@method", "@path"],
    alg: "hmac-sha256",
    key: HMAC_SECRET,
    created,
    tag: "billing",
    now: fixedNow(created),
  });
  const result = await verifyMessage({
    method: "GET",
    url: "https://api.example.com/x",
    headers: {
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["hmac-sha256"],
    requiredTag: "payments",
    resolveKey: () => HMAC_SECRET,
    now: fixedNow(created),
  });
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.reason, "tag_mismatch");
});

// ---------- signing input validation ----------

test("raw HMAC secret shorter than 32 bytes throws", async () => {
  await assert.rejects(
    signMessage({
      method: "GET",
      url: "https://api.example.com/x",
      components: ["@method"],
      alg: "hmac-sha256",
      key: new Uint8Array(16),
    }),
    /at least 32 bytes/,
  );
});

test("raw byte key with asymmetric alg throws", async () => {
  await assert.rejects(
    signMessage({
      method: "GET",
      url: "https://api.example.com/x",
      components: ["@method"],
      alg: "ed25519",
      key: new Uint8Array(32),
    }),
    /only supported for hmac-sha256/,
  );
});

test("non-printable keyid throws on serialization", async () => {
  await assert.rejects(
    signMessage({
      method: "GET",
      url: "https://api.example.com/x",
      components: ["@method"],
      alg: "hmac-sha256",
      key: HMAC_SECRET,
      keyid: "bad\nkeyid",
    }),
    /non-printable-ASCII/,
  );
});

// ---------- middleware ----------

function makeApp(opts: Parameters<typeof httpSignatureAuth>[0]): App {
  const app = new App({ env: "development" });
  app.use(httpSignatureAuth(opts));
  app.route({
    method: "GET",
    path: "/secure",
    responses: { 200: { description: "ok" } },
    handler: (ctx) => ({
      status: 200 as const,
      body: { keyid: (ctx.state as any).httpSignature?.keyid ?? null },
    }),
  });
  return app;
}

test("httpSignatureAuth accepts a valid signature and stamps state", async () => {
  const created = Math.floor(Date.now() / 1000);
  const url = "http://localhost/secure";
  const sig = await signMessage({
    method: "GET",
    url,
    components: ["@method", "@path"],
    alg: "hmac-sha256",
    key: HMAC_SECRET,
    keyid: "svc-a",
    created,
  });
  const app = makeApp({
    algorithms: ["hmac-sha256"],
    resolveKey: () => HMAC_SECRET,
  });
  const res = await app.fetch(
    new Request(url, {
      headers: {
        "signature-input": sig.signatureInput,
        signature: sig.signature,
      },
    }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { keyid: "svc-a" });
});

test("httpSignatureAuth rejects a missing signature with 401", async () => {
  const app = makeApp({
    algorithms: ["hmac-sha256"],
    resolveKey: () => HMAC_SECRET,
  });
  const res = await app.fetch(new Request("http://localhost/secure"));
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("httpSignatureAuth rejects a forged signature with 401", async () => {
  const created = Math.floor(Date.now() / 1000);
  const url = "http://localhost/secure";
  const sig = await signMessage({
    method: "GET",
    url,
    components: ["@method", "@path"],
    alg: "hmac-sha256",
    key: HMAC_SECRET,
    created,
  });
  const app = makeApp({
    algorithms: ["hmac-sha256"],
    resolveKey: () => new Uint8Array(32).fill(1),
  });
  const res = await app.fetch(
    new Request(url, {
      headers: {
        "signature-input": sig.signatureInput,
        signature: sig.signature,
      },
    }),
  );
  assert.equal(res.status, 401);
});

test("httpSignatureAuth optional mode passes unsigned requests through", async () => {
  const app = makeApp({
    algorithms: ["hmac-sha256"],
    resolveKey: () => HMAC_SECRET,
    optional: true,
  });
  const res = await app.fetch(new Request("http://localhost/secure"));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { keyid: null });
});

// ---------- content-digest helpers ----------

test("contentDigest + verifyContentDigest round-trip", async () => {
  const body = JSON.stringify({ hello: "world" });
  const header = await contentDigest(body);
  assert.match(header, /^sha-256=:.+:$/);
  assert.equal(await verifyContentDigest(header, body), true);
  assert.equal(await verifyContentDigest(header, body + "tampered"), false);
});

test("contentDigest sha-512 and binding into a signature", async () => {
  const created = 1_700_011_000;
  const body = new TextEncoder().encode("payload");
  const digest = await contentDigest(body, { algorithm: "sha-512" });
  assert.match(digest, /^sha-512=:.+:$/);

  const sig = await signMessage({
    method: "POST",
    url: "https://api.example.com/ingest",
    headers: { "content-digest": digest },
    components: ["@method", "@path", "content-digest"],
    alg: "hmac-sha256",
    key: HMAC_SECRET,
    created,
    now: fixedNow(created),
  });
  const result = await verifyMessage({
    method: "POST",
    url: "https://api.example.com/ingest",
    headers: {
      "content-digest": digest,
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["hmac-sha256"],
    requiredComponents: ["content-digest"],
    resolveKey: () => HMAC_SECRET,
    now: fixedNow(created),
  });
  assert.equal(result.valid, true);
  assert.equal(await verifyContentDigest(digest, body), true);
});

test("verifyContentDigest rejects malformed or empty headers", async () => {
  assert.equal(await verifyContentDigest("not-a-digest", "x"), false);
  assert.equal(await verifyContentDigest("", "x"), false);
  assert.equal(await verifyContentDigest("md5=:AAAA:", "x"), false);
});

test("rsa-pss-sha512 sign + verify roundtrip", async () => {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSA-PSS",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-512",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const created = 1_700_012_000;
  const sig = await signMessage({
    method: "GET",
    url: "https://api.example.com/rsa",
    components: ["@method", "@path"],
    alg: "rsa-pss-sha512",
    key: pair.privateKey,
    created,
    now: fixedNow(created),
  });
  const result = await verifyMessage({
    method: "GET",
    url: "https://api.example.com/rsa",
    headers: {
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["rsa-pss-sha512"],
    resolveKey: () => pair.publicKey,
    now: fixedNow(created),
  });
  assert.equal(result.valid, true);
});

test("rsa-v1_5-sha256 sign + verify roundtrip", async () => {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const created = 1_700_012_500;
  const sig = await signMessage({
    method: "GET",
    url: "https://api.example.com/rsa15",
    components: ["@method", "@path"],
    alg: "rsa-v1_5-sha256",
    key: pair.privateKey,
    created,
    now: fixedNow(created),
  });
  const result = await verifyMessage({
    method: "GET",
    url: "https://api.example.com/rsa15",
    headers: {
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["rsa-v1_5-sha256"],
    resolveKey: () => pair.publicKey,
    now: fixedNow(created),
  });
  assert.equal(result.valid, true);
});

test("ecdsa-p384-sha384 sign + verify roundtrip", async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-384" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const created = 1_700_013_000;
  const sig = await signMessage({
    method: "GET",
    url: "https://api.example.com/ec384",
    components: ["@method", "@path"],
    alg: "ecdsa-p384-sha384",
    key: pair.privateKey,
    created,
    now: fixedNow(created),
  });
  const result = await verifyMessage({
    method: "GET",
    url: "https://api.example.com/ec384",
    headers: {
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["ecdsa-p384-sha384"],
    resolveKey: () => pair.publicKey,
    now: fixedNow(created),
  });
  assert.equal(result.valid, true);
});

test("ed25519 JWK key material round-trips", async () => {
  const { privateKey, publicKey } = await genEd25519();
  const pubJwk = await crypto.subtle.exportKey("jwk", publicKey);
  const created = 1_700_013_500;
  const sig = await signMessage({
    method: "GET",
    url: "https://api.example.com/jwk",
    components: ["@method", "@path"],
    alg: "ed25519",
    key: privateKey,
    created,
    now: fixedNow(created),
  });
  const result = await verifyMessage({
    method: "GET",
    url: "https://api.example.com/jwk",
    headers: {
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["ed25519"],
    resolveKey: () => ({ alg: "ed25519", key: pubJwk }),
    now: fixedNow(created),
  });
  assert.equal(result.valid, true);
});

test("all derived components serialize and round-trip", async () => {
  const created = 1_700_014_000;
  const url = "https://api.example.com/a/b?x=1&y=2";
  const components = [
    "@method",
    "@target-uri",
    "@authority",
    "@scheme",
    "@request-target",
    "@path",
    "@query",
  ];
  const sig = await signMessage({
    method: "POST",
    url,
    components,
    alg: "hmac-sha256",
    key: HMAC_SECRET,
    created,
    expires: created + 120,
    nonce: "n-1",
    tag: "billing",
    now: fixedNow(created),
  });
  assert.match(sig.signatureBase, /"@scheme": https/);
  assert.match(sig.signatureBase, /"@request-target": \/a\/b\?x=1&y=2/);
  assert.match(sig.signatureInput, /;expires=/);
  assert.match(sig.signatureInput, /;nonce="n-1"/);
  assert.match(sig.signatureInput, /;tag="billing"/);
  const result = await verifyMessage({
    method: "POST",
    url,
    headers: {
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["hmac-sha256"],
    requiredComponents: ["@scheme", "@authority"],
    requiredTag: "billing",
    resolveKey: () => HMAC_SECRET,
    now: fixedNow(created + 1),
  });
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.expires, created + 120);
    assert.equal(result.nonce, "n-1");
    assert.equal(result.tag, "billing");
  }
});

test("@query with no query string serializes as a lone ?", async () => {
  const created = 1_700_014_500;
  const sig = await signMessage({
    method: "GET",
    url: "https://api.example.com/noquery",
    components: ["@method", "@query"],
    alg: "hmac-sha256",
    key: HMAC_SECRET,
    created,
    now: fixedNow(created),
  });
  assert.match(sig.signatureBase, /"@query": \?\n/);
});

test("signing a response covers @status", async () => {
  const created = 1_700_015_000;
  const sig = await signMessage({
    method: "GET",
    url: "https://api.example.com/x",
    status: 200,
    components: ["@status"],
    alg: "hmac-sha256",
    key: HMAC_SECRET,
    created,
    now: fixedNow(created),
  });
  assert.match(sig.signatureBase, /"@status": 200/);
  const result = await verifyMessage({
    method: "GET",
    url: "https://api.example.com/x",
    status: 200,
    headers: {
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["hmac-sha256"],
    requiredComponents: ["@status"],
    resolveKey: () => HMAC_SECRET,
    now: fixedNow(created),
  });
  assert.equal(result.valid, true);
});

test("@status on a non-response message fails to resolve", async () => {
  await assert.rejects(
    signMessage({
      method: "GET",
      url: "https://api.example.com/x",
      components: ["@status"],
      alg: "hmac-sha256",
      key: HMAC_SECRET,
    }),
    /@status is only valid for responses/,
  );
});

test("@signature-params cannot be a covered component", async () => {
  await assert.rejects(
    signMessage({
      method: "GET",
      url: "https://api.example.com/x",
      components: ["@signature-params"],
      alg: "hmac-sha256",
      key: HMAC_SECRET,
    }),
    /cannot be a covered component/,
  );
});

test("duplicate covered component is rejected at signing", async () => {
  await assert.rejects(
    signMessage({
      method: "GET",
      url: "https://api.example.com/x",
      components: ["@method", "@method"],
      alg: "hmac-sha256",
      key: HMAC_SECRET,
    }),
    /duplicate covered component/,
  );
});

test("@query-param missing from the query fails to resolve", async () => {
  await assert.rejects(
    signMessage({
      method: "GET",
      url: "https://api.example.com/x?a=1",
      components: ['@query-param;name="missing"'],
      alg: "hmac-sha256",
      key: HMAC_SECRET,
    }),
    /is not present in the query/,
  );
});

test("uppercase field component name is rejected", async () => {
  await assert.rejects(
    signMessage({
      method: "GET",
      url: "https://api.example.com/x",
      headers: { "x-trace": "1" },
      components: ["X-Trace"],
      alg: "hmac-sha256",
      key: HMAC_SECRET,
    }),
    /must be lowercase/,
  );
});

test("includeAlg: false omits alg; verify uses the pinned key alg", async () => {
  const created = 1_700_016_000;
  const sig = await signMessage({
    method: "GET",
    url: "https://api.example.com/x",
    components: ["@method", "@path"],
    alg: "hmac-sha256",
    key: HMAC_SECRET,
    includeAlg: false,
    created,
    now: fixedNow(created),
  });
  assert.doesNotMatch(sig.signatureInput, /;alg=/);
  // Without a declared alg and without a pinned alg → unspecified_alg.
  const r1 = await verifyMessage({
    method: "GET",
    url: "https://api.example.com/x",
    headers: {
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["hmac-sha256"],
    resolveKey: () => HMAC_SECRET,
    now: fixedNow(created),
  });
  assert.equal(r1.valid, false);
  if (!r1.valid) assert.equal(r1.reason, "unspecified_alg");
  // With a pinned alg it verifies.
  const r2 = await verifyMessage({
    method: "GET",
    url: "https://api.example.com/x",
    headers: {
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["hmac-sha256"],
    resolveKey: () => ({ alg: "hmac-sha256", key: HMAC_SECRET }),
    now: fixedNow(created),
  });
  assert.equal(r2.valid, true);
});

test("explicit label selection picks the right signature", async () => {
  const created = 1_700_016_500;
  const sig = await signMessage({
    method: "GET",
    url: "https://api.example.com/x",
    components: ["@method", "@path"],
    alg: "hmac-sha256",
    key: HMAC_SECRET,
    label: "proxy",
    created,
    now: fixedNow(created),
  });
  assert.ok(sig.signatureInput.startsWith("proxy="));
  const result = await verifyMessage({
    method: "GET",
    url: "https://api.example.com/x",
    headers: {
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["hmac-sha256"],
    label: "proxy",
    resolveKey: () => HMAC_SECRET,
    now: fixedNow(created),
  });
  assert.equal(result.valid, true);
});

test("oversized signature headers are rejected", async () => {
  const big = "sig1=" + "a".repeat(9000);
  const result = await verifyMessage({
    method: "GET",
    url: "https://api.example.com/x",
    headers: { "signature-input": big, signature: "sig1=:AA:" },
    algorithms: ["hmac-sha256"],
    resolveKey: () => HMAC_SECRET,
  });
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.reason, "header_too_large");
});

test("invalid key material for verify is reported as invalid_key", async () => {
  const created = 1_700_017_000;
  const sig = await signMessage({
    method: "GET",
    url: "https://api.example.com/x",
    components: ["@method", "@path"],
    alg: "hmac-sha256",
    key: HMAC_SECRET,
    created,
    now: fixedNow(created),
  });
  const result = await verifyMessage({
    method: "GET",
    url: "https://api.example.com/x",
    headers: {
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["hmac-sha256"],
    // Too-short HMAC secret → importKey throws → invalid_key.
    resolveKey: () => new Uint8Array(8),
    now: fixedNow(created),
  });
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.reason, "invalid_key");
});

test("contentDigest rejects an unsupported algorithm", async () => {
  await assert.rejects(
    contentDigest("x", { algorithm: "md5" as any }),
    /unsupported algorithm/,
  );
});

test("verifyContentDigest accepts a multi-member header", async () => {
  const body = "hello";
  const d256 = await contentDigest(body, { algorithm: "sha-256" });
  const d512 = await contentDigest(body, { algorithm: "sha-512" });
  assert.equal(await verifyContentDigest(`${d256}, ${d512}`, body), true);
});
