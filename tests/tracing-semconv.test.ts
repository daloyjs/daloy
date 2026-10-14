import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  NotFoundError,
  otelTracing,
  parseTraceparent,
  formatTraceparent,
  isValidSpanContext,
  TRACING_SPAN_STATUS_ERROR,
  type TracingAttributeValue,
  type TracingSpan,
  type TracingTracer,
} from "../src/index.js";

interface Recorded {
  name: string;
  renamed: string[];
  attributes: Record<string, TracingAttributeValue>;
  status: { code: number; message?: string } | undefined;
  exceptions: unknown[];
  endCount: number;
}

/** Fake tracer; `rename: true` gives spans an `updateName` like the OTel SDK. */
function fakeTracer(rename = false): { tracer: TracingTracer; spans: Recorded[] } {
  const spans: Recorded[] = [];
  const tracer: TracingTracer = {
    startSpan(name, options) {
      const r: Recorded = {
        name,
        renamed: [],
        attributes: { ...(options?.attributes ?? {}) },
        status: undefined,
        exceptions: [],
        endCount: 0,
      };
      spans.push(r);
      const span: TracingSpan = {
        setAttribute: (k, v) => {
          r.attributes[k] = v;
        },
        setAttributes: (a) => {
          Object.assign(r.attributes, a);
        },
        setStatus: (s) => {
          r.status = s;
        },
        recordException: (e) => {
          r.exceptions.push(e);
        },
        end: () => {
          r.endCount += 1;
        },
      };
      if (rename) {
        span.updateName = (next) => {
          r.renamed.push(next);
          r.name = next;
        };
      }
      return span;
    },
  };
  return { tracer, spans };
}

test("otelTracing leaves 4xx SERVER spans UNSET (404 and thrown 4xx) with no exception", async () => {
  const { tracer, spans } = fakeTracer();
  const app = new App({ env: "development", hooks: otelTracing({ tracer }) });
  app.route({
    method: "GET",
    path: "/gone",
    operationId: "gone",
    responses: { 200: { description: "ok" } },
    handler: () => {
      throw new NotFoundError("nope");
    },
  });
  assert.equal((await app.request("/missing")).status, 404);
  assert.equal((await app.request("/gone")).status, 404);
  assert.equal(spans.length, 2);
  for (const span of spans) {
    assert.equal(span.status, undefined, "a 4xx must not mark a SERVER span ERROR");
    assert.equal(span.exceptions.length, 0);
    assert.equal(span.attributes["error.type"], undefined);
    assert.equal(span.endCount, 1);
  }
});

test("otelTracing sets error.type on 5xx: the exception name when thrown, the status otherwise", async () => {
  const { tracer, spans } = fakeTracer();
  const app = new App({ env: "development", hooks: otelTracing({ tracer }) });
  app.route({
    method: "GET",
    path: "/type",
    operationId: "typeErr",
    responses: { 500: { description: "x" } },
    handler: () => {
      throw new TypeError("bad type");
    },
  });
  app.route({
    method: "GET",
    path: "/down",
    operationId: "down",
    responses: { 503: { description: "down" } },
    handler: () => ({ status: 503 as const, body: undefined }),
  });
  await app.request("/type");
  await app.request("/down");
  assert.equal(spans[0]!.attributes["error.type"], "TypeError");
  assert.equal(spans[0]!.status?.code, TRACING_SPAN_STATUS_ERROR);
  assert.equal(spans[0]!.status?.message, "bad type");
  assert.equal(spans[0]!.exceptions.length, 1);
  assert.equal(spans[1]!.attributes["error.type"], "503");
  assert.equal(spans[1]!.status?.code, TRACING_SPAN_STATUS_ERROR);
  assert.equal(spans[1]!.exceptions.length, 0);
});

test("otelTracing records http.route and renames spans to the route template", async () => {
  const { tracer, spans } = fakeTracer(true);
  const app = new App({ env: "development", hooks: otelTracing({ tracer }) });
  app.route({
    method: "GET",
    path: "/users/:id",
    operationId: "getUser",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });
  await app.request("/users/alice");
  await app.request("/no/such/secret-path");
  const [matched, unmatched] = spans;
  assert.equal(matched!.attributes["http.route"], "/users/:id");
  assert.equal(matched!.name, "GET /users/:id");
  // Unhappy path: an unmatched path never becomes a span name or route.
  assert.equal(unmatched!.name, "GET");
  assert.equal(unmatched!.attributes["http.route"], undefined);
  for (const s of spans) assert.ok(!s.name.includes("alice") && !s.name.includes("secret"));
});

test("otelTracing never renames a custom spanName", async () => {
  const { tracer, spans } = fakeTracer(true);
  const app = new App({
    env: "development",
    hooks: otelTracing({ tracer, spanName: () => "custom" }),
  });
  app.route({
    method: "GET",
    path: "/c/:id",
    operationId: "c",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });
  await app.request("/c/1");
  assert.equal(spans[0]!.name, "custom");
  assert.deepEqual(spans[0]!.renamed, []);
  assert.equal(spans[0]!.attributes["http.route"], "/c/:id");
});

test("otelTracing ends the span of a request the cross-origin guard rejects (regression)", async () => {
  const { tracer, spans } = fakeTracer();
  const app = new App({ env: "development", hooks: otelTracing({ tracer }) });
  app.route({
    method: "POST",
    path: "/x",
    operationId: "x",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/x", {
    method: "POST",
    headers: { origin: "https://evil.example" },
  });
  assert.equal(res.status, 403);
  assert.equal(spans.length, 1);
  assert.equal(spans[0]!.endCount, 1);
  assert.equal(spans[0]!.attributes["http.response.status_code"], 403);
  assert.equal(spans[0]!.status, undefined);
});

test("otelTracing correlateLogs binds trace ids onto ctx.state.log only for a valid span context", async () => {
  const bound: Record<string, unknown>[] = [];
  const log = {
    child(bindings: Record<string, unknown>): unknown {
      bound.push(bindings);
      return { marker: "child" };
    },
  };
  const traceId = "0af7651916cd43dd8448eb211c80319c";
  const spanId = "b7ad6b7169203331";
  const run = async (sc: unknown, correlateLogs = true): Promise<unknown> => {
    const tracer: TracingTracer = {
      startSpan: () => ({
        setAttribute() {},
        setStatus() {},
        end() {},
        spanContext: () => sc as any,
      }),
    };
    const hooks = otelTracing({ tracer, correlateLogs });
    const ctx: any = { request: new Request("http://t.local/a"), state: { log } };
    await hooks.beforeHandle?.(ctx);
    return ctx.state.log;
  };
  const rebound = (await run({ traceId, spanId, traceFlags: 1 })) as { marker: string };
  assert.equal(rebound.marker, "child");
  assert.deepEqual(bound[0], { trace_id: traceId, span_id: spanId, trace_flags: "01" });
  // Unhappy paths: invalid or all-zero contexts, or the option off, leave the logger alone.
  assert.equal(await run({ traceId: "0".repeat(32), spanId, traceFlags: 1 }), log);
  assert.equal(await run({ traceId: "XYZ", spanId, traceFlags: 1 }), log);
  assert.equal(await run({ traceId, spanId, traceFlags: 1 }, false), log);
  assert.equal(bound.length, 1);
});

test("parseTraceparent accepts valid headers and rejects malformed or hostile ones", () => {
  const valid = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
  assert.deepEqual(parseTraceparent(valid), {
    traceId: "0af7651916cd43dd8448eb211c80319c",
    spanId: "b7ad6b7169203331",
    traceFlags: 1,
  });
  assert.equal(parseTraceparent(` ${valid} `)?.traceFlags, 1);
  // A future version may append fields after a "-".
  assert.ok(parseTraceparent("01-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00-extra"));
  const bad: unknown[] = [
    undefined,
    null,
    "",
    valid.toUpperCase(),
    valid + "-x", // version 00 must be exactly 55 characters
    "ff-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
    "00-00000000000000000000000000000000-b7ad6b7169203331-01",
    "00-0af7651916cd43dd8448eb211c80319c-0000000000000000-01",
    "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-zz",
    "00_0af7651916cd43dd8448eb211c80319c_b7ad6b7169203331_01",
    "01-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01x",
    "00-" + "a".repeat(600),
  ];
  for (const value of bad) {
    assert.equal(parseTraceparent(value as string), undefined, `accepted ${String(value)}`);
  }
});

test("formatTraceparent round-trips and refuses invalid contexts", () => {
  const sc = { traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331", traceFlags: 0 };
  const header = formatTraceparent(sc);
  assert.equal(header, "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00");
  assert.deepEqual(parseTraceparent(header), sc);
  assert.equal(isValidSpanContext(sc), true);
  assert.throws(() => formatTraceparent({ ...sc, spanId: "0".repeat(16) }), TypeError);
  assert.equal(isValidSpanContext({ ...sc, traceFlags: 256 }), false);
  assert.equal(isValidSpanContext(null), false);
});
