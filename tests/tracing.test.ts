import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  App,
  otelTracing,
  TRACING_SPAN_KIND_SERVER,
  TRACING_SPAN_STATUS_ERROR,
  TRACING_SPAN_STATUS_UNSET,
  type Hooks,
  type TracingAttributeValue,
  type TracingSpan,
  type TracingTracer,
  type TracingStartSpanOptions,
} from "../src/index.js";

interface RecordedSpan {
  name: string;
  options: TracingStartSpanOptions | undefined;
  context: unknown;
  attributes: Record<string, TracingAttributeValue>;
  status: { code: number; message?: string } | undefined;
  exceptions: unknown[];
  ended: boolean;
  endCount: number;
}

interface MakeFakeTracerOptions {
  /** When true, the span will not have an `updateName` method. */
  omitUpdateName?: boolean;
}

function makeFakeTracer(opts: MakeFakeTracerOptions = {}): { tracer: TracingTracer; spans: RecordedSpan[] } {
  const spans: RecordedSpan[] = [];
  const tracer: TracingTracer = {
    startSpan(name, options, context) {
      const recorded: RecordedSpan = {
        name,
        options,
        context,
        attributes: { ...(options?.attributes ?? {}) },
        status: undefined,
        exceptions: [],
        ended: false,
        endCount: 0,
      };
      const span: TracingSpan = {
        setAttribute(key, value) {
          recorded.attributes[key] = value;
        },
        setAttributes(attrs) {
          Object.assign(recorded.attributes, attrs);
        },
        setStatus(s) {
          recorded.status = s;
        },
        recordException(err) {
          recorded.exceptions.push(err);
        },
        end() {
          recorded.ended = true;
          recorded.endCount += 1;
        },
        ...(opts.omitUpdateName ? {} : {
          updateName(n: string) {
            recorded.name = n;
          },
        }),
      };
      spans.push(recorded);
      return span;
    },
  };
  return { tracer, spans };
}

function makeApp(hooks: Hooks) {
  const app = new App({ hooks });
  app.route({
    method: "GET",
    path: "/ok",
    operationId: "ok",
    responses: {
      200: { description: "ok", body: z.object({ ok: z.boolean() }) as any },
    },
    handler: async ({ state }) => {
      // Expose the span on state for assertion purposes
      (state as Record<string, unknown>).__sawSpan =
        (state as Record<string, unknown>).otelSpan !== undefined;
      return { status: 200 as const, body: { ok: true } };
    },
  });
  app.route({
    method: "GET",
    path: "/boom",
    operationId: "boom",
    responses: { 500: { description: "fail" } },
    handler: async () => {
      throw new Error("kaboom");
    },
  });
  return app;
}

test("otelTracing starts a SERVER span with HTTP semantic-convention attributes", async () => {
  const { tracer, spans } = makeFakeTracer();
  const app = makeApp(otelTracing({ tracer }));
  const res = await app.request("http://api.test.local/ok?x=1", {
    headers: { "user-agent": "vitest/1.0" },
  });
  assert.equal(res.status, 200);
  assert.equal(spans.length, 1);
  const span = spans[0]!;
  assert.equal(span.name, "GET /ok");
  assert.equal(span.options?.kind, TRACING_SPAN_KIND_SERVER);
  assert.equal(span.attributes["http.request.method"], "GET");
  assert.equal(span.attributes["url.path"], "/ok");
  assert.equal(span.attributes["url.scheme"], "http");
  assert.equal(span.attributes["server.address"], "api.test.local");
  // url.query is omitted by default (secure-by-default: query strings carry tokens/PII).
  assert.equal("url.query" in span.attributes, false);
  assert.equal(span.attributes["user_agent.original"], "vitest/1.0");
  assert.equal(span.attributes["http.response.status_code"], 200);
  assert.equal(span.ended, true);
  assert.equal(span.endCount, 1);
  assert.equal(span.status, undefined);
});

test("otelTracing splits host and port into server.address (no port) and server.port", async () => {
  const { tracer, spans } = makeFakeTracer();
  const app = makeApp(otelTracing({ tracer }));
  const res = await app.request("http://api.test.local:8443/ok");
  assert.equal(res.status, 200);
  const span = spans[0]!;
  // server.address must NOT include the port per the OTel HTTP semconv.
  assert.equal(span.attributes["server.address"], "api.test.local");
  assert.equal(span.attributes["server.port"], 8443);
});

test("otelTracing omits server.port for default ports", async () => {
  const { tracer, spans } = makeFakeTracer();
  const app = makeApp(otelTracing({ tracer }));
  // No explicit port → URL.port is "" → no server.port attribute.
  const res = await app.request("http://api.test.local/ok");
  assert.equal(res.status, 200);
  const span = spans[0]!;
  assert.equal(span.attributes["server.address"], "api.test.local");
  assert.equal(span.attributes["server.port"], undefined);
});

test("otelTracing exposes the active span on ctx.state under the configured key", async () => {
  const { tracer } = makeFakeTracer();
  const seen: { hadSpan: boolean } = { hadSpan: false };
  const app = new App({
    hooks: otelTracing({ tracer, stateKey: "span" }),
  });
  app.route({
    method: "GET",
    path: "/h",
    operationId: "h",
    responses: { 200: { description: "ok" } },
    handler: ({ state }) => {
      seen.hadSpan = (state as Record<string, unknown>).span !== undefined;
      return { status: 200 as const, body: undefined };
    },
  });
  await app.request("/h");
  assert.equal(seen.hadSpan, true);
});

test("otelTracing records exceptions and marks span ERROR on thrown handlers", async () => {
  const { tracer, spans } = makeFakeTracer();
  const app = makeApp(otelTracing({ tracer }));
  const res = await app.request("/boom");
  assert.equal(res.status, 500);
  assert.equal(spans.length, 1);
  const span = spans[0]!;
  assert.equal(span.exceptions.length, 1);
  assert.ok(span.exceptions[0] instanceof Error);
  assert.equal(span.status?.code, TRACING_SPAN_STATUS_ERROR);
  assert.equal(span.status?.message, "kaboom");
  assert.equal(span.ended, true);
  assert.equal(span.endCount, 1);
  assert.equal(span.attributes["http.response.status_code"], 500);
});

test("otelTracing escalates 5xx responses to ERROR status without an exception", async () => {
  const { tracer, spans } = makeFakeTracer();
  const app = new App({ hooks: otelTracing({ tracer }) });
  app.route({
    method: "GET",
    path: "/svc",
    operationId: "svc",
    responses: { 503: { description: "down" } },
    handler: () => ({ status: 503 as const, body: undefined }),
  });
  const res = await app.request("/svc");
  assert.equal(res.status, 503);
  const span = spans[0]!;
  assert.equal(span.status?.code, TRACING_SPAN_STATUS_ERROR);
  assert.equal(span.attributes["http.response.status_code"], 503);
});

test("otelTracing traces unmatched requests through the error response", async () => {
  const { tracer, spans } = makeFakeTracer();
  const app = new App({ hooks: otelTracing({ tracer }) });
  const res = await app.request("/missing?debug=1");
  assert.equal(res.status, 404);
  assert.equal(spans.length, 1);
  const span = spans[0]!;
  assert.equal(span.name, "GET /missing");
  // url.query is omitted by default (secure-by-default).
  assert.equal("url.query" in span.attributes, false);
  assert.equal(span.attributes["http.response.status_code"], 404);
  // ctx.state.route was never set (unmatched), so span name stays as the path-based creation-time name.
  assert.equal(span.name, "GET /missing");
  assert.equal(span.ended, true);
  assert.equal(span.endCount, 1);
});

test("otelTracing traces method-not-allowed responses through the error response", async () => {
  const { tracer, spans } = makeFakeTracer();
  const app = new App({ hooks: otelTracing({ tracer }) });
  app.route({
    method: "GET",
    path: "/only-get",
    operationId: "onlyGet",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/only-get", { method: "POST" });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("allow"), "GET");
  assert.equal(spans.length, 1);
  const span = spans[0]!;
  assert.equal(span.name, "POST /only-get");
  assert.equal(span.attributes["http.response.status_code"], 405);
  assert.equal(span.ended, true);
  assert.equal(span.endCount, 1);
});

test("otelTracing supports custom spanName, attribute extractors, parent context, and onSpanStart", async () => {
  const { tracer, spans } = makeFakeTracer();
  const startCalls: string[] = [];
  const parentContext = { traceId: "abc123" };
  const app = new App({
    hooks: otelTracing({
      tracer,
      spanName: (req) => `custom ${new URL(req.url).pathname}`,
      attributesFromRequest: () => ({ "tenant.id": "acme", "feature.flags": ["a", "b"] }),
      attributesFromResponse: (res) => ({ "http.response.body.size": res.headers.get("content-length") ? Number(res.headers.get("content-length")) : 0 }),
      contextFromRequest: () => parentContext,
      onSpanStart: (req, _span) => {
        startCalls.push(req.url);
      },
    }),
  });
  app.route({
    method: "GET",
    path: "/c",
    operationId: "c",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/c");
  assert.equal(res.status, 200);
  const span = spans[0]!;
  assert.equal(span.name, "custom /c");
  assert.equal(span.attributes["tenant.id"], "acme");
  assert.deepEqual(span.attributes["feature.flags"], ["a", "b"]);
  assert.equal(span.context, parentContext);
  assert.ok("http.response.body.size" in span.attributes);
  assert.equal(startCalls.length, 1);
});

test("otelTracing falls back to setAttribute when setAttributes is not implemented", async () => {
  const recorded: { attrs: Record<string, unknown> } = { attrs: {} };
  const tracer: TracingTracer = {
    startSpan(_name, options) {
      Object.assign(recorded.attrs, options?.attributes ?? {});
      return {
        setAttribute(key, value) {
          recorded.attrs[key] = value;
        },
        setStatus() {},
        end() {},
      };
    },
  };
  const app = new App({ hooks: otelTracing({ tracer }) });
  app.route({
    method: "GET",
    path: "/x",
    operationId: "x",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });
  await app.request("/x");
  assert.equal(recorded.attrs["http.response.status_code"], 200);
});

test("otelTracing handles non-Error throws by setting ERROR without recordException payload", async () => {
  const { tracer, spans } = makeFakeTracer();
  const app = new App({ hooks: otelTracing({ tracer }) });
  app.route({
    method: "GET",
    path: "/weird",
    operationId: "weird",
    responses: { 500: { description: "x" } },
    handler: () => {
      // eslint-disable-next-line no-throw-literal
      throw "not-an-error";
    },
  });
  const res = await app.request("/weird");
  assert.equal(res.status, 500);
  const span = spans[0]!;
  assert.equal(span.status?.code, TRACING_SPAN_STATUS_ERROR);
  assert.equal(span.exceptions.length, 0);
});

test("otelTracing tolerates malformed Request URLs", async () => {
  const { tracer, spans } = makeFakeTracer();
  const hooks = otelTracing({ tracer });
  // Invoke beforeHandle directly with a synthetic ctx that has an invalid URL.
  const fakeReq = new Request("http://test.local/x", { method: "POST" });
  Object.defineProperty(fakeReq, "url", { value: "not a url", configurable: true });
  Object.defineProperty(fakeReq, "method", { value: "POST", configurable: true });
  const ctx: any = {
    request: fakeReq,
    params: {},
    query: {},
    headers: {},
    body: undefined,
    state: {},
    set: { headers: new Headers() },
  };
  await hooks.beforeHandle?.(ctx);
  assert.equal(spans.length, 1);
  const span = spans[0]!;
  assert.equal(span.name, "POST /");
  assert.equal(span.attributes["http.request.method"], "POST");
  assert.equal(span.attributes["url.path"], undefined);
});

test("otelTracing onError/onSend are no-ops when ctx is undefined", async () => {
  const { tracer, spans } = makeFakeTracer();
  const hooks = otelTracing({ tracer });
  // Should not throw.
  await hooks.onError?.(new Error("x"), undefined);
  await hooks.onSend?.(new Response("hi"), undefined);
  assert.equal(spans.length, 0);
});

test("otelTracing onError without a started span is a no-op", async () => {
  const { tracer, spans } = makeFakeTracer();
  const hooks = otelTracing({ tracer });
  const req = new Request("http://test.local/none");
  const ctx: any = {
    request: req,
    params: {},
    query: {},
    headers: {},
    body: undefined,
    state: {},
    set: { headers: new Headers() },
  };
  await hooks.onError?.(new Error("x"), ctx);
  await hooks.onSend?.(new Response(null, { status: 200 }), ctx);
  assert.equal(spans.length, 0);
});

test("otelTracing onSend ends the span exactly once even after onError already fired", async () => {
  const { tracer, spans } = makeFakeTracer();
  const hooks = otelTracing({ tracer });
  const req = new Request("http://test.local/once");
  const ctx: any = {
    request: req,
    params: {},
    query: {},
    headers: {},
    body: undefined,
    state: {},
    set: { headers: new Headers() },
  };
  await hooks.beforeHandle?.(ctx);
  await hooks.onError?.(new Error("first"), ctx);
  await hooks.onSend?.(new Response(null, { status: 500 }), ctx);
  await hooks.onSend?.(new Response(null, { status: 500 }), ctx); // second time, no-op
  await hooks.onError?.(new Error("late"), ctx); // after end, no-op
  const span = spans[0]!;
  assert.equal(span.endCount, 1);
});

test("dispatch exposes matched route template and operationId on ctx.state", async () => {
  let seen: { route?: unknown; operationId?: unknown } = {};
  const app = new App();
  app.route({
    method: "GET",
    path: "/books/:id",
    operationId: "getBook",
    responses: { 200: { description: "ok" } },
    handler: (ctx) => {
      seen = { route: ctx.state.route, operationId: ctx.state.operationId };
      return { status: 200 as const, body: { ok: true } } as any;
    },
  });
  await app.fetch(new Request("http://x/books/42"));
  assert.equal(seen.route, "/books/:id");
  assert.equal(seen.operationId, "getBook");
});

test("operationId is undefined (not empty/null) when the route declares none", async () => {
  let op: unknown = "sentinel";
  const app = new App();
  app.route({
    method: "GET",
    path: "/health",
    responses: { 200: { description: "ok" } },
    handler: (ctx) => { op = ctx.state.operationId; return { status: 200 as const, body: { ok: true } } as any; },
  });
  await app.fetch(new Request("http://x/health"));
  assert.equal(op, undefined);
});

// ─── semconv Task 2 tests ────────────────────────────────────────────────────

test("span carries http.route and is renamed to {METHOD} {route}", async () => {
  const { tracer, spans } = makeFakeTracer();
  const app = new App({ hooks: otelTracing({ tracer }) });
  app.route({ method: "GET", path: "/books/:id", responses: { 200: { description: "ok" } }, handler: () => ({ status: 200 as const, body: undefined }) });
  await app.fetch(new Request("http://x/books/42"));
  assert.equal(spans[0]!.attributes["http.route"], "/books/:id");
  assert.equal(spans[0]!.name, "GET /books/:id");
});

test("unknown HTTP method is normalized to _OTHER with method_original", async () => {
  const { tracer, spans } = makeFakeTracer();
  const app = new App({ hooks: otelTracing({ tracer }) });
  app.route({ method: "GET", path: "/x", responses: { 200: { description: "ok" } }, handler: () => ({ status: 200 as const, body: undefined }) });
  // dispatch a non-standard method directly through the tracing hook path:
  await app.fetch(new Request("http://x/x", { method: "PROPFIND" }));
  assert.equal(spans[0]!.attributes["http.request.method"], "_OTHER");
  assert.equal(spans[0]!.attributes["http.request.method_original"], "PROPFIND");
});

test("url query is omitted from the span by default (no secret leak)", async () => {
  const { tracer, spans } = makeFakeTracer();
  const app = new App({ hooks: otelTracing({ tracer }) });
  app.route({ method: "GET", path: "/x", responses: { 200: { description: "ok" } }, handler: () => ({ status: 200 as const, body: undefined }) });
  await app.fetch(new Request("http://x/x?token=secret"));
  assert.equal("url.query" in spans[0]!.attributes, false);
});

test("redactQuery opts a sanitized query back in", async () => {
  const { tracer, spans } = makeFakeTracer();
  const app = new App({ hooks: otelTracing({ tracer, redactQuery: () => "[redacted]" }) });
  app.route({ method: "GET", path: "/x", responses: { 200: { description: "ok" } }, handler: () => ({ status: 200 as const, body: undefined }) });
  await app.fetch(new Request("http://x/x?token=secret"));
  assert.equal(spans[0]!.attributes["url.query"], "[redacted]");
});

test("redactQuery returning undefined keeps url.query absent", async () => {
  const { tracer, spans } = makeFakeTracer();
  const app = new App({ hooks: otelTracing({ tracer, redactQuery: () => undefined }) });
  app.route({ method: "GET", path: "/x", responses: { 200: { description: "ok" } }, handler: () => ({ status: 200 as const, body: undefined }) });
  await app.fetch(new Request("http://x/x?token=secret"));
  assert.equal("url.query" in spans[0]!.attributes, false);
});

test("5xx without thrown error sets error.type to the status string", async () => {
  const { tracer, spans } = makeFakeTracer();
  const app = new App({ hooks: otelTracing({ tracer }) });
  app.route({ method: "GET", path: "/x", responses: { 503: { description: "down" } }, handler: () => ({ status: 503 as const, body: undefined }) });
  await app.fetch(new Request("http://x/x"));
  assert.equal(spans[0]!.status!.code, TRACING_SPAN_STATUS_ERROR);
  assert.equal(spans[0]!.attributes["error.type"], "503");
});

test("thrown error sets error.type to the error class name", async () => {
  const { tracer, spans } = makeFakeTracer();
  const app = new App({ hooks: otelTracing({ tracer }) });
  app.route({ method: "GET", path: "/x", responses: { 500: { description: "err" } }, handler: () => { throw new TypeError("boom"); } });
  await app.fetch(new Request("http://x/x"));
  assert.equal(spans[0]!.attributes["error.type"], "TypeError");
});

test("4xx leaves span status UNSET (regression guard)", async () => {
  const { tracer, spans } = makeFakeTracer();
  const app = new App({ hooks: otelTracing({ tracer }) });
  app.route({ method: "GET", path: "/x", responses: { 404: { description: "not found" } }, handler: () => ({ status: 404 as const, body: undefined }) });
  await app.fetch(new Request("http://x/x"));
  assert.equal(spans[0]!.status, undefined);
});

test("tracer whose span lacks updateName() does not throw", async () => {
  const { tracer, spans } = makeFakeTracer({ omitUpdateName: true });
  const app = new App({ hooks: otelTracing({ tracer }) });
  app.route({ method: "GET", path: "/books/:id", responses: { 200: { description: "ok" } }, handler: () => ({ status: 200 as const, body: undefined }) });
  await app.fetch(new Request("http://x/books/42"));
  assert.equal(spans[0]!.attributes["http.route"], "/books/:id"); // attr still set
  // name stays as the creation-time path-based name since updateName is not available
  assert.equal(spans[0]!.name, "GET /books/42");
});
