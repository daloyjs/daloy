import { test } from "node:test";
import assert from "node:assert/strict";

import {
  App,
  JwtError,
  createJwtSigner,
  createJwtVerifier,
  jwk,
  type JwkOptions,
} from "../src/index.js";

// Injectable clocks for the signer and for jwk(). A test suite that pins its
// app clock must be able to mint tokens whose `iat` matches that clock and
// verify them through jwk() against the same clock; otherwise pinned-time
// tests see every token as expired (or not yet valid) and have to fall back
// to wall-clock tokens that cannot be stepped past expiry.

const PINNED = 1_700_000_000; // 2023-11-14T22:13:20Z, far from the real wall clock.

type Pair = CryptoKeyPair;

async function genPair(): Promise<Pair> {
  return (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as Pair;
}

async function fixtures() {
  const pair = await genPair();
  const pub = {
    ...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
    kid: "k1",
    alg: "ES256",
  };
  const priv = (await crypto.subtle.exportKey(
    "jwk",
    pair.privateKey,
  )) as JsonWebKey;
  return { jwks: { keys: [pub] }, priv };
}

function appWithJwk(opts: JwkOptions) {
  const app = new App({ logger: false });
  app.use(jwk(opts));
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  return (token: string) =>
    app.request(
      new Request("http://api.test/", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
}

// ---------------------------------------------------------------------------
// createJwtSigner({ now })
// ---------------------------------------------------------------------------

test("signer: `now` supplies the default iat when the payload omits one", async () => {
  const { jwks, priv } = await fixtures();
  const signer = createJwtSigner({
    alg: "ES256",
    key: priv,
    maxLifetimeSeconds: 3600,
    header: { kid: "k1" },
    now: () => PINNED,
  });
  // No iat in the payload: the lifetime check (exp - iat) must use the pinned
  // clock, or a 300s token measured from 2023 against the wall clock would be
  // refused as already expired.
  const token = await signer.sign({ sub: "u", exp: PINNED + 300 });
  const [, payloadB64] = token.split(".") as [string, string, string];
  const payload = JSON.parse(
    Buffer.from(payloadB64, "base64url").toString("utf8"),
  ) as {
    iat?: number;
    exp?: number;
  };
  assert.equal(
    payload.iat,
    undefined,
    "signer does not inject iat into the payload",
  );
  assert.equal(payload.exp, PINNED + 300);
  const verifier = createJwtVerifier({
    algorithms: ["ES256"],
    key: jwks.keys[0] as JsonWebKey,
    now: () => PINNED + 10,
  });
  assert.equal((await verifier.verify(token)).payload.sub, "u");
});

test("signer: `now` pins the lifetime check for payloads without iat", async () => {
  const { priv } = await fixtures();
  const signer = createJwtSigner({
    alg: "ES256",
    key: priv,
    maxLifetimeSeconds: 60,
    now: () => PINNED,
  });
  // 60s window measured from the pinned clock: allowed.
  await signer.sign({ sub: "u", exp: PINNED + 60 });
  // 61s from the pinned clock: over the cap (would have been a huge negative
  // lifetime, i.e. "already expired", against the wall clock).
  await assert.rejects(
    signer.sign({ sub: "u", exp: PINNED + 61 }),
    (err: unknown) =>
      err instanceof JwtError && err.code === "exp_exceeds_max_lifetime",
  );
  // exp in the pinned past: refused as already expired.
  await assert.rejects(
    signer.sign({ sub: "u", exp: PINNED - 1 }),
    (err: unknown) => err instanceof JwtError && err.code === "exp_in_past",
  );
});

test("signer: an explicit payload iat still wins over `now`", async () => {
  const { priv } = await fixtures();
  const signer = createJwtSigner({
    alg: "ES256",
    key: priv,
    maxLifetimeSeconds: 60,
    now: () => PINNED,
  });
  await signer.sign({ sub: "u", iat: PINNED + 1000, exp: PINNED + 1030 });
});

test("signer: refuses a non-function `now` at construction", async () => {
  const { priv } = await fixtures();
  assert.throws(
    () =>
      createJwtSigner({
        alg: "ES256",
        key: priv,
        maxLifetimeSeconds: 60,
        now: PINNED as unknown as () => number,
      }),
    (err: unknown) => err instanceof JwtError && err.code === "invalid_options",
  );
});

test("signer: refuses to sign when `now` returns a non-finite value", async () => {
  const { priv } = await fixtures();
  const signer = createJwtSigner({
    alg: "ES256",
    key: priv,
    maxLifetimeSeconds: 60,
    now: () => Number.NaN,
  });
  await assert.rejects(
    signer.sign({ sub: "u", exp: PINNED + 30 }),
    (err: unknown) => err instanceof JwtError && err.code === "invalid_clock",
  );
});

test("signer: without `now` the wall clock is used (existing behavior)", async () => {
  const { priv } = await fixtures();
  const signer = createJwtSigner({
    alg: "ES256",
    key: priv,
    maxLifetimeSeconds: 60,
  });
  const wall = Math.floor(Date.now() / 1000);
  await signer.sign({ sub: "u", exp: wall + 30 });
  await assert.rejects(signer.sign({ sub: "u", exp: PINNED + 30 }));
});

// ---------------------------------------------------------------------------
// createJwtVerifier({ now }) validation
// ---------------------------------------------------------------------------

test("verifier: refuses a non-function `now` at construction", async () => {
  const { jwks } = await fixtures();
  assert.throws(
    () =>
      createJwtVerifier({
        algorithms: ["ES256"],
        key: jwks.keys[0] as JsonWebKey,
        now: "soon" as unknown as () => number,
      }),
    (err: unknown) => err instanceof JwtError && err.code === "invalid_options",
  );
});

// ---------------------------------------------------------------------------
// jwk({ now })
// ---------------------------------------------------------------------------

test("jwk: `now` is forwarded to the verifier so pinned-clock tokens verify", async () => {
  const { jwks, priv } = await fixtures();
  const signer = createJwtSigner({
    alg: "ES256",
    key: priv,
    maxLifetimeSeconds: 3600,
    header: { kid: "k1" },
    now: () => PINNED,
  });
  const token = await signer.sign({ sub: "u", iat: PINNED, exp: PINNED + 300 });

  // Without the clock the token (issued in 2023) is long expired.
  const wallClock = appWithJwk({
    jwks,
    algorithms: ["ES256"],
    allowAnyAudience: true,
  });
  assert.equal((await wallClock(token)).status, 401);

  // With the pinned clock it is valid...
  let now = PINNED + 10;
  const pinned = appWithJwk({
    jwks,
    algorithms: ["ES256"],
    allowAnyAudience: true,
    now: () => now,
  });
  assert.equal((await pinned(token)).status, 200);

  // ...and stepping the same clock past exp expires it without re-signing.
  now = PINNED + 301;
  const expired = await pinned(token);
  assert.equal(expired.status, 401);
  assert.match(expired.headers.get("www-authenticate") ?? "", /invalid_token/);

  // Stepping it back before iat makes the token "issued in the future".
  now = PINNED - 5;
  assert.equal((await pinned(token)).status, 401);
});

test("jwk: `now` still enforces maxLifetimeSeconds against the pinned clock", async () => {
  const { jwks, priv } = await fixtures();
  const signer = createJwtSigner({
    alg: "ES256",
    key: priv,
    maxLifetimeSeconds: 86_400,
    header: { kid: "k1" },
    now: () => PINNED,
  });
  const longLived = await signer.sign({ sub: "u", exp: PINNED + 7200 });
  const capped = appWithJwk({
    jwks,
    algorithms: ["ES256"],
    allowAnyAudience: true,
    maxLifetimeSeconds: 3600,
    now: () => PINNED + 1,
  });
  assert.equal((await capped(longLived)).status, 401);
});

test("jwk: a clock returning NaN fails closed (401), never accepts", async () => {
  const { jwks, priv } = await fixtures();
  const signer = createJwtSigner({
    alg: "ES256",
    key: priv,
    maxLifetimeSeconds: 3600,
    header: { kid: "k1" },
    now: () => PINNED,
  });
  const token = await signer.sign({ sub: "u", exp: PINNED + 300 });
  const broken = appWithJwk({
    jwks,
    algorithms: ["ES256"],
    allowAnyAudience: true,
    now: () => Number.NaN,
  });
  assert.equal((await broken(token)).status, 401);
});

test("jwk: refuses a non-function `now` at construction", async () => {
  const { jwks } = await fixtures();
  assert.throws(
    () =>
      jwk({
        jwks,
        algorithms: ["ES256"],
        allowAnyAudience: true,
        now: 42 as unknown as () => number,
      }),
    (err: unknown) => err instanceof JwtError && err.code === "invalid_options",
  );
});
