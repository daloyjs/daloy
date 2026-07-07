/**
 * OpenTelemetry tracing demo — DaloyJS + Jaeger (OTLP/HTTP) integration.
 *
 * DaloyJS ships `otelTracing()`, a dependency-free hook that creates one
 * SERVER span per request against ANY tracer matching the small
 * `TracingTracer` interface. This demo proves the integration end-to-end
 * WITHOUT pulling in the `@opentelemetry/*` SDK: it implements a tiny
 * OTLP/HTTP JSON exporter (~120 lines, web-standard `fetch` + `crypto`) that
 * ships spans straight to Jaeger. In production you would typically pass
 * `trace.getTracer("svc")` from the real OTel SDK instead — `otelTracing()`
 * does not care which one you use.
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
  TRACING_SPAN_KIND_SERVER,
  type TracingAttributes,
  type TracingAttributeValue,
  type TracingSpan,
  type TracingStartSpanOptions,
  type TracingTracer,
} from "../src/index.ts";
import { z } from "zod";

const SERVICE_NAME = "daloy-otel-demo";
const OTLP_TRACES_URL =
  process.env.OTLP_TRACES_URL ?? "http://localhost:4318/v1/traces";

// --------------------------------------------------------------------------
// A minimal, dependency-free OTLP/HTTP JSON tracer.
//
// It speaks just enough of the OpenTelemetry wire format for Jaeger to ingest:
// resourceSpans → scopeSpans → spans, with hex-encoded trace/span IDs and
// nanosecond timestamps. No SDK, no npm install.
// --------------------------------------------------------------------------

/** Parent trace context extracted from an inbound W3C `traceparent` header. */
interface ParentContext {
  traceId: string;
  spanId: string;
}

/** OTLP `AnyValue` JSON shape. */
type OtlpAnyValue =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: string }
  | { doubleValue: number }
  | { arrayValue: { values: OtlpAnyValue[] } };

interface OtlpKeyValue {
  key: string;
  value: OtlpAnyValue;
}

/**
 * Wall-clock-anchored, sub-millisecond clock. `Date.now()` only has ms
 * resolution, so very fast handlers would render as zero-duration spans;
 * blending it with `performance.now()` recovers fractional-ms precision while
 * staying anchored to real time.
 */
const WALL_BASE_MS = Date.now();
const PERF_BASE_MS = performance.now();
function nowUnixNano(): bigint {
  const absMs = WALL_BASE_MS + (performance.now() - PERF_BASE_MS);
  return BigInt(Math.round(absMs * 1e6));
}

/** Hex-encode `n` cryptographically-random bytes (trace = 16, span = 8). */
function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  let out = "";
  for (const b of arr) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Parse a W3C `traceparent` header (`00-<32hex>-<16hex>-<flags>`). */
function parseTraceparent(header: string | null): ParentContext | undefined {
  if (!header) return undefined;
  const parts = header.trim().split("-");
  if (parts.length < 4) return undefined;
  const [version, traceId, spanId] = parts;
  if (version !== "00") return undefined; // only the version we understand
  const zeroTrace = "0".repeat(32);
  const zeroSpan = "0".repeat(16);
  if (!/^[0-9a-f]{32}$/.test(traceId!) || traceId === zeroTrace) return undefined;
  if (!/^[0-9a-f]{16}$/.test(spanId!) || spanId === zeroSpan) return undefined;
  return { traceId: traceId!, spanId: spanId! };
}

/** Convert a DaloyJS attribute value to an OTLP `AnyValue`. */
function toAnyValue(v: TracingAttributeValue): OtlpAnyValue {
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { boolValue: v };
  if (typeof v === "number") {
    // OTLP encodes int64 as a JSON string and double as a number.
    return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  }
  return { arrayValue: { values: v.map((item) => toAnyValue(item)) } };
}

function attrsToKeyValues(attrs: TracingAttributes): OtlpKeyValue[] {
  return Object.keys(attrs).map((key) => ({ key, value: toAnyValue(attrs[key]!) }));
}

interface FinishedSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  /** OTLP wire-format SpanKind (already +1 from the API enum). */
  kind: number;
  startNano: bigint;
  endNano: bigint;
  attributes: TracingAttributes;
  statusCode: number;
  statusMessage?: string;
  events: { name: string; timeNano: bigint; attributes: TracingAttributes }[];
}

const SPAN_QUEUE: FinishedSpan[] = [];

/**
 * One span. Collects attributes/status/events until `end()`, then hands the
 * finished span to the export queue.
 */
class DemoSpan implements TracingSpan {
  private readonly attributes: TracingAttributes = {};
  private statusCode = 0; // UNSET
  private statusMessage?: string;
  private readonly events: FinishedSpan["events"] = [];
  private readonly startNano = nowUnixNano();
  private ended = false;

  constructor(
    private readonly name: string,
    private readonly kind: number,
    private readonly traceId: string,
    private readonly spanId: string,
    private readonly parentSpanId: string | undefined,
    initial: TracingAttributes | undefined,
  ) {
    if (initial) Object.assign(this.attributes, initial);
  }

  setAttribute(key: string, value: TracingAttributeValue): void {
    this.attributes[key] = value;
  }

  setAttributes(attrs: TracingAttributes): void {
    Object.assign(this.attributes, attrs);
  }

  setStatus(status: { code: number; message?: string }): void {
    this.statusCode = status.code;
    this.statusMessage = status.message;
  }

  recordException(err: unknown): void {
    const error = err instanceof Error ? err : undefined;
    this.events.push({
      name: "exception",
      timeNano: nowUnixNano(),
      attributes: {
        "exception.type": error?.name ?? "Error",
        "exception.message": error?.message ?? String(err),
        ...(error?.stack ? { "exception.stacktrace": error.stack } : {}),
      },
    });
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    SPAN_QUEUE.push({
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      kind: this.kind,
      startNano: this.startNano,
      endNano: nowUnixNano(),
      attributes: this.attributes,
      statusCode: this.statusCode,
      statusMessage: this.statusMessage,
      events: this.events,
    });
  }
}

const tracer: TracingTracer = {
  startSpan(
    name: string,
    options?: TracingStartSpanOptions,
    context?: unknown,
  ): TracingSpan {
    const parent = (context as ParentContext | undefined) ?? undefined;
    // DaloyJS passes the @opentelemetry/api SpanKind convention (SERVER = 1).
    // The OTLP wire enum is offset by one (SPAN_KIND_UNSPECIFIED = 0,
    // INTERNAL = 1, SERVER = 2, ...), so add one when serialising.
    const wireKind = (options?.kind ?? 0) + 1;
    return new DemoSpan(
      name,
      wireKind,
      parent?.traceId ?? randomHex(16),
      randomHex(8),
      parent?.spanId,
      options?.attributes,
    );
  },
};

/** POST any queued spans to the collector. Best-effort: logs and drops on error. */
async function flushSpans(): Promise<void> {
  if (SPAN_QUEUE.length === 0) return;
  const batch = SPAN_QUEUE.splice(0, SPAN_QUEUE.length);
  const payload = {
    resourceSpans: [
      {
        resource: {
          attributes: attrsToKeyValues({
            "service.name": SERVICE_NAME,
            "telemetry.sdk.name": "daloy-demo-otlp-exporter",
            "telemetry.sdk.language": "nodejs",
          }),
        },
        scopeSpans: [
          {
            scope: { name: SERVICE_NAME, version: "1.0.0" },
            spans: batch.map((s) => ({
              traceId: s.traceId,
              spanId: s.spanId,
              ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
              name: s.name,
              kind: s.kind,
              startTimeUnixNano: s.startNano.toString(),
              endTimeUnixNano: s.endNano.toString(),
              attributes: attrsToKeyValues(s.attributes),
              status:
                s.statusMessage !== undefined
                  ? { code: s.statusCode, message: s.statusMessage }
                  : { code: s.statusCode },
              events: s.events.map((e) => ({
                name: e.name,
                timeUnixNano: e.timeNano.toString(),
                attributes: attrsToKeyValues(e.attributes),
              })),
            })),
          },
        ],
      },
    ],
  };
  try {
    const res = await fetch(OTLP_TRACES_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`OTLP export failed: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error("OTLP export error (is Jaeger running on :4318?):", err);
    // Re-queue so spans aren't lost on a transient collector hiccup.
    SPAN_QUEUE.unshift(...batch);
  }
}

// Flush on a short interval so the Jaeger UI updates quickly. `unref()` keeps
// the timer from holding the process open.
const flushTimer = setInterval(() => void flushSpans(), 1000);
flushTimer.unref?.();

// --------------------------------------------------------------------------
// The app under test.
// --------------------------------------------------------------------------

const app = new App({
  env: "development",
  hooks: otelTracing({
    tracer,
    // Continue an upstream trace when the caller sends W3C `traceparent`.
    contextFromRequest: (req) => parseTraceparent(req.headers.get("traceparent")),
    // Tag every span with the demo service so it groups in Jaeger.
    attributesFromRequest: (): TracingAttributes => ({ "service.name": SERVICE_NAME }),
  }),
});

app.route({
  method: "GET",
  path: "/health",
  operationId: "healthCheck",
  summary: "Liveness probe",
  responses: { 200: { description: "OK", body: z.object({ status: z.string() }) } },
  handler: () => ({ status: 200 as const, body: { status: "ok" } }),
});

app.route({
  method: "GET",
  path: "/orders",
  operationId: "listOrders",
  summary: "List orders",
  responses: {
    200: {
      description: "Order list",
      body: z.object({ orders: z.array(z.object({ id: z.string(), total: z.number() })) }),
    },
  },
  handler: ({ state }) => {
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
  },
});

app.route({
  method: "POST",
  path: "/orders",
  operationId: "createOrder",
  summary: "Create an order",
  request: { body: z.object({ item: z.string(), total: z.number().positive() }) },
  responses: {
    201: {
      description: "Order created",
      body: z.object({ id: z.string(), item: z.string(), total: z.number() }),
    },
  },
  handler: ({ body, state }) => {
    const span = (state as Record<string, unknown>).otelSpan as TracingSpan | undefined;
    span?.setAttribute("app.order.item", body.item);
    span?.setAttribute("app.order.total", body.total);
    return {
      status: 201 as const,
      body: { id: `ord-${randomHex(4)}`, item: body.item, total: body.total },
    };
  },
});

app.route({
  method: "GET",
  path: "/slow",
  operationId: "slowEndpoint",
  summary: "Artificially slow endpoint (visible span duration)",
  responses: { 200: { description: "OK", body: z.object({ waitedMs: z.number() }) } },
  handler: async () => {
    const waitedMs = 150;
    await new Promise((r) => setTimeout(r, waitedMs));
    return { status: 200 as const, body: { waitedMs } };
  },
});

app.route({
  method: "GET",
  path: "/boom",
  operationId: "boom",
  summary: "Always throws (produces an ERROR span with an exception event)",
  responses: { 500: { description: "Internal error" } },
  handler: () => {
    throw new Error("synthetic failure for tracing demo");
  },
});

const PORT = 3002;
const { port } = serve(app, { port: PORT });

// Flush any buffered spans on shutdown so the last requests aren't lost.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(flushTimer);
    void flushSpans().finally(() => process.exit(0));
  });
}

console.log(`DaloyJS OTel tracing demo running at http://localhost:${port}`);
console.log(`Exporting OTLP spans to: ${OTLP_TRACES_URL}`);
console.log(`Jaeger UI (after docker compose up jaeger): http://localhost:16686`);
console.log(`Try:  curl localhost:${port}/orders  ·  curl localhost:${port}/boom`);
