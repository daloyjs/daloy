import { CodeBlock } from "../../../components/code-block";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Tracing with OpenTelemetry",
  description:
    "Instrument DaloyJS apps with OpenTelemetry-compatible spans. The otelTracing helper produces a Hooks object that starts a SERVER span per request, attaches HTTP semantic-convention attributes, exposes the span on ctx.state, and ends it when the response is sent.",
  path: "/docs/tracing",
  keywords: [
    "OpenTelemetry",
    "tracing",
    "spans",
    "otelTracing",
    "DaloyJS observability",
    "OTel",
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
          <code>url.scheme</code>, <code>server.address</code>,{" "}
          <code>url.query</code>, <code>user_agent.original</code> set on{" "}
          <code>beforeHandle</code>.
        </li>
        <li>
          <code>http.response.status_code</code> set on <code>onSend</code>.
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
          imports an OTel SDK — it stays adapter-portable.
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
          <code>secureHeaders(...)</code>, etc. — DaloyJS merges global, group,
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
