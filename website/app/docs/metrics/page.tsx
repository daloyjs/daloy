import { CodeBlock } from "../../../components/code-block";
import { FlowDiagram } from "../../../components/diagram";

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
        <strong>tracer</strong>. DaloyJS ships a{" "}
        <strong>dependency-free</strong> Prometheus / OpenMetrics stack: a
        metrics registry (counters, gauges, histograms), RED (Rate / Errors /
        Duration) instrumentation for every route, and an opt-in,{" "}
        <strong>auth-guarded</strong> <code>/metrics</code> scrape route that
        inherits the same hardened posture as <code>app.healthcheck()</code>.
      </p>
      <p>
        Everything is built on Web-standard primitives (plus optional{" "}
        <code>process.*</code> gauges guarded for non-Node runtimes), so it runs
        unchanged on Node, Bun, Deno, Cloudflare Workers, and Vercel.
      </p>

      <FlowDiagram
        title="From request to scrape"
        numbered
        caption="RED instrumentation records counters and the latency histogram for routes registered after app.metrics(), the registry accumulates the series, then a Prometheus scrape hits the auth-guarded, rate-limited /metrics route and gets the rendered exposition text."
        steps={[
          {
            label: "Request handled",
            detail: "RED hook installed by app.metrics()",
          },
          {
            label: "Record series",
            detail: "requests_total, request_duration_seconds, in_flight",
            tone: "accent",
          },
          {
            label: "Registry accumulates",
            detail: "low-cardinality {method, route, status} labels",
          },
          {
            label: "Prometheus scrapes",
            detail: "GET /metrics, Bearer token + per-IP rate limit",
          },
          {
            label: "Exposition rendered",
            eyebrow: "text/plain",
            detail: "registry.render() to OpenMetrics",
            tone: "success",
          },
        ]}
      />

      <h2>Quick start</h2>
      <p>
        Call <code>app.metrics()</code> <strong>before</strong> registering the
        routes you want measured. It installs RED instrumentation for later
        routes and registers the scrape route in one step.
      </p>
      <CodeBlock
        code={`import { App } from "@daloyjs/core";
import { z } from "zod";

const app = new App();

// Install instrumentation + the scrape route BEFORE your routes.
app.metrics({ token: process.env.METRICS_TOKEN! });

const BooksResponse = z.object({
  items: z.array(z.object({ id: z.string(), title: z.string() })),
});

app.route({
  method: "GET",
  path: "/books",
  operationId: "listBooks",
  responses: { 200: { description: "ok", body: BooksResponse } },
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
        matched routes registered <em>after</em> the <code>app.metrics()</code>{" "}
        call, the same ordering rule as any <code>app.use(...)</code>{" "}
        middleware. Unmatched <code>404</code> paths and synthetic{" "}
        <code>OPTIONS</code> preflights are not counted.
      </p>

      <h2>What gets exported</h2>
      <p>Out of the box, the scrape route exposes:</p>
      <ul>
        <li>
          <code>daloy_http_requests_total{`{method,route,status}`}</code>: a
          request counter (rate; the error rate is the subset with a{" "}
          <code>4xx</code>/<code>5xx</code> status).
        </li>
        <li>
          <code>daloy_http_request_duration_seconds{`{method,route}`}</code>: a
          latency histogram with conventional Prometheus buckets.
        </li>
        <li>
          <code>daloy_http_requests_in_flight</code>: a gauge of
          concurrently-handled requests.
        </li>
        <li>
          process gauges (<code>daloy_process_resident_memory_bytes</code>,{" "}
          <code>daloy_process_heap_used_bytes</code>,{" "}
          <code>daloy_process_uptime_seconds</code>) collected at scrape time on
          Node-like runtimes.
        </li>
      </ul>

      <h2>Options reference</h2>
      <p>
        All fields are optional. The table below covers the full{" "}
        <code>MetricsRouteOptions</code> surface:
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Option</th>
              <th>Type</th>
              <th>Default</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>path</code>
              </td>
              <td>
                <code>string</code>
              </td>
              <td>
                <code>&quot;/metrics&quot;</code>
              </td>
              <td>Override the scrape endpoint path.</td>
            </tr>
            <tr>
              <td>
                <code>token</code>
              </td>
              <td>
                <code>string</code>
              </td>
              <td>-</td>
              <td>
                Require <code>Authorization: Bearer &lt;token&gt;</code>,
                compared via <code>timingSafeEqual</code>. Required in
                production unless <code>acknowledgeUnauthenticated</code> is
                set.
              </td>
            </tr>
            <tr>
              <td>
                <code>rateLimit</code>
              </td>
              <td>
                <code>{`{ limit?, windowMs? }`} | false`</code>
              </td>
              <td>
                <code>{`{ limit: 60, windowMs: 60_000 }`}</code>
              </td>
              <td>
                Per-IP fixed-window rate limit. Pass <code>false</code> to
                disable entirely (useful inside private VPC networks).
              </td>
            </tr>
            <tr>
              <td>
                <code>registry</code>
              </td>
              <td>
                <code>MetricsRegistry</code>
              </td>
              <td>fresh registry</td>
              <td>
                Bring your own registry to co-render business metrics alongside
                the built-in HTTP series.
              </td>
            </tr>
            <tr>
              <td>
                <code>route</code>
              </td>
              <td>
                <code>(ctx) =&gt; string | undefined</code>
              </td>
              <td>pathname (capped)</td>
              <td>
                Resolve the low-cardinality <code>route</code> label. Always
                prefer the route template over the raw pathname.
              </td>
            </tr>
            <tr>
              <td>
                <code>maxRouteCardinality</code>
              </td>
              <td>
                <code>number</code>
              </td>
              <td>
                <code>100</code>
              </td>
              <td>
                Hard cap on distinct pathname-derived route labels. Overflow
                collapses to <code>&lt;other&gt;</code>.
              </td>
            </tr>
            <tr>
              <td>
                <code>buckets</code>
              </td>
              <td>
                <code>number[]</code>
              </td>
              <td>conventional Prometheus defaults</td>
              <td>Custom latency histogram bucket boundaries in seconds.</td>
            </tr>
            <tr>
              <td>
                <code>exclude</code>
              </td>
              <td>
                <code>(path: string) =&gt; boolean</code>
              </td>
              <td>-</td>
              <td>
                Skip RED instrumentation for matching paths (e.g. health
                probes). The scrape path itself is always excluded
                automatically.
              </td>
            </tr>
            <tr>
              <td>
                <code>acknowledgeUnauthenticated</code>
              </td>
              <td>
                <code>boolean</code>
              </td>
              <td>
                <code>false</code>
              </td>
              <td>
                Opt-in bypass for the production refuse-to-boot guard when you
                intentionally run without a token (e.g. behind a private load
                balancer).
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <CodeBlock
        code={`app.metrics({
  path: "/internal/metrics",
  token: process.env.METRICS_TOKEN!,
  rateLimit: false,            // safe inside a private VPC
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.5, 1],
  exclude: (p) => p === "/healthz" || p === "/readyz",
  maxRouteCardinality: 50,
});`}
        language="ts"
      />

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
  token: process.env.METRICS_TOKEN!,
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
app.metrics({ registry, token: process.env.METRICS_TOKEN! });

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
        built-in scrape route, then render the registry from your own handler.
      </p>
      <CodeBlock
        code={`import {
  App,
  MetricsRegistry,
  PROMETHEUS_CONTENT_TYPE,
  httpMetrics,
} from "@daloyjs/core";
import { z } from "zod";

const registry = new MetricsRegistry();
const app = new App();
app.use(httpMetrics({
  registry,
  maxRouteCardinality: 50,
  exclude: (path) => path === "/metrics",
}));

app.route({
  method: "GET",
  path: "/metrics",
  responses: { 200: { description: "ok", body: z.string() } },
  handler: () => ({
    status: 200 as const,
    body: registry.render(),
    headers: {
      "content-type": PROMETHEUS_CONTENT_TYPE,
      "cache-control": "no-store",
    },
  }),
});`}
        language="ts"
      />

      <h2>Grafana + Prometheus integration</h2>
      <p>
        The repository ships a ready-to-use Docker Compose stack under{" "}
        <code>examples/observability/</code> that spins up Prometheus and
        Grafana with a pre-built dashboard, zero extra configuration needed.
      </p>
      <h3>1. Start the app</h3>
      <p>
        Run any DaloyJS server that calls <code>app.metrics()</code>. The
        example in the repo uses port 3001:
      </p>
      <CodeBlock
        code={`node --import tsx examples/metrics-demo.ts
# DaloyJS metrics demo running at http://localhost:3001
# Prometheus scrape target: http://localhost:3001/metrics`}
        language="sh"
      />
      <h3>2. Start the observability stack</h3>
      <CodeBlock
        code={`docker compose -f examples/observability/docker-compose.yml up`}
        language="sh"
      />
      <p>This brings up:</p>
      <ul>
        <li>
          <strong>Prometheus</strong> at <code>http://localhost:9090</code>,
          pre-configured to scrape{" "}
          <code>host.docker.internal:3001/metrics</code> every 10 seconds.
        </li>
        <li>
          <strong>Grafana</strong> at <code>http://localhost:3000</code> (admin
          / admin). Prometheus datasource and the DaloyJS dashboard are
          auto-provisioned on first start, no manual import required.
        </li>
      </ul>
      <h3>3. Open the dashboard</h3>
      <p>
        Navigate to <code>http://localhost:3000/d/daloy-http-metrics</code>. The
        dashboard ships nine panels out of the box:
      </p>
      <ul>
        <li>Request rate by route</li>
        <li>Error rate (4xx / 5xx)</li>
        <li>Latency percentiles (p50 / p95 / p99)</li>
        <li>In-flight requests</li>
        <li>Request rate by method</li>
        <li>Business metric panel (orders created, from the demo)</li>
        <li>Memory usage (RSS + heap)</li>
        <li>Process uptime</li>
        <li>Request duration heatmap</li>
      </ul>
      <h3>Pointing at your own app</h3>
      <p>
        Edit <code>examples/observability/prometheus.yml</code> and replace the
        target:
      </p>
      <CodeBlock
        code={`scrape_configs:
  - job_name: my_app
    static_configs:
      - targets:
          - "host.docker.internal:3000"   # your app port
    metrics_path: /metrics                # or /internal/metrics etc.
    scrape_interval: 15s`}
        language="yaml"
      />
      <p>If your app requires a bearer token, add it as a HTTP header:</p>
      <CodeBlock
        code={`scrape_configs:
  - job_name: my_app
    static_configs:
      - targets: ["host.docker.internal:3000"]
    authorization:
      credentials: \${METRICS_TOKEN}`}
        language="yaml"
      />
      <p>
        On Linux you may need to replace <code>host.docker.internal</code> with
        your host IP address, or add{" "}
        <code>
          extra_hosts: - &quot;host.docker.internal:host-gateway&quot;
        </code>{" "}
        to the Prometheus service in{" "}
        <code>examples/observability/docker-compose.yml</code>.
      </p>
      <h3>Useful PromQL queries</h3>
      <CodeBlock
        code={`# Request rate (req/s) by route over the last 5 minutes
sum by (route) (rate(daloy_http_requests_total[5m]))

# 5xx error rate as a fraction
sum(rate(daloy_http_requests_total{status=~"5.."}[5m]))
  / sum(rate(daloy_http_requests_total[5m]))

# p99 latency per route
histogram_quantile(0.99,
  sum by (le, route) (rate(daloy_http_request_duration_seconds_bucket[5m]))
)

# Currently in-flight requests
daloy_http_requests_in_flight`}
        language="promql"
      />

      <h2>Security posture</h2>
      <p>
        A <code>/metrics</code> endpoint leaks internal route names, latency
        distributions, request volume, and process memory, so it ships with the
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
