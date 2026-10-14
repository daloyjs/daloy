import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  createAppTelemetry,
  createOtlpLogExporter,
  createOtlpMetricsExporter,
  createOtlpTracer,
  formatTraceparent,
  TRACING_SPAN_KIND_CLIENT,
  TRACING_SPAN_KIND_SERVER,
} from "../src/index.js";

// ---------- fixtures ----------

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: any;
}

function fakeCollector(status = 200) {
  const calls: Captured[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body)),
    });
    return new Response("{}", { status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const BASE = {
  endpoint: "http://collector.local:4317",
  resourceAttributes: { "service.name": "svc" },
  flushIntervalMs: 0,
};

function spansOf(calls: Captured[]): any[] {
  return calls
    .filter((c) => c.url.endsWith("/v1/traces"))
    .flatMap((c) => c.body.resourceSpans[0].scopeSpans[0].spans);
}

function attr(span: any, key: string): unknown {
  const kv = span.attributes.find((a: any) => a.key === key);
  if (kv === undefined) return undefined;
  const v = kv.value;
  return v.stringValue ?? v.intValue ?? v.doubleValue ?? v.boolValue ?? v.arrayValue;
}

/** Run `fn` with env vars set (`undefined` deletes), restoring them afterwards. */
async function withEnv(vars: Record<string, string | undefined>, fn: () => unknown): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const HEX32 = /^[0-9a-f]{32}$/;
const HEX16 = /^[0-9a-f]{16}$/;

// ---------- createOtlpTracer ----------

test("createOtlpTracer exports OTLP/HTTP JSON spans with wire kinds, hex ids, events and status", async () => {
  const { calls, fetchImpl } = fakeCollector();
  const tracer = createOtlpTracer({ ...BASE, fetch: fetchImpl })!;
  const server = tracer.startSpan("GET /a", {
    kind: TRACING_SPAN_KIND_SERVER,
    attributes: { "http.request.method": "GET", n: 3, ratio: 0.5, ok: true, tags: ["a", "b"] },
  });
  const child = tracer.startSpan("db", { kind: TRACING_SPAN_KIND_CLIENT }, server);
  child.addEvent("cache.miss", { key: "k" });
  child.end();
  server.updateName("GET /:id");
  server.recordException(new RangeError("boom"));
  server.setStatus({ code: 2, message: "boom" });
  server.end();
  server.end(); // idempotent
  await tracer.flush();

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "http://collector.local:4318/v1/traces");
  const resource = calls[0]!.body.resourceSpans[0].resource.attributes;
  assert.deepEqual(resource, [{ key: "service.name", value: { stringValue: "svc" } }]);
  const [c, s] = spansOf(calls);
  assert.equal(s.name, "GET /:id");
  assert.equal(s.kind, 2, "SERVER is 2 on the wire");
  assert.equal(c.kind, 3, "CLIENT is 3 on the wire");
  assert.match(s.traceId, HEX32);
  assert.match(s.spanId, HEX16);
  assert.equal(s.parentSpanId, undefined);
  assert.equal(c.traceId, s.traceId);
  assert.equal(c.parentSpanId, s.spanId);
  assert.deepEqual(s.status, { code: 2, message: "boom" });
  assert.equal(attr(s, "n"), "3");
  assert.equal(attr(s, "ratio"), 0.5);
  assert.equal(attr(s, "ok"), true);
  assert.deepEqual(attr(s, "tags"), { values: [{ stringValue: "a" }, { stringValue: "b" }] });
  const exception = s.events.find((e: any) => e.name === "exception");
  assert.equal(attr(exception, "exception.type"), "RangeError");
  assert.equal(attr(exception, "exception.message"), "boom");
  assert.equal(c.events[0].name, "cache.miss");
  assert.ok(BigInt(s.endTimeUnixNano) >= BigInt(s.startTimeUnixNano));
});

test("createOtlpTracer continues a valid remote parent and ignores an invalid one", async () => {
  const { calls, fetchImpl } = fakeCollector();
  const tracer = createOtlpTracer({ ...BASE, fetch: fetchImpl })!;
  const parent = { traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331", traceFlags: 1 };
  tracer.startSpan("child", {}, parent).end();
  tracer.startSpan("root", {}, { traceId: "nope", spanId: "x", traceFlags: 1 }).end();
  tracer.startSpan("root2", {}, "garbage").end();
  await tracer.flush();
  const [child, root, root2] = spansOf(calls);
  assert.equal(child.traceId, parent.traceId);
  assert.equal(child.parentSpanId, parent.spanId);
  assert.equal(child.kind, 1, "default kind is INTERNAL");
  for (const r of [root, root2]) {
    assert.notEqual(r.traceId, parent.traceId);
    assert.equal(r.parentSpanId, undefined);
  }
});

test("createOtlpTracer sampling: ratio 0 records nothing but keeps a propagatable identity; parent flags win", async () => {
  const { calls, fetchImpl } = fakeCollector();
  const tracer = createOtlpTracer({ ...BASE, fetch: fetchImpl, sampleRatio: 0 })!;
  const dropped = tracer.startSpan("dropped");
  assert.equal(dropped.isRecording(), false);
  const sc = dropped.spanContext();
  assert.equal(sc.traceFlags, 0);
  assert.match(formatTraceparent(sc), /^00-[0-9a-f]{32}-[0-9a-f]{16}-00$/);
  dropped.setAttribute("x", 1);
  dropped.end();
  // A sampled remote parent is honored even at ratio 0 (parent-based).
  const kept = tracer.startSpan("kept", {}, { ...sc, traceFlags: 1 });
  assert.equal(kept.isRecording(), true);
  kept.end();
  assert.equal(kept.isRecording(), false, "an ended span stops recording");
  // A child of a sampled-out span is sampled out too.
  assert.equal(tracer.startSpan("c", {}, dropped).isRecording(), false);
  await tracer.flush();
  assert.deepEqual(spansOf(calls).map((s) => s.name), ["kept"]);

  const all = createOtlpTracer({ ...BASE, fetch: fetchImpl, sampleRatio: 1 })!;
  const notSampledParent = { ...sc, traceFlags: 0 };
  assert.equal(all.startSpan("s", {}, notSampledParent).isRecording(), false);
});

test("createOtlpTracer rejects an out-of-range sampleRatio and honors OTEL_TRACES_SAMPLER", async () => {
  for (const bad of [-0.1, 1.5, NaN, "0.5" as unknown as number]) {
    assert.throws(() => createOtlpTracer({ ...BASE, sampleRatio: bad }), RangeError);
  }
  const { fetchImpl } = fakeCollector();
  await withEnv({ OTEL_TRACES_SAMPLER: "always_off", OTEL_TRACES_SAMPLER_ARG: undefined }, () => {
    const t = createOtlpTracer({ ...BASE, fetch: fetchImpl })!;
    assert.equal(t.startSpan("x").isRecording(), false);
    // always_off is not parent-based: a sampled parent does not override it.
    const parent = { traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331", traceFlags: 1 };
    assert.equal(t.startSpan("y", {}, parent).isRecording(), false);
  });
  await withEnv({ OTEL_TRACES_SAMPLER: "parentbased_traceidratio", OTEL_TRACES_SAMPLER_ARG: "0" }, () => {
    const t = createOtlpTracer({ ...BASE, fetch: fetchImpl })!;
    assert.equal(t.startSpan("x").isRecording(), false);
  });
  await withEnv({ OTEL_TRACES_SAMPLER: "traceidratio", OTEL_TRACES_SAMPLER_ARG: "garbage" }, () => {
    const t = createOtlpTracer({ ...BASE, fetch: fetchImpl })!;
    assert.equal(t.startSpan("x").isRecording(), true, "an invalid ratio falls back to 1");
  });
});

test("createOtlpTracer caps attributes, events and value sizes per span", async () => {
  const { calls, fetchImpl } = fakeCollector();
  const tracer = createOtlpTracer({ ...BASE, fetch: fetchImpl })!;
  const span = tracer.startSpan("big".repeat(400));
  for (let i = 0; i < 200; i++) span.setAttribute(`k${i}`, i);
  span.setAttribute("k0", "overwrite is allowed at the cap");
  span.setAttribute("huge", "x".repeat(10_000));
  span.setAttribute("bad", NaN);
  for (let i = 0; i < 150; i++) span.addEvent(`e${i}`);
  span.end();
  await tracer.flush();
  const [s] = spansOf(calls);
  assert.equal(s.attributes.length, 128);
  assert.equal(s.droppedAttributesCount, 74);
  assert.equal(attr(s, "k0"), "overwrite is allowed at the cap");
  assert.equal(s.events.length, 128);
  assert.equal(s.droppedEventsCount, 22);
  assert.ok(s.name.length <= 512);
});

test("createOtlpTracer stringifies non-finite numbers and truncates long strings", async () => {
  const { calls, fetchImpl } = fakeCollector();
  const tracer = createOtlpTracer({ ...BASE, fetch: fetchImpl })!;
  tracer
    .startSpan("s", { attributes: { inf: Infinity, long: "y".repeat(5000), big: 2 ** 60 } })
    .end();
  await tracer.flush();
  const [s] = spansOf(calls);
  assert.equal(attr(s, "inf"), "Infinity");
  assert.equal((attr(s, "long") as string).length, 4096);
  assert.equal(attr(s, "big"), 2 ** 60, "unsafe integers ship as doubles");
  // The payload is valid JSON (the fake collector parsed it).
});

test("createOtlpTracer drops the oldest span at the queue cap and counts failed exports", async () => {
  const { calls, fetchImpl } = fakeCollector(503);
  const tracer = createOtlpTracer({ ...BASE, fetch: fetchImpl })!;
  for (let i = 0; i < 2_100; i++) tracer.startSpan(`s${i}`).end();
  await tracer.flush();
  // Full batches flush eagerly; every POST failed with 503.
  assert.ok(calls.length >= 4);
  assert.ok(tracer.droppedBatches >= calls.length);

  const dead = createOtlpTracer({
    ...BASE,
    fetch: (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch,
  })!;
  dead.startSpan("x").end();
  await dead.flush(); // never rejects
  assert.equal(dead.droppedBatches, 1);
  await dead.flush(); // queue was cleared
  assert.equal(dead.droppedBatches, 1);
});

test("createOtlpTracer is null without an endpoint", () => {
  assert.equal(createOtlpTracer({ flushIntervalMs: 0 }), null);
});

// ---------- environment variables ----------

test("operator kill switches disable exporters: OTEL_SDK_DISABLED and OTEL_<SIGNAL>_EXPORTER=none", async () => {
  await withEnv({ OTEL_SDK_DISABLED: "true" }, () => {
    assert.equal(createOtlpLogExporter(BASE), null);
    assert.equal(createOtlpMetricsExporter(BASE), null);
    assert.equal(createOtlpTracer(BASE), null);
  });
  await withEnv({ OTEL_SDK_DISABLED: "false", OTEL_TRACES_EXPORTER: "otlp, none" }, () => {
    assert.equal(createOtlpTracer(BASE), null);
    assert.ok(createOtlpLogExporter(BASE), "other signals stay on");
  });
  await withEnv({ OTEL_METRICS_EXPORTER: "otlp" }, () => {
    assert.ok(createOtlpMetricsExporter(BASE));
  });
});

test("signal-specific endpoint, headers and timeout env vars are honored", async () => {
  const { calls, fetchImpl } = fakeCollector();
  await withEnv(
    {
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://generic.local:4317",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://traces.example/custom/path",
      OTEL_EXPORTER_OTLP_HEADERS: "tenant=generic,shared=1",
      OTEL_EXPORTER_OTLP_TRACES_HEADERS: "tenant=traces",
      OTEL_EXPORTER_OTLP_TIMEOUT: "1234",
    },
    async () => {
      const tracer = createOtlpTracer({ flushIntervalMs: 0, fetch: fetchImpl })!;
      tracer.startSpan("x").end();
      await tracer.flush();
      const logs = createOtlpLogExporter({ flushIntervalMs: 0, fetch: fetchImpl })!;
      logs.pushLine("hi");
      await logs.flush();
    },
  );
  // The signal endpoint is used as-is; the generic one gets the signal path.
  assert.equal(calls[0]!.url, "https://traces.example/custom/path");
  assert.equal(calls[0]!.headers.tenant, "traces");
  assert.equal(calls[0]!.headers.shared, "1");
  assert.equal(calls[1]!.url, "http://generic.local:4318/v1/logs");
  assert.equal(calls[1]!.headers.tenant, "generic");
});

// ---------- flush serialization ----------

test("a flush called during an in-flight export waits and then ships the newer records", async () => {
  const bodies: any[] = [];
  let release: (() => void) | undefined;
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    if (bodies.length === 1) await new Promise<void>((r) => (release = r));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const logs = createOtlpLogExporter({ ...BASE, fetch: fetchImpl, flushTimeoutMs: 0 })!;
  logs.pushLine("first");
  const first = logs.flush();
  for (let i = 0; i < 20 && release === undefined; i++) await Promise.resolve();
  logs.pushLine("second");
  // Previously this returned immediately, so a shutdown or waitUntil flush
  // could finish before "second" was ever sent.
  let secondDone = false;
  const second = logs.flush().then(() => (secondDone = true));
  await Promise.resolve();
  assert.equal(secondDone, false, "must wait for the in-flight export");
  release!();
  await Promise.all([first, second]);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].resourceLogs[0].scopeLogs[0].logRecords[0].body.stringValue, "second");
});

// ---------- log/trace correlation ----------

test("log exporter promotes well-formed trace_id/span_id to the record trace context", async () => {
  const { calls, fetchImpl } = fakeCollector();
  const logs = createOtlpLogExporter({ ...BASE, fetch: fetchImpl })!;
  const traceId = "0af7651916cd43dd8448eb211c80319c";
  const spanId = "b7ad6b7169203331";
  logs.pushLine(JSON.stringify({ level: "info", msg: "ok", trace_id: traceId, span_id: spanId, trace_flags: "01" }));
  logs.pushLine(JSON.stringify({ level: "info", msg: "bad", trace_id: "not-hex", span_id: spanId }));
  await logs.flush();
  const [good, bad] = calls[0]!.body.resourceLogs[0].scopeLogs[0].logRecords;
  assert.equal(good.traceId, traceId);
  assert.equal(good.spanId, spanId);
  assert.equal(good.flags, 1);
  assert.ok(!good.attributes.some((a: any) => a.key === "trace_id"));
  // Unhappy path: malformed ids are not promoted and stay plain attributes.
  assert.equal(bad.traceId, undefined);
  assert.ok(bad.attributes.some((a: any) => a.key === "trace_id"));
});

// ---------- App telemetry.traces ----------

test("telemetry.traces traces matched routes, continues traceparent, and correlates handler logs", async () => {
  const { calls, fetchImpl } = fakeCollector();
  const app = new App({
    env: "development",
    telemetry: { traces: true, exporter: { ...BASE, fetch: fetchImpl } },
  });
  app.get("/books/:id", { responses: { 200: { description: "ok" } } }, async ({ state }) => {
    (state as any).log.info({ event: "book.read" }, "reading");
    return { status: 200 as const, body: { ok: true } };
  });
  assert.ok(app.telemetry!.traces);
  const upstream = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
  assert.equal((await app.request("/books/42", { headers: { traceparent: upstream } })).status, 200);
  assert.equal((await app.request("/no/such/path")).status, 404);
  await app.telemetry!.flush();

  const spans = spansOf(calls);
  assert.equal(spans.length, 1, "unmatched requests are not traced");
  const [span] = spans;
  assert.equal(span.name, "GET /books/:id");
  assert.equal(span.kind, 2);
  assert.equal(span.traceId, "0af7651916cd43dd8448eb211c80319c");
  assert.equal(span.parentSpanId, "b7ad6b7169203331");
  assert.equal(attr(span, "http.route"), "/books/:id");
  assert.equal(attr(span, "http.response.status_code"), "200");

  const records = calls
    .filter((c) => c.url.endsWith("/v1/logs"))
    .flatMap((c) => c.body.resourceLogs[0].scopeLogs[0].logRecords);
  const handlerLine = records.find((r: any) => r.body.stringValue === "reading");
  assert.equal(handlerLine.traceId, span.traceId);
  assert.equal(handlerLine.spanId, span.spanId);
});

test("telemetry.traces propagate:false ignores an inbound traceparent", async () => {
  const { calls, fetchImpl } = fakeCollector();
  const app = new App({
    env: "development",
    logger: false,
    telemetry: { logs: false, metrics: false, traces: { propagate: false }, exporter: { ...BASE, fetch: fetchImpl } },
  });
  app.get("/a", { responses: { 200: { description: "ok" } } }, async () => ({
    status: 200 as const,
    body: { ok: true },
  }));
  await app.request("/a", {
    headers: { traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00" },
  });
  await app.telemetry!.flush();
  const [span] = spansOf(calls);
  assert.ok(span, "a not-sampled upstream flag cannot suppress the span");
  assert.notEqual(span.traceId, "0af7651916cd43dd8448eb211c80319c");
  assert.equal(span.parentSpanId, undefined);
});

test("telemetry traces are opt-in, and the displayed endpoint never carries credentials", () => {
  const off = createAppTelemetry({ exporter: { ...BASE, fetch: fakeCollector().fetchImpl } });
  assert.equal(off.traces, null);
  assert.equal(off.traceHooks, undefined);

  const secret = createAppTelemetry({
    exporter: {
      ...BASE,
      endpoint: "https://user:s3cret@collector.example:4318/otlp?api_key=topsecret#frag",
      fetch: fakeCollector().fetchImpl,
    },
  });
  assert.equal(secret.endpoint, "https://collector.example:4318/otlp");

  const inert = createAppTelemetry({ logs: false, metrics: false, exporter: BASE });
  assert.equal(inert.endpoint, null, "no active exporter means no endpoint");
  assert.throws(() => createAppTelemetry({ traces: { sampleRatio: 2 }, exporter: BASE }), RangeError);
});
