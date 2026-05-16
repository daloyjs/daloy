/**
 * OpenTelemetry-compatible tracing hook.
 *
 * `otelTracing(opts)` returns a `Hooks` object you can pass to `new App({ hooks })`
 * (or `app.use(...)`) that creates one server-kind span per HTTP request
 * and ends it when the response is sent. The API mirrors the
 * [`@opentelemetry/api`](https://www.npmjs.com/package/@opentelemetry/api)
 * `Tracer`/`Span` shape, but DaloyJS does not depend on it directly — pass any
 * tracer that implements the minimal {@link TracingTracer} interface and
 * `otelTracing` will use it. This keeps the framework runtime-portable (Edge,
 * Workers, Bun, Deno) and lets you wire in your favorite SDK without forcing it
 * into every install.
 *
 * Lifecycle:
 *
 * 1. `onRequest` — optionally extracts an upstream parent context, starts a
 *    `SERVER` span, and attaches HTTP semantic-convention attributes.
 * 2. `beforeHandle` — stores the active span on `ctx.state[stateKey]` (default
 *    `otelSpan`) so handlers can add events / child spans.
 * 3. `onError` — records the exception and sets the span status to `ERROR`.
 * 4. `onSend` — stamps `http.response.status_code` on the span, escalates to
 *    `ERROR` for 5xx responses, and ends the span exactly once per request.
 *
 * ```ts
 * import { trace } from "@opentelemetry/api";
 * import { App, otelTracing } from "@daloyjs/core";
 *
 * const tracer = trace.getTracer("my-service");
 * const app = new App({ hooks: otelTracing({ tracer }) });
 * ```
 */

import type { Hooks } from "./types.js";

/** OpenTelemetry `SpanKind.SERVER`. Hard-coded so we don't pull in `@opentelemetry/api`. */
export const TRACING_SPAN_KIND_SERVER = 1;
/** OpenTelemetry `SpanStatusCode.UNSET`. */
export const TRACING_SPAN_STATUS_UNSET = 0;
/** OpenTelemetry `SpanStatusCode.OK`. */
export const TRACING_SPAN_STATUS_OK = 1;
/** OpenTelemetry `SpanStatusCode.ERROR`. */
export const TRACING_SPAN_STATUS_ERROR = 2;

/** Attribute value accepted by OTel `Span.setAttribute`. */
export type TracingAttributeValue = string | number | boolean | string[] | number[] | boolean[];

export type TracingAttributes = Record<string, TracingAttributeValue>;

/**
 * Minimum span surface DaloyJS needs. Compatible with `@opentelemetry/api`'s
 * `Span` (extra OTel methods are ignored).
 */
export interface TracingSpan {
  setAttribute(key: string, value: TracingAttributeValue): void;
  setAttributes?(attrs: TracingAttributes): void;
  setStatus(status: { code: number; message?: string }): void;
  recordException?(err: unknown): void;
  end(endTime?: number): void;
}

export interface TracingStartSpanOptions {
  kind?: number;
  attributes?: TracingAttributes;
}

/** Minimum tracer surface DaloyJS needs. Compatible with `@opentelemetry/api`'s `Tracer`. */
export interface TracingTracer {
  startSpan(name: string, options?: TracingStartSpanOptions, context?: unknown): TracingSpan;
}

export interface OtelTracingOptions {
  /** OTel-compatible tracer (e.g. `trace.getTracer("my-service")`). */
  tracer: TracingTracer;
  /**
   * Override the span name. Default: `"<METHOD> <pathname>"`.
   *
   * If you have a route template (e.g. `/users/:id`), you can read it from
   * `ctx.request.url` plus your routing knowledge — DaloyJS doesn't expose the
   * matched template here to keep the hook decoupled from the router internals.
   */
  spanName?: (req: Request) => string;
  /** Extra attributes derived from the request. Merged on top of the defaults. */
  attributesFromRequest?: (req: Request) => TracingAttributes;
  /** Extra attributes derived from the response. Merged just before `end()`. */
  attributesFromResponse?: (res: Response) => TracingAttributes;
  /**
   * Extract upstream context (W3C `traceparent`, B3, etc.) before span creation.
   * The returned value is passed as the third `startSpan` argument. DaloyJS does
   * not import any propagator — pass one in if you need parent-span continuation.
   */
  contextFromRequest?: (req: Request) => unknown;
  /** Run after span creation for custom span setup. */
  onSpanStart?: (req: Request, span: TracingSpan) => void;
  /**
   * Key under which the active span is exposed on `ctx.state` for handlers.
   * Default: `"otelSpan"`.
   */
  stateKey?: string;
}

interface TracingEntry {
  span: TracingSpan;
  ended: boolean;
  errored: boolean;
}

const REQUEST_TO_ENTRY: WeakMap<Request, TracingEntry> = new WeakMap();

function defaultSpanName(req: Request, url: URL | undefined): string {
  const method = req.method.toUpperCase();
  const path = url ? url.pathname : "/";
  return `${method} ${path}`;
}

function safeParseUrl(input: string): URL | undefined {
  try {
    return new URL(input);
  } catch {
    return undefined;
  }
}

function setSpanAttributes(span: TracingSpan, attrs: TracingAttributes): void {
  if (typeof span.setAttributes === "function") {
    span.setAttributes(attrs);
    return;
  }
  for (const key of Object.keys(attrs)) {
    span.setAttribute(key, attrs[key]!);
  }
}

function endOnce(entry: TracingEntry, attrs?: TracingAttributes): void {
  if (entry.ended) return;
  entry.ended = true;
  if (attrs) setSpanAttributes(entry.span, attrs);
  entry.span.end();
}

export function otelTracing(opts: OtelTracingOptions): Hooks {
  const stateKey = opts.stateKey ?? "otelSpan";

  const startEntry = (req: Request): TracingEntry => {
    const existing = REQUEST_TO_ENTRY.get(req);
    if (existing) return existing;

    const url = safeParseUrl(req.url);
    const method = req.method.toUpperCase();
    const name = opts.spanName ? opts.spanName(req) : defaultSpanName(req, url);

    const attrs: TracingAttributes = { "http.request.method": method };
    if (url) {
      attrs["url.path"] = url.pathname;
      attrs["url.scheme"] = url.protocol.replace(/:$/, "");
      if (url.host) attrs["server.address"] = url.host;
      if (url.search) attrs["url.query"] = url.search.replace(/^\?/, "");
    }
    const ua = req.headers.get("user-agent");
    if (ua) attrs["user_agent.original"] = ua;

    const extra = opts.attributesFromRequest?.(req);
    if (extra) Object.assign(attrs, extra);

    const parentContext = opts.contextFromRequest?.(req);
    const span = opts.tracer.startSpan(name, {
      kind: TRACING_SPAN_KIND_SERVER,
      attributes: attrs,
    }, parentContext);
    opts.onSpanStart?.(req, span);

    const entry: TracingEntry = { span, ended: false, errored: false };
    REQUEST_TO_ENTRY.set(req, entry);
    return entry;
  };

  return {
    onRequest(req) {
      startEntry(req);
    },
    beforeHandle(ctx) {
      const entry = startEntry(ctx.request);
      (ctx.state as Record<string, unknown>)[stateKey] = entry.span;
    },
    onError(err, ctx) {
      if (!ctx) return;
      const entry = REQUEST_TO_ENTRY.get(ctx.request);
      if (!entry || entry.ended) return;
      entry.errored = true;
      if (err instanceof Error) {
        entry.span.recordException?.(err);
        entry.span.setStatus({ code: TRACING_SPAN_STATUS_ERROR, message: err.message });
      } else {
        entry.span.setStatus({ code: TRACING_SPAN_STATUS_ERROR });
      }
    },
    onSend(res, ctx) {
      if (!ctx) return;
      const entry = REQUEST_TO_ENTRY.get(ctx.request);
      if (!entry || entry.ended) return;
      const attrs: TracingAttributes = { "http.response.status_code": res.status };
      const extra = opts.attributesFromResponse?.(res);
      if (extra) Object.assign(attrs, extra);
      if (res.status >= 500 && !entry.errored) {
        entry.span.setStatus({ code: TRACING_SPAN_STATUS_ERROR });
      }
      endOnce(entry, attrs);
    },
  };
}
