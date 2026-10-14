import { test } from "node:test";
import assert from "node:assert/strict";
import { App, MetricsRegistry, httpMetrics } from "../src/index.js";

test("counter and histogram reject non-finite values instead of poisoning the series", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  const c = reg.counter("c_total");
  const h = reg.histogram("h_seconds", "h", [1]);
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.throws(() => c.inc(undefined, bad), /finite/);
    assert.throws(() => h.observe(undefined, bad), /finite/);
  }
  // Happy path still works, and nothing bad was recorded.
  c.inc();
  h.observe(undefined, 0.5);
  const out = reg.render();
  assert.match(out, /\nc_total 1\n/);
  assert.match(out, /\nh_seconds_sum 0\.5\n/);
  assert.doesNotMatch(out, /NaN|Infinity/);
});

test("httpMetrics installed globally keeps in-flight balanced on 404, 405 and cross-origin 403 (regression)", async () => {
  const reg = new MetricsRegistry();
  const app = new App({ env: "development", hooks: httpMetrics({ registry: reg }) });
  app.route({
    method: "POST",
    path: "/x",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: {} }),
  });
  assert.equal((await app.request("/nope")).status, 404);
  assert.equal((await app.request("/x")).status, 405);
  const rejected = await app.request("/x", {
    method: "POST",
    headers: { origin: "https://evil.example" },
  });
  assert.equal(rejected.status, 403);
  const out = reg.render();
  assert.match(out, /\nhttp_requests_in_flight 0\n/);
  assert.match(out, /status="403"\} 1/);
  assert.match(out, /status="404"\} 1/);
});

test("httpMetrics exclude still sees the pathname after the lazy URL parse", async () => {
  const reg = new MetricsRegistry();
  const seen: string[] = [];
  const app = new App({ env: "development" });
  app.use(
    httpMetrics({
      registry: reg,
      exclude: (p) => {
        seen.push(p);
        return p === "/skip";
      },
    }),
  );
  for (const path of ["/skip", "/keep"]) {
    app.route({
      method: "GET",
      path: path as "/skip",
      responses: { 200: { description: "ok" } },
      handler: () => ({ status: 200 as const, body: {} }),
    });
  }
  await app.request("/skip?x=1");
  await app.request("/keep");
  assert.deepEqual(seen, ["/skip", "/keep"]);
  const out = reg.render();
  assert.match(out, /route="\/keep"/);
  assert.doesNotMatch(out, /route="\/skip"/);
});
