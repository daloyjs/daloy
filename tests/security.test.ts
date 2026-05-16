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
