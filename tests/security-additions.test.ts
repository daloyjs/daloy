import { test } from "node:test";
import assert from "node:assert/strict";
import { App, basicAuth, csrf, secureHeaders, timingSafeEqual } from "../src/index.js";

// ============================================================================
// secureHeaders -- CSP nonce + Trusted Types
// ============================================================================

function appWithSecureHeaders(opts: Parameters<typeof secureHeaders>[0]) {
  const app = new App({ logger: false });
  app.use(secureHeaders(opts));
  app.route({
    method: "GET",
    path: "/h",
    operationId: "h",
    responses: { 200: { description: "ok" } },
    handler: async ({ state }) => ({
      status: 200 as const,
      body: { nonce: (state as Record<string, unknown>).cspNonce ?? null },
    }),
  });
  return app;
}

test("secureHeaders: CSP object form builds header from directives", async () => {
  const app = appWithSecureHeaders({
    contentSecurityPolicy: {
      directives: {
        "default-src": "'self'",
        "img-src": ["'self'", "data:"],
      },
    },
  });
  const res = await app.request("/h");
  const csp = res.headers.get("content-security-policy") ?? "";
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /img-src 'self' data:/);
});

test("secureHeaders: empty arrays in directives are skipped", async () => {
  const app = appWithSecureHeaders({
    contentSecurityPolicy: {
      directives: {
        "default-src": "'self'",
        "img-src": [],
      },
    },
  });
  const res = await app.request("/h");
  const csp = res.headers.get("content-security-policy") ?? "";
  assert.doesNotMatch(csp, /img-src/);
});

test("secureHeaders: nonce is generated per request and injected into script-src + style-src", async () => {
  const app = appWithSecureHeaders({
    contentSecurityPolicy: {
      directives: {
        "default-src": "'self'",
        "script-src": "'self'",
        "style-src": "'self'",
      },
      nonce: true,
    },
  });
  const res = await app.request("/h");
  const csp = res.headers.get("content-security-policy") ?? "";
  const body = (await res.json()) as { nonce: string };
  assert.ok(body.nonce, "expected ctx.state.cspNonce");
  assert.match(body.nonce, /^[A-Za-z0-9_-]{22}$/, "nonce should be 16-byte base64url");
  assert.ok(csp.includes(`'nonce-${body.nonce}'`), "nonce should be in CSP header");
  // Two requests must produce two different nonces.
  const res2 = await app.request("/h");
  const body2 = (await res2.json()) as { nonce: string };
  assert.notEqual(body.nonce, body2.nonce);
});

test("secureHeaders: nonce is injected into element directives when declared", async () => {
  const app = appWithSecureHeaders({
    contentSecurityPolicy: {
      directives: {
        "default-src": "'self'",
        "script-src-elem": "'self'",
        "style-src-elem": "'self'",
      },
      nonce: true,
    },
  });
  const res = await app.request("/h");
  const csp = res.headers.get("content-security-policy") ?? "";
  const body = (await res.json()) as { nonce: string };
  assert.ok(csp.includes(`script-src-elem 'self' 'nonce-${body.nonce}'`));
  assert.ok(csp.includes(`style-src-elem 'self' 'nonce-${body.nonce}'`));
});

test("secureHeaders: nonce skipped on directives that aren't declared", async () => {
  const app = appWithSecureHeaders({
    contentSecurityPolicy: {
      directives: { "default-src": "'self'" },
      nonce: true,
    },
  });
  const res = await app.request("/h");
  const csp = res.headers.get("content-security-policy") ?? "";
  assert.doesNotMatch(csp, /nonce-/);
});

test("secureHeaders: Trusted Types directives are emitted", async () => {
  const app = appWithSecureHeaders({
    contentSecurityPolicy: {
      directives: { "default-src": "'self'" },
      trustedTypes: true,
    },
  });
  const res = await app.request("/h");
  const csp = res.headers.get("content-security-policy") ?? "";
  assert.match(csp, /require-trusted-types-for 'script'/);
  assert.doesNotMatch(csp, /trusted-types /);
});

test("secureHeaders: Trusted Types with custom policy list", async () => {
  const app = appWithSecureHeaders({
    contentSecurityPolicy: {
      directives: { "default-src": "'self'" },
      trustedTypes: { policies: ["my-policy", "default"] },
    },
  });
  const res = await app.request("/h");
  const csp = res.headers.get("content-security-policy") ?? "";
  assert.match(csp, /require-trusted-types-for 'script'/);
  assert.match(csp, /trusted-types my-policy default/);
});

test("secureHeaders: CSP directives object form does not overwrite handler-set CSP", async () => {
  const app = new App({ logger: false });
  app.use(
    secureHeaders({
      contentSecurityPolicy: { directives: { "default-src": "'self'" } },
    })
  );
  app.route({
    method: "GET",
    path: "/h",
    operationId: "h2",
    responses: { 200: { description: "ok" } },
    handler: async ({ set }) => {
      set.headers.set("content-security-policy", "default-src 'none'");
      return { status: 200 as const, body: undefined };
    },
  });
  const res = await app.request("/h");
  assert.equal(res.headers.get("content-security-policy"), "default-src 'none'");
});

test("secureHeaders: trustedTypes object with no policies emits only require-trusted-types-for", async () => {
  const app = appWithSecureHeaders({
    contentSecurityPolicy: {
      directives: { "default-src": "'self'" },
      trustedTypes: { policies: [] },
    },
  });
  const res = await app.request("/h");
  const csp = res.headers.get("content-security-policy") ?? "";
  assert.match(csp, /require-trusted-types-for 'script'/);
  assert.doesNotMatch(csp, /trusted-types /);
});

test("secureHeaders: nonce throws when WebCrypto is unavailable", async () => {
  const original = (globalThis as unknown as { crypto?: Crypto }).crypto;
  // Simulate environment without getRandomValues.
  Object.defineProperty(globalThis, "crypto", {
    value: undefined,
    configurable: true,
  });
  try {
    const app = appWithSecureHeaders({
      contentSecurityPolicy: {
        directives: { "default-src": "'self'", "script-src": "'self'" },
        nonce: true,
      },
    });
    const res = await app.request("/h");
    // The thrown error becomes a 500 problem+json.
    assert.equal(res.status, 500);
  } finally {
    Object.defineProperty(globalThis, "crypto", {
      value: original,
      configurable: true,
    });
  }
});

// ============================================================================
// CSRF -- fetch-metadata strategy
// ============================================================================

function makeFetchMetaApp(opts?: Parameters<typeof csrf>[0]) {
  // csrf({ strategy: "fetch-metadata" }) handles cross-origin admission on
  // its own, so opt out of the `corsCrossOriginGuard` for this
  // helper — otherwise its cross-origin allowlist tests would be rejected
  // by the framework-level guard before csrf() sees them.
  const app = new App({ logger: false, corsCrossOriginGuard: false });
  app.use(csrf({ strategy: "fetch-metadata", ...opts }));
  app.route({
    method: "GET",
    path: "/r",
    operationId: "fmGet",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  app.route({
    method: "POST",
    path: "/r",
    operationId: "fmPost",
    responses: { 200: { description: "ok" }, 403: { description: "no" } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  return app;
}

test("csrf fetch-metadata: same-origin Sec-Fetch-Site is allowed", async () => {
  const app = makeFetchMetaApp();
  const res = await app.request("/r", {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin" },
  });
  assert.equal(res.status, 200);
});

test("csrf fetch-metadata: 'none' Sec-Fetch-Site is allowed", async () => {
  const app = makeFetchMetaApp();
  const res = await app.request("/r", {
    method: "POST",
    headers: { "sec-fetch-site": "none" },
  });
  assert.equal(res.status, 200);
});

test("csrf fetch-metadata: cross-site Sec-Fetch-Site is rejected", async () => {
  const app = makeFetchMetaApp();
  const res = await app.request("/r", {
    method: "POST",
    headers: { "sec-fetch-site": "cross-site" },
  });
  assert.equal(res.status, 403);
});

test("csrf fetch-metadata: cross-site is allowed when Origin is allowlisted", async () => {
  const app = makeFetchMetaApp({ allowedOrigins: ["https://app.example.com"] });
  const res = await app.request("/r", {
    method: "POST",
    headers: {
      "sec-fetch-site": "cross-site",
      origin: "https://app.example.com",
    },
  });
  assert.equal(res.status, 200);
});

test("csrf fetch-metadata: cross-site with non-allowlisted Origin is rejected", async () => {
  const app = makeFetchMetaApp({ allowedOrigins: ["https://app.example.com"] });
  const res = await app.request("/r", {
    method: "POST",
    headers: {
      "sec-fetch-site": "cross-site",
      origin: "https://evil.example.com",
    },
  });
  assert.equal(res.status, 403);
});

test("csrf fetch-metadata: legacy browser (no Sec-Fetch-Site) accepted via Origin allowlist", async () => {
  const app = makeFetchMetaApp({ allowedOrigins: ["https://app.example.com"] });
  const res = await app.request("/r", {
    method: "POST",
    headers: { origin: "https://app.example.com" },
  });
  assert.equal(res.status, 200);
});

test("csrf fetch-metadata: legacy browser falls back to Referer allowlist", async () => {
  const app = makeFetchMetaApp({
    allowedOrigins: (origin) => origin === "https://app.example.com",
  });
  const res = await app.request("/r", {
    method: "POST",
    headers: { referer: "https://app.example.com/some/path" },
  });
  assert.equal(res.status, 200);
});

test("csrf fetch-metadata: legacy browser with malformed Referer is rejected", async () => {
  const app = makeFetchMetaApp({ allowedOrigins: ["https://app.example.com"] });
  const res = await app.request("/r", {
    method: "POST",
    headers: { referer: ":::not-a-url" },
  });
  assert.equal(res.status, 403);
});

test("csrf fetch-metadata: legacy browser with non-allowlisted Referer is rejected", async () => {
  const app = makeFetchMetaApp({ allowedOrigins: ["https://app.example.com"] });
  const res = await app.request("/r", {
    method: "POST",
    headers: { referer: "https://evil.example.com/" },
  });
  assert.equal(res.status, 403);
});

test("csrf fetch-metadata: legacy browser with nothing identifying origin is rejected", async () => {
  const app = makeFetchMetaApp();
  const res = await app.request("/r", { method: "POST" });
  assert.equal(res.status, 403);
});

test("csrf fetch-metadata: safe methods are never checked and never issue a cookie", async () => {
  const app = makeFetchMetaApp();
  const res = await app.request("/r");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("set-cookie"), null);
});

test("csrf 'both' strategy: requires both fetch-metadata and double-submit cookie", async () => {
  const app = new App({ logger: false });
  app.use(csrf({ strategy: "both" }));
  app.route({
    method: "POST",
    path: "/r",
    operationId: "bothPost",
    responses: { 200: { description: "ok" }, 403: { description: "no" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });

  // Fails fetch-metadata.
  const r1 = await app.request("/r", {
    method: "POST",
    headers: { "sec-fetch-site": "cross-site" },
  });
  assert.equal(r1.status, 403);

  // Passes fetch-metadata but fails double-submit.
  const r2 = await app.request("/r", {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin" },
  });
  assert.equal(r2.status, 403);

  // Passes both.
  const r3 = await app.request("/r", {
    method: "POST",
    headers: {
      "sec-fetch-site": "same-origin",
      cookie: "__Host-daloy.csrf=t1",
      "x-csrf-token": "t1",
    },
  });
  assert.equal(r3.status, 200);
});

test("csrf: invalid strategy is rejected at construction time", () => {
  assert.throws(
    () => csrf({ strategy: "off" as never }),
    /strategy must be "double-submit", "fetch-metadata", or "both"/
  );
});

// ============================================================================
// basicAuth
// ============================================================================

function makeBasicApp(opts: Parameters<typeof basicAuth>[0]) {
  const app = new App({ logger: false });
  app.use(basicAuth(opts));
  app.route({
    method: "GET",
    path: "/me",
    operationId: "me",
    responses: { 200: { description: "ok" }, 401: { description: "no" } },
    handler: async ({ state }) => ({
      status: 200 as const,
      body: { user: (state as Record<string, unknown>).user ?? null },
    }),
  });
  return app;
}

function basicHeader(user: string, pass: string): string {
  const encoded = new TextEncoder().encode(`${user}:${pass}`);
  let binary = "";
  for (const byte of encoded) binary += String.fromCharCode(byte);
  return "Basic " + btoa(binary);
}

test("basicAuth: missing Authorization returns 401 with WWW-Authenticate", async () => {
  const app = makeBasicApp({ verify: () => true });
  const res = await app.request("/me");
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate") ?? "", /^Basic realm="api"/);
  assert.match(res.headers.get("content-type") ?? "", /application\/problem\+json/);
});

test("basicAuth: malformed Authorization returns 401", async () => {
  const app = makeBasicApp({ verify: () => true });
  const res = await app.request("/me", {
    headers: { authorization: "Bearer something" },
  });
  assert.equal(res.status, 401);
});

test("basicAuth: invalid base64 returns 401", async () => {
  const app = makeBasicApp({ verify: () => true });
  const res = await app.request("/me", {
    headers: { authorization: "Basic !!!not-base64!!!" },
  });
  assert.equal(res.status, 401);
});

test("basicAuth: invalid UTF-8 returns 401", async () => {
  const app = makeBasicApp({ verify: () => true });
  const invalidUtf8 = btoa(String.fromCharCode(0xff) + ":pass");
  const res = await app.request("/me", {
    headers: { authorization: "Basic " + invalidUtf8 },
  });
  assert.equal(res.status, 401);
});

test("basicAuth: payload without ':' separator returns 401", async () => {
  const app = makeBasicApp({ verify: () => true });
  // base64("noseparator")
  const res = await app.request("/me", {
    headers: { authorization: "Basic " + btoa("noseparator") },
  });
  assert.equal(res.status, 401);
});

test("basicAuth: NUL byte in credentials is rejected", async () => {
  const app = makeBasicApp({ verify: () => true });
  const res = await app.request("/me", {
    headers: { authorization: "Basic " + btoa("user\0name:pass") },
  });
  assert.equal(res.status, 401);
});

test("basicAuth: oversize credential blob is rejected without invoking verify", async () => {
  let called = false;
  const app = makeBasicApp({
    verify: () => {
      called = true;
      return true;
    },
    maxCredentialBytes: 64,
  });
  const big = "x".repeat(200);
  const res = await app.request("/me", {
    headers: { authorization: "Basic " + btoa(`${big}:${big}`) },
  });
  assert.equal(res.status, 401);
  assert.equal(called, false);
});

test("basicAuth: verify returning false produces 401", async () => {
  const app = makeBasicApp({ verify: () => false });
  const res = await app.request("/me", {
    headers: { authorization: basicHeader("admin", "wrong") },
  });
  assert.equal(res.status, 401);
});

test("basicAuth: verify returning true sets ctx.state.user with username", async () => {
  const app = makeBasicApp({
    verify: (username, password) =>
      timingSafeEqual(username, "admin") && timingSafeEqual(password, "s3cret"),
  });
  const res = await app.request("/me", {
    headers: { authorization: basicHeader("admin", "s3cret") },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { username: string } };
  assert.deepEqual(body.user, { username: "admin" });
});

test("basicAuth: UTF-8 credentials are decoded before verify", async () => {
  const app = makeBasicApp({
    verify: (username, password) => username === "\u00e1lice" && password === "p\u0101ss",
  });
  const res = await app.request("/me", {
    headers: { authorization: basicHeader("\u00e1lice", "p\u0101ss") },
  });
  assert.equal(res.status, 200);
});

test("basicAuth: verify returning user object is stamped on state", async () => {
  const app = makeBasicApp({
    verify: async (username) => ({ id: 1, username, role: "admin" }),
  });
  const res = await app.request("/me", {
    headers: { authorization: basicHeader("alice", "x") },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { id: number; role: string } };
  assert.equal(body.user.id, 1);
  assert.equal(body.user.role, "admin");
});

test("basicAuth: custom realm appears in challenge", async () => {
  const app = makeBasicApp({ verify: () => true, realm: "books-api" });
  const res = await app.request("/me");
  assert.match(res.headers.get("www-authenticate") ?? "", /^Basic realm="books-api"/);
});

test("basicAuth: realm with CRLF is rejected at construction time", () => {
  assert.throws(
    () => basicAuth({ verify: () => true, realm: 'evil"\r\nInjection: yes' }),
    /must not contain quotes, CR, LF, or NUL bytes/
  );
});

test("basicAuth: missing verify is rejected at construction time", () => {
  assert.throws(
    () => basicAuth(undefined as unknown as Parameters<typeof basicAuth>[0]),
    /verify must be a function/
  );
});

test("basicAuth: invalid maxCredentialBytes is rejected at construction time", () => {
  assert.throws(
    () => basicAuth({ verify: () => true, maxCredentialBytes: 0 }),
    /maxCredentialBytes must be a positive integer/
  );
});
