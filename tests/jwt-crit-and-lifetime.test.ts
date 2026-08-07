import { test } from "node:test";
import assert from "node:assert/strict";

import { createJwtSigner, createJwtVerifier, JwtError } from "../src/index.js";

// ============================================================
// JWT hardening (v1.1.0 live-pentest findings):
//  - `crit` header must be rejected at sign AND verify (RFC 7515 §4.1.11)
//  - verifier-side maxLifetimeSeconds caps accepted token lifetimes
// ============================================================

const subtle = (globalThis as unknown as { crypto: Crypto }).crypto.subtle;

async function genHs256Key(): Promise<Uint8Array> {
  const bytes = new Uint8Array(32);
  (globalThis as unknown as { crypto: Crypto }).crypto.getRandomValues(bytes);
  return bytes;
}

/** Sign a token externally (bypassing the signer's own guards) so unhappy paths are testable. */
async function craftHs256(
  key: Uint8Array,
  header: Record<string, unknown>,
  payload: Record<string, unknown>
): Promise<string> {
  const cryptoKey = await subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const h = Buffer.from(JSON.stringify(header)).toString("base64url");
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = new Uint8Array(
    await subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(`${h}.${p}`) as BufferSource)
  );
  return `${h}.${p}.${Buffer.from(sig).toString("base64url")}`;
}

test("jwt verify: rejects a token whose header carries crit (RFC 7515 §4.1.11)", async () => {
  const key = await genHs256Key();
  const now = Math.floor(Date.now() / 1000);
  // `crit:["exp"]` with exp mirrored into the header — the classic shape a
  // lax verifier accepts while ignoring the critical extension semantics.
  const token = await craftHs256(
    key,
    { alg: "HS256", typ: "JWT", crit: ["exp"], exp: now + 3600 },
    { sub: "attacker", exp: now + 3600 }
  );
  const verifier = createJwtVerifier({ algorithms: ["HS256"], key });
  await assert.rejects(
    () => verifier.verify(token),
    (e: unknown) => {
      assert.ok(e instanceof JwtError);
      assert.equal((e as JwtError).code, "unsupported_crit");
      return true;
    }
  );
});

test("jwt verify: a token with no crit still verifies (happy path)", async () => {
  const key = await genHs256Key();
  const now = Math.floor(Date.now() / 1000);
  const token = await craftHs256(key, { alg: "HS256", typ: "JWT" }, { sub: "ok", exp: now + 60 });
  const verifier = createJwtVerifier({ algorithms: ["HS256"], key });
  const verified = await verifier.verify(token);
  assert.equal((verified.payload as { sub?: string }).sub, "ok");
});

test("jwt sign: refuses to emit a crit header", () => {
  assert.throws(
    () =>
      createJwtSigner({
        alg: "HS256",
        key: new Uint8Array(32),
        maxLifetimeSeconds: 60,
        header: { crit: ["exp"] },
      }),
    (e: unknown) => {
      assert.ok(e instanceof JwtError);
      assert.equal((e as JwtError).code, "unsupported_crit");
      return true;
    }
  );
});

test("jwt verify: maxLifetimeSeconds rejects an over-long token (unhappy path)", async () => {
  const key = await genHs256Key();
  const now = Math.floor(Date.now() / 1000);
  const token = await craftHs256(
    key,
    { alg: "HS256", typ: "JWT" },
    { sub: "x", iat: now, exp: now + 100 * 365 * 24 * 3600 }
  );
  const verifier = createJwtVerifier({ algorithms: ["HS256"], key, maxLifetimeSeconds: 3600 });
  await assert.rejects(
    () => verifier.verify(token),
    (e: unknown) => {
      assert.ok(e instanceof JwtError);
      assert.equal((e as JwtError).code, "lifetime_exceeded");
      return true;
    }
  );
});

test("jwt verify: maxLifetimeSeconds accepts a token within the cap (happy path)", async () => {
  const key = await genHs256Key();
  const now = Math.floor(Date.now() / 1000);
  const token = await craftHs256(
    key,
    { alg: "HS256", typ: "JWT" },
    { sub: "x", iat: now, exp: now + 1800 }
  );
  const verifier = createJwtVerifier({ algorithms: ["HS256"], key, maxLifetimeSeconds: 3600 });
  const verified = await verifier.verify(token);
  assert.equal((verified.payload as { sub?: string }).sub, "x");
});

test("jwt verify: maxLifetimeSeconds requires exp on the token", async () => {
  const key = await genHs256Key();
  const token = await craftHs256(key, { alg: "HS256", typ: "JWT" }, { sub: "x" });
  const verifier = createJwtVerifier({ algorithms: ["HS256"], key, maxLifetimeSeconds: 3600 });
  await assert.rejects(
    () => verifier.verify(token),
    (e: unknown) => {
      assert.ok(e instanceof JwtError);
      assert.equal((e as JwtError).code, "missing_exp");
      return true;
    }
  );
});

test("jwt verify: unset maxLifetimeSeconds keeps long tokens acceptable (compat)", async () => {
  const key = await genHs256Key();
  const now = Math.floor(Date.now() / 1000);
  const token = await craftHs256(
    key,
    { alg: "HS256", typ: "JWT" },
    { sub: "x", iat: now, exp: now + 10 * 365 * 24 * 3600 }
  );
  const verifier = createJwtVerifier({ algorithms: ["HS256"], key });
  const verified = await verifier.verify(token);
  assert.equal((verified.payload as { sub?: string }).sub, "x");
});

test("jwt verify: invalid maxLifetimeSeconds option refused at construction", () => {
  for (const bad of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () =>
        createJwtVerifier({
          algorithms: ["HS256"],
          key: new Uint8Array(32),
          maxLifetimeSeconds: bad,
        }),
      (e: unknown) => {
        assert.ok(e instanceof JwtError);
        assert.equal((e as JwtError).code, "invalid_max_lifetime");
        return true;
      }
    );
  }
});
