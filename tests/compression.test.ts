import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  compression,
  COMPRESSION_HOOK_MARKER,
  _resetCompressionRuntimeProbeForTests,
} from "../src/index.js";

// Build a body large enough to clear the default 1024 minimumSize and also
// be highly compressible so the gzip ratio is well below 1.0.
const LARGE_TEXT = "the quick brown fox jumps over the lazy dog. ".repeat(80);

function appWithCompression(opts?: Parameters<typeof compression>[0]) {
  const app = new App({ env: "development" });
  app.use(compression(opts));
  app.route({
    method: "GET",
    path: "/text",
    operationId: "text",
    responses: { 200: { description: "ok" } },
    handler: () => ({
      status: 200 as const,
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: LARGE_TEXT,
    }),
  });
  app.route({
    method: "GET",
    path: "/tiny",
    operationId: "tiny",
    responses: { 200: { description: "ok" } },
    handler: () => ({
      status: 200 as const,
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: "hi",
    }),
  });
  app.route({
    method: "GET",
    path: "/binary",
    operationId: "binary",
    responses: { 200: { description: "ok" } },
    handler: () => ({
      status: 200 as const,
      headers: { "content-type": "image/png" },
      body: new Uint8Array(2048).fill(7),
    }),
  });
  app.route({
    method: "GET",
    path: "/svg",
    operationId: "svg",
    responses: { 200: { description: "ok" } },
    handler: () => ({
      status: 200 as const,
      headers: { "content-type": "image/svg+xml" },
      body: `<svg>${LARGE_TEXT}</svg>`,
    }),
  });
  app.route({
    method: "POST",
    path: "/post",
    operationId: "postIt",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { hi: true } }),
  });
  return app;
}

test("compression: gzip-compresses large GET text bodies", async () => {
  const app = appWithCompression();
  const res = await app.fetch(
    new Request("http://x/text", {
      headers: { "accept-encoding": "gzip, deflate" },
    }),
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-encoding"), "gzip");
  assert.match(res.headers.get("vary") ?? "", /Accept-Encoding/);
  const bytes = new Uint8Array(await res.arrayBuffer());
  // gzip magic number 1f 8b
  assert.equal(bytes[0], 0x1f);
  assert.equal(bytes[1], 0x8b);
  assert.ok(bytes.byteLength < LARGE_TEXT.length);
});

test("compression: prefers brotli when client and runtime support it", async () => {
  _resetCompressionRuntimeProbeForTests();
  const app = appWithCompression();
  const res = await app.fetch(
    new Request("http://x/text", {
      headers: { "accept-encoding": "br;q=1.0, gzip;q=0.5" },
    }),
  );
  // Node 24 ships brotli in CompressionStream; if it ever regresses
  // the test still asserts a valid choice is made.
  const enc = res.headers.get("content-encoding");
  assert.ok(enc === "br" || enc === "gzip", `unexpected encoding: ${enc}`);
});

test("compression: respects q=0 to disable an encoding", async () => {
  const app = appWithCompression();
  const res = await app.fetch(
    new Request("http://x/text", {
      headers: { "accept-encoding": "gzip;q=0, deflate" },
    }),
  );
  // gzip is disabled by q=0; the middleware should pick deflate (br is
  // also fine if supported and not explicitly disabled — but the client
  // didn't list it, so the server should fall through to deflate).
  const enc = res.headers.get("content-encoding");
  assert.equal(enc, "deflate");
});

test("compression: wildcard accept-encoding accepts the server's preferred", async () => {
  const app = appWithCompression();
  const res = await app.fetch(
    new Request("http://x/text", { headers: { "accept-encoding": "*" } }),
  );
  const enc = res.headers.get("content-encoding");
  assert.ok(enc === "br" || enc === "gzip" || enc === "deflate");
});

test("compression: no Accept-Encoding header → no compression, still Vary", async () => {
  const app = appWithCompression();
  const res = await app.fetch(new Request("http://x/text"));
  assert.equal(res.headers.get("content-encoding"), null);
  assert.match(res.headers.get("vary") ?? "", /Accept-Encoding/);
});

test("compression: empty Accept-Encoding → no compression", async () => {
  const app = appWithCompression();
  const res = await app.fetch(
    new Request("http://x/text", { headers: { "accept-encoding": "" } }),
  );
  assert.equal(res.headers.get("content-encoding"), null);
  assert.match(res.headers.get("vary") ?? "", /Accept-Encoding/);
});

test("compression: unknown encoding token in Accept-Encoding is ignored", async () => {
  const app = appWithCompression();
  const res = await app.fetch(
    new Request("http://x/text", {
      headers: { "accept-encoding": "compress, identity;q=0.5, , ;q=foo" },
    }),
  );
  // No supported encoding the client asked for → no Content-Encoding.
  assert.equal(res.headers.get("content-encoding"), null);
  assert.match(res.headers.get("vary") ?? "", /Accept-Encoding/);
});

test("compression: invalid q values are ignored (default q=1)", async () => {
  const app = appWithCompression();
  const res = await app.fetch(
    new Request("http://x/text", {
      headers: { "accept-encoding": "gzip;q=banana" },
    }),
  );
  assert.equal(res.headers.get("content-encoding"), "gzip");
});

test("compression: q values outside [0,1] are ignored (default q=1)", async () => {
  const app = appWithCompression();
  const res = await app.fetch(
    new Request("http://x/text", {
      headers: { "accept-encoding": "gzip;q=2.5" },
    }),
  );
  assert.equal(res.headers.get("content-encoding"), "gzip");
});

test("compression: BREACH guard — Authorization header skips", async () => {
  const app = appWithCompression();
  const res = await app.fetch(
    new Request("http://x/text", {
      headers: {
        "accept-encoding": "gzip",
        authorization: "Bearer secret",
      },
    }),
  );
  assert.equal(res.headers.get("content-encoding"), null);
  assert.match(res.headers.get("vary") ?? "", /Accept-Encoding/);
});

test("compression: BREACH guard — session cookie skips", async () => {
  const app = appWithCompression();
  const res = await app.fetch(
    new Request("http://x/text", {
      headers: {
        "accept-encoding": "gzip",
        cookie: "my_session_id=abc",
      },
    }),
  );
  assert.equal(res.headers.get("content-encoding"), null);
  assert.match(res.headers.get("vary") ?? "", /Accept-Encoding/);
});

test("compression: BREACH guard — CSRF cookie skips", async () => {
  const app = appWithCompression();
  const res = await app.fetch(
    new Request("http://x/text", {
      headers: { "accept-encoding": "gzip", cookie: "X-CSRF-Token=abc" },
    }),
  );
  assert.equal(res.headers.get("content-encoding"), null);
  assert.match(res.headers.get("vary") ?? "", /Accept-Encoding/);
});

test("compression: BREACH guard — XSRF cookie skips", async () => {
  const app = appWithCompression();
  const res = await app.fetch(
    new Request("http://x/text", {
      headers: { "accept-encoding": "gzip", cookie: "XSRF-TOKEN=abc" },
    }),
  );
  assert.equal(res.headers.get("content-encoding"), null);
  assert.match(res.headers.get("vary") ?? "", /Accept-Encoding/);
});

test("compression: BREACH guard — __Host-* cookie skips", async () => {
  const app = appWithCompression();
  const res = await app.fetch(
    new Request("http://x/text", {
      headers: { "accept-encoding": "gzip", cookie: "__Host-id=abc" },
    }),
  );
  assert.equal(res.headers.get("content-encoding"), null);
  assert.match(res.headers.get("vary") ?? "", /Accept-Encoding/);
});

test("compression: BREACH guard — custom authCookieNames opt-in", async () => {
  const app = appWithCompression({ authCookieNames: ["my-app-auth"] });
  const res = await app.fetch(
    new Request("http://x/text", {
      headers: { "accept-encoding": "gzip", cookie: "my-app-auth=foo" },
    }),
  );
  assert.equal(res.headers.get("content-encoding"), null);
  assert.match(res.headers.get("vary") ?? "", /Accept-Encoding/);
});

test("compression: BREACH guard — Set-Cookie on response skips", async () => {
  const app = new App({ env: "development" });
  app.use({
    onSend(res) {
      res.headers.append("set-cookie", "a=b");
    },
  });
  app.use(compression());
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({
      status: 200 as const,
      headers: { "content-type": "text/plain" },
      body: LARGE_TEXT,
    }),
  });
  const res = await app.fetch(
    new Request("http://x/", { headers: { "accept-encoding": "gzip" } }),
  );
  assert.equal(res.headers.get("content-encoding"), null);
  assert.match(res.headers.get("vary") ?? "", /Accept-Encoding/);
});

test("compression: skips when Content-Encoding already set", async () => {
  const app = new App({ env: "development" });
  app.use({
    onSend(res) {
      res.headers.set("content-encoding", "identity");
    },
  });
  app.use(compression());
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({
      status: 200 as const,
      headers: { "content-type": "text/plain" },
      body: LARGE_TEXT,
    }),
  });
  const res = await app.fetch(
    new Request("http://x/", { headers: { "accept-encoding": "gzip" } }),
  );
  assert.equal(res.headers.get("content-encoding"), "identity");
  assert.match(res.headers.get("vary") ?? "", /Accept-Encoding/);
});

test("compression: skips bodies smaller than minimumSize", async () => {
  const app = appWithCompression();
  const res = await app.fetch(
    new Request("http://x/tiny", { headers: { "accept-encoding": "gzip" } }),
  );
  assert.equal(res.headers.get("content-encoding"), null);
  // Vary IS still emitted (negotiation surface) — runtime support detected,
  // chosen encoding selected, but the body was too small for the cap.
  assert.match(res.headers.get("vary") ?? "", /Accept-Encoding/);
});

test("compression: skips already-compressed content types (image/png) + emits Vary", async () => {
  const app = appWithCompression();
  const res = await app.fetch(
    new Request("http://x/binary", {
      headers: { "accept-encoding": "gzip" },
    }),
  );
  assert.equal(res.headers.get("content-encoding"), null);
  assert.match(res.headers.get("vary") ?? "", /Accept-Encoding/);
});

test("compression: SVG IS compressed even though prefix is image/", async () => {
  const app = appWithCompression();
  const res = await app.fetch(
    new Request("http://x/svg", {
      headers: { "accept-encoding": "gzip" },
    }),
  );
  assert.equal(res.headers.get("content-encoding"), "gzip");
});

test("compression: skips non-GET/HEAD methods", async () => {
  const app = appWithCompression();
  const res = await app.fetch(
    new Request("http://x/post", {
      method: "POST",
      headers: { "accept-encoding": "gzip", origin: "http://x" },
    }),
  );
  assert.equal(res.headers.get("content-encoding"), null);
  assert.match(res.headers.get("vary") ?? "", /Accept-Encoding/);
});

test("compression: HEAD request — encoded headers, empty body", async () => {
  const app = appWithCompression();
  const res = await app.fetch(
    new Request("http://x/text", {
      method: "HEAD",
      headers: { "accept-encoding": "gzip" },
    }),
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-encoding"), "gzip");
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.equal(bytes.byteLength, 0);
});

test("compression: skips non-2xx", async () => {
  const app = new App({ env: "development" });
  app.use(compression());
  app.route({
    method: "GET",
    path: "/",
    responses: { 404: { description: "nope" } },
    handler: () => ({
      status: 404 as const,
      headers: { "content-type": "text/plain" },
      body: LARGE_TEXT,
    }),
  });
  const res = await app.fetch(
    new Request("http://x/", { headers: { "accept-encoding": "gzip" } }),
  );
  assert.equal(res.headers.get("content-encoding"), null);
});

test("compression: existing strong ETag is downgraded to weak after compression", async () => {
  const app = new App({ env: "development" });
  app.use({
    onSend(res) {
      res.headers.set("etag", '"abc123"');
    },
  });
  app.use(compression());
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({
      status: 200 as const,
      headers: { "content-type": "text/plain" },
      body: LARGE_TEXT,
    }),
  });
  const res = await app.fetch(
    new Request("http://x/", { headers: { "accept-encoding": "gzip" } }),
  );
  assert.equal(res.headers.get("content-encoding"), "gzip");
  assert.equal(res.headers.get("etag"), 'W/"abc123"');
});

test("compression: existing weak ETag is left alone", async () => {
  const app = new App({ env: "development" });
  app.use({
    onSend(res) {
      res.headers.set("etag", 'W/"already-weak"');
    },
  });
  app.use(compression());
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({
      status: 200 as const,
      headers: { "content-type": "text/plain" },
      body: LARGE_TEXT,
    }),
  });
  const res = await app.fetch(
    new Request("http://x/", { headers: { "accept-encoding": "gzip" } }),
  );
  assert.equal(res.headers.get("etag"), 'W/"already-weak"');
});

test("compression: appends to existing Vary header without duplicating", async () => {
  const app = new App({ env: "development" });
  app.use({
    onSend(res) {
      res.headers.set("vary", "Cookie");
    },
  });
  app.use(compression());
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({
      status: 200 as const,
      headers: { "content-type": "text/plain" },
      body: LARGE_TEXT,
    }),
  });
  const res = await app.fetch(
    new Request("http://x/", { headers: { "accept-encoding": "gzip" } }),
  );
  const vary = res.headers.get("vary") ?? "";
  assert.match(vary, /Cookie/);
  assert.match(vary, /Accept-Encoding/);
});

test("compression: Vary: * is left alone", async () => {
  const app = new App({ env: "development" });
  app.use({
    onSend(res) {
      res.headers.set("vary", "*");
    },
  });
  app.use(compression());
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({
      status: 200 as const,
      headers: { "content-type": "text/plain" },
      body: LARGE_TEXT,
    }),
  });
  const res = await app.fetch(
    new Request("http://x/", { headers: { "accept-encoding": "gzip" } }),
  );
  assert.equal(res.headers.get("vary"), "*");
});

test("compression: Vary already includes Accept-Encoding (case-insensitive) is not duplicated", async () => {
  const app = new App({ env: "development" });
  app.use({
    onSend(res) {
      res.headers.set("vary", "accept-encoding");
    },
  });
  app.use(compression());
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({
      status: 200 as const,
      headers: { "content-type": "text/plain" },
      body: LARGE_TEXT,
    }),
  });
  const res = await app.fetch(
    new Request("http://x/", { headers: { "accept-encoding": "gzip" } }),
  );
  assert.equal(res.headers.get("vary"), "accept-encoding");
});

test("compression: stamps the hook marker symbol", () => {
  const hooks = compression() as Record<symbol, unknown>;
  assert.equal(hooks[COMPRESSION_HOOK_MARKER], true);
});

test("compression: refuses unknown encoding at construction", () => {
  assert.throws(
    () => compression({ encodings: ["bogus" as never] }),
    /unknown encoding/,
  );
});

test("compression: refuses non-finite minimumSize", () => {
  assert.throws(
    () => compression({ minimumSize: Number.NaN }),
    /minimumSize/,
  );
  assert.throws(() => compression({ minimumSize: -1 }), /minimumSize/);
  assert.throws(() => compression({ minimumSize: 1.5 }), /minimumSize/);
  assert.throws(
    () => compression({ minimumSize: 2 ** 32 }),
    /minimumSize/,
  );
});

test("compression: rejects infinite minimumSize", () => {
  assert.throws(
    () => compression({ minimumSize: Number.POSITIVE_INFINITY }),
    /minimumSize/,
  );
});

test("compression: rejects non-string option tokens", () => {
  assert.throws(
    () => compression({ excludeContentTypes: [123 as never] }),
    /excludeContentTypes/,
  );
  assert.throws(
    () => compression({ authCookieNames: [null as never] }),
    /authCookieNames/,
  );
});

test("compression: refuses compressLevel knob", () => {
  assert.throws(
    () => compression({ compressLevel: 9 as never }),
    /compressLevel/,
  );
  assert.throws(
    () => compression({ compressLevel: 6 as never }),
    /compressLevel/,
  );
});

test("compression: refuses empty option tokens", () => {
  assert.throws(
    () => compression({ excludeContentTypes: [""] }),
    /excludeContentTypes/,
  );
  assert.throws(
    () => compression({ authCookieNames: ["  "] }),
    /authCookieNames/,
  );
});

test("compression: explicit encodings list narrows preference", async () => {
  const app = new App({ env: "development" });
  app.use(compression({ encodings: ["deflate"] }));
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({
      status: 200 as const,
      headers: { "content-type": "text/plain" },
      body: LARGE_TEXT,
    }),
  });
  const res = await app.fetch(
    new Request("http://x/", {
      headers: { "accept-encoding": "br, gzip, deflate" },
    }),
  );
  assert.equal(res.headers.get("content-encoding"), "deflate");
});

test("compression: extra excludeContentTypes skips a custom type", async () => {
  const app = new App({ env: "development" });
  app.use(compression({ excludeContentTypes: ["application/x-custom"] }));
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({
      status: 200 as const,
      headers: { "content-type": "application/x-custom; charset=utf-8" },
      body: LARGE_TEXT,
    }),
  });
  const res = await app.fetch(
    new Request("http://x/", { headers: { "accept-encoding": "gzip" } }),
  );
  assert.equal(res.headers.get("content-encoding"), null);
});

test("compression: skips application/gzip as already compressed", async () => {
  const app = new App({ env: "development" });
  app.use(compression());
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({
      status: 200 as const,
      headers: { "content-type": "application/gzip" },
      body: new Uint8Array(2048).fill(7),
    }),
  });
  const res = await app.fetch(
    new Request("http://x/", { headers: { "accept-encoding": "gzip" } }),
  );
  assert.equal(res.headers.get("content-encoding"), null);
  assert.match(res.headers.get("vary") ?? "", /Accept-Encoding/);
});

test("compression: missing CompressionStream → silent no-op + Vary", async () => {
  const originalCS = (globalThis as Record<string, unknown>).CompressionStream;
  // Remove CompressionStream to simulate an old runtime, then reset the probe cache.
  delete (globalThis as Record<string, unknown>).CompressionStream;
  _resetCompressionRuntimeProbeForTests();
  try {
    const app = appWithCompression();
    const res = await app.fetch(
      new Request("http://x/text", {
        headers: { "accept-encoding": "gzip" },
      }),
    );
    assert.equal(res.headers.get("content-encoding"), null);
    assert.match(res.headers.get("vary") ?? "", /Accept-Encoding/);
  } finally {
    (globalThis as Record<string, unknown>).CompressionStream = originalCS;
    _resetCompressionRuntimeProbeForTests();
  }
});

test("compression: response with no content-type is still considered for compression", async () => {
  const app = new App({ env: "development" });
  app.use(compression());
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({
      status: 200 as const,
      // explicit Uint8Array body bypasses default JSON content-type
      body: new TextEncoder().encode(LARGE_TEXT),
    }),
  });
  const res = await app.fetch(
    new Request("http://x/", { headers: { "accept-encoding": "gzip" } }),
  );
  assert.equal(res.headers.get("content-encoding"), "gzip");
});

test("compression: response with empty content-type token is not blocked", async () => {
  const app = new App({ env: "development" });
  app.use({
    onSend(res) {
      res.headers.set("content-type", ";");
    },
  });
  app.use(compression());
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: LARGE_TEXT }),
  });
  const res = await app.fetch(
    new Request("http://x/", { headers: { "accept-encoding": "gzip" } }),
  );
  // An empty type token should not match any deny prefix.
  assert.equal(res.headers.get("content-encoding"), "gzip");
});

test("compression: small high-entropy body that grows under gzip is skipped", async () => {
  // 1100-byte random bytes: gzip overhead exceeds savings. The middleware's
  // negative-ratio guard should refuse to ship the larger bytes.
  const random = new Uint8Array(1100);
  const crypto = globalThis.crypto;
  crypto.getRandomValues(random);
  const app = new App({ env: "development" });
  app.use(compression());
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({
      status: 200 as const,
      headers: { "content-type": "application/octet-stream" },
      body: random,
    }),
  });
  const res = await app.fetch(
    new Request("http://x/", { headers: { "accept-encoding": "gzip" } }),
  );
  // Either the gzipped body is larger (skip) OR the runtime chose not to
  // compress at all — either way, no broken response.
  const enc = res.headers.get("content-encoding");
  if (enc === "gzip") {
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.ok(bytes.byteLength < random.byteLength);
  } else {
    assert.equal(enc, null);
  }
});

test("compression: skips bodies larger than maxCompressibleBytes without hanging", async () => {
  _resetCompressionRuntimeProbeForTests();
  const app = new App({ env: "development" });
  app.use(compression({ minimumSize: 16, maxCompressibleBytes: 64 }));
  app.route({
    method: "GET",
    path: "/big",
    responses: { 200: { description: "ok" } },
    handler: () => ({
      status: 200 as const,
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: "A".repeat(200),
    }),
  });
  const res = await app.fetch(
    new Request("http://x/big", { headers: { "accept-encoding": "gzip" } }),
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-encoding"), null, "oversize body must not be compressed");
  const text = await res.text();
  assert.equal(text.length, 200);
});
