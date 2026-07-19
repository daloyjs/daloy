import { test } from "node:test";
import assert from "node:assert/strict";

import {
  App,
  MetricsRegistry,
  Counter,
  Gauge,
  Histogram,
  httpMetrics,
  DEFAULT_DURATION_BUCKETS,
  PROMETHEUS_CONTENT_TYPE,
} from "../src/index.js";

// ---------- MetricsRegistry: counters ----------

test("counter renders HELP/TYPE headers and a labelled sample", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  const c = reg.counter("requests_total", "Total requests.");
  c.inc({ method: "GET" });
  c.inc({ method: "GET" }, 2);
  const out = reg.render();
  assert.match(out, /# HELP daloy_requests_total Total requests\./);
  assert.match(out, /# TYPE daloy_requests_total counter/);
  assert.match(out, /daloy_requests_total\{method="GET"\} 3/);
  assert.ok(out.endsWith("\n"), "exposition must end with a newline");
});

test("counter is memoized by name and rejects negative increments", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  const a = reg.counter("hits");
  const b = reg.counter("hits");
  assert.equal(a, b);
  assert.throws(() => a.inc(undefined, -1), /non-negative/);
});

test("counter default increment is 1 and unlabelled series render without braces", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  reg.counter("ticks").inc();
  assert.match(reg.render(), /\ndaloy_ticks 1\n/);
});

// ---------- MetricsRegistry: gauges ----------

test("gauge supports set, inc, and dec", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  const g = reg.gauge("queue_depth");
  g.set(undefined, 5);
  g.inc();
  g.dec(undefined, 2);
  assert.match(reg.render(), /\ndaloy_queue_depth 4\n/);
});

// ---------- MetricsRegistry: histograms ----------

test("histogram records cumulative buckets, sum, and count", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  const h = reg.histogram("latency_seconds", "Latency.", [0.1, 0.5, 1]);
  h.observe({ route: "/a" }, 0.05);
  h.observe({ route: "/a" }, 0.4);
  h.observe({ route: "/a" }, 2);
  const out = reg.render();
  assert.match(out, /daloy_latency_seconds_bucket\{route="\/a",le="0.1"\} 1/);
  assert.match(out, /daloy_latency_seconds_bucket\{route="\/a",le="0.5"\} 2/);
  assert.match(out, /daloy_latency_seconds_bucket\{route="\/a",le="1"\} 2/);
  assert.match(out, /daloy_latency_seconds_bucket\{route="\/a",le="\+Inf"\} 3/);
  assert.match(out, /daloy_latency_seconds_sum\{route="\/a"\} 2.45/);
  assert.match(out, /daloy_latency_seconds_count\{route="\/a"\} 3/);
});

test("histogram rejects empty or non-finite bucket lists", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  assert.throws(() => reg.histogram("h1", "h", []), /non-empty/);
  assert.throws(() => reg.histogram("h2", "h", [Number.NaN]), /finite/);
});

test("default duration buckets are exported and used when omitted", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  const h = reg.histogram("d_seconds");
  assert.deepEqual([...h.bounds], [...DEFAULT_DURATION_BUCKETS]);
});

// ---------- validation / injection defenses ----------

test("invalid metric names are rejected at definition", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false, prefix: "" });
  assert.throws(() => reg.counter("bad-name"), /Invalid metric name/);
  assert.throws(() => reg.counter("1leading"), /Invalid metric name/);
});

test("invalid and reserved label names are rejected", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  const c = reg.counter("c");
  assert.throws(() => c.inc({ "bad-label": "x" }), /Invalid metric label name/);
  assert.throws(() => c.inc({ le: "x" }), /reserved/);
});

test("label values are escaped so they cannot break out of the label block", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  reg.counter("c").inc({ path: 'a"b\\c\nd' });
  const out = reg.render();
  assert.match(out, /\{path="a\\"b\\\\c\\nd"\}/);
});

test("HELP text escapes backslash and newline", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  reg.counter("c", "line1\nback\\slash").inc();
  assert.match(reg.render(), /# HELP daloy_c line1\\nback\\\\slash/);
});

test("re-registering a name with a different metric type throws", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  reg.counter("dup");
  assert.throws(() => reg.gauge("dup"), /different type/);
});

// ---------- cardinality cap ----------

test("per-metric series cap drops overflow and counts it", () => {
  const reg = new MetricsRegistry({ maxSeries: 2 });
  const c = reg.counter("c");
  c.inc({ id: "1" });
  c.inc({ id: "2" });
  c.inc({ id: "3" }); // dropped
  const out = reg.render();
  assert.match(out, /daloy_c\{id="1"\} 1/);
  assert.match(out, /daloy_c\{id="2"\} 1/);
  assert.doesNotMatch(out, /id="3"/);
  assert.match(out, /daloy_metrics_series_dropped_total 1/);
});

test("invalid maxSeries is rejected", () => {
  assert.throws(() => new MetricsRegistry({ maxSeries: 0 }), /positive integer/);
  assert.throws(() => new MetricsRegistry({ maxSeries: 1.5 }), /positive integer/);
});

// ---------- default / process metrics ----------

test("default metrics include process gauges on Node", () => {
  const reg = new MetricsRegistry();
  const out = reg.render();
  assert.match(out, /# TYPE daloy_process_resident_memory_bytes gauge/);
  assert.match(out, /# TYPE daloy_process_heap_used_bytes gauge/);
  assert.match(out, /daloy_process_uptime_seconds /);
});

test("collectDefaultMetrics:false omits process gauges and the dropped counter", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  reg.counter("only").inc();
  const out = reg.render();
  assert.doesNotMatch(out, /process_resident_memory_bytes/);
  assert.doesNotMatch(out, /metrics_series_dropped_total/);
});

test("collect callbacks run at render time", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  const g = reg.gauge("dynamic");
  let n = 0;
  reg.collect(() => g.set(undefined, ++n));
  reg.render();
  reg.render();
  assert.match(reg.render(), /\ndaloy_dynamic 3\n/);
});

test("reset clears recorded series but keeps definitions and handles valid", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  const c = reg.counter("c");
  c.inc();
  reg.reset();
  assert.doesNotMatch(reg.render(), /\ndaloy_c /);
  c.inc(undefined, 7);
  assert.match(reg.render(), /\ndaloy_c 7\n/);
});

test("custom prefix is applied to metric names", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false, prefix: "myapp_" });
  reg.counter("hits").inc();
  assert.match(reg.render(), /\nmyapp_hits 1\n/);
});

// ---------- httpMetrics middleware ----------

function pingApp(hook: ReturnType<typeof httpMetrics>): App {
  const app = new App({ env: "development" });
  app.use(hook);
  app.route({
    method: "GET",
    path: "/ping",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  return app;
}

test("httpMetrics records counter, duration, and balances in-flight", async () => {
  const reg = new MetricsRegistry();
  const app = pingApp(httpMetrics({ registry: reg }));
  const res = await app.fetch(new Request("http://x/ping"));
  assert.equal(res.status, 200);
  const out = reg.render();
  assert.match(out, /daloy_http_requests_total\{method="GET",route="\/ping",status="200"\} 1/);
  assert.match(out, /daloy_http_request_duration_seconds_count\{method="GET",route="\/ping"\} 1/);
  assert.match(out, /\ndaloy_http_requests_in_flight 0\n/);
});

test("httpMetrics custom route resolver controls the route label", async () => {
  const reg = new MetricsRegistry();
  const app = pingApp(httpMetrics({ registry: reg, route: () => "/ping/:id" }));
  await app.fetch(new Request("http://x/ping"));
  assert.match(reg.render(), /route="\/ping\/:id"/);
});

test("httpMetrics exclude predicate skips instrumentation but still balances in-flight", async () => {
  const reg = new MetricsRegistry();
  const app = pingApp(httpMetrics({ registry: reg, exclude: (p) => p === "/ping" }));
  await app.fetch(new Request("http://x/ping"));
  const out = reg.render();
  assert.doesNotMatch(out, /daloy_http_requests_total\{/);
  assert.match(out, /\ndaloy_http_requests_in_flight 0\n/);
});

test("default route label cardinality collapses overflow to <other>", async () => {
  const reg = new MetricsRegistry();
  const app = new App({ env: "development" });
  app.use(httpMetrics({ registry: reg, maxRouteCardinality: 1 }));
  app.route({
    method: "GET",
    path: "/a/:id",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: {} }),
  });
  await app.fetch(new Request("http://x/a/1"));
  await app.fetch(new Request("http://x/a/2"));
  const out = reg.render();
  assert.match(out, /route="\/a\/1"/);
  assert.match(out, /route="&lt;other&gt;"|route="<other>"/);
});

// ---------- app.metrics() route ----------

test("app.metrics() exposes Prometheus text and records matched routes", async () => {
  const app = new App({ env: "development" });
  app.metrics();
  app.route({
    method: "GET",
    path: "/ping",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  await app.fetch(new Request("http://x/ping"));
  const res = await app.fetch(new Request("http://x/metrics"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), PROMETHEUS_CONTENT_TYPE);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = await res.text();
  assert.match(body, /daloy_http_requests_total\{method="GET",route="\/ping",status="200"\} 1/);
  // The scrape route itself must be excluded from instrumentation.
  assert.doesNotMatch(body, /route="\/metrics"/);
});

test("app.metrics() renders custom metrics from a supplied registry", async () => {
  const registry = new MetricsRegistry();
  registry.counter("widgets_built_total", "Widgets.").inc({ kind: "a" }, 4);
  const app = new App({ env: "development" });
  app.metrics({ registry });
  const res = await app.fetch(new Request("http://x/metrics"));
  const body = await res.text();
  assert.match(body, /daloy_widgets_built_total\{kind="a"\} 4/);
});

test("app.metrics() enforces a bearer token (401 missing, 403 wrong, 200 correct)", async () => {
  const app = new App({ env: "development" });
  app.metrics({ token: "s3cret" });
  const missing = await app.fetch(new Request("http://x/metrics"));
  assert.equal(missing.status, 401);
  assert.equal(missing.headers.get("www-authenticate"), 'Bearer realm="metrics"');
  const wrong = await app.fetch(
    new Request("http://x/metrics", { headers: { authorization: "Bearer nope" } }),
  );
  assert.equal(wrong.status, 403);
  const ok = await app.fetch(
    new Request("http://x/metrics", { headers: { authorization: "Bearer s3cret" } }),
  );
  assert.equal(ok.status, 200);
});

test("app.metrics() rate-limits scrapes per IP", async () => {
  const app = new App({ env: "development" });
  app.metrics({ rateLimit: { limit: 1, windowMs: 60_000 } });
  const first = await app.fetch(new Request("http://x/metrics"));
  assert.equal(first.status, 200);
  const second = await app.fetch(new Request("http://x/metrics"));
  assert.equal(second.status, 429);
});

test("app.metrics() refuses to boot unauthenticated in production", () => {
  const app = new App({ env: "production" });
  assert.throws(() => app.metrics(), /refused in production/);
});

test("app.metrics() boots in production with a token or explicit acknowledgement", () => {
  const withToken = new App({ env: "production" });
  assert.doesNotThrow(() => withToken.metrics({ token: "t" }));
  const acked = new App({ env: "production" });
  assert.doesNotThrow(() => acked.metrics({ acknowledgeUnauthenticated: true }));
});

test("exported metric classes are the concrete handle types", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  assert.ok(reg.counter("a") instanceof Counter);
  assert.ok(reg.gauge("b") instanceof Gauge);
  assert.ok(reg.histogram("c") instanceof Histogram);
});

// ---------- additional happy paths ----------

test("counter inc with value 0 is allowed (not a negative increment) and creates the series at 0", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  const c = reg.counter("noop");
  assert.doesNotThrow(() => c.inc(undefined, 0));
  // inc(0) is permitted — the series is created at value 0.
  assert.match(reg.render(), /\ndaloy_noop 0\n/);
});

test("gauge dec produces a negative value (gauges are not bounded below zero)", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  const g = reg.gauge("temp");
  g.dec();
  assert.match(reg.render(), /\ndaloy_temp -1\n/);
});

test("histogram observation at exactly a bucket boundary counts as ≤ that bucket", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  const h = reg.histogram("lat", "Latency.", [0.1, 0.5, 1]);
  h.observe({}, 0.1); // exactly on the first boundary
  const out = reg.render();
  assert.match(out, /daloy_lat_bucket\{le="0.1"\} 1/);
  assert.match(out, /daloy_lat_bucket\{le="0.5"\} 1/);
  assert.match(out, /daloy_lat_bucket\{le="\+Inf"\} 1/);
  assert.match(out, /daloy_lat_count 1/);
});

test("histogram observation above all buckets lands only in +Inf", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  const h = reg.histogram("big", "Big values.", [0.1, 0.5]);
  h.observe({}, 99);
  const out = reg.render();
  assert.match(out, /daloy_big_bucket\{le="0.1"\} 0/);
  assert.match(out, /daloy_big_bucket\{le="0.5"\} 0/);
  assert.match(out, /daloy_big_bucket\{le="\+Inf"\} 1/);
});

test("MetricsRegistry with empty prefix emits bare metric names", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false, prefix: "" });
  reg.counter("bare_hits").inc();
  assert.match(reg.render(), /\nbare_hits 1\n/);
});

test("httpMetrics records 4xx and 5xx status codes in the requests counter", async () => {
  const reg = new MetricsRegistry();
  const app = new App({ env: "development" });
  app.use(httpMetrics({ registry: reg }));
  app.route({
    method: "GET",
    path: "/fail",
    responses: { 200: { description: "ok" }, 500: { description: "err" } },
    handler(): never {
      throw new Error("boom");
    },
  });
  const res = await app.fetch(new Request("http://x/fail"));
  assert.equal(res.status, 500);
  assert.match(reg.render(), /daloy_http_requests_total\{method="GET",route="\/fail",status="500"\} 1/);
});

test("httpMetrics records 404 from unmatched routes via the fallback route label", async () => {
  const reg = new MetricsRegistry();
  const app = new App({ env: "development" });
  app.use(httpMetrics({ registry: reg }));
  app.route({
    method: "GET",
    path: "/exists",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: {} }),
  });
  // Hit a route that does not exist — 404 takes the error path without ctx.
  const res = await app.fetch(new Request("http://x/nope"));
  assert.equal(res.status, 404);
  // httpMetrics onRequest is not invoked for unmatched routes (groupHooks
  // only wrap registered routes), so no counter sample is emitted.
  assert.doesNotMatch(reg.render(), /route="\/nope"/);
});

test("app.metrics() respects a custom path", async () => {
  const app = new App({ env: "development" });
  app.metrics({ path: "/internal/metrics" });
  const notFound = await app.fetch(new Request("http://x/metrics"));
  assert.equal(notFound.status, 404);
  const ok = await app.fetch(new Request("http://x/internal/metrics"));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), PROMETHEUS_CONTENT_TYPE);
});

test("app.metrics() with rateLimit:false allows unlimited scrapes", async () => {
  const app = new App({ env: "development" });
  app.metrics({ rateLimit: false });
  for (let i = 0; i < 5; i++) {
    const res = await app.fetch(new Request("http://x/metrics"));
    assert.equal(res.status, 200, `scrape ${i + 1} should succeed`);
  }
});

test("app.metrics() with custom buckets records durations in those buckets", async () => {
  const app = new App({ env: "development" });
  app.metrics({ buckets: [0.001, 0.01, 0.1] });
  app.route({
    method: "GET",
    path: "/ping",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: {} }),
  });
  await app.fetch(new Request("http://x/ping"));
  const res = await app.fetch(new Request("http://x/metrics"));
  const body = await res.text();
  // Custom buckets should appear in the output.
  assert.match(body, /le="0.001"/);
  assert.match(body, /le="0.01"/);
  assert.match(body, /le="0.1"/);
  // Default bucket boundaries that are NOT in our custom list must be absent.
  assert.doesNotMatch(body, /le="2.5"/);
});

test("app.metrics() exclude option skips RED instrumentation for matching paths", async () => {
  const app = new App({ env: "development" });
  app.metrics({ exclude: (p) => p.startsWith("/health") });
  app.route({
    method: "GET",
    path: "/health",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: {} }),
  });
  app.route({
    method: "GET",
    path: "/api",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: {} }),
  });
  await app.fetch(new Request("http://x/health"));
  await app.fetch(new Request("http://x/api"));
  const res = await app.fetch(new Request("http://x/metrics"));
  const body = await res.text();
  assert.doesNotMatch(body, /route="\/health"/);
  assert.match(body, /route="\/api"/);
});

// ---------- additional unhappy paths (bug-fix regressions) ----------

test("httpMetrics in-flight gauge is not decremented for OPTIONS preflight (bug-fix regression)", async () => {
  // An OPTIONS request to a path that has a GET handler but no OPTIONS handler
  // is handled by the framework's synthetic-204 path, which invokes
  // preflightHooks.onSend without a prior groupHook onRequest call. Before the
  // fix this drove the gauge negative; after the fix it stays at zero.
  const reg = new MetricsRegistry();
  const app = new App({ env: "development" });
  app.use(httpMetrics({ registry: reg }));
  app.route({
    method: "GET",
    path: "/data",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: {} }),
  });
  const res = await app.fetch(new Request("http://x/data", { method: "OPTIONS" }));
  assert.equal(res.status, 204);
  // Gauge must not go negative.
  assert.doesNotMatch(reg.render(), /daloy_http_requests_in_flight -\d/);
  // And no spurious requests_total entry for OPTIONS.
  assert.doesNotMatch(reg.render(), /method="OPTIONS"/);
});

test("httpMetrics in-flight stays balanced when OPTIONS preflight interleaves with real requests", async () => {
  const reg = new MetricsRegistry();
  const app = new App({ env: "development" });
  app.use(httpMetrics({ registry: reg }));
  app.route({
    method: "GET",
    path: "/api/v1/items",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: {} }),
  });
  // Mix: real GET, then OPTIONS preflight, then real GET again.
  await app.fetch(new Request("http://x/api/v1/items"));
  await app.fetch(new Request("http://x/api/v1/items", { method: "OPTIONS" }));
  await app.fetch(new Request("http://x/api/v1/items"));
  const out = reg.render();
  // Two real GET requests recorded.
  assert.match(out, /daloy_http_requests_total\{method="GET",route="\/api\/v1\/items",status="200"\} 2/);
  // In-flight at zero after all requests completed.
  assert.match(out, /\ndaloy_http_requests_in_flight 0\n/);
});

test("app.metrics() rate limit ignores spoofed X-Real-IP without trustProxy", async () => {
  const app = new App({ env: "development" });
  app.metrics({ rateLimit: { limit: 1, windowMs: 60_000 } });
  const first = await app.fetch(
    new Request("http://x/metrics", { headers: { "x-real-ip": "1.1.1.1" } }),
  );
  assert.equal(first.status, 200);
  // Different spoofed IP must still share the global bucket when trustProxy is unset.
  const second = await app.fetch(
    new Request("http://x/metrics", { headers: { "x-real-ip": "2.2.2.2" } }),
  );
  assert.equal(second.status, 429);
});

test("app.metrics() rate limit may key on X-Real-IP when trustProxy is true", async () => {
  const app = new App({ env: "development", trustProxy: true });
  app.metrics({ rateLimit: { limit: 1, windowMs: 60_000 } });
  const a = await app.fetch(
    new Request("http://x/metrics", { headers: { "x-real-ip": "1.1.1.1" } }),
  );
  assert.equal(a.status, 200);
  const b = await app.fetch(
    new Request("http://x/metrics", { headers: { "x-real-ip": "2.2.2.2" } }),
  );
  assert.equal(b.status, 200, "distinct trusted-proxy client IPs get distinct buckets");
  const a2 = await app.fetch(
    new Request("http://x/metrics", { headers: { "x-real-ip": "1.1.1.1" } }),
  );
  assert.equal(a2.status, 429);
});
