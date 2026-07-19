/**
 * RED-TEAM ATTACK SUITE — WAVE 10 (deep-dive offensive campaigns)
 * ===============================================================
 *
 * Three focused campaigns that go past breadth and stress single classes the
 * Doyensec methodology calls out for dedicated attention:
 *
 *   Campaign A — WAF EVASION & THE CONTRACT BACKSTOP
 *     Multi-encoding / obfuscation attacks against the signature WAF. Proves
 *     bounded multi-decode + comment-strip catch classic double-encoding and
 *     SQL block-comment keyword splits, and shows the typed schema contract is
 *     still the wall for residual / novel evasions signatures cannot cover.
 *
 *   Campaign B — JWT ALGORITHM MATRIX
 *     A full sweep of forged-header attacks against the JWT verifier:
 *     `alg:none`, missing/garbage/case-variant algorithms, HS↔RS confusion,
 *     embedded `jwk`/`jku`/`kid` key-injection, and the JWKS confused-deputy
 *     refuse-to-construct guard.
 *
 *   Campaign C — TIMING ANALYSIS (constant-time credential comparison)
 *     A deterministic correctness matrix plus a statistical wall-clock probe
 *     that proves `timingSafeEqual` does not short-circuit on the first
 *     differing byte — closing the side-channel an attacker uses to recover a
 *     secret one character at a time.
 *
 * The SECURE outcome is the PASSING outcome.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import {
  App,
  waf,
  createJwtSigner,
  createJwtVerifier,
  JwtError,
  timingSafeEqual,
} from "../src/index.js";

// ===========================================================================
// Campaign A — WAF evasion & the contract backstop
// (WSTG-INPV "Testing for ... Injection", defense-in-depth layering)
// ===========================================================================

/** App with a global signature WAF, a free-text route, and a typed-number route. */
function wafApp(): App {
  const app = new App({ env: "development", logger: false });
  app.use(waf());
  app.route({
    method: "GET",
    path: "/search",
    operationId: "search",
    request: { query: z.object({ q: z.string() }) as any },
    responses: { 200: { description: "ok", body: z.object({ q: z.string() }) as any } },
    handler: async ({ query }: any) => ({ status: 200 as const, body: { q: query.q } }),
  });
  app.route({
    method: "GET",
    path: "/item",
    operationId: "item",
    request: { query: z.object({ id: z.coerce.number().int() }) as any },
    responses: { 200: { description: "ok", body: z.object({ id: z.number() }) as any } },
    handler: async ({ query }: any) => ({ status: 200 as const, body: { id: query.id } }),
  });
  return app;
}

test("[waf-evasion/baseline] classic + mixed-case + comment-spanning injection signatures are blocked (403)", async () => {
  const app = wafApp();
  const blocked = [
    "%27%20OR%201%3D1", // single-encoded  ' OR 1=1
    "UnIoN%20SeLeCT%20password", // mixed-case keyword evasion
    "UNION/**/SELECT/**/1", // inline comments BETWEEN keywords (\s\S spans them)
    "%3Cscript%3Ealert(1)%3C/script%3E", // <script>…</script>
    "%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E", // <img … onerror=>
    "1;%20DROP%20TABLE%20users", // stacked statement
  ];
  for (const q of blocked) {
    const res = await app.request(`/search?q=${q}`);
    assert.equal(res.status, 403, `payload should be blocked: ${q}`);
  }
  // And a benign query is NOT a false positive.
  assert.equal((await app.request("/search?q=hello%20world")).status, 200);
});

test("[waf-evasion] double-encoding and comment-split keywords are blocked by multi-decode + comment strip", async () => {
  const app = wafApp();
  // Bounded multi-decode (max 2) turns %2527… into ' OR 1=1. Comment stripping
  // turns 1/**/OR/**/1=1 into 1 OR 1=1. Both must score and block.
  const doubleEncoded = "%2527%2520OR%25201%253D1";
  const commentSplit = "1/**/OR/**/1=1";
  for (const q of [doubleEncoded, commentSplit]) {
    const res = await app.request(`/search?q=${q}`);
    assert.equal(res.status, 403, `payload should be blocked: ${q}`);
  }
});

test("[waf-evasion/backstop] the SAME evasive payload is rejected by the typed contract (422) — schemas are the real wall", async () => {
  const app = wafApp();
  // Aimed at a typed numeric field, the WAF-evading payload cannot validate:
  // the contract rejects it with 422 no matter how it was encoded.
  for (const id of ["%2527%2520OR%25201%253D1", "1/**/OR/**/1=1", "0x27%20OR%201"]) {
    const res = await app.request(`/item?id=${id}`);
    assert.equal(res.status, 422, `typed field rejects the smuggled value: ${id}`);
  }
  // The legitimate value still passes.
  assert.equal((await app.request("/item?id=42")).status, 200);
});

// ===========================================================================
// Campaign B — JWT algorithm matrix (forged-header attacks)
// (WSTG-ATHN / Doyensec "Cryptography": algorithm discipline)
// ===========================================================================

const HS = new TextEncoder().encode("0123456789abcdef0123456789abcdef"); // 32 bytes
const LEGIT_KEY = new TextEncoder().encode("LEGIT-key-LEGIT-key-LEGIT-key-32"); // 32 bytes
const NOW = Math.floor(Date.now() / 1000);

const subtle = (globalThis as unknown as { crypto: Crypto }).crypto.subtle;
async function genRs256Pair(): Promise<CryptoKeyPair> {
  return (await subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
}

/** Base64url-encode a JSON value (the JOSE segment encoding). */
const seg = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
/** Forge a raw JWT from attacker-controlled header + payload + (irrelevant) signature. */
const forge = (header: object, payload: object, sig = "AAAA") => `${seg(header)}.${seg(payload)}.${sig}`;

const rejectsWith = (code: string) => (e: unknown) =>
  e instanceof JwtError && e.code === code;

test("[jwt-matrix/alg-none] a forged alg:none token is refused (signature verification cannot be disabled)", async () => {
  const verifier = createJwtVerifier({ algorithms: ["HS256"], key: HS });
  const token = forge({ alg: "none", typ: "JWT" }, { sub: "admin", exp: NOW + 600 }, "");
  await assert.rejects(verifier.verify(token), rejectsWith("alg_none_refused"));
});

test("[jwt-matrix/alg-none] alg:none cannot even be configured into the allowlist", () => {
  assert.throws(
    () => createJwtVerifier({ algorithms: ["none" as any], key: HS }),
    rejectsWith("alg_none_refused"),
  );
});

test("[jwt-matrix/missing-garbage-case] missing, unknown, and case-variant token algorithms are all rejected", async () => {
  const verifier = createJwtVerifier({ algorithms: ["HS256"], key: HS });
  const payload = { sub: "admin", exp: NOW + 600 };
  const forged = [
    forge({ typ: "JWT" }, payload), // no alg at all
    forge({ alg: "HS999" }, payload), // unknown algorithm
    forge({ alg: "hs256" }, payload), // case-variant of an allowed alg
    forge({ alg: "" }, payload), // empty alg
    forge({ alg: 256 as any }, payload), // non-string alg
  ];
  for (const token of forged) {
    await assert.rejects(verifier.verify(token), rejectsWith("alg_not_allowed"), token.slice(0, 24));
  }
});

test("[jwt-matrix/confusion] an HS256 token is refused by an RS256-only verifier (algorithm confusion)", async () => {
  const signer = createJwtSigner({ alg: "HS256", key: HS, maxLifetimeSeconds: 3600 });
  const token = await signer.sign({ sub: "user", iat: NOW, exp: NOW + 600 });
  const { publicKey } = await genRs256Pair();
  const verifier = createJwtVerifier({ algorithms: ["RS256"], key: publicKey });
  await assert.rejects(verifier.verify(token), rejectsWith("alg_not_allowed"));
});

test("[jwt-matrix/key-injection] an embedded jwk / jku / kid header is ignored — the configured key wins", async () => {
  // Attacker signs with THEIR key and stuffs the header with key-injection
  // fields, hoping the verifier trusts the in-band material.
  const attacker = createJwtSigner({
    alg: "HS256",
    key: new TextEncoder().encode("ATTACKER-key-ATTACKER-key-ATTACK"),
    maxLifetimeSeconds: 3600,
    header: {
      jwk: { kty: "oct", k: "QUJD" },
      jku: "https://evil.example/keys.json",
      kid: "../../../../dev/null",
      x5u: "https://evil.example/cert.pem",
    },
  });
  const token = await attacker.sign({ sub: "admin", iat: NOW, exp: NOW + 600 });
  // The verifier uses its OWN configured secret, never the embedded jwk.
  const verifier = createJwtVerifier({ algorithms: ["HS256"], key: LEGIT_KEY });
  await assert.rejects(verifier.verify(token), rejectsWith("invalid_signature"));
});

test("[jwt-matrix/confused-deputy] HS* mixed with a JWKS-style key resolver is refused at construction", () => {
  // A function resolver is treated as a JWKS source; combining it with a
  // symmetric algorithm is the classic confused-deputy footgun.
  assert.throws(
    () => createJwtVerifier({ algorithms: ["HS256"], key: () => HS }),
    rejectsWith("sym_with_jwk_refused"),
  );
});

// ===========================================================================
// Campaign C — timing analysis (constant-time credential comparison)
// (Doyensec "Cryptography" / side-channel; WSTG-ATHN timing)
// ===========================================================================

test("[timing/correctness] timingSafeEqual is correct for early/mid/late/length/unicode mismatches", () => {
  assert.equal(timingSafeEqual("secret-token", "secret-token"), true, "equal strings match");
  assert.equal(timingSafeEqual("Xecret-token", "secret-token"), false, "differ at position 0");
  assert.equal(timingSafeEqual("secret-toketX", "secret-token"), false, "differ near the end / length");
  assert.equal(timingSafeEqual("secret-toked", "secret-token"), false, "differ at last position, same length");
  assert.equal(timingSafeEqual("short", "secret-token"), false, "length mismatch (shorter)");
  assert.equal(timingSafeEqual("secret-token-and-then-some", "secret-token"), false, "length mismatch (longer)");
  assert.equal(timingSafeEqual("", ""), true, "empty equals empty");
  assert.equal(timingSafeEqual("café", "cafe"), false, "unicode-sensitive");
});

test("[timing/side-channel] equal-length candidates take ~the same time regardless of WHERE they differ (no early exit)", () => {
  // A naive `===`/byte-loop comparator returns on the first mismatch, so a
  // guess that is wrong at byte 0 returns far faster than one wrong only at
  // the last byte — leaking the secret one character at a time. A constant-
  // time comparator scans the full length either way, so the two timings are
  // statistically indistinguishable. We assert they stay within a generous
  // multiplicative band; an early-exit comparator would differ by ~1000x here.
  // 256-byte secret: an early-exit comparator would make `diffAtEnd` ~256x
  // slower than `diffAtStart` — decisively outside the 4x band below — while
  // keeping each measurement large enough (51M char-compares) to dwarf timer
  // jitter and finish in ~2s.
  const N = 256;
  const secret = "a".repeat(N);
  const diffAtStart = "b" + "a".repeat(N - 1); // wrong at byte 0
  const diffAtEnd = "a".repeat(N - 1) + "b"; // wrong only at byte N-1

  let sink = 0; // keep the call live so the JIT cannot elide the loop
  const measure = (candidate: string, iters: number): number => {
    const t0 = performance.now();
    for (let i = 0; i < iters; i++) if (timingSafeEqual(candidate, secret)) sink++;
    return performance.now() - t0;
  };

  // Warm up the JIT, then take the MIN across several rounds — the minimum is
  // the cleanest signal because scheduler/GC noise can only make a sample
  // slower, never faster.
  measure(diffAtStart, 50_000);
  measure(diffAtEnd, 50_000);
  let early = Infinity;
  let late = Infinity;
  for (let round = 0; round < 3; round++) {
    early = Math.min(early, measure(diffAtStart, 200_000));
    late = Math.min(late, measure(diffAtEnd, 200_000));
  }
  assert.ok(sink >= 0, "result is consumed");
  const ratio = Math.max(early, late) / Math.min(early, late);
  assert.ok(
    ratio < 4,
    `constant-time: early-vs-late timing within 4x (got ${ratio.toFixed(2)}; early=${early.toFixed(2)}ms late=${late.toFixed(2)}ms)`,
  );
});
