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
 * into every install. `createOtlpTracer()` from `@daloyjs/core/otlp` is a
 * dependency-free tracer that pushes spans to an OTLP collector.
 *
 * Lifecycle:
 *
 * 1. `onRequest` — optionally extracts an upstream parent context, starts a
 *    `SERVER` span, and attaches HTTP semantic-convention attributes.
 * 2. `beforeHandle` — stores the active span on `ctx.state[stateKey]` (default
 *    `otelSpan`) so handlers can add events / child spans, and optionally
 *    binds the trace ids onto `ctx.state.log`.
 * 3. `onError` — remembers the thrown error for the span.
 * 4. `onSend` — stamps `http.response.status_code` and (for matched routes)
 *    `http.route`, renames the span to the low-cardinality
 *    `"<METHOD> <route template>"` when the tracer supports `updateName`,
 *    marks it `ERROR` (with `error.type` and the recorded exception) only for
 *    `5xx` responses, and ends the span exactly once per request. Per the OTel
 *    HTTP semantic conventions a `4xx` leaves a SERVER span's status unset.
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
import { sanitizeUrlPathForLog, sanitizeUrlQueryForLog } from "./logger.js";

/** OpenTelemetry `SpanKind.INTERNAL`, for in-process child spans. @since 1.11.0 */
export const TRACING_SPAN_KIND_INTERNAL = 0;
/** OpenTelemetry `SpanKind.SERVER`. Hard-coded so we don't pull in `@opentelemetry/api`. */
export const TRACING_SPAN_KIND_SERVER = 1;
/** OpenTelemetry `SpanKind.CLIENT`, for outbound-call child spans. @since 1.11.0 */
export const TRACING_SPAN_KIND_CLIENT = 2;
/** OpenTelemetry `SpanStatusCode.UNSET`. */
export const TRACING_SPAN_STATUS_UNSET = 0;
/** OpenTelemetry `SpanStatusCode.OK`. */
export const TRACING_SPAN_STATUS_OK = 1;
/** OpenTelemetry `SpanStatusCode.ERROR`. */
export const TRACING_SPAN_STATUS_ERROR = 2;

/** Attribute value accepted by OTel `Span.setAttribute`. */
export type TracingAttributeValue = string | number | boolean | string[] | number[] | boolean[];

/** Record of attribute key/value pairs passed to {@link TracingSpan.setAttributes}. */
export type TracingAttributes = Record<string, TracingAttributeValue>;

/**
 * W3C trace identity of a span. Structurally compatible with
 * `@opentelemetry/api`'s `SpanContext`.
 *
 * @since 1.11.0
 */
export interface TracingSpanContext {
  /** 32 lowercase hex characters, never all zeros. */
  traceId: string;
  /** 16 lowercase hex characters, never all zeros. */
  spanId: string;
  /** W3C trace flags; bit `0x01` means sampled. */
  traceFlags: number;
}

/**
 * Minimum span surface DaloyJS needs. Compatible with `@opentelemetry/api`'s
 * `Span` (extra OTel methods are ignored).
 */
export interface TracingSpan {
  /** Set a single attribute on the span. */
  setAttribute(key: string, value: TracingAttributeValue): void;
  /** Optional bulk attribute setter; DaloyJS falls back to `setAttribute` per key. */
  setAttributes?(attrs: TracingAttributes): void;
  /** Set the span status (e.g. {@link TRACING_SPAN_STATUS_ERROR} on failure). */
  setStatus(status: { code: number; message?: string }): void;
  /** Optional exception recorder; called with the thrown error on `5xx` failures. */
  recordException?(err: unknown): void;
  /** End the span. DaloyJS calls this exactly once per request. */
  end(endTime?: number): void;
  /**
   * Optional rename. When present (and no custom `spanName` is configured),
   * `otelTracing()` renames the span to `"<METHOD> <route template>"` once
   * the route is known, or to `"<METHOD>"` for unmatched requests, so span
   * names stay low-cardinality and never carry raw path segments.
   *
   * @since 1.11.0
   */
  updateName?(name: string): void;
  /**
   * Optional trace identity, used for log correlation
   * ({@link OtelTracingOptions.correlateLogs}) and for propagating
   * `traceparent` to downstream calls.
   *
   * @since 1.11.0
   */
  spanContext?(): TracingSpanContext;
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
  /** Create a span; `context` carries the extracted upstream parent context, if any. */
  startSpan(name: string, options?: TracingStartSpanOptions, context?: unknown): TracingSpan;
}

/** Options for {@link otelTracing}. */
export interface OtelTracingOptions {
  /** OTel-compatible tracer (e.g. `trace.getTracer("my-service")`). */
  tracer: TracingTracer;
  /**
   * Override the span name. Runs before routing, so it only sees the
   * `Request`. A custom name is never renamed afterwards.
   *
   * Default: the span starts as `"<METHOD> <pathname>"`. When the tracer's
   * spans implement `updateName` (the `@opentelemetry/api` SDK and
   * `createOtlpTracer()` both do), it is renamed on send to
   * `"<METHOD> <route template>"` (e.g. `GET /users/:id`) for matched routes
   * and to `"<METHOD>"` for unmatched ones, per the OTel HTTP semantic
   * conventions.
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
   * How the request query string is recorded as the `url.query` attribute.
   *
   * - omitted (default): redacted with the same rules the framework logger
   *   applies to logged URLs (`sanitizeUrlForLog`) — values of sensitive keys
   *   such as `code`, `access_token`, `id_token`, `X-Amz-Signature`, `sig`,
   *   and JWT/credential-shaped values become `[REDACTED]`.
   * - a function: receives the raw query (without `?`) and returns the value
   *   to record, or `undefined` to omit the attribute. You own the redaction.
   * - `false`: record the raw query verbatim. **Unsafe** — OAuth codes,
   *   bearer tokens and presigned-URL signatures reach the tracing backend.
   *
   * @since 1.3.7
   */
  redactQuery?: false | ((query: string) => string | undefined);
  /**
   * Key under which the active span is exposed on `ctx.state` for handlers.
   * Default: `"otelSpan"`.
   */
  stateKey?: string;
  /**
   * Rebind `ctx.state.log` to a child logger carrying `trace_id`, `span_id`,
   * and `trace_flags`, so handler log lines join their trace. Needs spans
   * that implement `spanContext()`. Default `false`; the
   * `telemetry: { traces: true }` App option turns it on.
   *
   * @since 1.11.0
   */
  correlateLogs?: boolean;
}

/** Minimal logger surface needed for {@link OtelTracingOptions.correlateLogs}. */
interface ChildLogger {
  child(bindings: Record<string, unknown>): unknown;
}

interface TracingEntry {
  span: TracingSpan;
  method: string;
  ended: boolean;
  /** Set by `onError`; the final status decides whether it marks the span. */
  hasError: boolean;
  error: unknown;
}

const REQUEST_TO_ENTRY: WeakMap<Request, TracingEntry> = new WeakMap();

const TRACE_ID_RE = /^[0-9a-f]{32}$/;
const SPAN_ID_RE = /^[0-9a-f]{16}$/;
const HEX2_RE = /^[0-9a-f]{2}$/;
const ZERO_TRACE_ID = "0".repeat(32);
const ZERO_SPAN_ID = "0".repeat(16);
/** Longest `traceparent` value considered; anything longer is ignored. */
const MAX_TRACEPARENT_LENGTH = 512;

function defaultSpanName(req: Request, path: string): string {
  const method = req.method.toUpperCase();
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

/**
 * Whether `sc` is a usable W3C span context: a 32-hex non-zero `traceId`, a
 * 16-hex non-zero `spanId` (lowercase), and integer `traceFlags` in `0..255`.
 *
 * @param sc - Candidate span context (any value is accepted and checked).
 * @returns `true` when the context can be used as a parent or propagated.
 * @since 1.11.0
 */
export function isValidSpanContext(sc: unknown): sc is TracingSpanContext {
  if (sc === null || typeof sc !== "object") return false;
  const { traceId, spanId, traceFlags } = sc as Partial<TracingSpanContext>;
  return (
    typeof traceId === "string" &&
    typeof spanId === "string" &&
    TRACE_ID_RE.test(traceId) &&
    SPAN_ID_RE.test(spanId) &&
    traceId !== ZERO_TRACE_ID &&
    spanId !== ZERO_SPAN_ID &&
    Number.isInteger(traceFlags) &&
    (traceFlags as number) >= 0 &&
    (traceFlags as number) <= 0xff
  );
}

/**
 * Parse a W3C Trace Context `traceparent` header
 * (`00-<32 hex trace-id>-<16 hex parent-id>-<2 hex flags>`).
 *
 * Strict by design, because the header is attacker-controlled on a public
 * edge: uppercase hex, all-zero ids, version `ff`, a malformed version-`00`
 * value, and values longer than 512 characters are all rejected. Future
 * versions are accepted by reading only their first four fields, as the spec
 * requires.
 *
 * Pass the result to a tracer as the parent, for example
 * `contextFromRequest: (req) => parseTraceparent(req.headers.get("traceparent"))`.
 *
 * @param header - The raw header value, or `null` / `undefined` when absent.
 * @returns The parent span context, or `undefined` when absent or invalid.
 * @since 1.11.0
 */
export function parseTraceparent(header: string | null | undefined): TracingSpanContext | undefined {
  if (typeof header !== "string" || header.length > MAX_TRACEPARENT_LENGTH) return undefined;
  const value = header.trim();
  if (value.length < 55) return undefined;
  const version = value.slice(0, 2);
  if (!HEX2_RE.test(version) || version === "ff") return undefined;
  // Version 00 is exactly 55 characters; a future version may append fields
  // after a "-" separator.
  if (version === "00" ? value.length !== 55 : value.length > 55 && value[55] !== "-") {
    return undefined;
  }
  if (value[2] !== "-" || value[35] !== "-" || value[52] !== "-") return undefined;
  const traceFlags = Number.parseInt(value.slice(53, 55), 16);
  if (!HEX2_RE.test(value.slice(53, 55))) return undefined;
  const sc = { traceId: value.slice(3, 35), spanId: value.slice(36, 52), traceFlags };
  return isValidSpanContext(sc) ? sc : undefined;
}

/**
 * Format a span context as a version-`00` W3C `traceparent` value, for
 * propagating the current trace to a downstream call:
 * `headers.set("traceparent", formatTraceparent(span.spanContext()))`.
 *
 * @param sc - A valid span context (see {@link isValidSpanContext}).
 * @returns The header value.
 * @throws {TypeError} When `sc` is not a valid span context.
 * @since 1.11.0
 */
export function formatTraceparent(sc: TracingSpanContext): string {
  if (!isValidSpanContext(sc)) throw new TypeError("formatTraceparent requires a valid span context.");
  return `00-${sc.traceId}-${sc.spanId}-${(sc.traceFlags & 0xff).toString(16).padStart(2, "0")}`;
}

/**
 * Middleware that wraps every request in an OpenTelemetry-compatible span.
 * Pass any tracer that matches the {@link TracingTracer} surface; DaloyJS
 * does not import `@opentelemetry/api` itself.
 *
 * @param opts Tracer plus optional span naming, attribute, and context
 *   extraction hooks; see {@link OtelTracingOptions}.
 *   The `url.query` attribute is redacted by default (see
 *   {@link OtelTracingOptions.redactQuery}).
 * @returns A {@link Hooks} object that starts a SERVER span per request,
 *   exposes it on `ctx.state[stateKey]`, records `http.route`, marks only
 *   `5xx` responses as errors (recording the thrown exception and
 *   `error.type`), and ends the span exactly once on send.
 */
export function otelTracing(opts: OtelTracingOptions): Hooks {
  const stateKey = opts.stateKey ?? "otelSpan";
  const redactQuery = opts.redactQuery;
  const renameSpans = opts.spanName === undefined;
  const recordQuery = (search: string): string | undefined => {
    const raw = search.slice(1);
    if (redactQuery === false) return raw;
    if (typeof redactQuery === "function") return redactQuery(raw);
    return sanitizeUrlQueryForLog(raw);
  };

  const startEntry = (req: Request): TracingEntry => {
    const existing = REQUEST_TO_ENTRY.get(req);
    if (existing) return existing;

    const url = safeParseUrl(req.url);
    const method = req.method.toUpperCase();
    // Path segments that are JWTs or provider credentials are redacted before
    // they become a span name or the `url.path` attribute (same rule as the
    // request logger); the span is later renamed to the route template.
    const path = url ? sanitizeUrlPathForLog(url.pathname) : "/";
    const name = opts.spanName ? opts.spanName(req) : defaultSpanName(req, path);

    const attrs: TracingAttributes = { "http.request.method": method };
    if (url) {
      attrs["url.path"] = path;
      attrs["url.scheme"] = url.protocol.replace(/:$/, "");
      // Per the OTel HTTP semantic conventions `server.address` is the host
      // WITHOUT the port (which belongs in `server.port`), so derive both from
      // `url.hostname`/`url.port` rather than `url.host` (which concatenates them).
      if (url.hostname) attrs["server.address"] = url.hostname;
      if (url.port) attrs["server.port"] = Number(url.port);
      if (url.search) {
        const query = recordQuery(url.search);
        if (query !== undefined) attrs["url.query"] = query;
      }
    }
    const ua = req.headers.get("user-agent");
    if (ua) attrs["user_agent.original"] = ua;

    const extra = opts.attributesFromRequest?.(req);
    if (extra) Object.assign(attrs, extra);

    const parentContext = opts.contextFromRequest?.(req);
    const span = opts.tracer.startSpan(
      name,
      {
        kind: TRACING_SPAN_KIND_SERVER,
        attributes: attrs,
      },
      parentContext
    );
    opts.onSpanStart?.(req, span);

    const entry: TracingEntry = {
      span,
      method,
      ended: false,
      hasError: false,
      error: undefined,
    };
    REQUEST_TO_ENTRY.set(req, entry);
    return entry;
  };

  return {
    onRequest(req) {
      startEntry(req);
    },
    beforeHandle(ctx) {
      const entry = startEntry(ctx.request);
      const state = ctx.state as Record<string, unknown>;
      state[stateKey] = entry.span;
      if (opts.correlateLogs === true) {
        const sc = entry.span.spanContext?.();
        const log = state.log as ChildLogger | undefined;
        if (isValidSpanContext(sc) && typeof log?.child === "function") {
          state.log = log.child({
            trace_id: sc.traceId,
            span_id: sc.spanId,
            trace_flags: (sc.traceFlags & 0xff).toString(16).padStart(2, "0"),
          });
        }
      }
    },
    onError(err, ctx) {
      if (!ctx) return;
      const entry = REQUEST_TO_ENTRY.get(ctx.request);
      if (!entry || entry.ended) return;
      // Deferred to onSend: whether the error marks the span depends on the
      // final status (a thrown 404 / 401 / 422 is not a server error).
      entry.hasError = true;
      entry.error = err;
    },
    onSend(res, ctx) {
      if (!ctx) return;
      const entry = REQUEST_TO_ENTRY.get(ctx.request);
      if (!entry || entry.ended) return;
      entry.ended = true;
      const span = entry.span;
      const attrs: TracingAttributes = { "http.response.status_code": res.status };
      // The matched route template is bounded by the route table, so it is
      // safe as a span name and attribute; the raw pathname is not.
      const route = ctx.routePath;
      if (typeof route === "string") attrs["http.route"] = route;
      if (renameSpans && typeof span.updateName === "function") {
        span.updateName(typeof route === "string" ? `${entry.method} ${route}` : entry.method);
      }
      if (res.status >= 500) {
        const err = entry.error;
        if (entry.hasError && err instanceof Error) {
          span.recordException?.(err);
          attrs["error.type"] = err.name || "Error";
          span.setStatus({ code: TRACING_SPAN_STATUS_ERROR, message: err.message });
        } else {
          attrs["error.type"] = String(res.status);
          span.setStatus({ code: TRACING_SPAN_STATUS_ERROR });
        }
      }
      const extra = opts.attributesFromResponse?.(res);
      if (extra) Object.assign(attrs, extra);
      setSpanAttributes(span, attrs);
      span.end();
    },
  };
}
