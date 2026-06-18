/**
 * RED-TEAM ATTACK SUITE
 * =====================
 *
 * Adversarial, end-to-end attacks against every advertised security control
 * in `@daloyjs/core`. Each `test()` plays the attacker and asserts that the
 * framework HOLDS THE LINE — the secure outcome is the passing outcome.
 *
 * This file is intentionally organized as a "report card": run it and every
 * green check is a defense that survived a real attack. It complements the
 * per-module unit suites by exercising the controls the way a pentester
 * would (forged tokens, smuggled headers, prototype-pollution payloads,
 * SSRF redirect chains, open redirects, NoSQL operators, etc.).
 *
 * The "Response over-exposure (OWASP API3)" section guards the fix that makes
 * the response schema a FILTER, not just a checker: undeclared fields a
 * handler returns are stripped before serialization, so they can never leak.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  App,
  // crypto / primitives
  timingSafeEqual,
  safeJsonParse,
  isForbiddenObjectKey,
  sanitizeHeaderName,
  sanitizeHeaderValue,
  assertNoDuplicateSingletonHeaders,
  assertNoReservedInternalHeaders,
  assertHeaderCountWithinLimit,
  DEFAULT_MAX_HEADER_COUNT,
  assertStrongSecret,
  sanitizeFilename,
  assertSafeRelativePath,
  assertNoMongoOperators,
  hasMongoOperatorKeys,
  verifyWebhookSignature,
  signWebhookPayload,
  // jwt
  createJwtSigner,
  createJwtVerifier,
  JwtError,
  // ssrf + open redirect
  fetchGuard,
  SsrfBlockedError,
  safeRedirect,
  OpenRedirectBlockedError,
  // middleware
  cors,
  csrf,
  rateLimit,
  waf,
  _resetSharedRateLimitStoresForTests,
  // errors
  InternalError,
  BadRequestError,
  ValidationError,
  PayloadTooLargeError,
  RequestHeaderFieldsTooLargeError,
} from "../src/index.js";

// A 32-byte HMAC secret that clears the RFC 7518 floor.
const HS = new TextEncoder().encode("0123456789abcdef0123456789abcdef");
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const NOW = Math.floor(Date.now() / 1000);

function pingApp(opts: Record<string, unknown> = {}) {
  const app = new App({ logger: false, ...opts } as any);
  app.route({
    method: "GET",
    path: "/ping",
    operationId: "ping",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  return app;
}

// ===========================================================================
// 1. PROTOTYPE POLLUTION  (safeJsonParse / query / form parsers)
// ===========================================================================

test("[proto-pollution] JSON body with __proto__ does not pollute Object.prototype", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/p",
    operationId: "p",
    request: { body: z.object({ name: z.string() }) as any },
    responses: { 200: { description: "ok", body: z.object({ name: z.string() }) as any } },
    handler: async ({ body }: any) => ({ status: 200 as const, body }),
  });
  const res = await app.request("/p", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"name":"x","__proto__":{"polluted":"yes"}}',
  });
  assert.equal(res.status, 200);
  assert.equal(({} as any).polluted, undefined, "global Object.prototype must NOT be polluted");
  assert.equal((Object.prototype as any).polluted, undefined);
});

test("[proto-pollution] nested constructor/prototype keys are stripped on parse", () => {
  const parsed = safeJsonParse('{"a":1,"constructor":{"x":1},"b":{"prototype":{"y":2}}}') as any;
  assert.equal(parsed.a, 1);
  assert.equal(parsed.constructor && parsed.constructor.x, undefined);
  assert.equal(parsed.b.prototype, undefined);
});

test("[proto-pollution] query string ?__proto__= is refused as an own key", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/q",
    operationId: "q",
    responses: { 200: { description: "ok", body: z.object({ keys: z.array(z.string()) }) as any } },
    handler: async ({ query }: any) => ({
      status: 200 as const,
      body: { keys: Object.keys(query) },
    }),
  });
  const res = await app.request("/q?__proto__=polluted&constructor=x&foo=bar");
  const json = await res.json();
  assert.equal(({} as any).polluted, undefined);
  assert.ok(!json.keys.includes("__proto__"), "__proto__ must not appear as a query key");
  assert.ok(!json.keys.includes("constructor"), "constructor must not appear as a query key");
  assert.ok(json.keys.includes("foo"));
});

test("[proto-pollution] isForbiddenObjectKey flags the three sink names only", () => {
  assert.equal(isForbiddenObjectKey("__proto__"), true);
  assert.equal(isForbiddenObjectKey("constructor"), true);
  assert.equal(isForbiddenObjectKey("prototype"), true);
  assert.equal(isForbiddenObjectKey("name"), false);
});

// ===========================================================================
// 2. DoS — body size, header-count amplification
// ===========================================================================

test("[dos] oversized body is rejected with 413 (Content-Length fast path)", async () => {
  const app = new App({ logger: false, bodyLimitBytes: 16 });
  app.route({
    method: "POST",
    path: "/echo",
    operationId: "echo",
    request: { body: z.object({ s: z.string() }) as any },
    responses: { 200: { description: "ok", body: z.object({ s: z.string() }) as any } },
    handler: async ({ body }: any) => ({ status: 200 as const, body }),
  });
  const res = await app.request("/echo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ s: "x".repeat(10_000) }),
  });
  assert.equal(res.status, 413);
});

test("[dos] header-count flood is rejected with 431", async () => {
  const app = pingApp();
  const headers = new Headers();
  for (let i = 0; i < DEFAULT_MAX_HEADER_COUNT + 25; i++) headers.set(`x-flood-${i}`, "1");
  const res = await app.request("/ping", { headers });
  assert.equal(res.status, 431);
});

test("[dos] assertHeaderCountWithinLimit enforces the cap and 0 disables it", () => {
  const flood = new Headers();
  for (let i = 0; i <= DEFAULT_MAX_HEADER_COUNT; i++) flood.set(`x-${i}`, "1");
  assert.throws(() => assertHeaderCountWithinLimit(flood, DEFAULT_MAX_HEADER_COUNT), RequestHeaderFieldsTooLargeError);
  assert.doesNotThrow(() => assertHeaderCountWithinLimit(flood, 0));
});

// ===========================================================================
// 3. HTTP REQUEST SMUGGLING / HEADER INJECTION
//    (Next.js CVE-2025-29927 class + CRLF response splitting)
// ===========================================================================

test("[smuggling] reserved internal header (x-daloy-internal-*) is rejected with 400", async () => {
  const app = pingApp();
  const res = await app.request("/ping", {
    headers: { "x-daloy-internal-subrequest": "1" },
  });
  assert.equal(res.status, 400);
});

test("[smuggling] duplicate Transfer-Encoding (comma-coalesced) is rejected", () => {
  const h = new Headers();
  h.append("transfer-encoding", "chunked");
  h.append("transfer-encoding", "gzip");
  assert.throws(() => assertNoDuplicateSingletonHeaders(h), BadRequestError);
  assert.doesNotThrow(() => assertNoDuplicateSingletonHeaders(new Headers({ "content-length": "10" })));
});

test("[smuggling] reserved-prefix check is case-insensitive", () => {
  assert.throws(
    () => assertNoReservedInternalHeaders(new Headers({ "X-Daloy-Internal-Dispatch": "1" })),
    BadRequestError,
  );
});

test("[header-injection] CRLF in a header value is refused (response splitting)", () => {
  assert.throws(() => sanitizeHeaderValue("ok\r\nSet-Cookie: admin=1"), BadRequestError);
  assert.throws(() => sanitizeHeaderValue("ok\x00null"), BadRequestError);
  assert.equal(sanitizeHeaderValue("perfectly-fine"), "perfectly-fine");
});

test("[header-injection] illegal header NAME is refused", () => {
  assert.throws(() => sanitizeHeaderName("bad header name"), BadRequestError);
  assert.throws(() => sanitizeHeaderName("evil:value"), BadRequestError);
  assert.equal(sanitizeHeaderName("X-Custom-Header"), "x-custom-header");
});

// ===========================================================================
// 4. JWT  (alg confusion, none, tampering, expiry, weak keys)
// ===========================================================================

test('[jwt] alg "none" is refused at signer construction', () => {
  assert.throws(
    () => createJwtSigner({ alg: "none" as any, key: HS, maxLifetimeSeconds: 60 }),
    (e: any) => e instanceof JwtError && e.code === "alg_none_refused",
  );
});

test('[jwt] alg "none" cannot appear in a verifier allowlist', () => {
  assert.throws(
    () => createJwtVerifier({ algorithms: ["none" as any], key: HS }),
    (e: any) => e instanceof JwtError && e.code === "alg_none_refused",
  );
});

test('[jwt] a forged alg:"none" token is rejected by a real verifier', async () => {
  const verifier = createJwtVerifier({ algorithms: ["HS256"], key: HS });
  const forged = `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ sub: "admin", exp: NOW + 600 })}.`;
  await assert.rejects(verifier.verify(forged), (e: any) => e instanceof JwtError);
});

test("[jwt] algorithm-confusion: HS256 token rejected by an RS256-only verifier", async () => {
  const signer = createJwtSigner({ alg: "HS256", key: HS, maxLifetimeSeconds: 3600 });
  const token = await signer.sign({ sub: "user", iat: NOW, exp: NOW + 600 });
  const verifier = createJwtVerifier({ algorithms: ["RS256"], key: HS });
  await assert.rejects(verifier.verify(token), (e: any) => e instanceof JwtError && e.code === "alg_not_allowed");
});

test("[jwt] symmetric algorithm + JWK key source is refused (confused deputy)", () => {
  assert.throws(
    () => createJwtVerifier({ algorithms: ["HS256"], key: { kty: "RSA", n: "abc", e: "AQAB" } as any }),
    (e: any) => e instanceof JwtError && e.code === "sym_with_jwk_refused",
  );
});

test("[jwt] a tampered signature is rejected as invalid_signature", async () => {
  const signer = createJwtSigner({ alg: "HS256", key: HS, maxLifetimeSeconds: 3600 });
  const token = await signer.sign({ sub: "user", iat: NOW, exp: NOW + 600 });
  const parts = token.split(".");
  const tampered = `${parts[0]}.${parts[1]}.${parts[2]!.slice(0, -2)}AA`;
  const verifier = createJwtVerifier({ algorithms: ["HS256"], key: HS });
  await assert.rejects(verifier.verify(tampered), (e: any) => e instanceof JwtError);
});

test("[jwt] a tampered PAYLOAD breaks signature verification", async () => {
  const signer = createJwtSigner({ alg: "HS256", key: HS, maxLifetimeSeconds: 3600 });
  const token = await signer.sign({ sub: "user", role: "user", iat: NOW, exp: NOW + 600 });
  const parts = token.split(".");
  const evilPayload = b64url({ sub: "user", role: "admin", iat: NOW, exp: NOW + 600 });
  const forged = `${parts[0]}.${evilPayload}.${parts[2]}`;
  const verifier = createJwtVerifier({ algorithms: ["HS256"], key: HS });
  await assert.rejects(verifier.verify(forged), (e: any) => e instanceof JwtError && e.code === "invalid_signature");
});

test("[jwt] expired token is rejected on verify", async () => {
  const signer = createJwtSigner({ alg: "HS256", key: HS, maxLifetimeSeconds: 3600 });
  const token = await signer.sign({ sub: "user", iat: NOW, exp: NOW + 60 });
  const verifier = createJwtVerifier({ algorithms: ["HS256"], key: HS, now: () => NOW + 1_000_000 });
  await assert.rejects(verifier.verify(token), (e: any) => e instanceof JwtError);
});

test("[jwt] not-yet-valid (nbf in the future) token is rejected", async () => {
  const signer = createJwtSigner({ alg: "HS256", key: HS, maxLifetimeSeconds: 3600 });
  const token = await signer.sign({ sub: "user", iat: NOW, nbf: NOW + 600, exp: NOW + 1200 });
  const verifier = createJwtVerifier({ algorithms: ["HS256"], key: HS, now: () => NOW });
  await assert.rejects(verifier.verify(token), (e: any) => e instanceof JwtError);
});

test("[jwt] issuing a token longer than maxLifetimeSeconds is refused", async () => {
  const signer = createJwtSigner({ alg: "HS256", key: HS, maxLifetimeSeconds: 60 });
  await assert.rejects(
    signer.sign({ sub: "user", iat: NOW, exp: NOW + 3600 }),
    (e: any) => e instanceof JwtError && e.code === "exp_exceeds_max_lifetime",
  );
});

test("[jwt] weak HS secret (<32 bytes) is refused at construction", () => {
  assert.throws(
    () => createJwtSigner({ alg: "HS256", key: new Uint8Array(16), maxLifetimeSeconds: 60 }),
    (e: any) => e instanceof JwtError && e.code === "weak_hs_secret",
  );
});

test("[jwt] issuer / audience mismatch is rejected", async () => {
  const signer = createJwtSigner({ alg: "HS256", key: HS, maxLifetimeSeconds: 3600 });
  const token = await signer.sign({ sub: "u", iss: "evil", aud: "wrong", iat: NOW, exp: NOW + 600 });
  const verifier = createJwtVerifier({
    algorithms: ["HS256"],
    key: HS,
    issuer: "https://trusted.example",
    audience: "my-api",
    now: () => NOW,
  });
  await assert.rejects(verifier.verify(token), (e: any) => e instanceof JwtError);
});

// ===========================================================================
// 5. SSRF  (fetchGuard)
// ===========================================================================

const okFetch = (async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;

test("[ssrf] AWS/Azure/GCP metadata IP 169.254.169.254 is blocked", async () => {
  const guard = fetchGuard({ fetch: okFetch });
  await assert.rejects(guard("http://169.254.169.254/latest/meta-data/"), SsrfBlockedError);
});

test("[ssrf] metadata IP stays blocked EVEN with allowLinkLocal:true (hard floor)", async () => {
  const guard = fetchGuard({ fetch: okFetch, allowLinkLocal: true });
  await assert.rejects(guard("http://169.254.169.254/"), SsrfBlockedError);
  // ...but a non-metadata link-local IP is now permitted, proving the floor is targeted.
  const res = await guard("http://169.254.1.1/");
  assert.equal(res.status, 200);
});

test("[ssrf] Alibaba (100.100.100.200) and Oracle (192.0.0.192) metadata are blocked", async () => {
  const guard = fetchGuard({ fetch: okFetch });
  await assert.rejects(guard("http://100.100.100.200/"), SsrfBlockedError);
  await assert.rejects(guard("http://192.0.0.192/"), SsrfBlockedError);
});

test("[ssrf] loopback and RFC1918 private ranges are blocked by default", async () => {
  const guard = fetchGuard({ fetch: okFetch });
  await assert.rejects(guard("http://127.0.0.1/"), SsrfBlockedError);
  await assert.rejects(guard("http://10.0.0.5/"), SsrfBlockedError);
  await assert.rejects(guard("http://192.168.1.1/"), SsrfBlockedError);
});

test("[ssrf] localhost resolving to 127.0.0.1 is blocked (post-DNS check)", async () => {
  const guard = fetchGuard({ fetch: okFetch, resolve: async () => ["127.0.0.1"] });
  await assert.rejects(guard("http://localhost/"), SsrfBlockedError);
});

test("[ssrf] IPv4-mapped IPv6 to metadata (::ffff:169.254.169.254) is blocked", async () => {
  const guard = fetchGuard({ fetch: okFetch });
  await assert.rejects(guard("http://[::ffff:169.254.169.254]/"), SsrfBlockedError);
});

test("[ssrf] non-http(s) schemes (file:, gopher:) are refused before any network call", async () => {
  const guard = fetchGuard({ fetch: okFetch });
  await assert.rejects(
    guard("file:///etc/passwd"),
    (e: any) => e instanceof SsrfBlockedError && e.reason === "protocol-not-allowed",
  );
  await assert.rejects(guard("gopher://127.0.0.1:6379/"), SsrfBlockedError);
});

test("[ssrf] a 302 redirect to the metadata IP is blocked at the hop", async () => {
  const fetchStub = (async (req: Request) => {
    const u = new URL(req.url);
    if (u.hostname === "8.8.8.8") {
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
    }
    return new Response("ok");
  }) as unknown as typeof fetch;
  const guard = fetchGuard({ fetch: fetchStub, resolve: async () => ["8.8.8.8"] });
  await assert.rejects(guard("http://8.8.8.8/"), SsrfBlockedError);
});

test("[ssrf] denyAddresses wins over allowAddresses", async () => {
  const guard = fetchGuard({ fetch: okFetch, allowAddresses: ["8.8.8.8"], denyAddresses: ["8.8.8.8"] });
  await assert.rejects(guard("http://8.8.8.8/"), SsrfBlockedError);
});

// ===========================================================================
// 6. OPEN REDIRECT  (safeRedirect)
// ===========================================================================

test("[open-redirect] external origin not on the allowlist is refused", () => {
  assert.throws(
    () => safeRedirect("https://evil.example/phish", { allowedOrigins: ["https://app.example.com"] }),
    OpenRedirectBlockedError,
  );
});

test("[open-redirect] protocol-relative //evil.com and /\\evil.com are refused", () => {
  assert.throws(() => safeRedirect("//evil.com", { allowedPaths: ["/"] }), OpenRedirectBlockedError);
  assert.throws(() => safeRedirect("/\\evil.com", { allowedPaths: ["/"] }), OpenRedirectBlockedError);
});

test("[open-redirect] javascript:/data: schemes are always refused", () => {
  assert.throws(
    () => safeRedirect("javascript:alert(1)", { allowedOrigins: ["https://app.example.com"] }),
    OpenRedirectBlockedError,
  );
});

test("[open-redirect] an allowlisted same-origin path is permitted", () => {
  const res = safeRedirect("/dashboard", { allowedPaths: ["/dashboard"] });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/dashboard");
});

// ===========================================================================
// 7. NoSQL OPERATOR INJECTION
// ===========================================================================

test("[nosql] {password:{$ne:null}} auth-bypass payload is rejected", () => {
  assert.throws(
    () => assertNoMongoOperators({ username: "admin", password: { $ne: null } }),
    BadRequestError,
  );
});

test("[nosql] operator keys nested inside arrays are detected", () => {
  assert.equal(hasMongoOperatorKeys([{ a: 1 }, { $gt: 2 }]), true);
  assert.equal(hasMongoOperatorKeys({ a: { b: { $where: "x" } } }), true);
  assert.equal(hasMongoOperatorKeys({ a: 1, b: { c: 2 } }), false);
});

// ===========================================================================
// 8. PATH TRAVERSAL / FILE EXPOSURE
// ===========================================================================

test("[path-traversal] assertSafeRelativePath blocks every escape vector", () => {
  for (const bad of ["../etc/passwd", "/etc/passwd", "a/../../etc", "foo\\bar", "C:\\win", "x\0y"]) {
    assert.throws(() => assertSafeRelativePath(bad), BadRequestError, bad);
  }
  assert.equal(assertSafeRelativePath("uploads/2024/file.png"), "uploads/2024/file.png");
});

test("[path-traversal] sanitizeFilename strips traversal and NUL truncation", () => {
  assert.equal(sanitizeFilename("../../etc/passwd"), "passwd");
  assert.equal(sanitizeFilename("..\\..\\windows\\system32\\cmd.exe"), "cmd.exe");
  assert.equal(sanitizeFilename("evil.png\0.exe"), "evil.png.exe");
});

// ===========================================================================
// 9. CONSTANT-TIME COMPARISON
// ===========================================================================

test("[timing] timingSafeEqual rejects length and content mismatches", () => {
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("", ""), true);
  assert.equal(timingSafeEqual("abc", "abd"), false);
  assert.equal(timingSafeEqual("abc", "abcd"), false);
  assert.equal(timingSafeEqual("secret-token", ""), false);
});

// ===========================================================================
// 10. WEBHOOK SIGNATURE VERIFICATION
// ===========================================================================

test("[webhook] valid signature verifies; tampered payload / wrong secret fail", async () => {
  const secret = "whsec_0123456789abcdef0123456789abcdef";
  const payload = '{"event":"payment.succeeded","amount":100}';
  const sig = await signWebhookPayload({ payload, secret });
  assert.equal(await verifyWebhookSignature({ payload, signature: sig, secret }), true);
  assert.equal(
    await verifyWebhookSignature({ payload: payload.replace("100", "999"), signature: sig, secret }),
    false,
  );
  assert.equal(await verifyWebhookSignature({ payload, signature: sig, secret: "wrong-secret-wrong-secret-xxxxxx" }), false);
  assert.equal(await verifyWebhookSignature({ payload, signature: "garbage", secret }), false);
});

// ===========================================================================
// 11. CORS
// ===========================================================================

test("[cors] origin:'*' + credentials:true is refused at construction", () => {
  assert.throws(() => cors({ origin: "*", credentials: true }), /credentials/i);
});

test("[cors] a disallowed origin gets NO Access-Control-Allow-Origin header", async () => {
  const app = new App({ logger: false });
  app.use(cors({ origin: "https://good.example" }));
  app.route({
    method: "GET",
    path: "/data",
    operationId: "data",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  const evil = await app.request("/data", { headers: { origin: "https://evil.example" } });
  assert.equal(evil.headers.get("access-control-allow-origin"), null);

  const good = await app.request("/data", { headers: { origin: "https://good.example" } });
  assert.equal(good.headers.get("access-control-allow-origin"), "https://good.example");
  assert.ok((good.headers.get("vary") ?? "").toLowerCase().includes("origin"));
});

// ===========================================================================
// 12. RATE LIMITING
// ===========================================================================

test("[rate-limit] requests beyond max are rejected with 429 + Retry-After", async () => {
  _resetSharedRateLimitStoresForTests();
  const app = new App({ logger: false });
  app.use(rateLimit({ windowMs: 60_000, max: 2 }));
  app.route({
    method: "GET",
    path: "/limited",
    operationId: "limited",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  const r1 = await app.request("/limited");
  const r2 = await app.request("/limited");
  const r3 = await app.request("/limited");
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.equal(r3.status, 429);
  assert.ok(r3.headers.get("retry-after"));
});

// ===========================================================================
// 13. CSRF (double-submit)
// ===========================================================================

function csrfApp() {
  const app = new App({ logger: false });
  app.use(csrf({ cookieName: "csrf", headerName: "x-csrf-token", generator: () => "tok", cookieOptions: { secure: false } }));
  app.route({
    method: "POST",
    path: "/act",
    operationId: "act",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  return app;
}

test("[csrf] state-changing POST without a token is rejected with 403", async () => {
  const res = await csrfApp().request("/act", { method: "POST" });
  assert.equal(res.status, 403);
});

test("[csrf] POST with a header that mismatches the cookie is rejected with 403", async () => {
  const res = await csrfApp().request("/act", {
    method: "POST",
    headers: { cookie: "csrf=tok", "x-csrf-token": "WRONG" },
  });
  assert.equal(res.status, 403);
});

test("[csrf] POST with matching cookie + header is allowed", async () => {
  const res = await csrfApp().request("/act", {
    method: "POST",
    headers: { cookie: "csrf=tok", "x-csrf-token": "tok" },
  });
  assert.equal(res.status, 200);
});

// ===========================================================================
// 14. WAF  (sqli / xss / cmdi signatures, block mode by default)
// ===========================================================================

function wafApp() {
  const app = new App({ logger: false });
  app.use(waf());
  app.route({
    method: "GET",
    path: "/search",
    operationId: "search",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  return app;
}

test("[waf] SQL-injection in the query string is blocked with 403", async () => {
  const res = await wafApp().request(`/search?q=${encodeURIComponent("' OR 1=1--")}`);
  assert.equal(res.status, 403);
});

test("[waf] reflected-XSS payload in the query string is blocked with 403", async () => {
  const res = await wafApp().request(`/search?q=${encodeURIComponent("<script>alert(document.cookie)</script>")}`);
  assert.equal(res.status, 403);
});

test("[waf] command-injection payload in the query string is blocked with 403", async () => {
  const res = await wafApp().request(`/search?q=${encodeURIComponent("; cat /etc/passwd")}`);
  assert.equal(res.status, 403);
});

test("[waf] a benign request is NOT a false positive", async () => {
  const res = await wafApp().request(`/search?q=${encodeURIComponent("hello world")}`);
  assert.equal(res.status, 200);
});

// ===========================================================================
// 15. CONTENT-TYPE ENFORCEMENT
// ===========================================================================

function bodyEchoApp() {
  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/echo",
    operationId: "echo",
    request: { body: z.object({ name: z.string() }) as any },
    responses: { 200: { description: "ok", body: z.object({ name: z.string() }) as any } },
    handler: async ({ body }: any) => ({ status: 200 as const, body }),
  });
  return app;
}

test("[content-type] a body route rejects text/plain with 415", async () => {
  const res = await bodyEchoApp().request("/echo", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "name=x",
  });
  assert.equal(res.status, 415);
});

// ===========================================================================
// 16. MASS ASSIGNMENT (request side) — extra keys must not reach the handler
// ===========================================================================

test("[mass-assignment] extra request keys are stripped before the handler sees them", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/user",
    operationId: "createUser",
    request: { body: z.object({ name: z.string() }) as any }, // intentionally NOT .strict()
    responses: { 200: { description: "ok", body: z.object({ received: z.record(z.string(), z.unknown()) }) as any } },
    handler: async ({ body }: any) => ({ status: 200 as const, body: { received: body } }),
  });
  const res = await app.request("/user", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"name":"alice","role":"admin","isAdmin":true}',
  });
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.received.role, undefined, "privilege-escalation field must be stripped");
  assert.equal(json.received.isAdmin, undefined);
  assert.equal(json.received.name, "alice");
});

test("[mass-assignment] a .strict() body schema rejects unexpected keys with 422", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/user",
    operationId: "createUserStrict",
    request: { body: z.object({ name: z.string() }).strict() as any },
    responses: { 200: { description: "ok", body: z.object({ name: z.string() }) as any } },
    handler: async ({ body }: any) => ({ status: 200 as const, body }),
  });
  const res = await app.request("/user", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"name":"alice","isAdmin":true}',
  });
  assert.equal(res.status, 422);
});

// ===========================================================================
// 17. ERROR REDACTION (RFC 9457 problem+json)
// ===========================================================================

test("[error-redaction] 5xx hides detail in prod, shows in dev; 4xx always shows detail", async () => {
  const internal = new InternalError("postgres://admin:hunter2@10.0.0.1/db leaked");
  const prodRes = internal.toResponse({ production: true });
  const prodJson = await prodRes.json();
  assert.equal(prodRes.status, 500);
  assert.equal(prodJson.detail, undefined, "5xx detail must be redacted in production");

  const devRes = new InternalError("postgres://admin:hunter2@10.0.0.1/db leaked").toResponse({ production: false });
  const devJson = await devRes.json();
  assert.ok((devJson.detail ?? "").includes("postgres://"), "5xx detail is visible in development");

  const badReq = new BadRequestError("the 'email' field is malformed").toResponse({ production: true });
  const badJson = await badReq.json();
  assert.equal(badReq.status, 400);
  assert.ok((badJson.detail ?? "").includes("email"), "4xx detail is preserved even in production");
});

test("[error-redaction] an unhandled handler exception returns a redacted 500 in production", async () => {
  const app = new App({ logger: false, production: true, crashOnUnhandledRejection: false } as any);
  app.route({
    method: "GET",
    path: "/boom",
    operationId: "boom",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => {
      throw new Error("internal stacktrace: /srv/app/db.ts:42 secret-token=abc123");
    },
  });
  const res = await app.request("/boom");
  const json = await res.json();
  assert.equal(res.status, 500);
  assert.equal(json.detail, undefined, "raw exception message must NOT leak to the client in production");
  assert.ok(!JSON.stringify(json).includes("secret-token"));
});

// ===========================================================================
// 18. SECURE HEADERS (auto-installed by secure-by-default)
// ===========================================================================

test("[secure-headers] new App() auto-applies the secure header set and strips fingerprints", async () => {
  const res = await pingApp().request("/ping");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.ok((res.headers.get("content-security-policy") ?? "").includes("frame-ancestors 'none'"));
  assert.ok((res.headers.get("strict-transport-security") ?? "").includes("max-age="));
  assert.ok(res.headers.get("referrer-policy"));
  assert.equal(res.headers.get("x-powered-by"), null, "X-Powered-By must be stripped");
  assert.equal(res.headers.get("server"), null, "Server header must be stripped");
});

// ===========================================================================
// 19. STRONG-SECRET BOOT GUARD
// ===========================================================================

test("[secret-guard] well-known weak / short / repeated secrets are refused", () => {
  for (const weak of ["secret", "changeme", "password", "your-jwt-secret"]) {
    assert.throws(() => assertStrongSecret(weak, "session"), /secret/i, weak);
  }
  assert.throws(() => assertStrongSecret("short", "session")); // < 32 bytes
  assert.throws(() => assertStrongSecret("a".repeat(40), "session")); // single repeated char
  assert.doesNotThrow(() => assertStrongSecret("Gjk29fmZ2pQ1xR7tLwY8vBn4cD6hS0aE5uI3oP9kM1nXz", "session"));
});

// ===========================================================================
// 20. RESPONSE OVER-EXPOSURE  (OWASP API3 — Broken Object Property Level Auth)
//     The response schema is a FILTER, not just a checker: undeclared fields
//     a handler returns are stripped before they ever hit the wire.
// ===========================================================================

test("[response-exposure] undeclared response fields are stripped, not leaked", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/me",
    operationId: "me",
    responses: { 200: { description: "ok", body: z.object({ id: z.string() }) as any } }, // non-strict
    handler: async () => ({
      status: 200 as const,
      // Handler accidentally returns sensitive fields not in the schema.
      body: { id: "1", passwordHash: "$2b$10$leaked", email: "secret@internal" } as any,
    }),
  });
  const res = await app.request("/me");
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.id, "1");
  assert.equal(json.passwordHash, undefined, "sensitive field must NOT reach the client");
  assert.equal(json.email, undefined, "undeclared field must NOT reach the client");
  assert.ok(!JSON.stringify(json).includes("leaked"));
});

test("[response-exposure] stripping also applies on async response validators", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/me-async",
    operationId: "meAsync",
    responses: {
      200: {
        description: "ok",
        // An async (Promise-returning) refinement keeps the validator on the
        // async branch of the serializer, which must strip too.
        body: z
          .object({ id: z.string() })
          .refine(async () => true, "ok") as any,
      },
    },
    handler: async () => ({
      status: 200 as const,
      body: { id: "1", ssn: "000-00-0000" } as any,
    }),
  });
  const res = await app.request("/me-async");
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.id, "1");
  assert.equal(json.ssn, undefined, "async validators must strip undeclared fields too");
});

test("[response-exposure] .passthrough() is honored — opt-in extra fields are kept", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/passthrough",
    operationId: "passthrough",
    responses: { 200: { description: "ok", body: z.object({ id: z.string() }).passthrough() as any } },
    handler: async () => ({ status: 200 as const, body: { id: "1", extra: "kept-on-purpose" } as any }),
  });
  const json = await (await app.request("/passthrough")).json();
  assert.equal(json.extra, "kept-on-purpose", "passthrough opt-in must preserve declared-as-allowed extras");
});

test("[response-exposure] a .strict() response schema rejects undeclared fields with 500", async () => {
  const app = new App({ logger: false, production: true, crashOnUnhandledRejection: false } as any);
  app.route({
    method: "GET",
    path: "/me-strict",
    operationId: "meStrict",
    responses: { 200: { description: "ok", body: z.object({ id: z.string() }).strict() as any } },
    handler: async () => ({
      status: 200 as const,
      body: { id: "1", passwordHash: "$2b$10$leaked" } as any,
    }),
  });
  const res = await app.request("/me-strict");
  const json = await res.json();
  assert.equal(res.status, 500, "strict response schema rejects the extra field");
  assert.ok(!JSON.stringify(json).includes("passwordHash"), "no leak in the error body");
});
