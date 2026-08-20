import { CodeBlock } from "../../../components/code-block";
import { FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "OTLP export (OpenTelemetry push)",
  description:
    "Push logs and OTel semantic-convention HTTP metrics to an OpenTelemetry collector with zero dependencies. One App option reads the standard OTEL_EXPORTER_OTLP_* variables; standalone exporters cover custom signals.",
  path: "/docs/otlp",
  keywords: [
    "OTLP",
    "OpenTelemetry",
    "collector",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "http.server.request.duration",
    "semantic conventions",
    "DaloyJS observability",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>OTLP export (OpenTelemetry push)</h1>
      <p>
        Many container platforms run an in-cluster OpenTelemetry collector and
        expect workloads to <strong>push</strong> telemetry: they inject the
        standard{" "}
        <code>OTEL_EXPORTER_OTLP_ENDPOINT</code> /{" "}
        <code>OTEL_EXPORTER_OTLP_HEADERS</code> /{" "}
        <code>OTEL_RESOURCE_ATTRIBUTES</code> / <code>OTEL_SERVICE_NAME</code>{" "}
        variables into every container and scrape nothing, not stdout and not a{" "}
        <code>/metrics</code> route. On such platforms, one App option turns on
        a dependency-free OTLP/HTTP pipeline:
      </p>

      <CodeBlock
        code={`import { App } from "@daloyjs/core";

const app = new App({
  telemetry: true,
});`}
      />

      <p>
        That flag tees the app logger&apos;s output to the collector as OTLP
        logs and records{" "}
        <a href="https://opentelemetry.io/docs/specs/semconv/http/http-metrics/">
          <code>http.server.request.duration</code>
        </a>{" "}
        per the OTel HTTP semantic conventions. With no endpoint configured it
        is a silent no-op, so it is safe to keep enabled in development. No
        OTel SDK, no loader hooks, no runtime dependencies.
      </p>

      <FlowDiagram
        title="Push pipeline"
        numbered
        caption="The logger write sink and the semconv HTTP hook feed two batched exporters. Both post OTLP/HTTP JSON to the collector named by the platform-injected environment variables; the collector fans out to Loki-style log stores and Mimir/Prometheus-style metric stores."
        steps={[
          {
            label: "OTEL_* env vars",
            eyebrow: "platform-injected",
            detail: "endpoint, tenant headers, resource attributes",
          },
          {
            label: "logger + hooks",
            detail: "log lines tee; http.server.request.duration per request",
            tone: "accent",
          },
          {
            label: "batched exporters",
            detail: "OTLP/HTTP JSON: /v1/logs and /v1/metrics",
          },
          {
            label: "collector",
            detail: "routes on tenant headers, converts, forwards",
          },
          {
            label: "Grafana",
            eyebrow: "standard dashboards",
            detail: "semconv names and buckets work unchanged",
            tone: "success",
          },
        ]}
      />

      <h2 id="what-gets-exported">What gets exported</h2>
      <ul>
        <li>
          <strong>Logs</strong>: every line the app logger writes. JSON lines
          are decomposed into an OTLP record: <code>msg</code> /{" "}
          <code>message</code> / <code>event</code> becomes the body,{" "}
          <code>level</code> maps to the OTLP severity, and remaining fields
          ship as attributes (structured metadata in Loki-style backends).
          Non-JSON lines ship verbatim.
        </li>
        <li>
          <strong><code>http.server.request.duration</code></strong>: a
          histogram with the spec bucket boundaries and attributes{" "}
          <code>http.request.method</code> (normalized to the well-known set,
          else <code>_OTHER</code>), <code>http.route</code> (the matched route{" "}
          <em>template</em>, e.g. <code>/books/:id</code>, from{" "}
          <code>ctx.routePath</code>), <code>http.response.status_code</code>,{" "}
          <code>url.scheme</code>, and <code>error.type</code> on{" "}
          <code>5xx</code>. Unmatched 404s record nothing (the 404 fast path
          builds no request context), so raw paths can never mint metric
          series.
        </li>
      </ul>

      <h2 id="configuration">Configuration</h2>
      <p>
        Everything defaults from the standard environment variables. Override
        per signal or per exporter:
      </p>
      <CodeBlock
        code={`const app = new App({
  telemetry: {
    logs: true, // tee the app logger to OTLP (default true)
    metrics: true, // semconv HTTP metrics (default true)
    exporter: {
      // all optional; defaults from OTEL_EXPORTER_OTLP_* env vars
      endpoint: "http://collector.internal:4318",
      headers: { tenant_id: "acme-prod" },
      resourceAttributes: { "service.name": "orders-api" },
      flushIntervalMs: 15_000,
    },
  },
});

// flush on demand (also flushed automatically on shutdown)
await app.telemetry?.flush();`}
      />
      <p>
        The conventional injected endpoint is the gRPC form
        (<code>http://host:4317</code>); a trailing <code>:4317</code> is
        rewritten to <code>:4318</code>, the collector&apos;s OTLP/HTTP port.
        Header values often carry multi-tenant routing credentials; DaloyJS
        never logs them. Spec values are percent-encoded (
        <code>tenant_id=a%2Cb</code> arrives as <code>a,b</code>).
      </p>

      <h2 id="fail-safety">Fail-safe by contract</h2>
      <ul>
        <li>
          A dead or misconfigured collector never affects request serving:
          export errors are swallowed and counted in{" "}
          <code>droppedBatches</code>. That counter mixes overflowed log
          lines, failed POSTs, and series refused at the cardinality cap, so
          do not treat it as &quot;POSTs that failed&quot; alone.
        </li>
        <li>
          Every export POST is aborted after 5 seconds (override with{" "}
          <code>exporter.flushTimeoutMs</code>) so a blackholed collector
          cannot latch the flusher forever. Redirects are refused, so tenant
          headers cannot follow a 302 off-box.
        </li>
        <li>
          The log queue is bounded (drop-oldest); metric series are capped and
          attribute values length-truncated, so hostile cardinality cannot grow
          memory.
        </li>
        <li>
          Metrics use <em>cumulative</em> temporality: totals survive a failed
          push and the next successful push carries them.
        </li>
      </ul>

      <h2 id="standalone">Standalone exporters</h2>
      <p>
        The pieces compose individually from{" "}
        <code>@daloyjs/core/otlp</code> for custom signals, for example
        domain-specific counters next to the built-in HTTP histogram:
      </p>
      <CodeBlock
        code={`import {
  createOtlpMetricsExporter,
  semconvHttpMetrics,
} from "@daloyjs/core/otlp";

const metrics = createOtlpMetricsExporter(); // null without an endpoint

// business counters with your own names and attributes
metrics?.count("orders_placed_total", { plan: "pro" });
metrics?.record("checkout_amount", { currency: "USD" }, 129.99, {
  unit: "1",
  boundaries: [10, 50, 100, 500, 1000],
});

// or install just the semconv HTTP hook on an existing app
const app = new App({ hooks: metrics ? semconvHttpMetrics(metrics) : {} });`}
      />

      <h2 id="serverless">Serverless and isolate runtimes</h2>
      <p>
        Long-lived Node, Bun, and Deno processes flush on an{" "}
        <code>unref</code>&apos;d interval and again on graceful shutdown.
        Cloudflare Workers, Vercel isolates, and AWS Lambda freeze when the
        handler returns, so the interval never runs. Use the adapters:
      </p>
      <ul>
        <li>
          <code>toFetchHandler</code> from{" "}
          <code>@daloyjs/core/cloudflare</code> calls{" "}
          <code>ctx.waitUntil(app.telemetry.flush())</code> after each
          request.
        </li>
        <li>
          <code>toFetchHandler</code> / <code>toWebHandler</code> from{" "}
          <code>@daloyjs/core/vercel</code> uses{" "}
          <code>globalThis.waitUntil</code> when the runtime provides it.
        </li>
        <li>
          <code>toLambdaHandler</code> awaits the flush before returning, so
          the export is billed as part of the invocation.
        </li>
      </ul>
      <p>
        Workers without <code>nodejs_compat</code> cannot read{" "}
        <code>process.env</code>. Pass{" "}
        <code>telemetry: {"{ exporter: { endpoint, headers } }"}</code> from
        the Worker bindings instead of relying on <code>OTEL_*</code>.
      </p>

      <h2 id="limits">What this does not do</h2>
      <ul>
        <li>
          A caller-supplied <code>Logger</code> instance (pino, winston, a
          custom sink) is not intercepted. Tee it yourself with{" "}
          <code>createOtlpLogExporter</code> and your logger&apos;s write
          hook. The built-in logger, or <code>{"{ level }"}</code>, is teed
          automatically.
        </li>
        <li>
          Export uses raw <code>fetch</code>, not <code>fetchGuard</code>.
          The collector URL is operator config (the same trust class as a
          database URL), and in-cluster collectors are typically private
          IPs that SSRF defaults would refuse.
        </li>
        <li>
          There is no OTLP trace export yet. Keep using{" "}
          <a href="/docs/tracing">
            <code>otelTracing()</code>
          </a>{" "}
          with a bring-your-own tracer.
        </li>
        <li>
          Calling <code>app.fetch</code> directly on an isolate, skipping
          the adapter, will queue telemetry and mostly never send it. Use{" "}
          <code>toFetchHandler</code> / <code>toLambdaHandler</code>, or
          call <code>await app.telemetry.flush()</code> yourself.
        </li>
      </ul>

      <h2 id="relationship">Pull vs push, and tracing</h2>
      <ul>
        <li>
          <a href="/docs/metrics">
            <code>app.metrics()</code> (Prometheus)
          </a>{" "}
          is the <em>pull</em> pillar: a scrape endpoint with Prometheus
          naming. Use it when something scrapes you. Use <code>telemetry</code>{" "}
          when a collector expects pushes. They coexist; the{" "}
          <code>httpMetrics()</code> route label also benefits from{" "}
          <code>ctx.routePath</code> now.
        </li>
        <li>
          <a href="/docs/tracing">
            <code>otelTracing()</code>
          </a>{" "}
          remains the tracing pillar (bring your own tracer). OTLP trace export
          is a planned follow-up.
        </li>
      </ul>

      <h2 id="grafana">Querying in Grafana</h2>
      <p>
        After the collector&apos;s Prometheus conversion the histogram appears
        as <code>http_server_request_duration_seconds_*</code>:
      </p>
      <CodeBlock
        language="promql"
        code={`# p95 latency per route
histogram_quantile(0.95, sum by (http_route, le) (
  rate(http_server_request_duration_seconds_bucket[5m])
))

# request volume by status
sum by (http_response_status_code) (
  rate(http_server_request_duration_seconds_count[5m])
)`}
      />
    </>
  );
}
