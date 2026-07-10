import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  App,
  cors,
  rateLimit,
  requestId,
  secureHeaders,
  bearerAuth,
  timingSafeEqual,
  safeJsonParse,
  safeJsonParseLimited,
  isForbiddenObjectKey,
} from "../src/index.js";

test("body size limit rejects oversized request", async () => {
  const app = new App({ bodyLimitBytes: 16 });
  app.route({
    method: "POST",
    path: "/echo",
    operationId: "echo",
    request: { body: z.object({ s: z.string() }) as any },
    responses: { 200: { description: "ok", body: z.object({ s: z.string() }) as any } },
    handler: async ({ body }) => ({ status: 200 as const, body: body as any }),
  });
  const big = JSON.stringify({ s: "x".repeat(1000) });
  const res = await app.request("/echo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: big,
  });
  assert.equal(res.status, 413);
});

test("unsupported content-type is rejected when body schema is declared", async () => {
  const app = new App();
  app.route({
    method: "POST",
    path: "/upload",
    operationId: "upload",
    request: { body: z.object({ s: z.string() }) as any },
    responses: { 200: { description: "ok", body: z.object({ s: z.string() }) as any } },
    handler: async ({ body }) => ({ status: 200 as const, body: body as any }),
  });
  const res = await app.request("/upload", {
    method: "POST",
    headers: { "content-type": "text/xml" },
    body: "<x/>",
  });
  assert.equal(res.status, 415);
});

test("safeJsonParse strips prototype-pollution keys", () => {
  const out = safeJsonParse(
    '{"a":1,"__proto__":{"polluted":true},"nested":{"constructor":{"prototype":{"x":1}}}}'
  ) as any;
  assert.equal(out.a, 1);
  // Object.prototype was not mutated:
  assert.equal((Object.prototype as any).polluted, undefined);
  // The dangerous own keys were stripped:
  assert.equal(Object.hasOwn(out, "__proto__"), false);
  assert.equal(Object.hasOwn(out.nested, "constructor"), false);
});

test("jsonMaxKeys (default 10k) rejects excessively wide objects", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/wide",
    operationId: "wide",
    request: { body: z.record(z.string(), z.string()) as any },
    responses: { 200: { description: "ok", body: z.object({ n: z.number() }) as any } },
    handler: async ({ body }: any) => ({ status: 200 as const, body: { n: Object.keys(body).length } }),
  });

  // 12k keys > default 10k → rejected quickly
  const wide: Record<string, string> = {};
  for (let i = 0; i < 12_000; i++) wide[`k${i}`] = "v";
  const res = await app.request("/wide", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(wide),
  });
  assert.equal(res.status, 400);
});

test("jsonMaxKeys and jsonMaxDepth are configurable and can be disabled", async () => {
  const app = new App({ logger: false, jsonMaxKeys: 0, jsonMaxDepth: 0 });
  app.route({
    method: "POST",
    path: "/accept",
    operationId: "accept",
    request: { body: z.any() as any },
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  const veryWide: Record<string, string> = {};
  for (let i = 0; i < 50_000; i++) veryWide[`k${i}`] = "v";
  const deep = JSON.stringify({ a: { b: { c: { d: { e: { f: 1 } } } } } }); // depth 6, fine anyway

  const resWide = await app.request("/accept", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(veryWide),
  });
  assert.equal(resWide.status, 200);

  const resDeep = await app.request("/accept", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: deep,
  });
  assert.equal(resDeep.status, 200);
});

test("jsonMaxDepth rejects deeply nested structures by default", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/deep",
    operationId: "deep",
    request: { body: z.any() as any },
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  // Build a structure deeper than default 50
  let deep: any = {};
  let current = deep;
  for (let i = 0; i < 60; i++) {
    current.n = {};
    current = current.n;
  }
  const res = await app.request("/deep", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(deep),
  });
  assert.equal(res.status, 400);
});

test("safeJsonParseLimited rejects wide/deep payloads", () => {
  const wide = JSON.stringify(Object.fromEntries(Array.from({ length: 20_000 }, (_, i) => [`k${i}`, "v"])));
  const deep = JSON.stringify({ a: { b: { c: Array.from({ length: 60 }).reduce((p: any) => ({ n: p }), {}) } } });

  try {
    safeJsonParseLimited(wide);
    assert.fail("should have thrown for wide object");
  } catch (e: any) {
    assert.equal(e.status, 400);
    assert.match(e.problem?.detail || "", /key count/);
  }

  try {
    safeJsonParseLimited(deep);
    assert.fail("should have thrown for deep nesting");
  } catch (e: any) {
    assert.equal(e.status, 400);
    assert.match(e.problem?.detail || "", /nesting depth/);
  }

  // Disabled limits
  assert.doesNotThrow(() => safeJsonParseLimited(wide, 0, 0));
});

test("safeJsonParseLimited counts structure, not string contents", () => {
  // The limit scan reads raw text, so `:`/`{`/`[` characters INSIDE string
  // literals must not be miscounted as object keys or nesting. These payloads
  // are structurally tiny and must parse cleanly under tight limits.

  // Colons inside string values are not keys: 3 real keys under a cap of 5.
  assert.doesNotThrow(() =>
    safeJsonParseLimited(
      JSON.stringify({ a: "1:2:3:4:5", b: "http://x:y:z", c: "::::::" }),
      5,
      50,
    ),
  );

  // A colon inside a key name is not a second key: 1 key under a cap of 1.
  assert.doesNotThrow(() => safeJsonParseLimited(JSON.stringify({ "a:b:c": 1 }), 1, 50));

  // Brackets inside a string do not inflate depth: real depth is 1 under a cap of 3.
  assert.doesNotThrow(() =>
    safeJsonParseLimited(JSON.stringify({ a: "[[[[[[[[[[x]]]]]]]]]]" }), 100, 3),
  );

  // An escaped quote must not end the string early, so the `:` that follows
  // stays inside the string and is not counted: 1 key under a cap of 2.
  assert.doesNotThrow(() => safeJsonParseLimited('{"a":"he said \\"x:y\\" ok"}', 2, 50));

  // Array elements are not object keys: 10 elements, 0 keys, under a cap of 1.
  assert.doesNotThrow(() => safeJsonParseLimited(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 1, 50));

  // Sanity: genuine structural excess still rejects (the phrase lives in the
  // RFC 9457 `detail`, matching the assertions above).
  const rejects = (fn: () => unknown, re: RegExp) => {
    try {
      fn();
      assert.fail("should have thrown");
    } catch (e: any) {
      assert.equal(e.status, 400);
      assert.match(e.problem?.detail || "", re);
    }
  };
  rejects(() => safeJsonParseLimited(JSON.stringify({ a: 1, b: 2, c: 3 }), 2, 50), /key count/);
  rejects(() => safeJsonParseLimited(JSON.stringify({ a: { b: { c: 1 } } }), 100, 2), /nesting depth/);
});

test("getSecurityPosture exposes jsonMaxKeys and jsonMaxDepth", () => {
  const app = new App({ logger: false });
  const p = app.getSecurityPosture() as any;
  assert.equal(typeof p.jsonMaxKeys, "number");
  assert.equal(typeof p.jsonMaxDepth, "number");
  assert.ok(p.jsonMaxKeys > 0 && p.jsonMaxKeys <= 100_000);
  assert.ok(p.jsonMaxDepth > 0 && p.jsonMaxDepth <= 200);
});

test("405 with allow header for known path / wrong method", async () => {
  const app = new App();
  app.route({
    method: "GET",
    path: "/x",
    operationId: "getX",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/x", { method: "POST" });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("allow"), "GET");
});

test("router rejects path traversal", async () => {
  const app = new App();
  app.route({
    method: "GET",
    path: "/files/:name",
    operationId: "f",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/files/../etc/passwd");
  assert.equal(res.status, 404);
});

test("rateLimit returns 429 when exceeded", async () => {
  const app = new App();
  app.use(rateLimit({ windowMs: 1000, max: 2, trustProxyHeaders: true }));
  app.route({
    method: "GET",
    path: "/r",
    operationId: "r",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const a = await app.request("/r", { headers: { "x-forwarded-for": "1.1.1.1" } });
  const b = await app.request("/r", { headers: { "x-forwarded-for": "1.1.1.1" } });
  const c = await app.request("/r", { headers: { "x-forwarded-for": "1.1.1.1" } });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(c.status, 429);
  assert.ok(c.headers.get("retry-after"));
});

test("secureHeaders sets defaults", async () => {
  const app = new App();
  app.use(secureHeaders());
  app.route({
    method: "GET",
    path: "/h",
    operationId: "h",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/h");
  assert.ok(res.headers.get("content-security-policy"));
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.ok(res.headers.get("strict-transport-security"));
  // Default Permissions-Policy denies the ClickFix clipboard-write vector.
  const permissionsPolicy = res.headers.get("permissions-policy") ?? "";
  assert.match(permissionsPolicy, /clipboard-write=\(\)/);
  assert.match(permissionsPolicy, /camera=\(\)/);
});

test("secureHeaders permissionsPolicy override fully replaces the default (no merge)", async () => {
  const app = new App();
  app.use(secureHeaders({ permissionsPolicy: "geolocation=(self)" }));
  app.route({
    method: "GET",
    path: "/h2",
    operationId: "h2",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/h2");
  assert.equal(res.headers.get("permissions-policy"), "geolocation=(self)");
});

test("requestId surfaces on every response", async () => {
  const app = new App();
  app.use(requestId());
  app.route({
    method: "GET",
    path: "/i",
    operationId: "i",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/i");
  assert.match(res.headers.get("x-request-id") ?? "", /\S+/);
});

test("CORS preflight returns 204 with allow-origin", async () => {
  const app = new App();
  app.use(cors({ origin: "https://example.com" }));
  app.route({
    method: "POST",
    path: "/c",
    operationId: "c",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/c", {
    method: "OPTIONS",
    headers: { origin: "https://example.com" },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://example.com");
});

test("bearerAuth challenges when missing", async () => {
  const app = new App();
  app.use(bearerAuth({ validate: (t) => t === "secret" }));
  app.route({
    method: "GET",
    path: "/p",
    operationId: "p",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const r1 = await app.request("/p");
  assert.equal(r1.status, 401);
  assert.match(r1.headers.get("www-authenticate") ?? "", /^Bearer/);
  const r2 = await app.request("/p", { headers: { authorization: "Bearer secret" } });
  assert.equal(r2.status, 200);
});

test("timingSafeEqual works", () => {
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("abc", "abd"), false);
  assert.equal(timingSafeEqual("abc", "abcd"), false);
});

test("mock mode returns example without invoking handler", async () => {
  const app = new App({ mockMode: true });
  let called = false;
  app.route({
    method: "GET",
    path: "/m/:id",
    operationId: "m",
    request: { params: z.object({ id: z.string() }) as any },
    responses: {
      200: {
        description: "ok",
        body: z.object({ id: z.string(), title: z.string() }) as any,
        examples: { default: { id: "ex", title: "Example" } },
      },
    },
    handler: async () => {
      called = true;
      return { status: 200 as const, body: { id: "real", title: "real" } };
    },
  });
  const res = await app.request("/m/123");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { id: "ex", title: "Example" });
  assert.equal(called, false);
});

test("graceful shutdown blocks new requests", async () => {
  const app = new App();
  app.route({
    method: "GET",
    path: "/g",
    operationId: "g",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const p = app.shutdown(50);
  const res = await app.request("/g");
  assert.equal(res.status, 503);
  await p;
});

test("isForbiddenObjectKey flags pollution-sink keys only", () => {
  assert.equal(isForbiddenObjectKey("__proto__"), true);
  assert.equal(isForbiddenObjectKey("constructor"), true);
  assert.equal(isForbiddenObjectKey("prototype"), true);
  assert.equal(isForbiddenObjectKey("proto"), false);
  assert.equal(isForbiddenObjectKey(""), false);
  assert.equal(isForbiddenObjectKey("user"), false);
});

// Spring4Shell-class regression: an attacker who can name request fields
// (query string, x-www-form-urlencoded, multipart) must not be able to bind
// them onto __proto__ / constructor / prototype of the parsed object.
// https://snyk.io/blog/spring4shell-rce-vulnerability-glassfish-payara/
test("query string drops prototype-pollution keys", async () => {
  let observed: unknown = null;
  const app = new App();
  app.route({
    method: "GET",
    path: "/q",
    operationId: "q",
    responses: { 200: { description: "ok" } },
    handler: async ({ query }) => {
      observed = query;
      return { status: 200 as const, body: undefined };
    },
  });
  const res = await app.request(
    "/q?safe=1&__proto__=pwn&constructor=pwn&prototype=pwn",
  );
  assert.equal(res.status, 200);
  const q = observed as Record<string, unknown>;
  assert.equal(q.safe, "1");
  assert.equal(Object.hasOwn(q, "__proto__"), false);
  assert.equal(Object.hasOwn(q, "constructor"), false);
  assert.equal(Object.hasOwn(q, "prototype"), false);
  // Object.prototype must not be polluted by the parse:
  assert.equal((Object.prototype as Record<string, unknown>).pwn, undefined);
});

test("x-www-form-urlencoded body drops prototype-pollution keys", async () => {
  let observed: unknown = null;
  const app = new App();
  app.route({
    method: "POST",
    path: "/f",
    operationId: "f",
    request: { body: z.record(z.string(), z.string()) as any },
    responses: { 200: { description: "ok" } },
    handler: async ({ body }) => {
      observed = body;
      return { status: 200 as const, body: undefined };
    },
  });
  const res = await app.request("/f", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "safe=1&__proto__=pwn&constructor=pwn&prototype=pwn",
  });
  assert.equal(res.status, 200);
  const b = observed as Record<string, unknown>;
  assert.equal(b.safe, "1");
  assert.equal(Object.hasOwn(b, "__proto__"), false);
  assert.equal(Object.hasOwn(b, "constructor"), false);
  assert.equal(Object.hasOwn(b, "prototype"), false);
});

test("multipart body drops prototype-pollution keys", async () => {
  let observed: unknown = null;
  const app = new App();
  app.route({
    method: "POST",
    path: "/m",
    operationId: "m",
    // Accept any record-shaped body so the parser path runs even with the
    // malicious keys present.
    request: { body: z.any() as any },
    responses: { 200: { description: "ok" } },
    handler: async ({ body }) => {
      observed = body;
      return { status: 200 as const, body: undefined };
    },
  });
  const fd = new FormData();
  fd.append("safe", "1");
  fd.append("__proto__", "pwn");
  fd.append("constructor", "pwn");
  fd.append("prototype", "pwn");
  const res = await app.request("/m", { method: "POST", body: fd });
  assert.equal(res.status, 200);
  const b = observed as Record<string, unknown>;
  assert.equal(b.safe, "1");
  assert.equal(Object.hasOwn(b, "__proto__"), false);
  assert.equal(Object.hasOwn(b, "constructor"), false);
  assert.equal(Object.hasOwn(b, "prototype"), false);
});
