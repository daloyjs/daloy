/**
 * OpenTelemetry tracing demo — DaloyJS + Jaeger (OTLP/HTTP) integration.
 *
 * DaloyJS ships `otelTracing()`, a dependency-free hook that creates one
 * SERVER span per request against ANY tracer matching the small
 * `TracingTracer` interface, and `createOtlpTracer()`, a dependency-free
 * tracer that pushes those spans to an OTLP collector. This demo wires the
 * two together and ships spans straight to Jaeger, WITHOUT the
 * `@opentelemetry/*` SDK. If you already run the SDK, pass
 * `trace.getTracer("svc")` instead — `otelTracing()` does not care which
 * tracer you use. (`new App({ telemetry: { traces: true } })` wires the same
 * thing from the standard OTEL_* environment variables.)
 *
 * Run it:
 *
 *   # Terminal 1 — start Jaeger (OTLP receiver + UI)
 *   docker compose -f examples/observability/docker-compose.yml up jaeger
 *
 *   # Terminal 2 — start this app (exports spans to Jaeger on :4318)
 *   node --import tsx examples/otel-tracing-demo.ts
 *
 *   # Generate some traffic
 *   curl localhost:3002/orders
 *   curl -X POST localhost:3002/orders -d '{"item":"book","total":42}' -H 'content-type: application/json'
 *   curl localhost:3002/slow
 *   curl localhost:3002/boom
 *   # Continue a trace started upstream (W3C traceparent):
 *   curl localhost:3002/orders -H 'traceparent: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'
 *
 * Then open Jaeger and pick the "daloy-otel-demo" service:
 *   http://localhost:16686
 */

import { serve } from "../src/adapters/node.ts";
import {
  App,
  otelTracing,
  parseTraceparent,
  TRACING_SPAN_KIND_INTERNAL,
  type TracingSpan,
} from "../src/index.ts";
import { createOtlpTracer } from "../src/otlp.ts";
import { z } from "zod";

const SERVICE_NAME = "daloy-otel-demo";
const OTLP_ENDPOINT = process.env.OTLP_ENDPOINT ?? "http://localhost:4318";

// Batches ended spans and POSTs them to `${OTLP_ENDPOINT}/v1/traces` as
// OTLP/HTTP JSON. A short interval keeps the Jaeger UI snappy.
const tracer = createOtlpTracer({
  endpoint: OTLP_ENDPOINT,
  resourceAttributes: { "service.name": SERVICE_NAME },
  flushIntervalMs: 1000,
})!;

const app = new App({
  env: "development",
  hooks: otelTracing({
    tracer,
    // Continue an upstream trace when the caller sends W3C `traceparent`.
    // (Do not do this on an internet-facing edge; see the tracing docs.)
    contextFromRequest: (req) => parseTraceparent(req.headers.get("traceparent")),
    // Handler log lines carry trace_id / span_id.
    correlateLogs: true,
  }),
});

app.get(
  "/health",
  {
    operationId: "healthCheck",
    summary: "Liveness probe",
    responses: { 200: { description: "OK", body: z.object({ status: z.string() }) } },
  },
  () => ({ status: 200 as const, body: { status: "ok" } })
);

app.get(
  "/orders",
  {
    operationId: "listOrders",
    summary: "List orders",
    responses: {
      200: {
        description: "Order list",
        body: z.object({ orders: z.array(z.object({ id: z.string(), total: z.number() })) }),
      },
    },
  },
  ({ state }) => {
    // Handlers can read the active span off ctx.state and enrich it.
    const span = (state as Record<string, unknown>).otelSpan as TracingSpan | undefined;
    span?.setAttribute("app.orders.count", 2);
    return {
      status: 200 as const,
      body: {
        orders: [
          { id: "ord-1", total: 49.99 },
          { id: "ord-2", total: 129.0 },
        ],
      },
    };
  }
);

app.post(
  "/orders",
  {
    operationId: "createOrder",
    summary: "Create an order",
    request: { body: z.object({ item: z.string(), total: z.number().positive() }) },
    responses: {
      201: {
        description: "Order created",
        body: z.object({ id: z.string(), item: z.string(), total: z.number() }),
      },
    },
  },
  ({ body, state }) => {
    const span = (state as Record<string, unknown>).otelSpan as TracingSpan | undefined;
    span?.setAttribute("app.order.item", body.item);
    span?.setAttribute("app.order.total", body.total);
    return {
      status: 201 as const,
      body: { id: `ord-${crypto.randomUUID().slice(0, 8)}`, item: body.item, total: body.total },
    };
  }
);

app.get(
  "/slow",
  {
    operationId: "slowEndpoint",
    summary: "Artificially slow endpoint (visible span duration and a child span)",
    responses: { 200: { description: "OK", body: z.object({ waitedMs: z.number() }) } },
  },
  async ({ state }) => {
    // Hooks cannot activate an OTel context, so a child span takes its
    // parent explicitly as the third startSpan argument.
    const child = tracer.startSpan(
      "simulated work",
      { kind: TRACING_SPAN_KIND_INTERNAL },
      (state as Record<string, unknown>).otelSpan
    );
    const waitedMs = 150;
    await new Promise((r) => setTimeout(r, waitedMs));
    child.end();
    return { status: 200 as const, body: { waitedMs } };
  }
);

app.get(
  "/boom",
  {
    operationId: "boom",
    summary: "Always throws (produces an ERROR span with an exception event)",
    responses: { 500: { description: "Internal error" } },
  },
  () => {
    throw new Error("synthetic failure for tracing demo");
  }
);

const PORT = 3002;
const { port } = serve(app, { port: PORT });

// Flush any buffered spans on shutdown so the last requests aren't lost.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void tracer.flush().finally(() => process.exit(0));
  });
}

console.log(`DaloyJS OTel tracing demo running at http://localhost:${port}`);
console.log(`Exporting OTLP spans to: ${OTLP_ENDPOINT}`);
console.log(`Jaeger UI (after docker compose up jaeger): http://localhost:16686`);
console.log(`Try:  curl localhost:${port}/orders  ·  curl localhost:${port}/boom`);
