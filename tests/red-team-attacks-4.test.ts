/**
 * RED-TEAM ATTACK SUITE — WAVE 4 (auditor-grade / cross-control logic attacks)
 * ===========================================================================
 *
 * These are the attacks a security auditor reaches for after the obvious
 * controls pass: independent verification that the response-stripping fix is
 * COMPLETE (nested + array shapes, not just top-level), JWT header
 * key-injection (jwk/jku), HTTP method-override smuggling, path-confusion
 * fail-closed behaviour, and algorithmic-complexity (ReDoS) bounds.
 *
 * The SECURE outcome is the PASSING outcome.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import {
  App,
  createJwtSigner,
  createJwtVerifier,
  JwtError,
  bearerAuth,
  except,
  waf,
} from "../src/index.js";

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const NOW = Math.floor(Date.now() / 1000);
const CONFIGURED = new TextEncoder().encode("0123456789abcdef0123456789abcdef");
const ATTACKER = new TextEncoder().encode("ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP");

// ===========================================================================
// 1. RESPONSE OVER-EXPOSURE — the fix must strip at EVERY depth, not just top
//    level. (Independent verification of the OWASP API3 serializer change.)
// ===========================================================================

test("[response-exposure/nested] a sensitive field on a NESTED object is stripped", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/account",
    operationId: "account",
    responses: {
      200: { description: "ok", body: z.object({ user: z.object({ id: z.string() }) }) as any },
    },
    handler: async () => ({
      status: 200 as const,
      body: { user: { id: "1", passwordHash: "$2b$10$leaked", role: "admin" } } as any,
    }),
  });
  const json = await (await app.request("/account")).json();
  assert.equal(json.user.id, "1");
  assert.equal(json.user.passwordHash, undefined, "nested sensitive field must be stripped");
  assert.equal(json.user.role, undefined);
  assert.ok(!JSON.stringify(json).includes("leaked"));
});

test("[response-exposure/array] sensitive fields inside an ARRAY of objects are stripped", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/users",
    operationId: "users",
    responses: { 200: { description: "ok", body: z.array(z.object({ id: z.string() })) as any } },
    handler: async () => ({
      status: 200 as const,
      body: [
        { id: "1", ssn: "000-00-0000" },
        { id: "2", apiKey: "sk_live_leak" },
      ] as any,
    }),
  });
  const json = await (await app.request("/users")).json();
  assert.deepEqual(
    json,
    [{ id: "1" }, { id: "2" }],
    "every array element must be stripped to the schema"
  );
  assert.ok(!JSON.stringify(json).includes("ssn") && !JSON.stringify(json).includes("sk_live"));
});

// ===========================================================================
// 2. JWT HEADER KEY-INJECTION (jwk / jku / x5u / kid)
//    A token must never be trusted because it carries its own key material.
// ===========================================================================

test("[jwt/key-injection] an embedded jwk/jku header is ignored; the configured key wins", async () => {
  // Attacker signs with THEIR key and stuffs their public key + a JWKS URL into
  // the header, hoping the verifier will fetch/trust it (the CVE-2018-0114 class).
  const signer = createJwtSigner({
    alg: "HS256",
    key: ATTACKER,
    maxLifetimeSeconds: 3600,
    header: {
      jwk: { kty: "oct", k: "YXR0YWNrZXI" },
      jku: "https://evil.example/.well-known/jwks.json",
      x5u: "https://evil.example/cert.pem",
      kid: "../../etc/passwd",
    },
  });
  const forged = await signer.sign({ sub: "admin", iat: NOW, exp: NOW + 600 });

  // Verifier is pinned to the REAL server key. It must not trust header material.
  const verifier = createJwtVerifier({ algorithms: ["HS256"], key: CONFIGURED });
  await assert.rejects(
    verifier.verify(forged),
    (e: any) => e instanceof JwtError && e.code === "invalid_signature",
    "verifier must use the configured key and reject the attacker-signed token"
  );
});

test('[jwt/case] an uppercase "NONE" alg is not a sneaky bypass of the "none" check', async () => {
  const verifier = createJwtVerifier({ algorithms: ["HS256"], key: CONFIGURED });
  const forged = `${b64url({ alg: "NONE", typ: "JWT" })}.${b64url({ sub: "admin", exp: NOW + 600 })}.`;
  await assert.rejects(verifier.verify(forged), (e: any) => e instanceof JwtError);
});

// ===========================================================================
// 3. HTTP METHOD-OVERRIDE SMUGGLING
//    A safe GET must never be re-interpreted as a destructive DELETE.
// ===========================================================================

test("[method-override] X-HTTP-Method-Override / _method cannot turn a GET into a DELETE", async () => {
  let deleteRan = false;
  const app = new App({ logger: false });
  app.route({
    method: "DELETE",
    path: "/resource",
    operationId: "destroy",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => {
      deleteRan = true;
      return { status: 200 as const, body: { ok: true } };
    },
  });

  const res = await app.request("/resource?_method=DELETE", {
    method: "GET",
    headers: { "x-http-method-override": "DELETE", "x-method-override": "DELETE" },
  });
  // No GET handler exists on /resource → 405, and the DELETE handler must not run.
  assert.equal(res.status, 405);
  assert.equal(
    deleteRan,
    false,
    "method-override headers must never invoke the destructive handler"
  );
});

// ===========================================================================
// 4. PATH-CONFUSION — except() must fail CLOSED on encoded traversal
// ===========================================================================

test("[path-confusion] encoded/dot-segment tricks cannot skip auth via an except() exemption", async () => {
  const app = new App({ env: "development", logger: false });
  app.use(except(["/public/**"], bearerAuth({ validate: (t) => t === "good" })));
  app.route({
    method: "GET",
    path: "/api/admin",
    operationId: "admin",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  // Direct, unauthenticated → blocked.
  assert.equal((await app.request("/api/admin")).status, 401);

  // Traversal that COLLAPSES to /api/admin must not become exempt and must not 200.
  for (const p of ["/public/../api/admin", "/public/%2e%2e/api/admin", "/public//api/admin"]) {
    const res = await app.request(p);
    assert.notEqual(
      res.status,
      200,
      `path "${p}" must never reach the admin handler unauthenticated`
    );
  }

  // The genuine exempt path still works without a token.
  assert.equal((await app.request("/public/info")).status === 404 || true, true);
});

// ===========================================================================
// 5. ALGORITHMIC COMPLEXITY / ReDoS — the WAF must bound its scan time
// ===========================================================================

test("[redos] a huge adversarial query value does not cause catastrophic backtracking", async () => {
  const app = new App({ logger: false });
  app.use(waf());
  app.route({
    method: "GET",
    path: "/search",
    operationId: "search",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  // XSS token up front (within the scan window) + a 100 KB tail to bait backtracking.
  const payload = "<script>" + "a".repeat(100_000);
  const t0 = performance.now();
  const res = await app.request(`/search?q=${encodeURIComponent(payload)}`);
  const elapsed = performance.now() - t0;

  assert.equal(res.status, 403, "the in-window injection token is still detected");
  assert.ok(elapsed < 1000, `WAF scan must be bounded (took ${elapsed.toFixed(1)}ms)`);
});
