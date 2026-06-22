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

/**
 * HTTP methods recognized by the OTel HTTP semantic conventions. Any other
 * method is recorded as `_OTHER` on `http.request.method`, with the raw value
 * preserved on `http.request.method_original` — this caps method cardinality
 * and prevents a hostile client from minting unbounded metric/trace series.
 */
const KNOWN_HTTP_METHODS = new Set([
  "CONNECT", "DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT", "TRACE",
]);

/** Attribute value accepted by OTel `Span.setAttribute`. */
export type TracingAttributeValue = string | number | boolean | string[] | number[] | boolean[];

/** Record of attribute key/value pairs passed to {@link TracingSpan.setAttributes}. */
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
  /** OTel `Span.updateName`. Optional: tracers without it keep the creation-time name. */
  updateName?(name: string): void;
}

/** Options passed to {@link TracingTracer.startSpan}. */
export interface TracingStartSpanOptions {
  /** OTel `SpanKind` (e.g. {@link TRACING_SPAN_KIND_SERVER}). */
  kind?: number;
  /** Initial attributes attached to the span at creation. */
  attributes?: TracingAttributes;
}

/** Minimum tracer surface DaloyJS needs. Compatible with `@opentelemetry/api`'s `Tracer`. */
export interface TracingTracer {
  startSpan(name: string, options?: TracingStartSpanOptions, context?: unknown): TracingSpan;
}

/** Options for {@link otelTracing}. */
export interface OtelTracingOptions {
  /** OTel-compatible tracer (e.g. `trace.getTracer("my-service")`). */
  tracer: TracingTracer;
  /**
   * Override the default span name.
   *
   * By default `otelTracing` renames the span to `"{METHOD} {route}"` in
   * `beforeHandle`, using `ctx.state.route` (the matched route template, e.g.
   * `GET /users/:id`), which keeps cardinality low automatically. Most apps do
   * **not** need this option.
   *
   * Supply a function here only when you need a custom naming strategy that
   * differs from the automatic `{method} {ctx.state.route}` default.
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
  /**
   * Map the raw URL query string (without the leading `?`) to a value recorded
   * on `url.query`, or `undefined` to record nothing. Default: query is OMITTED
   * entirely — query strings routinely carry tokens/PII, so daloy does not put
   * them on spans unless you opt in with a redactor.
   */
  redactQuery?: (search: string) => string | undefined;
}

interface TracingEntry {
  span: TracingSpan;
  ended: boolean;
  errored: boolean;
}

const REQUEST_TO_ENTRY: WeakMap<Request, TracingEntry> = new WeakMap();

function defaultSpanName(req: Request, url: URL | undefined, method: string): string {
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

/**
 * Middleware that wraps every request in an OpenTelemetry-compatible span.
 * Pass any tracer that matches the {@link TracingTracer} surface; DaloyJS
 * does not import `@opentelemetry/api` itself.
 */
export function otelTracing(opts: OtelTracingOptions): Hooks {
  const stateKey = opts.stateKey ?? "otelSpan";

  const startEntry = (req: Request): TracingEntry => {
    const existing = REQUEST_TO_ENTRY.get(req);
    if (existing) return existing;

    const url = safeParseUrl(req.url);
    const rawMethod = req.method.toUpperCase();
    const method = KNOWN_HTTP_METHODS.has(rawMethod) ? rawMethod : "_OTHER";
    const name = opts.spanName ? opts.spanName(req) : defaultSpanName(req, url, method);

    const attrs: TracingAttributes = { "http.request.method": method };
    if (method === "_OTHER") attrs["http.request.method_original"] = rawMethod;
    if (url) {
      attrs["url.path"] = url.pathname;
      attrs["url.scheme"] = url.protocol.replace(/:$/, "");
      // Per the OTel HTTP semantic conventions `server.address` is the host
      // WITHOUT the port (which belongs in `server.port`), so derive both from
      // `url.hostname`/`url.port` rather than `url.host` (which concatenates them).
      if (url.hostname) attrs["server.address"] = url.hostname;
      if (url.port) attrs["server.port"] = Number(url.port);
      if (url.search && opts.redactQuery) {
        const q = opts.redactQuery(url.search.replace(/^\?/, ""));
        if (q !== undefined) attrs["url.query"] = q;
      }
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
      const route = (ctx.state as Record<string, unknown>).route;
      if (typeof route === "string" && route.length > 0) {
        entry.span.setAttribute("http.route", route);
        // Only rename when no custom spanName override is in use — the caller
        // chose their own name and we must not clobber it.
        if (!opts.spanName) {
          const method = ctx.request.method.toUpperCase();
          const normalized = KNOWN_HTTP_METHODS.has(method) ? method : "_OTHER";
          entry.span.updateName?.(`${normalized} ${route}`);
        }
      }
    },
    onError(err, ctx) {
      if (!ctx) return;
      const entry = REQUEST_TO_ENTRY.get(ctx.request);
      if (!entry || entry.ended) return;
      entry.errored = true;
      if (err instanceof Error) {
        entry.span.recordException?.(err);
        entry.span.setAttribute("error.type", err.constructor?.name ?? "_OTHER");
        entry.span.setStatus({ code: TRACING_SPAN_STATUS_ERROR, message: err.message });
      } else {
        entry.span.setAttribute("error.type", "_OTHER");
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
        entry.span.setAttribute("error.type", String(res.status));
        entry.span.setStatus({ code: TRACING_SPAN_STATUS_ERROR });
      }
      endOnce(entry, attrs);
    },
  };
}
