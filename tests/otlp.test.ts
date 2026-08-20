import { test } from "node:test";
import assert from "node:assert/strict";

import {
  App,
  MetricsRegistry,
  httpMetrics,
  createOtlpLogExporter,
  createOtlpMetricsExporter,
  createAppTelemetry,
  semconvHttpMetrics,
  HTTP_SERVER_REQUEST_DURATION_BUCKETS,
  type Hooks,
} from "../src/index.js";

// ---------- fixtures ----------

const EXPORTER_ENV = {
  endpoint: "http://collector.local:4317",
  headers: { tenant_id: "tenant-a" },
  resourceAttributes: { "service.name": "svc", "service.namespace": "prod" },
  flushIntervalMs: 0, // tests flush explicitly
};

interface CapturedCall {
  url: string;
  headers: Record<string, string>;
  body: any;
}

function fakeCollector(status = 200) {
  const calls: CapturedCall[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body)),
    });
    return new Response(JSON.stringify({ partialSuccess: {} }), { status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function logExporterWith(fetchImpl: typeof fetch, overrides: Record<string, unknown> = {}) {
  return createOtlpLogExporter({ ...EXPORTER_ENV, fetch: fetchImpl, ...overrides })!;
}

function metricsExporterWith(fetchImpl: typeof fetch, overrides: Record<string, unknown> = {}) {
  return createOtlpMetricsExporter({ ...EXPORTER_ENV, fetch: fetchImpl, ...overrides })!;
}

// ---------- log exporter ----------

test("log exporter posts batched records to /v1/logs with rewritten port and headers", async () => {
  const { calls, fetchImpl } = fakeCollector();
  const exporter = logExporterWith(fetchImpl);

  exporter.pushLine(JSON.stringify({ level: "warn", msg: "upstream slow", requestId: "r-1" }));
  exporter.pushLine(JSON.stringify({ event: "user_feedback", verdict: "helpful" }));
  exporter.pushLine("plain banner line");
  await exporter.flush();

  assert.equal(calls.length, 1);
  const call = calls[0]!;
  assert.equal(call.url, "http://collector.local:4318/v1/logs");
  assert.equal(call.headers["tenant_id"], "tenant-a");
  assert.equal(call.headers["content-type"], "application/json");

  const records = call.body.resourceLogs[0].scopeLogs[0].logRecords;
  assert.equal(records.length, 3);
  assert.equal(records[0].severityText, "WARN");
  assert.equal(records[0].severityNumber, 13);
  assert.equal(records[0].body.stringValue, "upstream slow");
  assert.ok(records[0].attributes.some((a: any) => a.key === "requestId"));
  assert.equal(records[1].body.stringValue, "user_feedback"); // event fallback
  assert.equal(records[2].body.stringValue, "plain banner line"); // non-JSON verbatim
  const res = call.body.resourceLogs[0].resource.attributes;
  assert.ok(res.some((a: any) => a.key === "service.name" && a.value.stringValue === "svc"));
});

test("log exporter is null without an endpoint and fail-safe when the collector dies", async () => {
  assert.equal(createOtlpLogExporter({ endpoint: undefined, flushIntervalMs: 0 }), null);

  const failing = (async () => {
    throw new Error("collector down");
  }) as unknown as typeof fetch;
  const exporter = logExporterWith(failing);
  exporter.pushLine('{"level":"info","msg":"x"}');
  await exporter.flush(); // must not throw
  assert.equal(exporter.droppedBatches, 1);
});

test("log exporter counts non-2xx responses and drops oldest at the queue cap", async () => {
  const { fetchImpl } = fakeCollector(500);
  const exporter = logExporterWith(fetchImpl);
  exporter.pushLine("line");
  await exporter.flush();
  assert.equal(exporter.droppedBatches, 1);

  const { calls, fetchImpl: okFetch } = fakeCollector();
  const bounded = logExporterWith(okFetch);
  for (let i = 0; i < 1_001; i++) bounded.pushLine(`line ${i}`);
  assert.equal(bounded.droppedBatches, 1); // oldest dropped at cap
  await bounded.flush();
  const total = calls.reduce(
    (n, c) => n + c.body.resourceLogs[0].scopeLogs[0].logRecords.length,
    0
  );
  assert.equal(total, 1_000);
});

// ---------- metrics exporter ----------

test("metrics exporter ships cumulative sums and histograms to /v1/metrics", async () => {
  const { calls, fetchImpl } = fakeCollector();
  const exporter = metricsExporterWith(fetchImpl);

  exporter.count("requests_total", { user: "a" });
  exporter.count("requests_total", { user: "a" }, 2);
  exporter.record("latency", { route: "/x" }, 0.007, { unit: "s", boundaries: [0.005, 0.01, 0.025] });
  exporter.record("latency", { route: "/x" }, 9, { unit: "s", boundaries: [0.005, 0.01, 0.025] });
  await exporter.flush();

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "http://collector.local:4318/v1/metrics");
  assert.equal(calls[0]!.headers["tenant_id"], "tenant-a");

  const metrics = calls[0]!.body.resourceMetrics[0].scopeMetrics[0].metrics;
  const sum = metrics.find((m: any) => m.name === "requests_total");
  assert.equal(sum.sum.aggregationTemporality, 2);
  assert.equal(sum.sum.isMonotonic, true);
  assert.equal(sum.sum.dataPoints.length, 1); // same series aggregated
  assert.equal(sum.sum.dataPoints[0].asDouble, 3);

  const hist = metrics.find((m: any) => m.name === "latency");
  assert.equal(hist.unit, "s");
  assert.equal(hist.histogram.aggregationTemporality, 2);
  const dp = hist.histogram.dataPoints[0];
  assert.equal(dp.count, "2"); // uint64 string mapping
  assert.ok(Math.abs(dp.sum - 9.007) < 1e-9);
  assert.deepEqual(dp.explicitBounds, [0.005, 0.01, 0.025]);
  assert.deepEqual(dp.bucketCounts, ["0", "1", "0", "1"]); // 0.007 → (0.005,0.01]; 9 → overflow

  // Nothing new recorded → nothing pushed.
  await exporter.flush();
  assert.equal(calls.length, 1);
});

test("metrics exporter buckets a value equal to a bound into that bound's bucket", async () => {
  const { calls, fetchImpl } = fakeCollector();
  const exporter = metricsExporterWith(fetchImpl);
  exporter.record("edge", {}, 0.01, { unit: "s", boundaries: [0.005, 0.01, 0.025] });
  await exporter.flush();
  const dp = calls[0]!.body.resourceMetrics[0].scopeMetrics[0].metrics[0].histogram.dataPoints[0];
  assert.deepEqual(dp.bucketCounts, ["0", "1", "0", "0"]);
});

test("metrics exporter keeps totals across collector failures (cumulative self-healing)", async () => {
  let fail = true;
  const { calls, fetchImpl } = fakeCollector();
  const flaky = (async (url: string | URL | Request, init?: RequestInit) => {
    if (fail) {
      fail = false;
      throw new Error("collector down");
    }
    return fetchImpl(url as string, init);
  }) as typeof fetch;

  const exporter = metricsExporterWith(flaky);
  exporter.count("c", {});
  await exporter.flush(); // fails, never throws
  assert.equal(exporter.droppedBatches, 1);
  await exporter.flush(); // succeeds, carries the total
  assert.equal(calls[0]!.body.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0].asDouble, 1);
});

test("metrics exporter is null without an endpoint, caps series cardinality, and rejects bad values", async () => {
  assert.equal(createOtlpMetricsExporter({ endpoint: undefined, flushIntervalMs: 0 }), null);

  const { fetchImpl } = fakeCollector();
  const exporter = metricsExporterWith(fetchImpl);
  // Hostile-cardinality attack: distinct attribute values far past the cap.
  for (let i = 0; i < 2_500; i++) exporter.count("attack_total", { victim: `path-${i}` });
  assert.equal(exporter.droppedBatches, 500); // 2000 series cap held

  exporter.count("bad", {}, -1);
  exporter.count("bad", {}, Number.NaN);
  exporter.record("bad_h", {}, Number.POSITIVE_INFINITY, { unit: "s", boundaries: [1] });
  // None of the invalid values may create state beyond the capped series.
  const before = exporter.droppedBatches;
  assert.equal(before, 500);
});

test("metrics exporter truncates oversized attribute values", async () => {
  const { calls, fetchImpl } = fakeCollector();
  const exporter = metricsExporterWith(fetchImpl);
  exporter.count("t", { k: "v".repeat(1_000) });
  await exporter.flush();
  const attr = calls[0]!.body.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0].attributes[0];
  assert.equal(attr.value.stringValue.length, 256);
});

// ---------- ctx.routePath + onResponse(ctx) plumbing ----------

test("ctx.routePath carries the matched route template and onResponse receives the context", async () => {
  const seen: { hook: string; routePath: string | undefined }[] = [];
  const hooks: Hooks = {
    beforeHandle(ctx) {
      seen.push({ hook: "beforeHandle", routePath: ctx.routePath });
    },
    onResponse(_res, ctx) {
      seen.push({ hook: "onResponse", routePath: ctx?.routePath });
    },
  };
  const app = new App({ env: "development", hooks });
  app.get("/books/:id", { responses: { 200: { description: "ok" } } }, async ({ params }) => ({
    status: 200 as const,
    body: { id: (params as { id: string }).id },
  }));

  const res = await app.request("/books/42");
  assert.equal(res.status, 200);
  assert.deepEqual(seen, [
    { hook: "beforeHandle", routePath: "/books/:id" },
    { hook: "onResponse", routePath: "/books/:id" },
  ]);
});

test("httpMetrics route label uses the matched template instead of the raw path", async () => {
  const registry = new MetricsRegistry({ collectDefaultMetrics: false });
  const app = new App({ env: "development", hooks: httpMetrics({ registry }) });
  app.get("/books/:id", { responses: { 200: { description: "ok" } } }, async () => ({
    status: 200 as const,
    body: { ok: true },
  }));

  await app.request("/books/1");
  await app.request("/books/2");
  const out = registry.render();
  assert.match(out, /route="\/books\/:id"/);
  assert.doesNotMatch(out, /route="\/books\/1"/);
});

// ---------- semconvHttpMetrics ----------

async function semconvApp(exporterOverrides: Record<string, unknown> = {}) {
  const { calls, fetchImpl } = fakeCollector();
  const exporter = metricsExporterWith(fetchImpl, exporterOverrides);
  const app = new App({ env: "development", hooks: semconvHttpMetrics(exporter) });
  app.get("/books/:id", { responses: { 200: { description: "ok" } } }, async () => ({
    status: 200 as const,
    body: { ok: true },
  }));
  app.get("/boom", { responses: { 200: { description: "ok" } } }, async () => {
    throw new Error("kaboom");
  });
  return { app, exporter, calls };
}

function durationMetric(calls: CapturedCall[]) {
  const metrics = calls.at(-1)!.body.resourceMetrics[0].scopeMetrics[0].metrics;
  return metrics.find((m: any) => m.name === "http.server.request.duration");
}

function attrsOf(dp: any): Record<string, string> {
  return Object.fromEntries(dp.attributes.map((a: any) => [a.key, a.value.stringValue]));
}

test("semconvHttpMetrics records http.server.request.duration with spec attributes and buckets", async () => {
  const { app, exporter, calls } = await semconvApp();
  const res = await app.request("/books/7");
  assert.equal(res.status, 200);
  await exporter.flush();

  const metric = durationMetric(calls);
  assert.equal(metric.unit, "s");
  const dp = metric.histogram.dataPoints[0];
  assert.deepEqual(dp.explicitBounds, [...HTTP_SERVER_REQUEST_DURATION_BUCKETS]);
  const attrs = attrsOf(dp);
  assert.equal(attrs["http.request.method"], "GET");
  assert.equal(attrs["http.route"], "/books/:id");
  assert.equal(attrs["http.response.status_code"], "200");
  assert.equal(attrs["url.scheme"], "http");
  assert.equal(attrs["error.type"], undefined);
});

test("semconvHttpMetrics records nothing for unmatched 404s and sets error.type on 5xx", async () => {
  const { app, exporter, calls } = await semconvApp();

  const notFound = await app.request("/no/such/path-abc");
  assert.equal(notFound.status, 404);
  const boom = await app.request("/boom");
  assert.equal(boom.status, 500);
  await exporter.flush();

  const metric = durationMetric(calls);
  const all = metric.histogram.dataPoints.map(attrsOf);
  // The 404 fast path never builds a context → no series minted from raw paths.
  assert.ok(all.every((a: Record<string, string>) => a["http.response.status_code"] !== "404"));
  const p500 = all.find((a: Record<string, string>) => a["http.response.status_code"] === "500")!;
  assert.equal(p500["http.route"], "/boom");
  assert.equal(p500["error.type"], "500");
});

test("semconvHttpMetrics honors exclude and normalizes unknown methods to _OTHER", async () => {
  const { calls, fetchImpl } = fakeCollector();
  const exporter = metricsExporterWith(fetchImpl);
  const excluding = semconvHttpMetrics(exporter, { exclude: (p) => p === "/healthz" });
  const app = new App({ env: "development", hooks: excluding });
  app.get("/healthz", { responses: { 200: { description: "ok" } } }, async () => ({
    status: 200 as const,
    body: { ok: true },
  }));

  await app.request("/healthz");
  await exporter.flush();
  assert.equal(calls.length, 0, "excluded path must record nothing");

  // Unknown methods cannot reach a matched route through the router, so the
  // _OTHER defense is unit-tested by invoking the hooks directly with a
  // synthetic context.
  const req = new Request("http://localhost/direct", { method: "BREW" });
  const ctx = {
    request: req,
    params: {},
    query: {},
    headers: {},
    body: undefined,
    state: {},
    routePath: "/direct",
    set: { headers: new Headers() },
  } as any;
  excluding.onRequest!(req);
  await excluding.onResponse!(new Response(null, { status: 200 }), ctx);
  await exporter.flush();

  const metric = durationMetric(calls);
  const attrs = attrsOf(metric.histogram.dataPoints[0]);
  assert.equal(attrs["http.request.method"], "_OTHER");
  assert.equal(attrs["http.route"], "/direct");
});

// ---------- App telemetry option ----------

test("App telemetry option exports logs and semconv metrics end to end", async () => {
  const { calls, fetchImpl } = fakeCollector();
  const app = new App({
    env: "development",
    telemetry: { exporter: { ...EXPORTER_ENV, fetch: fetchImpl } },
  });
  app.get("/ping", { responses: { 200: { description: "ok" } } }, async () => ({
    status: 200 as const,
    body: { ok: true },
  }));

  assert.ok(app.telemetry);
  assert.equal(app.telemetry!.endpoint, "http://collector.local:4317");

  const res = await app.request("/ping");
  assert.equal(res.status, 200);
  await app.telemetry!.flush();

  const logCalls = calls.filter((c) => c.url.endsWith("/v1/logs"));
  const metricCalls = calls.filter((c) => c.url.endsWith("/v1/metrics"));
  assert.ok(logCalls.length >= 1, "boot log line must be exported");
  const bootRecords = logCalls.flatMap((c) => c.body.resourceLogs[0].scopeLogs[0].logRecords);
  assert.ok(
    bootRecords.some((r: any) =>
      r.attributes.some((a: any) => a.key === "event" && a.value.stringValue === "telemetry.otlp")
    )
  );
  assert.ok(metricCalls.length >= 1, "semconv metric must be exported");
  const metric = metricCalls
    .at(-1)!
    .body.resourceMetrics[0].scopeMetrics[0].metrics.find(
      (m: any) => m.name === "http.server.request.duration"
    );
  assert.equal(attrsOf(metric.histogram.dataPoints[0])["http.route"], "/ping");
});

test("App telemetry option is a silent no-op without an endpoint and can disable each signal", async () => {
  const inert = new App({
    env: "development",
    telemetry: { exporter: { endpoint: undefined, flushIntervalMs: 0 } },
  });
  assert.ok(inert.telemetry);
  assert.equal(inert.telemetry!.logs, null);
  assert.equal(inert.telemetry!.metrics, null);
  assert.equal(inert.telemetry!.hooks, undefined);
  await inert.telemetry!.flush(); // must not throw

  const { calls, fetchImpl } = fakeCollector();
  const logsOnly = new App({
    env: "development",
    telemetry: { metrics: false, exporter: { ...EXPORTER_ENV, fetch: fetchImpl } },
  });
  assert.equal(logsOnly.telemetry!.metrics, null);
  assert.ok(logsOnly.telemetry!.logs);

  const metricsOnly = new App({
    env: "development",
    telemetry: { logs: false, exporter: { ...EXPORTER_ENV, fetch: fetchImpl } },
  });
  assert.equal(metricsOnly.telemetry!.logs, null);
  assert.ok(metricsOnly.telemetry!.metrics);
  assert.equal(metricsOnly.telemetry!.logWrite, undefined);
  void calls;
});

test("App without the telemetry option allocates nothing", () => {
  const app = new App({ env: "development" });
  assert.equal(app.telemetry, undefined);
});
