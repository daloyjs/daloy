/**
 * RED-TEAM ATTACK SUITE — WAVE 2
 * ==============================
 *
 * Extends `red-team-attacks.test.ts` into the corners the first wave didn't
 * touch: decompression bombs, session/cookie integrity, mTLS header spoofing,
 * HTTP Message Signatures, scope/auth enforcement, WebSocket frame protocol,
 * pagination cursors, idempotency replay, concurrency shedding, and the
 * secure-by-default refuse-to-boot guards.
 *
 * Same rule as wave 1: the SECURE outcome is the PASSING outcome.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { z } from "zod";
import {
  App,
  // DoS / parsing
  requestDecompression,
  decodeCursor,
  encodeCursor,
  MAX_CURSOR_LENGTH,
  idempotency,
  MemoryIdempotencyStore,
  concurrencyLimit,
  multipartObject,
  fileField,
  // crypto integrity
  signValue,
  verifySignedValue,
  assertCookieAttributes,
  clientCertAuth,
  signMessage,
  verifyMessage,
  // auth middleware
  bearerAuth,
  basicAuth,
  requireScopes,
  fetchMetadata,
  timingSafeEqual,
  // websocket
  parseFrame,
  encodeFrame,
  checkWebSocketOrigin,
  WS_OPCODE,
  WebSocketProtocolError,
  FRAME_INCOMPLETE,
  // errors
  BadRequestError,
} from "../src/index.js";

const b64 = (s: string) => Buffer.from(s).toString("base64");
const b64url = (s: string) => Buffer.from(s).toString("base64url");
const SECRET32 = "0123456789abcdef0123456789abcdef"; // 32 chars

// ===========================================================================
// 1. DECOMPRESSION BOMB
// ===========================================================================

function decompApp() {
  const app = new App({ logger: false });
  app.use(requestDecompression({ maxDecompressedBytes: 1024, maxRatio: 50 }));
  app.route({
    method: "POST",
    path: "/ingest",
    operationId: "ingest",
    request: { body: z.object({ value: z.string() }) as any },
    responses: { 200: { description: "ok", body: z.object({ len: z.number() }) as any } },
    handler: async ({ body }: any) => ({ status: 200 as const, body: { len: body.value.length } }),
  });
  return app;
}

test("[decompression-bomb] a gzip body that inflates past the cap is rejected (413)", async () => {
  const huge = JSON.stringify({ value: "A".repeat(500_000) }); // ~500 KB plaintext
  const gz = gzipSync(Buffer.from(huge)); // compresses to a few hundred bytes
  const res = await decompApp().request("/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", "content-encoding": "gzip" },
    body: gz,
  });
  assert.equal(res.status, 413);
});

test("[decompression-bomb] an unsupported content-encoding (br) is rejected (415)", async () => {
  const res = await decompApp().request("/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", "content-encoding": "br" },
    body: gzipSync(Buffer.from('{"value":"hi"}')),
  });
  assert.equal(res.status, 415);
});

test("[decompression-bomb] layered encodings (gzip, gzip) are refused (415)", async () => {
  const res = await decompApp().request("/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", "content-encoding": "gzip, gzip" },
    body: gzipSync(Buffer.from('{"value":"hi"}')),
  });
  assert.equal(res.status, 415);
});

// ===========================================================================
// 2. SIGNED-VALUE / SESSION-COOKIE INTEGRITY
// ===========================================================================

test("[signed-value] a tampered signature fails verification (returns null)", async () => {
  const signed = await signValue("session-id-123", SECRET32);
  assert.equal(await verifySignedValue(signed, SECRET32), "session-id-123");

  const tampered = signed.slice(0, -1) + (signed.endsWith("A") ? "B" : "A");
  assert.equal(await verifySignedValue(tampered, SECRET32), null, "flipped signature byte must not verify");
});

test("[signed-value] swapping the payload but keeping the signature fails", async () => {
  const signed = await signValue("user-7", SECRET32);
  const sig = signed.slice(signed.lastIndexOf(".") + 1);
  const forged = `admin.${sig}`; // attacker keeps the MAC, swaps the value
  assert.equal(await verifySignedValue(forged, SECRET32), null);
});

test("[signed-value] a wrong secret never verifies; rotation array still accepts old", async () => {
  const signed = await signValue("session-id-123", SECRET32);
  assert.equal(await verifySignedValue(signed, "wrong-secret-wrong-secret-wrong!"), null);
  // Secret rotation: the old secret remains valid while listed in the array.
  assert.equal(await verifySignedValue(signed, ["new-secret-new-secret-new-secret", SECRET32]), "session-id-123");
});

// ===========================================================================
// 3. COOKIE ATTRIBUTE GUARDS
// ===========================================================================

test("[cookie] insecure attribute combinations are refused", () => {
  // __Host- prefix without Secure.
  assert.throws(() =>
    assertCookieAttributes({ scope: "test", name: "__Host-sid", attributes: { secure: false } }),
  );
  // __Host- prefix with a Domain (forbidden by the prefix spec).
  assert.throws(() =>
    assertCookieAttributes({
      scope: "test",
      name: "__Host-sid",
      attributes: { secure: true, path: "/", domain: "example.com" },
    }),
  );
  // SameSite=None without Secure (browsers reject it; we refuse to emit it).
  assert.throws(() =>
    assertCookieAttributes({ scope: "test", name: "sid", attributes: { sameSite: "None", secure: false } }),
  );
  // A correct __Host- cookie is accepted.
  assert.doesNotThrow(() =>
    assertCookieAttributes({ scope: "test", name: "__Host-sid", attributes: { secure: true, path: "/" } }),
  );
});

// ===========================================================================
// 4. mTLS — spoofed client-cert header must be ignored without opt-in
// ===========================================================================

test("[mtls] a spoofed x-forwarded-client-cert header is ignored when not configured (401)", async () => {
  const app = new App({ logger: false });
  app.use(clientCertAuth()); // no header trust configured → XFCC must be ignored
  app.route({
    method: "GET",
    path: "/internal",
    operationId: "internal",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.request("/internal", {
    headers: { "x-forwarded-client-cert": 'Subject="CN=admin,O=acme";Hash=deadbeef' },
  });
  assert.equal(res.status, 401, "an unconfigured app must not trust a client-supplied XFCC header");
});

// ===========================================================================
// 5. HTTP MESSAGE SIGNATURES (RFC 9421)
// ===========================================================================

const SIG_KEY = new TextEncoder().encode(SECRET32);

test("[http-sig] a valid signature verifies; a tampered one is rejected", async () => {
  const url = "https://api.example.com/transfer";
  // Default covered set is @method + @target-uri (aligned with verify defaults).
  const sig = await signMessage({
    method: "POST",
    url,
    headers: { "content-type": "application/json" },
    components: ["@method", "@target-uri", "content-type"],
    alg: "hmac-sha256",
    key: SIG_KEY,
    keyid: "key-1",
  });

  const ok = await verifyMessage({
    method: "POST",
    url,
    headers: {
      "content-type": "application/json",
      "signature-input": sig.signatureInput,
      signature: sig.signature,
    },
    algorithms: ["hmac-sha256"],
    resolveKey: () => SIG_KEY,
  });
  assert.equal(ok.valid, true);

  const bad = await verifyMessage({
    method: "POST",
    url,
    headers: {
      "content-type": "application/json",
      "signature-input": sig.signatureInput,
      signature: sig.signature.slice(0, -6) + "AAAAA:",
    },
    algorithms: ["hmac-sha256"],
    resolveKey: () => SIG_KEY,
  });
  assert.equal(bad.valid, false);
});

test("[http-sig] a stale signature (created too long ago) is rejected", async () => {
  const url = "https://api.example.com/transfer";
  const stale = await signMessage({
    method: "POST",
    url,
    // Default components satisfy the verifier's default required set.
    alg: "hmac-sha256",
    key: SIG_KEY,
    created: Math.floor(Date.now() / 1000) - 4000, // way past a 300s window
  });
  const res = await verifyMessage({
    method: "POST",
    url,
    headers: { "signature-input": stale.signatureInput, signature: stale.signature },
    algorithms: ["hmac-sha256"],
    resolveKey: () => SIG_KEY,
    maxAgeSeconds: 300,
  });
  assert.equal(res.valid, false);
  if (!res.valid) assert.equal(res.reason, "signature_stale");
});

// ===========================================================================
// 6. AUTH MIDDLEWARE — bearerAuth / basicAuth / requireScopes / fetchMetadata
// ===========================================================================

test("[bearer-auth] missing token → 401 with WWW-Authenticate; bad token → 403; good → 200", async () => {
  const app = new App({ logger: false });
  app.use(bearerAuth({ validate: (t) => t === "good-token" }));
  app.route({
    method: "GET",
    path: "/secure",
    operationId: "secure",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  const missing = await app.request("/secure");
  assert.equal(missing.status, 401);
  assert.ok((missing.headers.get("www-authenticate") ?? "").toLowerCase().includes("bearer"));

  const bad = await app.request("/secure", { headers: { authorization: "Bearer nope" } });
  assert.equal(bad.status, 403);

  const good = await app.request("/secure", { headers: { authorization: "Bearer good-token" } });
  assert.equal(good.status, 200);
});

test("[basic-auth] missing/wrong/oversize credentials → 401; correct → 200", async () => {
  const app = new App({ logger: false });
  app.use(
    basicAuth({
      verify: (u, p) => timingSafeEqual(u, "admin") && timingSafeEqual(p, "s3cr3t-passphrase-value"),
    }),
  );
  app.route({
    method: "GET",
    path: "/admin",
    operationId: "admin",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  assert.equal((await app.request("/admin")).status, 401);
  assert.equal(
    (await app.request("/admin", { headers: { authorization: `Basic ${b64("admin:wrong")}` } })).status,
    401,
  );
  // Oversize credential is rejected before verify() runs.
  assert.equal(
    (await app.request("/admin", { headers: { authorization: `Basic ${b64("admin:" + "x".repeat(5000))}` } }))
      .status,
    401,
  );
  assert.equal(
    (await app.request("/admin", { headers: { authorization: `Basic ${b64("admin:s3cr3t-passphrase-value")}` } }))
      .status,
    200,
  );
});

function scopeApp(userScopes: string[] | null, required: string[]) {
  const app = new App({ logger: false });
  if (userScopes !== null) {
    app.use({
      beforeHandle: (ctx: any) => {
        ctx.state.user = { scopes: userScopes };
        return undefined;
      },
    } as any);
  }
  app.use(requireScopes(required));
  app.route({
    method: "GET",
    path: "/scoped",
    operationId: "scoped",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  return app;
}

test("[require-scopes] no credentials → 401; present-but-missing-scope → 403; sufficient → 200", async () => {
  assert.equal((await scopeApp(null, ["read"]).request("/scoped")).status, 401);
  assert.equal((await scopeApp(["read"], ["write"]).request("/scoped")).status, 403);
  assert.equal((await scopeApp(["read", "write"], ["write"]).request("/scoped")).status, 200);
});

test("[fetch-metadata] a cross-site state-changing request is rejected (403)", async () => {
  const app = new App({ logger: false });
  app.use(fetchMetadata());
  app.route({
    method: "POST",
    path: "/transfer",
    operationId: "transfer",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  const blocked = await app.request("/transfer", {
    method: "POST",
    headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" },
  });
  assert.equal(blocked.status, 403);

  const same = await app.request("/transfer", {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" },
  });
  assert.equal(same.status, 200);
});

// ===========================================================================
// 7. WEBSOCKET FRAME PROTOCOL + CROSS-SITE HIJACKING
// ===========================================================================

test("[websocket] oversize control frames are refused on encode and parse", () => {
  assert.throws(
    () => encodeFrame({ opcode: WS_OPCODE.PING, payload: new Uint8Array(200) }),
    WebSocketProtocolError,
  );
  // A CLOSE frame claiming a >125 control payload (len marker 126) is rejected.
  assert.throws(() => parseFrame(new Uint8Array([0x88, 0x7e, 0x00, 0x00])), WebSocketProtocolError);
});

test("[websocket] an unmasked client frame is a protocol error when masking is required", () => {
  const unmasked = new Uint8Array([0x81, 0x03, 0x61, 0x62, 0x63]); // FIN+TEXT, mask bit clear, "abc"
  assert.throws(() => parseFrame(unmasked, { requireMask: true }), WebSocketProtocolError);
});

test("[websocket] a too-short buffer parses as FRAME_INCOMPLETE, not a crash", () => {
  assert.equal(parseFrame(new Uint8Array([0x81])), FRAME_INCOMPLETE);
});

test("[websocket] cross-origin handshake (CSWSH) is rejected by same-origin / allowlist policy", () => {
  const evil = new Request("http://api.local/ws", { headers: { origin: "https://evil.example" } });
  assert.equal(checkWebSocketOrigin(evil, "same-origin").ok, false);
  assert.equal(checkWebSocketOrigin(evil, ["https://trusted.example"]).ok, false);

  const trusted = new Request("http://api.local/ws", { headers: { origin: "https://trusted.example" } });
  assert.equal(checkWebSocketOrigin(trusted, ["https://trusted.example"]).ok, true);
});

// ===========================================================================
// 8. PAGINATION CURSOR TAMPERING
// ===========================================================================

test("[cursor] oversized / non-base64 / non-JSON cursors are rejected, never crash", () => {
  assert.throws(() => decodeCursor("a".repeat(MAX_CURSOR_LENGTH + 1)), BadRequestError);
  assert.throws(() => decodeCursor("not valid base64!!!"), BadRequestError);
  assert.throws(() => decodeCursor(b64url("this is not json")), BadRequestError);
});

test("[cursor] a prototype-pollution payload in a cursor is stripped on decode", () => {
  const malicious = b64url(JSON.stringify({ id: 42, __proto__: { admin: true } }));
  const decoded = decodeCursor<{ id: number }>(malicious);
  assert.equal(decoded.id, 42);
  assert.equal(({} as any).admin, undefined, "decoding a cursor must not pollute Object.prototype");
});

test("[cursor] honest round-trips survive", () => {
  assert.deepEqual(decodeCursor(encodeCursor({ id: 7, after: "x" })), { id: 7, after: "x" });
});

// ===========================================================================
// 9. IDEMPOTENCY — replay + key-reuse-with-different-body
// ===========================================================================

test("[idempotency] replay returns the cached response; reusing a key with a new body → 422", async () => {
  const app = new App({ logger: false });
  app.use(idempotency({ store: new MemoryIdempotencyStore() }));
  app.route({
    method: "POST",
    path: "/pay",
    operationId: "pay",
    request: { body: z.object({ amount: z.number() }) as any },
    responses: { 201: { description: "created", body: z.object({ txId: z.string() }) as any } },
    handler: async () => ({ status: 201 as const, body: { txId: "tx-123" } }),
  });

  const h = (k: string) => ({ "content-type": "application/json", "idempotency-key": k });
  const first = await app.request("/pay", { method: "POST", headers: h("k1"), body: '{"amount":100}' });
  assert.equal(first.status, 201);

  const replay = await app.request("/pay", { method: "POST", headers: h("k1"), body: '{"amount":100}' });
  assert.equal(replay.status, 201);
  assert.ok(replay.headers.get("idempotency-replayed"), "replay must be flagged");

  const reuse = await app.request("/pay", { method: "POST", headers: h("k1"), body: '{"amount":999}' });
  assert.equal(reuse.status, 422, "same key + different body must be refused");
});

// ===========================================================================
// 10. CONCURRENCY LIMIT — overflow sheds with 503
// ===========================================================================

test("[concurrency] requests beyond the limit are shed with 503 + Retry-After", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const app = new App({ logger: false });
  app.use(concurrencyLimit({ maxConcurrent: 1, maxQueue: 0, retryAfterSeconds: 2 }));
  app.route({
    method: "GET",
    path: "/slow",
    operationId: "slow",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => {
      await gate;
      return { status: 200 as const, body: { ok: true } };
    },
  });

  const p1 = app.request("/slow"); // takes the only slot
  await new Promise((r) => setTimeout(r, 25)); // let it enter the handler
  const shed = await app.request("/slow"); // no slot, no queue → shed
  assert.equal(shed.status, 503);
  assert.ok(shed.headers.get("retry-after"));

  release();
  assert.equal((await p1).status, 200);
});

// ===========================================================================
// 11. MULTIPART — magic-bytes mismatch (file lies about its type)
// ===========================================================================

test("[multipart] a JPEG masquerading as image/png is rejected by magic-byte sniffing", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/avatar",
    operationId: "avatar",
    request: {
      body: multipartObject({
        file: fileField({ accept: ["image/png"], magicBytes: true, maxBytes: 1_000_000 }),
      }) as any,
    },
    responses: { 201: { description: "created", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 201 as const, body: { ok: true } }),
  });

  // Real bytes are JPEG (ff d8 ff), but the part claims image/png.
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x10]);
  const fd = new FormData();
  fd.append("file", new File([jpegBytes], "evil.png", { type: "image/png" }));
  const res = await app.request("/avatar", { method: "POST", body: fd });
  assert.ok(res.status === 400 || res.status === 422, `expected a rejection, got ${res.status}`);
  assert.notEqual(res.status, 201);
});

// ===========================================================================
// 12. SECURE-BY-DEFAULT REFUSE-TO-BOOT
// ===========================================================================

test("[refuse-to-boot] secureDefaults:false is refused in production without acknowledgement", () => {
  assert.throws(() => new App({ logger: false, production: true, secureDefaults: false } as any));
  // With the explicit acknowledgement it is allowed to boot.
  assert.doesNotThrow(
    () =>
      new App({
        logger: false,
        production: true,
        secureDefaults: false,
        acknowledgeInsecureDefaults: true,
        crashOnUnhandledRejection: false,
      } as any),
  );
});

test("[preset] internal-service preset skips browser-only secure headers but keeps the core guards", async () => {
  const app = new App({ logger: false, preset: "internal-service" } as any);
  app.route({
    method: "GET",
    path: "/svc",
    operationId: "svc",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.request("/svc");
  assert.equal(res.status, 200);
  // Browser-only header is NOT auto-applied under the internal-service preset.
  assert.equal(res.headers.get("x-frame-options"), null);
});
