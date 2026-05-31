import { CodeBlock } from "../../../components/code-block";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Metrics & the /metrics endpoint",
  description:
    "Expose Prometheus / OpenMetrics from your DaloyJS app: a dependency-free metrics registry (counters, gauges, histograms), RED instrumentation for every route, and an opt-in, auth-guarded /metrics scrape route that inherits the same hardened posture as app.healthcheck().",
  path: "/docs/metrics",
  keywords: [
    "Prometheus",
    "OpenMetrics",
    "/metrics endpoint",
    "RED metrics",
    "DaloyJS metrics",
    "MetricsRegistry",
    "httpMetrics",
    "histogram",
    "request duration",
    "observability",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>
        Metrics &amp; the <code>/metrics</code> endpoint
      </h1>
      <p>
        Metrics are the third observability pillar alongside the structured{" "}
        <strong>logger</strong> and the OpenTelemetry-compatible{" "}
        <strong>tracer</strong>. As of <strong>0.37.0</strong> DaloyJS ships a{" "}
        <strong>dependency-free</strong> Prometheus / OpenMetrics stack: a
        metrics registry (counters, gauges, histograms), RED (Rate / Errors /
        Duration) instrumentation for every route, and an opt-in,{" "}
        <strong>auth-guarded</strong> <code>/metrics</code> scrape route that
        inherits the same hardened posture as <code>app.healthcheck()</code>.
      </p>
      <p>
        Everything is built on Web-standard primitives (plus optional{" "}
        <code>process.*</code> gauges guarded for non-Node runtimes), so it runs
        unchanged on Node, Bun, Deno, Cloudflare Workers, and Vercel Edge.
      </p>

      <h2>Quick start</h2>
      <p>
        Call <code>app.metrics()</code> <strong>before</strong> registering the
        routes you want measured. It installs RED instrumentation and registers
        the scrape route in one step.
      </p>
      <CodeBlock
        code={`import { App } from "@daloyjs/core";

const app = new App();

// Install instrumentation + the scrape route BEFORE your routes.
app.metrics({ token: process.env.METRICS_TOKEN });

app.route({
  method: "GET",
  path: "/books",
  operationId: "listBooks",
  responses: { 200: { description: "ok" } },
  handler: () => ({ status: 200 as const, body: { items: [] } }),
});

// GET /metrics  (Authorization: Bearer <METRICS_TOKEN>)
// # TYPE daloy_http_requests_total counter
// daloy_http_requests_total{method="GET",route="/books",status="200"} 1
// # TYPE daloy_http_request_duration_seconds histogram
// daloy_http_request_duration_seconds_bucket{method="GET",route="/books",le="0.005"} 1
// ...`}
        language="ts"
      />
      <p>
        Because the instrumentation is installed as a group hook, it only wraps
        routes registered <em>after</em> the <code>app.metrics()</code> call —
        the same ordering rule as any <code>app.use(...)</code> middleware.
      </p>

      <h2>What gets exported</h2>
      <p>Out of the box, the scrape route exposes:</p>
      <ul>
        <li>
          <code>daloy_http_requests_total{`{method,route,status}`}</code> — a
          request counter (rate; the error rate is the subset with a{" "}
          <code>4xx</code>/<code>5xx</code> status).
        </li>
        <li>
          <code>daloy_http_request_duration_seconds{`{method,route}`}</code> — a
          latency histogram with conventional Prometheus buckets.
        </li>
        <li>
          <code>daloy_http_requests_in_flight</code> — a gauge of
          concurrently-handled requests.
        </li>
        <li>
          process gauges (<code>daloy_process_resident_memory_bytes</code>,{" "}
          <code>daloy_process_heap_used_bytes</code>,{" "}
          <code>daloy_process_uptime_seconds</code>) collected at scrape time on
          Node-like runtimes.
        </li>
      </ul>

      <h2>The route label</h2>
      <p>
        High-cardinality labels are the classic way to melt a Prometheus server.
        By default the <code>route</code> label uses the request pathname,
        capped at <code>maxRouteCardinality</code> (100) distinct values before
        further paths collapse to <code>&lt;other&gt;</code>. For templated
        routes, supply a resolver that returns the route{" "}
        <strong>template</strong>:
      </p>
      <CodeBlock
        code={`app.metrics({
  token: process.env.METRICS_TOKEN,
  // Group "/books/1", "/books/2", ... into a single series.
  route: (ctx) => new URL(ctx.request.url).pathname.replace(/\\/books\\/[^/]+/, "/books/:id"),
});`}
        language="ts"
      />

      <h2>Custom application metrics</h2>
      <p>
        Pass your own <code>MetricsRegistry</code> to register business metrics
        that render alongside the built-in HTTP series.
      </p>
      <CodeBlock
        code={`import { App, MetricsRegistry } from "@daloyjs/core";

const registry = new MetricsRegistry();
const ordersPlaced = registry.counter("orders_placed_total", "Orders placed.");
const queueDepth = registry.gauge("job_queue_depth", "Pending jobs.");
const renderTime = registry.histogram(
  "render_seconds",
  "Template render time.",
  [0.001, 0.01, 0.1, 1],
);

const app = new App();
app.metrics({ registry, token: process.env.METRICS_TOKEN });

// Later, from your handlers / workers:
ordersPlaced.inc({ channel: "web" });
queueDepth.set(undefined, 12);
renderTime.observe({ template: "invoice" }, 0.042);`}
        language="ts"
      />
      <p>
        Use <code>registry.collect(fn)</code> to refresh point-in-time gauges
        (queue depth, connection-pool size) only when the endpoint is actually
        scraped, instead of on a timer.
      </p>

      <h2>Manual instrumentation</h2>
      <p>
        Prefer to wire the pieces yourself? <code>httpMetrics()</code> returns a{" "}
        <code>Hooks</code> bundle you can <code>app.use(...)</code> without the
        built-in scrape route — render the registry from your own handler.
      </p>
      <CodeBlock
        code={`import { App, MetricsRegistry, httpMetrics } from "@daloyjs/core";

const registry = new MetricsRegistry();
const app = new App();
app.use(httpMetrics({ registry, maxRouteCardinality: 50 }));

app.route({
  method: "GET",
  path: "/metrics",
  responses: { 200: { description: "ok" } },
  handler: () => ({
    status: 200 as const,
    body: registry.render(),
    headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" },
  }),
});`}
        language="ts"
      />

      <h2>Security posture</h2>
      <p>
        A <code>/metrics</code> endpoint leaks internal route names, latency
        distributions, request volume, and process memory — so it ships with the
        same hardened defaults as <code>app.healthcheck()</code>:
      </p>
      <ul>
        <li>
          <strong>Bearer token</strong> (<code>opts.token</code>) compared with{" "}
          <code>timingSafeEqual</code>. Missing token is a <code>401</code> with{" "}
          <code>WWW-Authenticate</code>; wrong token is a <code>403</code>.
        </li>
        <li>
          <strong>Per-IP rate limit</strong> (default{" "}
          <code>{`{ limit: 60, windowMs: 60_000 }`}</code>) returning{" "}
          <code>429</code> with <code>Retry-After</code> on overflow. Pass{" "}
          <code>rateLimit: false</code> to disable.
        </li>
        <li>
          <strong>Refuse-to-boot</strong>: an unauthenticated scrape endpoint in
          production throws at registration unless you set a token or explicitly
          pass <code>acknowledgeUnauthenticated: true</code>.
        </li>
        <li>
          <strong>Cardinality cap</strong>: every metric is bounded by{" "}
          <code>maxSeries</code> (default 5000); overflowing label combinations
          are dropped and counted in{" "}
          <code>daloy_metrics_series_dropped_total</code>, a memory-exhaustion
          defense.
        </li>
        <li>
          <strong>Exposition-injection defense</strong>: metric and label names
          are validated against the Prometheus grammar at definition time, and
          label values escape <code>\\</code>, <code>&quot;</code>, and newlines
          so a hostile value cannot forge extra samples.
        </li>
      </ul>
      <p>
        In most deployments you should also scope the scrape endpoint to your
        monitoring network at the ingress/firewall layer in addition to the
        bearer token.
      </p>
    </>
  );
}
