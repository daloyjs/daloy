/**
 * Coverage completion tests — targets every previously-uncovered branch in src/
 * so the framework lands at 100% line coverage. Read alongside the matching
 * source file to understand the intent of each case.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import {
  App,
  HttpError,
  BadRequestError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  MethodNotAllowedError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  TooManyRequestsError,
  RequestTimeoutError,
  InternalError,
  readBodyLimited,
  safeJsonParse,
  sanitizeHeaderName,
  sanitizeHeaderValue,
  timingSafeEqual,
  randomId,
  validate,
  isStandardSchema,
  createLogger,
  noopLogger,
  requestId,
  secureHeaders,
  cors,
  rateLimit,
  timing,
  bearerAuth,
} from "../src/index.js";
import { generateOpenAPI } from "../src/openapi.js";
import { Router } from "../src/router.js";
import { createClient } from "../src/client.js";
import { runContractTests } from "../src/contract.js";
import { scalarHtml, swaggerUiHtml } from "../src/docs.js";
import { serve as serveBun } from "../src/adapters/bun.js";
import { serve as serveDeno } from "../src/adapters/deno.js";

// ---------- security.ts ----------

test("readBodyLimited rejects invalid Content-Length", async () => {
  const req = new Request("http://t/", { method: "POST", headers: { "content-length": "abc" } });
  await assert.rejects(
    () => readBodyLimited(req, 1024),
    (err: any) => err instanceof BadRequestError && /Invalid Content-Length/.test(err.problem?.detail ?? ""),
  );

  const negative = new Request("http://t/", { method: "POST", headers: { "content-length": "-1" } });
  await assert.rejects(
    () => readBodyLimited(negative, 1024),
    (err: any) => err instanceof BadRequestError && /Invalid Content-Length/.test(err.problem?.detail ?? ""),
  );
});

test("readBodyLimited rejects when Content-Length exceeds limit", async () => {
  const req = new Request("http://t/", {
    method: "POST",
    headers: { "content-length": "9999" },
    body: "x",
  });
  await assert.rejects(() => readBodyLimited(req, 16), PayloadTooLargeError);
});

test("readBodyLimited returns empty for missing body", async () => {
  const req = new Request("http://t/", { method: "GET" });
  const out = await readBodyLimited(req, 1024);
  assert.equal(out.byteLength, 0);
});

test("readBodyLimited cancels and throws when streamed bytes exceed limit", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(8));
      controller.enqueue(new Uint8Array(8));
      controller.enqueue(new Uint8Array(8));
      controller.close();
    },
  });
  const req = new Request("http://t/", { method: "POST", body: stream, duplex: "half" } as any);
  await assert.rejects(() => readBodyLimited(req, 10), PayloadTooLargeError);
});

test("readBodyLimited concatenates chunked stream output", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("hello "));
      controller.enqueue(new TextEncoder().encode("world"));
      controller.close();
    },
  });
  const req = new Request("http://t/", { method: "POST", body: stream, duplex: "half" } as any);
  const bytes = await readBodyLimited(req, 1024);
  assert.equal(new TextDecoder().decode(bytes), "hello world");
});

test("safeJsonParse returns undefined for empty input and rejects invalid JSON", () => {
  assert.equal(safeJsonParse(""), undefined);
  assert.throws(() => safeJsonParse("not json"), BadRequestError);
});

test("sanitizeHeaderName lowercases tokens and rejects invalid characters", () => {
  assert.equal(sanitizeHeaderName("X-Custom-Header"), "x-custom-header");
  assert.throws(() => sanitizeHeaderName("bad header"), BadRequestError);
});

test("sanitizeHeaderValue accepts safe values and blocks CRLF/NUL", () => {
  assert.equal(sanitizeHeaderValue("plain"), "plain");
  assert.throws(() => sanitizeHeaderValue("bad\r\nvalue"), BadRequestError);
  assert.throws(() => sanitizeHeaderValue("bad\0value"), BadRequestError);
});

test("timingSafeEqual handles mismatched lengths in constant time", () => {
  assert.equal(timingSafeEqual("short", "longer-string"), false);
  assert.equal(timingSafeEqual("", ""), true);
});

test("randomId falls back to getRandomValues and to time-based id when crypto is absent", () => {
  const original = (globalThis as any).crypto;

  // Force a crypto stub with only getRandomValues (no randomUUID) → hex fallback path.
  const stub = {
    getRandomValues<T extends ArrayBufferView>(buf: T): T {
      const view = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      for (let i = 0; i < view.length; i++) view[i] = (i * 7 + 1) & 0xff;
      return buf;
    },
  };
  Object.defineProperty(globalThis, "crypto", { value: stub, configurable: true });
  try {
    const id = randomId();
    assert.match(id, /^[0-9a-f]{32}$/);
  } finally {
    Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
  }

  // Now remove crypto entirely → time-based fallback path.
  Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
  try {
    const id = randomId();
    assert.match(id, /-/);
  } finally {
    Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
  }
});

// ---------- schema.ts ----------

test("isStandardSchema rejects non-objects and falsy inputs", () => {
  assert.equal(isStandardSchema(null), false);
  assert.equal(isStandardSchema(undefined), false);
  assert.equal(isStandardSchema("not a schema"), false);
  assert.equal(isStandardSchema({}), false);
  assert.equal(isStandardSchema(z.string()), true);
});

test("validate awaits async Standard Schema results", async () => {
  const asyncSchema = {
    "~standard": {
      version: 1 as const,
      vendor: "test",
      validate: async (value: unknown) =>
        typeof value === "string" ? { value } : { issues: [{ message: "expected string" }] },
    },
  };
  const ok = await validate(asyncSchema as any, "hi");
  assert.deepEqual(ok, { value: "hi" });
  const bad = await validate(asyncSchema as any, 123);
  assert.deepEqual(bad, { issues: [{ message: "expected string" }] });
});

// ---------- errors.ts ----------

test("HttpError merges custom problem fields and renders in production with 5xx detail scrubbed", () => {
  const err = new HttpError(503, {
    title: "Service Unavailable",
    detail: "internal trace info",
    type: "https://example.com/errors/down",
  });
  const prod = err.toResponse({ production: true, requestId: "req-1" });
  return prod.json().then((body: any) => {
    assert.equal(prod.status, 503);
    assert.equal(prod.headers.get("content-type"), "application/problem+json");
    assert.equal(body.title, "Service Unavailable");
    assert.equal(body.detail, undefined, "5xx detail should be scrubbed in production");
    assert.equal(body.instance, "urn:request:req-1");
    assert.equal(body.type, "https://example.com/errors/down");
  });
});

test("HttpError keeps detail in non-production responses", async () => {
  const err = new HttpError(500, { title: "Internal Server Error", detail: "stack" });
  const res = err.toResponse({ production: false });
  const body: any = await res.json();
  assert.equal(body.detail, "stack");
});

test("HttpError preserves custom headers", async () => {
  const err = new HttpError(418, { title: "I'm a teapot" }, { "x-teapot": "yes" });
  const res = err.toResponse();
  assert.equal(res.headers.get("x-teapot"), "yes");
});

test("HttpError uses default type when none provided and falls back to NODE_ENV", () => {
  const err = new HttpError(400, { title: "Bad" });
  assert.equal(err.problem.type, "https://httpstatuses.io/400");
  const prevEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    const internal = new InternalError("leaky");
    const res = internal.toResponse();
    return res.json().then((body: any) => {
      assert.equal(body.detail, undefined);
    });
  } finally {
    process.env.NODE_ENV = prevEnv;
  }
});

test("specific HttpError subclasses carry the expected status and metadata", async () => {
  const cases: Array<[HttpError, number]> = [
    [new BadRequestError(), 400],
    [new BadRequestError("nope"), 400],
    [new UnauthorizedError("login required"), 401],
    [new ForbiddenError("denied"), 403],
    [new NotFoundError(), 404],
    [new MethodNotAllowedError(["GET", "POST"]), 405],
    [new RequestTimeoutError(1234), 408],
    [new PayloadTooLargeError(1024), 413],
    [new UnsupportedMediaTypeError("text/xml", ["application/json"]), 415],
    [new ValidationError("body", [{ path: "x", message: "bad" }]), 422],
    [new TooManyRequestsError(30), 429],
    [new TooManyRequestsError(), 429],
    [new InternalError(), 500],
  ];
  for (const [err, status] of cases) {
    assert.equal(err.status, status, err.name);
    const res = err.toResponse({ production: false });
    assert.equal(res.status, status);
    assert.equal(res.headers.get("content-type"), "application/problem+json");
    const body: any = await res.json();
    assert.equal(body.status, status);
  }

  const mna = new MethodNotAllowedError(["GET", "POST"]).toResponse();
  assert.equal(mna.headers.get("allow"), "GET, POST");
  const tmr = new TooManyRequestsError(15).toResponse();
  assert.equal(tmr.headers.get("retry-after"), "15");
});

// ---------- logger.ts ----------

test("createLogger writes to stdout by default and survives unserializable payloads", () => {
  const written: string[] = [];
  const writes = process.stdout.write.bind(process.stdout);
  (process.stdout as any).write = (line: string) => {
    written.push(line);
    return true;
  };
  try {
    const logger = createLogger();
    logger.info("hello stdout");
    const circular: any = {};
    circular.self = circular;
    logger.error(circular, "circular");
  } finally {
    (process.stdout as any).write = writes;
  }
  assert.ok(written.some((l) => l.includes("hello stdout")));
  assert.ok(written.some((l) => l.includes("<unserializable log>")));
});

test("createLogger uses console.log fallback when stdout.write is missing", () => {
  const realProcess = (globalThis as any).process;
  const proxy = new Proxy(realProcess, {
    get(target, prop) {
      if (prop === "stdout") return { write: undefined };
      return (target as any)[prop];
    },
  });
  Object.defineProperty(globalThis, "process", { value: proxy, configurable: true });
  const original = console.log;
  const captured: string[] = [];
  console.log = (line: string) => captured.push(line);
  try {
    const logger = createLogger({ level: "trace" });
    logger.trace("first");
    logger.debug({ a: 1 }, "second");
  } finally {
    console.log = original;
    Object.defineProperty(globalThis, "process", { value: realProcess, configurable: true });
  }
  assert.ok(captured.some((l) => l.includes("first")));
  assert.ok(captured.some((l) => l.includes("second")));
});

test("createLogger child merges bindings and emits every level method", () => {
  const lines: string[] = [];
  const logger = createLogger({ level: "trace", bindings: { app: "daloy" }, write: (line) => lines.push(line) });
  const child = logger.child({ route: "/health" });

  child.trace("trace");
  child.debug("debug");
  child.info("info");
  child.warn("warn");
  child.error("error");
  child.fatal("fatal");

  assert.equal(lines.length, 6);
  assert.ok(lines.every((line) => line.includes('"app":"daloy"') && line.includes('"route":"/health"')));
  assert.ok(lines.some((line) => line.includes('"level":"fatal"')));
});

test("noopLogger ignores every call and returns itself from child()", () => {
  noopLogger.trace("a");
  noopLogger.debug("b");
  noopLogger.info("c");
  noopLogger.warn("d");
  noopLogger.error("e");
  noopLogger.fatal("f");
  assert.equal(noopLogger.child({ a: 1 }), noopLogger);
});

test("App accepts a custom Logger instance and honors logger: false", () => {
  const calls: string[] = [];
  const custom = {
    level: "info" as const,
    trace() {},
    debug() {},
    info(_obj: object | string, msg?: string) {
      calls.push(`info:${msg ?? "obj"}`);
    },
    warn() {},
    error() {},
    fatal() {},
    child() {
      return custom;
    },
  };
  const app = new App({ logger: custom });
  assert.equal(app.log, custom);

  const silent = new App({ logger: false });
  assert.equal(silent.log, noopLogger);

  const configured = new App({ logger: { level: "debug" } });
  assert.equal(configured.log.level, "debug");
  void calls;
});

// ---------- middleware.ts ----------

test("secureHeaders supports hsts preload and overlapping disabled options", async () => {
  const app = new App({ logger: false });
  app.use(
    secureHeaders({
      hsts: { maxAgeSeconds: 60, includeSubDomains: false, preload: true },
      contentSecurityPolicy: false,
      frameOptions: false,
      noSniff: false,
    })
  );
  app.route({
    method: "GET",
    path: "/sec",
    operationId: "sec",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/sec");
  assert.equal(res.headers.get("strict-transport-security"), "max-age=60; preload");
  assert.equal(res.headers.get("content-security-policy"), null);
  assert.equal(res.headers.get("x-frame-options"), null);
});

test("cors allows wildcard, denies unknown, and accepts array of origins", async () => {
  const wildcard = new App({ logger: false });
  wildcard.use(cors({ origin: "*" }));
  wildcard.route({
    method: "GET",
    path: "/w",
    operationId: "w",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const allowed = await wildcard.request("/w", { headers: { origin: "https://anyone" } });
  assert.equal(allowed.headers.get("access-control-allow-origin"), "*");
  const noOrigin = await wildcard.request("/w");
  assert.equal(noOrigin.headers.get("access-control-allow-origin"), null);

  const arr = new App({ logger: false });
  arr.use(cors({ origin: ["https://a.test", "https://b.test"] }));
  arr.route({
    method: "GET",
    path: "/a",
    operationId: "a",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const ok = await arr.request("/a", { headers: { origin: "https://a.test" } });
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://a.test");
  const denied = await arr.request("/a", { headers: { origin: "https://c.test" } });
  assert.equal(denied.headers.get("access-control-allow-origin"), null);

  // String origin (not wildcard) — only matches exact value.
  const exact = new App({ logger: false });
  exact.use(cors({ origin: "https://only.test" }));
  exact.route({
    method: "GET",
    path: "/e",
    operationId: "e",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const exactDenied = await exact.request("/e", { headers: { origin: "https://other.test" } });
  assert.equal(exactDenied.headers.get("access-control-allow-origin"), null);
});

test("cors preflight from an unknown origin omits allow-origin and still responds 204", async () => {
  const app = new App({ logger: false });
  app.use(cors({ origin: ["https://known.test"] }));
  app.route({
    method: "GET",
    path: "/pre",
    operationId: "pre",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/pre", { method: "OPTIONS", headers: { origin: "https://unknown.test" } });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
  assert.equal(res.headers.get("access-control-allow-methods"), "GET, POST, PUT, PATCH, DELETE, OPTIONS");
});

test("rateLimit cleans up expired entries when buckets grow past the watermark", async () => {
  let now = 1_000_000;
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    const app = new App({ logger: false });
    app.use(rateLimit({ windowMs: 10, max: 10_000 }));
    app.route({
      method: "GET",
      path: "/rl",
      operationId: "rl",
      responses: { 200: { description: "ok" } },
      handler: async () => ({ status: 200 as const, body: undefined }),
    });
    for (let i = 0; i < 10_001; i++) {
      await app.request("/rl", { headers: { "x-forwarded-for": `1.1.1.${i}` } });
    }
    now += 10_000; // force expiry of every existing bucket
    const res = await app.request("/rl", { headers: { "x-forwarded-for": "2.2.2.2" } });
    assert.equal(res.status, 200);
  } finally {
    Date.now = originalNow;
  }
});

test("rateLimit falls back through key generators when proxy headers are missing", async () => {
  const app = new App({ logger: false });
  app.use(rateLimit({ windowMs: 1000, max: 1, trustProxyHeaders: true }));
  app.route({
    method: "GET",
    path: "/k",
    operationId: "k",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const first = await app.request("/k", { headers: { "x-real-ip": "9.9.9.9" } });
  assert.equal(first.status, 200);
  const second = await app.request("/k", { headers: { "x-real-ip": "9.9.9.9" } });
  assert.equal(second.status, 429);

  const fresh = new App({ logger: false });
  fresh.use(rateLimit({ windowMs: 1000, max: 1 }));
  fresh.route({
    method: "GET",
    path: "/g",
    operationId: "g",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const a = await fresh.request("/g");
  assert.equal(a.status, 200);
  const b = await fresh.request("/g");
  assert.equal(b.status, 429);
});

test("requestId falls back to a generated id when no incoming header is set", async () => {
  const app = new App({ logger: false });
  app.use(requestId({ trustIncoming: false, generator: () => "fixed-id" }));
  app.route({
    method: "GET",
    path: "/id",
    operationId: "id",
    responses: { 200: { description: "ok" } },
    handler: async ({ state }) => ({ status: 200 as const, body: { requestId: state.requestId } }),
  });
  const res = await app.request("/id");
  assert.equal(res.headers.get("x-request-id"), "fixed-id");
  assert.deepEqual(await res.json(), { requestId: "fixed-id" });
});

test("timing middleware no-ops when start time is missing", async () => {
  const app = new App({ logger: false });
  app.use({
    afterHandle(ctx) {
      // wipe the marker so the next afterHandle sees no start time
      delete (ctx.state as Record<string, unknown>).__start;
    },
  });
  app.use(timing("server-timing"));
  app.route({
    method: "GET",
    path: "/t",
    operationId: "t",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/t");
  assert.equal(res.headers.get("server-timing"), null);
});

// ---------- router/app extras ----------

test("Router.add accepts operationIds on root and static routes", () => {
  const router = new Router<string>();
  router.add("GET", "/", "root", "rootOp");
  router.add("POST", "/static", "static", "staticOp");

  assert.equal(router.find("GET", "/")?.handler, "root");
  assert.equal(router.find("POST", "/static")?.handler, "static");
  assert.throws(() => router.add("PATCH", "/other", "duplicate", "staticOp"), /Duplicate operationId/);
});

test("App rejects requests during graceful shutdown with 503", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/slow",
    operationId: "slow",
    responses: { 200: { description: "ok" } },
    handler: async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { status: 200 as const, body: undefined };
    },
  });
  const inflight = app.request("/slow");
  const drain = app.shutdown(200);
  // After draining flag flips, new requests must 503.
  await new Promise((r) => setTimeout(r, 5));
  const blocked = await app.request("/slow");
  assert.equal(blocked.status, 503);
  assert.equal(blocked.headers.get("retry-after"), "5");
  await inflight;
  await drain;
});

test("App.shutdown returns when drain timeout elapses with inflight requests", async () => {
  const app = new App({ logger: false });
  let release!: () => void;
  app.route({
    method: "GET",
    path: "/hang",
    operationId: "hang",
    responses: { 200: { description: "ok" } },
    handler: async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { status: 200 as const, body: undefined };
    },
  });
  const inflight = app.request("/hang");
  // Give the request a moment to start.
  await new Promise((r) => setTimeout(r, 5));
  const start = Date.now();
  await app.shutdown(40);
  assert.ok(Date.now() - start >= 40);
  release();
  await inflight;
});

test("App.request accepts string URLs, URL objects, and Request instances", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/r",
    operationId: "r",
    responses: { 200: { description: "ok", body: z.object({ via: z.string() }) as any } },
    handler: async ({ request }) => ({ status: 200 as const, body: { via: new URL(request.url).pathname } }),
  });
  const a = await app.request("/r");
  const b = await app.request(new URL("http://test.local/r"));
  const c = await app.request(new Request("http://test.local/r"));
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(c.status, 200);
  assert.deepEqual(await a.json(), { via: "/r" });
});

test("HEAD requests fall back to GET handlers but return an empty body", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/page",
    operationId: "page",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.request("/page", { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "");
});

test("mock mode returns a null body when no example is declared", async () => {
  const app = new App({ logger: false, mockMode: true });
  app.route({
    method: "GET",
    path: "/m2",
    operationId: "m2",
    responses: { 204: { description: "no content" } },
    handler: async () => ({ status: 204 as const, body: undefined }),
  });
  const res = await app.request("/m2");
  assert.equal(res.status, 204);
});

test("requestTimeoutMs aborts slow handlers with 408", async () => {
  const app = new App({ logger: false, requestTimeoutMs: 5 });
  app.route({
    method: "GET",
    path: "/slow",
    operationId: "slow",
    responses: { 200: { description: "ok" }, 408: { description: "timeout" } },
    handler: async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { status: 200 as const, body: undefined };
    },
  });
  const res = await app.request("/slow");
  assert.equal(res.status, 408);
});

test("requestTimeoutMs=0 disables the timeout", async () => {
  const app = new App({ logger: false, requestTimeoutMs: 0 });
  app.route({
    method: "GET",
    path: "/fast",
    operationId: "fast",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/fast");
  assert.equal(res.status, 200);
});

test("non-Error throwables become 500 Internal Error", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/boom",
    operationId: "boom",
    responses: { 500: { description: "err" } },
    handler: async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "string error";
    },
  });
  const res = await app.request("/boom");
  assert.equal(res.status, 500);
  const body: any = await res.json();
  assert.equal(body.title, "Internal Server Error");
});

test("handler returning an undeclared status surfaces as Internal Error", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/wrong-status",
    operationId: "wrongStatus",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 418 as any, body: undefined }),
  });
  const res = await app.request("/wrong-status");
  assert.equal(res.status, 500);
});

test("explicit content-type headers and binary bodies bypass JSON serialization", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/binary",
    operationId: "binary",
    responses: { 200: { description: "ok" } },
    handler: async () => ({
      status: 200 as const,
      body: new Uint8Array([1, 2, 3]) as any,
      headers: { "content-type": "application/octet-stream" },
    }),
  });
  const res = await app.request("/binary");
  assert.equal(res.headers.get("content-type"), "application/octet-stream");
  const buf = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual(Array.from(buf), [1, 2, 3]);
});

test("explicit content-type with string body skips JSON.stringify", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/raw",
    operationId: "raw",
    responses: { 200: { description: "ok" } },
    handler: async () => ({
      status: 200 as const,
      body: "raw text" as any,
      headers: { "content-type": "text/plain" },
    }),
  });
  const res = await app.request("/raw");
  assert.equal(await res.text(), "raw text");
  assert.equal(res.headers.get("content-type"), "text/plain");
});

test("form-urlencoded bodies are parsed into objects", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/form",
    operationId: "form",
    request: { body: z.object({ a: z.string(), b: z.string() }) as any },
    responses: { 200: { description: "ok", body: z.object({ a: z.string(), b: z.string() }) as any } },
    handler: async ({ body }) => ({ status: 200 as const, body: body as any }),
  });
  const res = await app.request("/form", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "a=1&b=two",
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { a: "1", b: "two" });
});

test("multipart/form-data bodies are accepted and large ones rejected by content-length", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/upload",
    operationId: "upload",
    request: { body: z.object({ file: z.any() }) as any },
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });

  const fd = new FormData();
  fd.append("file", "tiny");
  const ok = await app.request("/upload", { method: "POST", body: fd });
  assert.equal(ok.status, 200);

  // Force a content-length over the configured limit.
  const huge = await app.request("/upload", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(10_000_000) },
    body: "----x--",
  });
  assert.equal(huge.status, 413);
});

test("unknown content-types fall through to text decoding", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/text",
    operationId: "text",
    request: { body: z.string() as any },
    responses: { 200: { description: "ok", body: z.string() as any } },
    handler: async ({ body }) => ({ status: 200 as const, body: body as any }),
  });
  const res = await app.request("/text", {
    method: "POST",
    headers: { "content-type": "text/markdown" },
    body: "hi",
  });
  // Body schema is declared so only allowlisted content-types are accepted.
  assert.equal(res.status, 415);

  const lenient = new App({ logger: false, allowedContentTypes: ["text/markdown"] });
  lenient.route({
    method: "POST",
    path: "/text",
    operationId: "text",
    request: { body: z.string() as any },
    responses: { 200: { description: "ok", body: z.string() as any } },
    handler: async ({ body }) => ({ status: 200 as const, body: body as any }),
  });
  const text = await lenient.request("/text", {
    method: "POST",
    headers: { "content-type": "text/markdown" },
    body: "hi",
  });
  assert.equal(text.status, 200);
  assert.equal(await text.json(), "hi");
});

test("function-form plugin registration mounts routes", async () => {
  const app = new App({ logger: false });
  app.register((child) => {
    child.route({
      method: "GET",
      path: "/fn",
      operationId: "fn",
      responses: { 200: { description: "ok" } },
      handler: async () => ({ status: 200 as const, body: { fn: true } }),
    });
  }, { prefix: "/p" });
  const res = await app.request("/p/fn");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { fn: true });
});

test("group merges hooks and tags from nested groups", async () => {
  const app = new App({ logger: false });
  app.group("/v1", { tags: ["v1"], hooks: { beforeHandle: (ctx) => ctx.set.headers.set("x-v1", "1") } }, (v1) => {
    v1.group("/admin", { tags: ["admin"], hooks: { beforeHandle: (ctx) => ctx.set.headers.set("x-admin", "1") } }, (admin) => {
      admin.route({
        method: "GET",
        path: "/ping",
        operationId: "ping",
        responses: { 200: { description: "ok" } },
        handler: async () => ({ status: 200 as const, body: undefined }),
      });
    });
  });
  const res = await app.request("/v1/admin/ping");
  assert.equal(res.headers.get("x-v1"), "1");
  assert.equal(res.headers.get("x-admin"), "1");
  const intro = app.introspect();
  const ping = intro.find((r) => r.path === "/v1/admin/ping");
  assert.deepEqual(ping?.tags?.sort(), ["admin", "v1"]);
});

// ---------- openapi.ts zod fallback ----------

test("generateOpenAPI uses zod fallback when toJSONSchema is unavailable", () => {
  const stub = (typeName: string, extra: Record<string, unknown> = {}): any => ({
    _def: { typeName, ...extra },
  });
  const stringSchema = stub("ZodString");
  const numberSchema = stub("ZodNumber");
  const boolSchema = stub("ZodBoolean");
  const arrSchema = stub("ZodArray", { element: stringSchema });
  const optString = stub("ZodOptional", { innerType: stringSchema });
  optString.isOptional = () => true;
  const objSchema = stub("ZodObject", {
    shape: () => ({
      a: stringSchema,
      b: numberSchema,
      c: boolSchema,
      d: arrSchema,
      e: optString,
      unknown: stub("ZodUnknown"),
    }),
  });

  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/zf/:a",
    operationId: "zf",
    request: { params: objSchema as any, query: objSchema as any },
    responses: {
      200: { description: "ok", body: objSchema as any },
    },
    handler: async () => ({ status: 200 as const, body: {} as any }),
  });

  const doc: any = generateOpenAPI(app, { info: { title: "Z", version: "1" } });
  const op = doc.paths["/zf/{a}"].get;
  const pathParam = op.parameters.find((p: any) => p.in === "path");
  assert.equal(pathParam.schema.type, "string");
  const queryParams = op.parameters.filter((p: any) => p.in === "query");
  const names = queryParams.map((p: any) => p.name).sort();
  assert.deepEqual(names, ["a", "b", "c", "d", "e", "unknown"]);
  assert.equal(queryParams.find((p: any) => p.name === "d").schema.type, "array");
  assert.equal(queryParams.find((p: any) => p.name === "e").required, false);
});

test("generateOpenAPI gracefully handles schemas without metadata", () => {
  const opaque = {
    "~standard": { version: 1, vendor: "opaque", validate: (v: unknown) => ({ value: v }) },
  };
  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/opaque",
    operationId: "opaque",
    request: { body: opaque as any },
    responses: { 200: { description: "ok", body: opaque as any } },
    handler: async () => ({ status: 200 as const, body: {} as any }),
  });
  const doc: any = generateOpenAPI(app, { info: { title: "O", version: "1" } });
  const op = doc.paths["/opaque"].post;
  assert.deepEqual(op.requestBody.content["application/json"].schema, {});
  assert.deepEqual(op.responses[200].content["application/json"].schema, {});
});

test("generateOpenAPI ignores schemas whose toJSONSchema throws", () => {
  const throwy: any = {
    "~standard": { version: 1, vendor: "x", validate: (v: unknown) => ({ value: v }) },
    toJSONSchema() {
      throw new Error("nope");
    },
    _def: { typeName: "ZodString" },
  };
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/throwy",
    operationId: "throwy",
    request: { query: throwy as any },
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const doc: any = generateOpenAPI(app, { info: { title: "T", version: "1" } });
  const op = doc.paths["/throwy"].get;
  // No params extracted (empty schema), but the document still generates.
  assert.ok(op);
});

// ---------- client.ts ----------

test("createClient skips routes without operationId", () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/anon",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  app.route({
    method: "GET",
    path: "/named",
    operationId: "named",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const client = createClient(app, { baseUrl: "http://t/", fetch: async () => new Response("", { status: 200 }) });
  assert.equal(typeof (client as any).named, "function");
  assert.equal((client as any).anon, undefined);
});

test("createClient handles empty responses, undefined query values, and uses default fetch when omitted", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/empty",
    operationId: "empty",
    request: { query: z.object({ q: z.string().optional() }) as any },
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });

  let seenUrl = "";
  const client = createClient(app, {
    baseUrl: "http://t/",
    fetch: async (url) => {
      seenUrl = String(url);
      return new Response("", { status: 200, headers: { "x-h": "v" } });
    },
  });
  const result = await (client as any).empty({ params: {}, query: { q: undefined } });
  assert.equal(result.status, 200);
  assert.equal(result.body, undefined);
  assert.equal(result.headers["x-h"], "v");
  assert.equal(new URL(seenUrl).search, "");

  // Exercise the default-fetch branch by stubbing globalThis.fetch.
  const originalFetch = globalThis.fetch;
  let stubbed = false;
  (globalThis as any).fetch = async () => {
    stubbed = true;
    return new Response("", { status: 200 });
  };
  try {
    const defaulted = createClient(app, { baseUrl: "http://t/" });
    await (defaulted as any).empty({ params: {} });
    assert.equal(stubbed, true);
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});

// ---------- docs.ts ----------

test("docs HTML uses default titles when none are supplied", () => {
  const scalar = scalarHtml({ specUrl: "/openapi.json" });
  assert.match(scalar, /<title>API Reference<\/title>/);
  const swagger = swaggerUiHtml({ specUrl: "/openapi.json" });
  assert.match(swagger, /<title>API Docs<\/title>/);
});

// ---------- contract.ts ----------

test("contract tests detect duplicate operationIds, missing responses, and clean async examples", async () => {
  const app = new App({ logger: false });
  // duplicate operationId — routes registered without going through the router's strict check.
  (app as any).routes.push(
    { method: "GET", path: "/d1", operationId: "dup", responses: { 200: { description: "ok" } }, handler: async () => ({}) },
    { method: "GET", path: "/d2", operationId: "dup", responses: { 200: { description: "ok" } }, handler: async () => ({}) },
    { method: "GET", path: "/no-responses", operationId: "noResp", responses: {}, handler: async () => ({}) }
  );
  const dupReport = await runContractTests(app);
  assert.equal(dupReport.ok, false);
  assert.ok(dupReport.issues.some((i) => /Duplicate operationId/.test(i.message)));
  assert.ok(dupReport.issues.some((i) => /No responses declared/.test(i.message)));

  // requireOperationId: false skips that check.
  const lenient = new App({ logger: false });
  lenient.route({
    method: "GET",
    path: "/anon",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const lenientReport = await runContractTests(lenient, { requireOperationId: false });
  assert.equal(lenientReport.ok, true);

  // allowBodyOnSafeMethods suppresses the warning.
  const bodyOnGet = new App({ logger: false });
  bodyOnGet.route({
    method: "GET",
    path: "/bget",
    operationId: "bget",
    request: { body: z.object({ x: z.number() }) as any },
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const allowed = await runContractTests(bodyOnGet, { allowBodyOnSafeMethods: true });
  assert.equal(allowed.issues.length, 0);
});

// ---------- adapters (bun & deno) ----------

test("bun adapter delegates fetch to app and produces a problem+json error response", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/b",
    operationId: "b",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  const captured: { fetch?: (r: Request) => Promise<Response>; error?: (e: Error) => Response; opts?: any } = {};
  (globalThis as any).Bun = {
    serve(opts: any) {
      captured.fetch = opts.fetch;
      captured.error = opts.error;
      captured.opts = opts;
      let stopped = false;
      return {
        port: opts.port,
        stop(forceClose: boolean) {
          stopped = forceClose;
          void stopped;
        },
      };
    },
  };
  try {
    const handle = serveBun(app, { port: 1234, hostname: "127.0.0.1", maxRequestBodySize: 1024 });
    assert.equal(handle.port, 1234);
    assert.equal(captured.opts.port, 1234);
    assert.equal(captured.opts.hostname, "127.0.0.1");
    assert.equal(captured.opts.maxRequestBodySize, 1024);

    const res = await captured.fetch!(new Request("http://t/b"));
    assert.equal(res.status, 200);

    const err = captured.error!(new Error("boom"));
    assert.equal(err.status, 500);
    assert.equal(err.headers.get("content-type"), "application/problem+json");
    const body: any = await err.json();
    assert.equal(body.title, "Internal Server Error");
    assert.equal(body.detail, "boom");

    await handle.stop();
  } finally {
    delete (globalThis as any).Bun;
  }
});

test("bun adapter uses defaults when options are omitted", async () => {
  let opts: any;
  (globalThis as any).Bun = {
    serve(o: any) {
      opts = o;
      return { port: o.port, stop() {} };
    },
  };
  try {
    const handle = serveBun(new App({ logger: false }));
    assert.equal(handle.port, 3000);
    assert.equal(opts.hostname, "0.0.0.0");
    assert.equal(opts.maxRequestBodySize, 16 * 1024 * 1024);
  } finally {
    delete (globalThis as any).Bun;
  }
});

test("deno adapter delegates fetch and shuts down when stopped", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/d",
    operationId: "d",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  const captured: { handler?: (req: Request) => Promise<Response>; opts?: any; shutdownCalled?: boolean } = {};
  (globalThis as any).Deno = {
    serve(opts: any, handler: (req: Request) => Promise<Response>) {
      captured.opts = opts;
      captured.handler = handler;
      return {
        async shutdown() {
          captured.shutdownCalled = true;
        },
      };
    },
  };
  try {
    const handle = serveDeno(app, { port: 9000, hostname: "127.0.0.1" });
    assert.equal(captured.opts.port, 9000);
    assert.equal(captured.opts.hostname, "127.0.0.1");
    const res = await captured.handler!(new Request("http://t/d"));
    assert.equal(res.status, 200);

    await handle.shutdown();
    assert.equal(captured.shutdownCalled, true);
  } finally {
    delete (globalThis as any).Deno;
  }
});

test("deno adapter falls back gracefully when the runtime omits shutdown()", async () => {
  (globalThis as any).Deno = {
    serve(_opts: any, _handler: any) {
      return {}; // no shutdown method
    },
  };
  try {
    const handle = serveDeno(new App({ logger: false }));
    await handle.shutdown();
  } finally {
    delete (globalThis as any).Deno;
  }
});

// ---------- middleware: bearerAuth realm default ----------

test("bearerAuth uses default realm when none is provided", async () => {
  const app = new App({ logger: false });
  app.use(bearerAuth({ validate: () => true }));
  app.route({
    method: "GET",
    path: "/auth",
    operationId: "auth",
    responses: { 200: { description: "ok" }, 401: { description: "no" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/auth");
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate") ?? "", /realm="api"/);
});
