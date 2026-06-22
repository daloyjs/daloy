import { CodeBlock } from "../../../components/code-block";
import { FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Tracing with OpenTelemetry",
  description:
    "Instrument DaloyJS apps with OpenTelemetry-compatible spans. The otelTracing helper produces a Hooks object that starts a SERVER span per request, attaches HTTP semantic-convention attributes (including http.route automatically), exposes the span on ctx.state, and ends it when the response is sent.",
  path: "/docs/tracing",
  keywords: [
    "OpenTelemetry",
    "tracing",
    "spans",
    "otelTracing",
    "DaloyJS observability",
    "OTel",
    "http.route",
    "redactQuery",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Tracing with OpenTelemetry</h1>
      <p>
        DaloyJS ships <code>otelTracing(opts)</code>, a hook factory that
        produces a <code>Hooks</code> object compatible with{" "}
        <a href="https://www.npmjs.com/package/@opentelemetry/api">
          <code>@opentelemetry/api</code>
        </a>
        . It starts a <strong>SERVER-kind span</strong> per HTTP
        request, attaches the standard{" "}
        <a href="https://opentelemetry.io/docs/specs/semconv/http/http-spans/">
          HTTP semantic-convention attributes
        </a>
        , exposes the span on <code>ctx.state</code> for handlers, and ends the
        span exactly once when the response is sent.
      </p>
      <p>
        The framework <strong>does not depend on</strong>{" "}
        <code>@opentelemetry/api</code>. You pass any tracer that implements the
        minimal <code>TracingTracer</code> interface, so the same hook works on
        Node with the OTel SDK, on Workers with a custom exporter, or in tests
        with an in-memory fake.
      </p>

      <FlowDiagram
        title="One span per request"
        numbered
        caption="The hook starts a SERVER span on onRequest, then stamps http.route and renames the span in beforeHandle once the router has matched the route template. The span is exposed on ctx.state for handlers, then ended exactly once on onSend."
        steps={[
          {
            label: "onRequest",
            detail: "start SERVER span + http.request.method, url.path; extract traceparent / B3 (optional)",
            tone: "accent",
          },
          {
            label: "beforeHandle",
            detail: "stamp http.route from ctx.state.route; rename span to METHOD /route/:template",
          },
          {
            label: "handler",
            detail: "ctx.state.otelSpan for events & child spans",
          },
          {
            label: "onSend",
            detail: "http.response.status_code, error.type, recordException on errors",
          },
          {
            label: "span.end()",
            eyebrow: "exactly once",
            detail: "5xx escalates to setStatus(ERROR)",
            tone: "success",
          },
        ]}
      />

      <h2>Quick start</h2>
      <CodeBlock code={`import { trace } from "@opentelemetry/api";
import { App, otelTracing } from "@daloyjs/core";

const tracer = trace.getTracer("my-service");

const app = new App({
  hooks: otelTracing({ tracer }),
});`} />

      <p>
        That single hook gives every request:
      </p>
      <ul>
        <li>
          <code>http.request.method</code>, <code>url.path</code>,{" "}
          <code>url.scheme</code>, <code>server.address</code> (host without
          port), <code>server.port</code> (when present),{" "}
          <code>user_agent.original</code> set on <code>onRequest</code>.
        </li>
        <li>
          <code>http.route</code> set automatically from{" "}
          <code>ctx.state.route</code> (the matched route template, e.g.{" "}
          <code>/books/:id</code>) on <code>beforeHandle</code>, and the span
          is renamed to <code>GET /books/:id</code>. Unmatched requests (404 /
          405) receive no <code>http.route</code> attribute.
        </li>
        <li>
          Unknown HTTP methods are normalized to{" "}
          <code>http.request.method=&quot;_OTHER&quot;</code> with the raw value
          preserved on <code>http.request.method_original</code>.
        </li>
        <li>
          <code>http.response.status_code</code> set on <code>onSend</code>.
        </li>
        <li>
          <code>error.type</code> set on failures: the exception class name
          for thrown errors, or the HTTP status code as a string for 5xx
          responses without an exception.
        </li>
        <li>
          <code>recordException</code> + <code>setStatus(ERROR)</code> on
          thrown errors, and <code>ERROR</code> escalation for any{" "}
          <code>5xx</code> response.
        </li>
        <li>
          A guaranteed single <code>span.end()</code> per request, even if
          both <code>onError</code> and <code>onSend</code> fire.
        </li>
      </ul>

      <h2>Route label and span name</h2>
      <p>
        The framework sets <code>ctx.state.route</code> to the matched route
        template on every handled request. <code>otelTracing()</code> reads
        this in <code>beforeHandle</code> and uses it for two things:
      </p>
      <ul>
        <li>
          Sets <code>http.route</code> on the span (the low-cardinality OTel
          semconv attribute that groups, say, <code>/books/1</code>,{" "}
          <code>/books/2</code>, etc. under <code>/books/:id</code>).
        </li>
        <li>
          Renames the span to <code>{"{METHOD} {route}"}</code>, e.g.{" "}
          <code>GET /books/:id</code> instead of{" "}
          <code>GET /books/42</code> — unless you supply a custom{" "}
          <code>spanName</code> resolver.
        </li>
      </ul>
      <p>
        You can also read <code>ctx.state.route</code> directly in handlers
        when you need the matched template for other purposes:
      </p>
      <CodeBlock code={`app.route({
  method: "GET",
  path: "/books/:id",
  operationId: "getBookById",
  responses: { 200: { description: "ok" } },
  handler: async ({ state }) => {
    // ctx.state.route is "/books/:id"
    // ctx.state.operationId is "getBookById"
    return { status: 200 as const, body: { route: state.route } };
  },
});`} />

      <h2>URL query string: omitted by default</h2>
      <p>
        <code>url.query</code> is <strong>not</strong> recorded on spans by
        default. Query strings frequently carry tokens, API keys, and other
        PII, and recording them verbatim would leak that data into your trace
        backend. This is a deliberate secure-by-default choice.
      </p>
      <p>
        To record a sanitized query, supply a <code>redactQuery</code>{" "}
        function. It receives the raw query string (without the leading{" "}
        <code>?</code>) and should return either a safe replacement string or{" "}
        <code>undefined</code> to still omit the attribute:
      </p>
      <CodeBlock code={`otelTracing({
  tracer,
  // Record the query but strip any "token" or "key" parameters.
  redactQuery: (search) => {
    const params = new URLSearchParams(search);
    params.delete("token");
    params.delete("key");
    params.delete("api_key");
    const redacted = params.toString();
    return redacted.length > 0 ? redacted : undefined;
  },
});`} />

      <h2>Reading the active span in handlers</h2>
      <p>
        The active span is exposed on <code>ctx.state.otelSpan</code> (key
        configurable via <code>stateKey</code>). Use it to add events, child
        spans, or extra attributes from inside a handler:
      </p>
      <CodeBlock code={`app.route({
  method: "POST",
  path: "/orders",
  operationId: "createOrder",
  responses: { 201: { description: "created" } },
  handler: async ({ state, body }) => {
    const span = state.otelSpan as import("@daloyjs/core").TracingSpan | undefined;
    span?.setAttribute("order.size", body.items.length);
    span?.setAttributes?.({ "tenant.id": state.tenantId as string });
    return { status: 201 as const };
  },
});`} />

      <h2>Customizing span name and attributes</h2>
      <p>
        All extractors are optional. They are merged on top of the defaults so
        you only need to override what you care about.
      </p>
      <CodeBlock code={`otelTracing({
  tracer,
  spanName: (req) => \`HTTP \${req.method} \${new URL(req.url).pathname}\`,
  attributesFromRequest: (req) => ({
    "tenant.id": req.headers.get("x-tenant-id") ?? "unknown",
  }),
  attributesFromResponse: (res) => ({
    "http.response.body.size": Number(res.headers.get("content-length") ?? 0),
  }),
});`} />

      <h2>Propagating upstream context</h2>
      <p>
        DaloyJS does not bundle a propagator. If you want parent-span
        continuation from <code>traceparent</code> / B3 headers, use{" "}
        <code>contextFromRequest</code> to wire your propagator&apos;s{" "}
        <code>extract</code> in:
      </p>
      <CodeBlock code={`import { context, propagation, trace } from "@opentelemetry/api";

otelTracing({
  tracer: trace.getTracer("my-service"),
  contextFromRequest: (req) =>
    propagation.extract(context.active(), req.headers, {
      get: (headers, key) => headers.get(key) ?? undefined,
      keys: (headers) => Array.from(headers.keys()),
    }),
  onSpanStart: (_req, span) => {
    span.setAttribute("component", "daloy");
  },
});`} />

      <h2>End-to-end with Jaeger (OTLP)</h2>
      <p>
        The repository ships a runnable example plus a Jaeger service in the{" "}
        <code>examples/observability/</code> Docker stack, so you can watch real
        spans land in a trace UI without writing any exporter code. Because{" "}
        <code>otelTracing()</code> only needs a tracer that matches the small{" "}
        <code>TracingTracer</code> interface, the example wires in a{" "}
        <strong>dependency-free OTLP/HTTP exporter</strong> (about 120 lines of
        web-standard <code>fetch</code> + <code>crypto</code>) that ships spans
        straight to Jaeger&apos;s OTLP receiver, no <code>@opentelemetry/*</code>{" "}
        SDK required.
      </p>
      <h3>1. Start Jaeger</h3>
      <CodeBlock
        code={`docker compose -f examples/observability/docker-compose.yml up jaeger
# Jaeger UI:            http://localhost:16686
# OTLP/HTTP receiver:   http://localhost:4318/v1/traces`}
        language="sh"
      />
      <h3>2. Run the demo app</h3>
      <CodeBlock
        code={`node --import tsx examples/otel-tracing-demo.ts
# DaloyJS OTel tracing demo running at http://localhost:3002
# Exporting OTLP spans to: http://localhost:4318/v1/traces`}
        language="sh"
      />
      <h3>3. Generate traffic and open Jaeger</h3>
      <CodeBlock
        code={`curl localhost:3002/orders
curl -X POST localhost:3002/orders -d '{"item":"book","total":42}' -H 'content-type: application/json'
curl localhost:3002/slow    # a span with visible duration
curl localhost:3002/boom    # an ERROR span with an exception event

# Continue a trace started by an upstream service (W3C traceparent):
curl localhost:3002/orders \\
  -H 'traceparent: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'`}
        language="sh"
      />
      <p>
        Open <code>http://localhost:16686</code>, pick the{" "}
        <code>daloy-otel-demo</code> service, and you will see one SERVER span
        per request: the <code>/boom</code> span flagged as an error with an{" "}
        <code>exception</code> event, the <code>/slow</code> span showing its
        real duration, and the <code>traceparent</code> request stitched into
        the upstream trace as a child span.
      </p>
      <p>
        In production you usually swap the demo exporter for the real SDK,{" "}
        <code>trace.getTracer(&quot;svc&quot;)</code> from{" "}
        <code>@opentelemetry/api</code> backed by{" "}
        <code>@opentelemetry/sdk-node</code> and an OTLP exporter. The{" "}
        <code>otelTracing()</code> call does not change; only the tracer you pass
        in does.
      </p>

      <h2>Lifecycle and limitations</h2>
      <ul>
        <li>
          <strong>Request outcomes.</strong> Matched routes, unmatched requests
          (<code>404</code> / <code>405</code>), and OPTIONS preflight responses
          all end with <code>http.response.status_code</code> on the same span.
        </li>
        <li>
          <strong>No global side effects.</strong> The hook never touches{" "}
          <code>globalThis</code>, never installs a propagator, and never
          imports an OTel SDK, it stays adapter-portable.
        </li>
        <li>
          <strong>Single end.</strong> If a handler throws, the same span is
          marked errored and ended once during <code>onSend</code>; later
          <code> onError</code> / repeat <code>onSend</code> invocations are
          no-ops.
        </li>
        <li>
          <strong>Composes with other hooks.</strong> Combine{" "}
          <code>otelTracing(...)</code> with <code>requestId(...)</code>,{" "}
          <code>secureHeaders(...)</code>, etc., DaloyJS merges global, group,
          and per-route hooks pipeline-style.
        </li>
      </ul>

      <h2>Tree-shake-friendly subpath</h2>
      <CodeBlock code={`// Main barrel:
import { otelTracing } from "@daloyjs/core";

// Or, to keep your bundle minimal:
import { otelTracing } from "@daloyjs/core/tracing";`} />
    </>
  );
}
