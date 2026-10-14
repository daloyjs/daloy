/**
 * OpenTelemetry OTLP push export — logs, metrics, traces, and
 * semantic-convention HTTP server instrumentation, with zero runtime
 * dependencies.
 *
 * Many container platforms run an in-cluster OTel collector and expect
 * workloads to **push** telemetry: they inject the standard
 * `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_HEADERS` /
 * `OTEL_RESOURCE_ATTRIBUTES` / `OTEL_SERVICE_NAME` variables into every
 * container and scrape nothing — not stdout, not a `/metrics` route. The
 * OTel Node SDK covers that with monkey-patching auto-instrumentation, but
 * its ESM loader hooks are fragile on modern Node and unavailable on edge
 * runtimes. This module is the framework-native alternative:
 *
 * - {@link createOtlpLogExporter} — batched OTLP/HTTP JSON log export;
 *   tee your logger's `write` sink into it.
 * - {@link createOtlpMetricsExporter} — cumulative counters + histograms
 *   pushed as OTLP/HTTP JSON.
 * - {@link createOtlpTracer} — a {@link TracingTracer} for `otelTracing()`
 *   that batches spans and pushes them as OTLP/HTTP JSON.
 * - {@link semconvHttpMetrics} — a `Hooks` bundle emitting
 *   `http.server.request.duration` exactly per the OTel HTTP semantic
 *   conventions (names, attributes, bucket boundaries), so standard Grafana
 *   dashboards work unchanged.
 * - `new App({ telemetry: true })` wires all of the above automatically
 *   (see {@link TelemetryOptions}).
 *
 * Everything is transport-portable (`fetch` + web-standard primitives) and
 * **fail-safe by contract**: a dead or misconfigured collector never affects
 * request serving — bounded queues, dropped-batch counters, no retry storms,
 * a timeout on every export POST, and cumulative metric temporality so
 * totals survive failed pushes. Long-lived runtimes flush on an `unref`'d
 * interval plus graceful shutdown; isolate runtimes (Workers, Vercel, Lambda)
 * flush per request via the adapters' `waitUntil` / handler-await path.
 *
 * @module
 * @since 1.2.0
 */

import type { BaseContext, Hooks } from "./types.js";
import {
  otelTracing,
  parseTraceparent,
  isValidSpanContext,
  type TracingAttributes,
  type TracingAttributeValue,
  type TracingSpan,
  type TracingSpanContext,
  type TracingStartSpanOptions,
  type TracingTracer,
} from "./tracing.js";

/** One OTLP string attribute (`{ key, value: { stringValue } }`). */
interface OtlpAttr {
  key: string;
  value: { stringValue: string };
}

/**
 * Shared configuration for {@link createOtlpLogExporter},
 * {@link createOtlpMetricsExporter}, and {@link createOtlpTracer}. Every
 * field falls back to the standard `OTEL_*` environment variables, so on
 * platforms that inject them no explicit configuration is needed at all.
 *
 * Two operator kill switches are always honored, even with an explicit
 * `endpoint`: `OTEL_SDK_DISABLED=true` disables every exporter, and
 * `OTEL_LOGS_EXPORTER` / `OTEL_METRICS_EXPORTER` / `OTEL_TRACES_EXPORTER`
 * set to `none` disables that signal.
 *
 * @since 1.2.0
 */
export interface OtlpExporterOptions {
  /**
   * Collector base URL. Defaults to the signal-specific
   * `OTEL_EXPORTER_OTLP_{LOGS,METRICS,TRACES}_ENDPOINT` (used as-is, per the
   * spec), then `OTEL_EXPORTER_OTLP_ENDPOINT`. For a base URL the
   * conventional injected value is the gRPC form (`http://host:4317`); a
   * trailing `:4317` is rewritten to `:4318`, the collector's OTLP/HTTP port,
   * and the signal path (`/v1/logs`, `/v1/metrics`, `/v1/traces`) is
   * appended automatically.
   */
  endpoint?: string;
  /**
   * Extra request headers. Defaults to `OTEL_EXPORTER_OTLP_HEADERS`
   * (`key=value,key2=value2`), overlaid with the signal-specific
   * `OTEL_EXPORTER_OTLP_{LOGS,METRICS,TRACES}_HEADERS`. Multi-tenant
   * collectors route on these (e.g. `tenant_id=...`), so treat the values as
   * credentials: DaloyJS never logs them and never includes them in errors.
   */
  headers?: Record<string, string>;
  /**
   * OTLP resource attributes. Defaults to `OTEL_RESOURCE_ATTRIBUTES`
   * (`key=value,...`) plus `service.name` from `OTEL_SERVICE_NAME` when not
   * already present.
   */
  resourceAttributes?: Record<string, string>;
  /**
   * Flush cadence in ms on runtimes with timers (`unref`'d — never keeps the
   * process alive). Defaults: 5000 (logs, traces), 15000 (metrics). Set `0`
   * to disable the timer and flush manually / on shutdown / via the
   * serverless adapters' per-request flush.
   */
  flushIntervalMs?: number;
  /**
   * Abort an in-flight export POST after this many ms so a blackholed
   * collector cannot stall flushing forever. Defaults to the signal-specific
   * `OTEL_EXPORTER_OTLP_{LOGS,METRICS,TRACES}_TIMEOUT`, then
   * `OTEL_EXPORTER_OTLP_TIMEOUT`, then `5000`. Set `0` to wait indefinitely
   * (tests that drive `fetch` themselves).
   */
  flushTimeoutMs?: number;
  /** Injectable transport for tests. Default `globalThis.fetch`. */
  fetch?: typeof fetch;
}

/**
 * Batched OTLP/HTTP JSON **log** exporter returned by
 * {@link createOtlpLogExporter}.
 *
 * @since 1.2.0
 */
export interface OtlpLogExporter {
  /**
   * Queue one log line (no trailing newline). JSON lines are decomposed:
   * `msg`/`message`/`event` becomes the record body, `level` maps to the
   * OTLP severity, valid `trace_id` / `span_id` / `trace_flags` fields become
   * the record's trace context (so the line links to its trace), and every
   * remaining field ships as a string attribute (surfacing as structured
   * metadata in Loki-style backends). Non-JSON lines ship verbatim as the
   * body.
   */
  pushLine(line: string): void;
  /**
   * Push pending records now. Never rejects; failures count as drops. A call
   * made while an export is in flight waits for it and then exports whatever
   * was queued meanwhile, so an awaited flush always covers prior lines.
   */
  flush(): Promise<void>;
  /**
   * Mixed drop counter: overflowed log *lines* (one per `shift()` at the
   * queue cap) plus failed export *POSTs* (collector 4xx/5xx, network error,
   * timeout, or disallowed redirect). Not a count of failed HTTP batches
   * alone — compare against queue depth under load, not "POSTs that failed".
   */
  readonly droppedBatches: number;
}

/**
 * Histogram configuration for {@link OtlpMetricsExporter.record}.
 *
 * @since 1.2.0
 */
export interface OtlpHistogramOptions {
  /** UCUM unit, e.g. `"s"` or `"{token}"`. */
  unit: string;
  /** Explicit bucket upper bounds, ascending. */
  boundaries: readonly number[];
}

/**
 * Cumulative OTLP/HTTP JSON **metrics** exporter returned by
 * {@link createOtlpMetricsExporter}. Counters and histograms use cumulative
 * temporality, so a failed push is self-healing: the totals are retained and
 * the next successful push carries them.
 *
 * @since 1.2.0
 */
export interface OtlpMetricsExporter {
  /** Add `value` (default `1`, must be finite and non-negative) to the counter series `name` + `attributes`. */
  count(name: string, attributes: Record<string, string>, value?: number): void;
  /** Record one observation into the histogram series `name` + `attributes`. */
  record(
    name: string,
    attributes: Record<string, string>,
    value: number,
    options: OtlpHistogramOptions,
  ): void;
  /**
   * Push the current state now. Never rejects; failures count as drops. A
   * call made while an export is in flight waits for it and then pushes again
   * if anything changed meanwhile.
   */
  flush(): Promise<void>;
  /**
   * Mixed drop counter: failed export *POSTs* (collector 4xx/5xx, network
   * error, timeout, or disallowed redirect) plus *series* refused at the
   * cardinality cap. A cardinality attack inflates this without any POST
   * failing.
   */
  readonly droppedBatches: number;
}

/** Log-queue and batching caps (drop-oldest beyond the queue cap). */
const LOG_MAX_BATCH = 100;
const LOG_MAX_QUEUE = 1_000;
const LOG_FLUSH_INTERVAL_MS = 5_000;
/** Longest log body / attribute value shipped before truncation. */
const LOG_MAX_FIELD_LENGTH = 8_192;

const METRICS_FLUSH_INTERVAL_MS = 15_000;
/** Default abort timeout for an in-flight OTLP POST. */
const DEFAULT_FLUSH_TIMEOUT_MS = 5_000;
/**
 * Cardinality guard: total metric series (counter + histogram) before new
 * series are dropped and counted. A hostile client must not be able to mint
 * unbounded series through attribute values.
 */
const METRICS_MAX_SERIES = 2_000;
/** Longest metric attribute value before truncation (cardinality + memory guard). */
const METRICS_MAX_ATTR_LENGTH = 256;

/** Span-queue and batching caps (drop-oldest beyond the queue cap). */
const SPAN_MAX_BATCH = 512;
const SPAN_MAX_QUEUE = 2_048;
const SPAN_FLUSH_INTERVAL_MS = 5_000;
/** Per-span caps, so one hostile or buggy attribute source cannot grow a span without bound. */
const SPAN_MAX_ATTRIBUTES = 128;
const SPAN_MAX_EVENTS = 128;
const SPAN_MAX_ATTR_LENGTH = 4_096;
const SPAN_MAX_ARRAY_LENGTH = 128;
const SPAN_MAX_NAME_LENGTH = 512;

/**
 * Spec-defined default bucket boundaries for `http.server.request.duration`,
 * in seconds (OTel HTTP semantic conventions).
 *
 * @since 1.2.0
 */
export const HTTP_SERVER_REQUEST_DURATION_BUCKETS: readonly number[] = [
  0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
];

/** OTLP severity numbers keyed by the framework logger's level names. */
const SEVERITY: Record<string, [number, string]> = {
  trace: [1, "TRACE"],
  debug: [5, "DEBUG"],
  info: [9, "INFO"],
  warn: [13, "WARN"],
  error: [17, "ERROR"],
  fatal: [21, "FATAL"],
};

/** Known HTTP methods per the semconv `http.request.method` well-known set. */
const KNOWN_METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "DELETE",
  "CONNECT",
  "OPTIONS",
  "TRACE",
  "PATCH",
]);

/** The three OTLP signals and their OTLP/HTTP paths. */
type OtlpSignal = "logs" | "metrics" | "traces";
const SIGNAL_PATHS: Record<OtlpSignal, string> = {
  logs: "/v1/logs",
  metrics: "/v1/metrics",
  traces: "/v1/traces",
};

/** Portable environment lookup (Node/Bun/Deno-with-node-compat; undefined elsewhere). */
function envVar(name: string): string | undefined {
  const env = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env;
  return env?.[name];
}

/** Decode one OTEL env-list component; invalid percent-encoding is kept raw. */
function decodeOtelComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Parse `key=value,key2=value2` lists (`OTEL_EXPORTER_OTLP_HEADERS` /
 * `OTEL_RESOURCE_ATTRIBUTES`). Spec values are percent-encoded; commas in a
 * value must be `%2C`.
 */
function parseKvList(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const pair of raw.split(",")) {
    const trimmed = pair.trim();
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = decodeOtelComponent(trimmed.slice(0, idx).trim());
    if (key.length === 0) continue;
    out[key] = decodeOtelComponent(trimmed.slice(idx + 1).trim());
  }
  return out;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

function toAttrList(
  record: Record<string, string>,
  maxLength: number,
): OtlpAttr[] {
  return Object.entries(record).map(([key, value]) => ({
    key,
    value: { stringValue: truncate(value, maxLength) },
  }));
}

/**
 * Whether the operator switched `signal` off: `OTEL_SDK_DISABLED=true`, or
 * `OTEL_{SIGNAL}_EXPORTER` listing `none`.
 */
function signalDisabled(signal: OtlpSignal): boolean {
  if ((envVar("OTEL_SDK_DISABLED") ?? "").trim().toLowerCase() === "true") {
    return true;
  }
  const exporters = envVar(`OTEL_${signal.toUpperCase()}_EXPORTER`);
  return (
    exporters !== undefined &&
    exporters.split(",").some((e) => e.trim().toLowerCase() === "none")
  );
}

/** Base URL normalization: drop trailing slashes, rewrite gRPC `:4317` to `:4318`. */
function normalizeBase(raw: string): string {
  return raw.trim().replace(/\/+$/, "").replace(/:4317$/, ":4318");
}

/** Parse a millisecond timeout env var; `undefined` when unset or invalid. */
function envTimeout(name: string): number | undefined {
  const raw = envVar(name);
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * The full export URL for `signal`: explicit `endpoint` (base + path), else
 * the signal-specific env var (as-is), else the generic env var (base +
 * path). `undefined` when none is configured.
 */
function resolveSignalUrl(
  signal: OtlpSignal,
  endpoint: string | undefined,
): string | undefined {
  if (endpoint !== undefined) {
    return endpoint === "" ? undefined : normalizeBase(endpoint) + SIGNAL_PATHS[signal];
  }
  const signalEndpoint = envVar(
    `OTEL_EXPORTER_OTLP_${signal.toUpperCase()}_ENDPOINT`,
  )?.trim();
  if (signalEndpoint) return signalEndpoint;
  const base = envVar("OTEL_EXPORTER_OTLP_ENDPOINT");
  return base ? normalizeBase(base) + SIGNAL_PATHS[signal] : undefined;
}

/** Resolved transport shared by every exporter; null when no endpoint is configured. */
interface OtlpTransport {
  url: string;
  headers: Record<string, string>;
  resourceAttributes: OtlpAttr[];
  fetchImpl: typeof fetch;
  timeoutMs: number;
}

function resolveTransport(
  signal: OtlpSignal,
  opts: OtlpExporterOptions,
): OtlpTransport | null {
  if (signalDisabled(signal)) return null;
  const url = resolveSignalUrl(signal, opts.endpoint);
  if (url === undefined) return null;
  const SIGNAL = signal.toUpperCase();
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  Object.assign(
    headers,
    parseKvList(envVar("OTEL_EXPORTER_OTLP_HEADERS")),
    parseKvList(envVar(`OTEL_EXPORTER_OTLP_${SIGNAL}_HEADERS`)),
    opts.headers ?? {},
  );
  const resource: Record<string, string> = parseKvList(
    envVar("OTEL_RESOURCE_ATTRIBUTES"),
  );
  const serviceName = envVar("OTEL_SERVICE_NAME");
  if (serviceName && resource["service.name"] === undefined) {
    resource["service.name"] = serviceName;
  }
  Object.assign(resource, opts.resourceAttributes ?? {});
  return {
    url,
    headers,
    resourceAttributes: toAttrList(resource, LOG_MAX_FIELD_LENGTH),
    fetchImpl: opts.fetch ?? fetch,
    timeoutMs:
      opts.flushTimeoutMs ??
      envTimeout(`OTEL_EXPORTER_OTLP_${SIGNAL}_TIMEOUT`) ??
      envTimeout("OTEL_EXPORTER_OTLP_TIMEOUT") ??
      DEFAULT_FLUSH_TIMEOUT_MS,
  };
}

/** Start an `unref`'d repeating flush where the runtime supports timers. */
function startFlushTimer(intervalMs: number, flush: () => Promise<void>): void {
  if (intervalMs <= 0 || typeof setInterval !== "function") return;
  const timer = setInterval(() => void flush(), intervalMs) as {
    unref?: () => unknown;
  };
  timer.unref?.();
}

/**
 * Serialize flushes. A call made while an export is in flight does not
 * return early (which would let a shutdown or `waitUntil` flush resolve
 * before the data queued meanwhile was sent); it waits for the in-flight
 * export and then runs again. `run` must never reject.
 */
function singleFlightFlush(run: () => Promise<void>): () => Promise<void> {
  let inFlight: Promise<void> | undefined;
  const flush = (): Promise<void> => {
    if (inFlight !== undefined) return inFlight.then(flush);
    const current = run().finally(() => {
      if (inFlight === current) inFlight = undefined;
    });
    inFlight = current;
    return current;
  };
  return flush;
}

/** AbortSignal that fires after `timeoutMs`, or `undefined` when timeout is disabled. */
function flushSignal(timeoutMs: number): AbortSignal | undefined {
  if (timeoutMs <= 0) return undefined;
  if (
    typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
  ) {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs) as {
    unref?: () => unknown;
  };
  timer.unref?.();
  return controller.signal;
}

/** Shared POST init: never follow redirects (tenant headers would leak). */
function exportRequestInit(
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): RequestInit {
  const init: RequestInit = {
    method: "POST",
    headers,
    body,
    redirect: "error",
  };
  const signal = flushSignal(timeoutMs);
  if (signal !== undefined) init.signal = signal;
  return init;
}

/**
 * Display form of a collector URL: origin + path only. Userinfo, query, and
 * fragment are dropped because they can carry credentials
 * (`https://user:token@host`, `?api_key=`).
 */
function redactEndpoint(raw: string): string {
  try {
    const url = new URL(raw);
    return url.origin + (url.pathname === "/" ? "" : url.pathname);
  } catch {
    return "[unparseable endpoint]";
  }
}

const HEX32_RE = /^[0-9a-f]{32}$/;
const HEX16_RE = /^[0-9a-f]{16}$/;
const HEX2_RE = /^[0-9a-f]{2}$/;

/** Shape of one OTLP log record in the JSON protobuf mapping. */
interface OtlpLogRecord {
  timeUnixNano: string;
  severityNumber: number;
  severityText: string;
  body: { stringValue: string };
  attributes: OtlpAttr[];
  traceId?: string;
  spanId?: string;
  flags?: number;
}

function toLogRecord(line: string): OtlpLogRecord {
  let level = "info";
  let body = line;
  const attributes: OtlpAttr[] = [];
  let traceId: string | undefined;
  let spanId: string | undefined;
  let flags: number | undefined;
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    if (typeof parsed.level === "string") level = parsed.level;
    const msg = parsed.msg ?? parsed.message ?? parsed.event;
    body = typeof msg === "string" ? msg : line;
    // Trace correlation (bound by otelTracing({ correlateLogs: true })). Only
    // well-formed ids are promoted; anything else stays a plain attribute.
    if (
      typeof parsed.trace_id === "string" &&
      typeof parsed.span_id === "string" &&
      HEX32_RE.test(parsed.trace_id) &&
      HEX16_RE.test(parsed.span_id)
    ) {
      traceId = parsed.trace_id;
      spanId = parsed.span_id;
      if (typeof parsed.trace_flags === "string" && HEX2_RE.test(parsed.trace_flags)) {
        flags = Number.parseInt(parsed.trace_flags, 16);
      }
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (key === "level" || key === "msg" || key === "message") continue;
      if (
        traceId !== undefined &&
        (key === "trace_id" || key === "span_id" || key === "trace_flags")
      ) {
        continue;
      }
      attributes.push({
        key,
        value: {
          stringValue: truncate(
            typeof value === "string"
              ? value
              : (JSON.stringify(value) ?? "null"),
            LOG_MAX_FIELD_LENGTH,
          ),
        },
      });
    }
  } catch {
    // Not a JSON object (boot banner etc.) — ship verbatim as the body.
  }
  const [severityNumber, severityText] = SEVERITY[level] ?? SEVERITY.info!;
  const record: OtlpLogRecord = {
    timeUnixNano: (BigInt(Date.now()) * 1_000_000n).toString(),
    severityNumber,
    severityText,
    body: { stringValue: truncate(body, LOG_MAX_FIELD_LENGTH) },
    attributes,
  };
  if (traceId !== undefined) {
    record.traceId = traceId;
    record.spanId = spanId;
    if (flags !== undefined) record.flags = flags;
  }
  return record;
}

/**
 * Create a batched OTLP/HTTP JSON log exporter, or `null` when no endpoint is
 * configured (local development, tests) or the operator disabled logs, so
 * callers can no-op cheaply.
 *
 * Fail-safe by contract: {@link OtlpLogExporter.flush} never rejects, a dead
 * collector cannot grow the queue past its cap (oldest records are dropped
 * and counted), and export work is decoupled from request handling.
 *
 * @param opts - Endpoint/header/resource overrides; defaults from `OTEL_*` env vars.
 * @returns The exporter, or `null` when no endpoint is configured.
 * @since 1.2.0
 */
export function createOtlpLogExporter(
  opts: OtlpExporterOptions = {},
): OtlpLogExporter | null {
  const transport = resolveTransport("logs", opts);
  if (transport === null) return null;
  const { url, headers, resourceAttributes, fetchImpl, timeoutMs } = transport;

  const queue: OtlpLogRecord[] = [];
  let dropped = 0;

  const flush = singleFlightFlush(async () => {
    try {
      while (queue.length > 0) {
        const batch = queue.splice(0, LOG_MAX_BATCH);
        const payload = {
          resourceLogs: [
            {
              resource: { attributes: resourceAttributes },
              scopeLogs: [{ scope: { name: "daloyjs" }, logRecords: batch }],
            },
          ],
        };
        const res = await fetchImpl(
          url,
          exportRequestInit(headers, JSON.stringify(payload), timeoutMs),
        );
        if (!res.ok) dropped += 1;
      }
    } catch {
      dropped += 1;
      queue.length = 0; // never let a dead collector grow the queue
    }
  });

  startFlushTimer(opts.flushIntervalMs ?? LOG_FLUSH_INTERVAL_MS, flush);

  return {
    pushLine(line: string): void {
      if (queue.length >= LOG_MAX_QUEUE) {
        queue.shift();
        dropped += 1;
      }
      queue.push(toLogRecord(line.endsWith("\n") ? line.trimEnd() : line));
    },
    flush,
    get droppedBatches() {
      return dropped;
    },
  };
}

interface CounterSeries {
  name: string;
  attributes: OtlpAttr[];
  total: number;
  startTimeUnixNano: string;
}

interface HistogramSeries {
  name: string;
  unit: string;
  boundaries: readonly number[];
  attributes: OtlpAttr[];
  count: number;
  sum: number;
  bucketCounts: number[]; // boundaries.length + 1 (last = overflow)
  startTimeUnixNano: string;
}

/**
 * Create a cumulative OTLP/HTTP JSON metrics exporter, or `null` when no
 * endpoint is configured or the operator disabled metrics.
 *
 * Counters export as monotonic cumulative sums and histograms as cumulative
 * explicit-bounds histograms, so state survives failed pushes (the next
 * successful push carries the accumulated totals). Total series are capped
 * ({@link OtlpMetricsExporter.droppedBatches} counts series refused at the
 * cap) and attribute values are length-truncated — both cardinality guards
 * against hostile or buggy attribute sources.
 *
 * @param opts - Endpoint/header/resource overrides; defaults from `OTEL_*` env vars.
 * @returns The exporter, or `null` when no endpoint is configured.
 * @since 1.2.0
 */
export function createOtlpMetricsExporter(
  opts: OtlpExporterOptions = {},
): OtlpMetricsExporter | null {
  const transport = resolveTransport("metrics", opts);
  if (transport === null) return null;
  const { url, headers, resourceAttributes, fetchImpl, timeoutMs } = transport;

  const counters = new Map<string, CounterSeries>();
  const histograms = new Map<string, HistogramSeries>();
  let dropped = 0;
  let dirty = false;

  function seriesKey(name: string, entries: [string, string][]): string {
    let key = name;
    for (const [k, v] of entries) key += "|" + k + "=" + v;
    return key;
  }

  function sortedEntries(
    attributes: Record<string, string>,
  ): [string, string][] {
    return Object.entries(attributes)
      .map(([k, v]): [string, string] => [
        k,
        truncate(v, METRICS_MAX_ATTR_LENGTH),
      ])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  }

  function atCapacity(): boolean {
    if (counters.size + histograms.size < METRICS_MAX_SERIES) return false;
    dropped += 1;
    return true;
  }

  const flush = singleFlightFlush(async () => {
    if (!dirty) return;
    // Clear before the POST so a concurrent count/record keeps the flag true
    // and the next flush carries the in-flight increment.
    dirty = false;
    try {
      const now = (BigInt(Date.now()) * 1_000_000n).toString();
      const sumsByName = new Map<string, CounterSeries[]>();
      for (const s of counters.values()) {
        const group = sumsByName.get(s.name);
        if (group === undefined) sumsByName.set(s.name, [s]);
        else group.push(s);
      }
      const histsByName = new Map<string, HistogramSeries[]>();
      for (const h of histograms.values()) {
        const group = histsByName.get(h.name);
        if (group === undefined) histsByName.set(h.name, [h]);
        else group.push(h);
      }
      const metrics: unknown[] = [];
      for (const [name, group] of sumsByName) {
        metrics.push({
          name,
          unit: "1",
          sum: {
            aggregationTemporality: 2, // cumulative
            isMonotonic: true,
            dataPoints: group.map((s) => ({
              attributes: s.attributes,
              startTimeUnixNano: s.startTimeUnixNano,
              timeUnixNano: now,
              asDouble: s.total,
            })),
          },
        });
      }
      for (const [name, group] of histsByName) {
        metrics.push({
          name,
          unit: group[0]!.unit,
          histogram: {
            aggregationTemporality: 2, // cumulative
            dataPoints: group.map((h) => ({
              attributes: h.attributes,
              startTimeUnixNano: h.startTimeUnixNano,
              timeUnixNano: now,
              // uint64 fields use the string JSON mapping in OTLP.
              count: String(h.count),
              sum: h.sum,
              bucketCounts: h.bucketCounts.map(String),
              explicitBounds: [...h.boundaries],
            })),
          },
        });
      }
      const payload = {
        resourceMetrics: [
          {
            resource: { attributes: resourceAttributes },
            scopeMetrics: [{ scope: { name: "daloyjs" }, metrics }],
          },
        ],
      };
      const res = await fetchImpl(
        url,
        exportRequestInit(headers, JSON.stringify(payload), timeoutMs),
      );
      if (!res.ok) {
        dropped += 1;
        dirty = true;
      }
    } catch {
      dropped += 1;
      dirty = true; // totals retained; cumulative temporality self-heals
    }
  });

  startFlushTimer(opts.flushIntervalMs ?? METRICS_FLUSH_INTERVAL_MS, flush);

  return {
    count(name: string, attributes: Record<string, string>, value = 1): void {
      if (!Number.isFinite(value) || value < 0) return;
      const entries = sortedEntries(attributes);
      const key = seriesKey(name, entries);
      let s = counters.get(key);
      if (s === undefined) {
        if (atCapacity()) return;
        s = {
          name,
          attributes: entries.map(([k, v]) => ({
            key: k,
            value: { stringValue: v },
          })),
          total: 0,
          startTimeUnixNano: (BigInt(Date.now()) * 1_000_000n).toString(),
        };
        counters.set(key, s);
      }
      s.total += value;
      dirty = true;
    },
    record(
      name: string,
      attributes: Record<string, string>,
      value: number,
      options: OtlpHistogramOptions,
    ): void {
      if (!Number.isFinite(value)) return;
      const entries = sortedEntries(attributes);
      const key = seriesKey(name, entries);
      let h = histograms.get(key);
      if (h === undefined) {
        if (atCapacity()) return;
        h = {
          name,
          unit: options.unit,
          boundaries: options.boundaries,
          attributes: entries.map(([k, v]) => ({
            key: k,
            value: { stringValue: v },
          })),
          count: 0,
          sum: 0,
          bucketCounts: new Array<number>(options.boundaries.length + 1).fill(
            0,
          ),
          startTimeUnixNano: (BigInt(Date.now()) * 1_000_000n).toString(),
        };
        histograms.set(key, h);
      }
      h.count += 1;
      h.sum += value;
      let bucket = h.boundaries.findIndex((bound) => value <= bound);
      if (bucket === -1) bucket = h.boundaries.length;
      h.bucketCounts[bucket]! += 1;
      dirty = true;
    },
    flush,
    get droppedBatches() {
      return dropped;
    },
  };
}

// ------------------------------------------------------------------ traces

/**
 * Options for {@link createOtlpTracer}: the shared exporter options plus a
 * sampling ratio.
 *
 * @since 1.11.0
 */
export interface OtlpTracerOptions extends OtlpExporterOptions {
  /**
   * Fraction of new root traces to record, from `0` to `1`. Spans with a
   * parent follow the parent's sampled flag (parent-based sampling), so a
   * trace is kept or dropped as a whole. The decision is derived from the
   * trace id, so it needs no randomness of its own.
   *
   * Defaults to the standard `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG`
   * (`always_on`, `always_off`, `traceidratio`, and the `parentbased_*`
   * forms), else `1`.
   *
   * @throws {RangeError} At creation when not a number in `[0, 1]`.
   */
  sampleRatio?: number;
}

/**
 * Span returned by {@link OtlpTracer.startSpan}. Implements the full
 * {@link TracingSpan} surface, including `updateName` and `spanContext`.
 *
 * @since 1.11.0
 */
export interface OtlpSpan extends TracingSpan {
  /** Set several attributes at once. */
  setAttributes(attrs: TracingAttributes): void;
  /** Add an `exception` event (`exception.type`, `.message`, `.stacktrace`). */
  recordException(err: unknown): void;
  /** Rename the span. */
  updateName(name: string): void;
  /** W3C identity, for log correlation and `traceparent` propagation. */
  spanContext(): TracingSpanContext;
  /** Add a timestamped event. Capped at 128 events per span. */
  addEvent(name: string, attributes?: TracingAttributes): void;
  /** `false` for spans the sampler dropped; every method is then a no-op. */
  isRecording(): boolean;
}

/**
 * Dependency-free OTLP/HTTP JSON tracer returned by {@link createOtlpTracer}.
 * Pass it to `otelTracing({ tracer })`, or let `telemetry: { traces: true }`
 * do that for you.
 *
 * @since 1.11.0
 */
export interface OtlpTracer extends TracingTracer {
  /**
   * Start a span. `parent` may be a span (`ctx.state.otelSpan`, for a child
   * span), a span context (for example from `parseTraceparent()`), or
   * omitted for a new root trace. Invalid parents are ignored.
   */
  startSpan(
    name: string,
    options?: TracingStartSpanOptions,
    parent?: unknown,
  ): OtlpSpan;
  /**
   * Push ended spans now. Never rejects; failures count as drops. A call made
   * while an export is in flight waits for it, then exports the rest.
   */
  flush(): Promise<void>;
  /**
   * Mixed drop counter: ended *spans* discarded at the queue cap plus failed
   * export *POSTs* (collector 4xx/5xx, network error, timeout, or disallowed
   * redirect).
   */
  readonly droppedBatches: number;
}

interface Sampler {
  parentBased: boolean;
  ratio: number;
}

function resolveSampler(sampleRatio: number | undefined): Sampler {
  if (sampleRatio !== undefined) {
    if (typeof sampleRatio !== "number" || !(sampleRatio >= 0 && sampleRatio <= 1)) {
      throw new RangeError("createOtlpTracer sampleRatio must be a number between 0 and 1.");
    }
    return { parentBased: true, ratio: sampleRatio };
  }
  const rawArg = envVar("OTEL_TRACES_SAMPLER_ARG");
  const arg = rawArg === undefined || rawArg.trim() === "" ? NaN : Number(rawArg);
  const ratio = arg >= 0 && arg <= 1 ? arg : 1;
  switch ((envVar("OTEL_TRACES_SAMPLER") ?? "").trim().toLowerCase()) {
    case "always_on":
      return { parentBased: false, ratio: 1 };
    case "always_off":
      return { parentBased: false, ratio: 0 };
    case "traceidratio":
      return { parentBased: false, ratio };
    case "parentbased_always_off":
      return { parentBased: true, ratio: 0 };
    case "parentbased_traceidratio":
      return { parentBased: true, ratio };
    default:
      return { parentBased: true, ratio: 1 };
  }
}

/** Trace-id-ratio decision on the low 52 bits (exact in a double). */
function sampledByRatio(traceId: string, ratio: number): boolean {
  if (ratio >= 1) return true;
  if (ratio <= 0) return false;
  return Number.parseInt(traceId.slice(-13), 16) < ratio * 2 ** 52;
}

/** Lowercase hex of `bytes` CSPRNG bytes, never all zeros (an invalid W3C id). */
function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  do {
    globalThis.crypto.getRandomValues(buf);
  } while (buf.every((b) => b === 0));
  let out = "";
  for (const b of buf) out += (b < 16 ? "0" : "") + b.toString(16);
  return out;
}

/** Resolve a span or span context into a parent context; `undefined` when unusable. */
function parentContextOf(parent: unknown): TracingSpanContext | undefined {
  if (parent === null || typeof parent !== "object") return undefined;
  const candidate =
    typeof (parent as TracingSpan).spanContext === "function"
      ? (parent as TracingSpan).spanContext!()
      : parent;
  return isValidSpanContext(candidate) ? candidate : undefined;
}

/** Epoch-anchored nanosecond clock with sub-millisecond resolution. */
function createClock(): () => bigint {
  const wallBaseMs = Date.now();
  const perfBaseMs = nowMs();
  return () => msToNanos(wallBaseMs + (nowMs() - perfBaseMs));
}

function msToNanos(ms: number): bigint {
  const whole = Math.trunc(ms);
  return BigInt(whole) * 1_000_000n + BigInt(Math.round((ms - whole) * 1e6));
}

/** OTLP `AnyValue` JSON shape. */
type OtlpAnyValue =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: string }
  | { doubleValue: number }
  | { arrayValue: { values: OtlpAnyValue[] } };

function toAnyValue(value: unknown): OtlpAnyValue {
  if (typeof value === "string") return { stringValue: truncate(value, SPAN_MAX_ATTR_LENGTH) };
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") {
    // int64 uses the string JSON mapping; NaN / Infinity are not valid JSON.
    if (Number.isSafeInteger(value)) return { intValue: String(value) };
    if (Number.isFinite(value)) return { doubleValue: value };
    return { stringValue: String(value) };
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.slice(0, SPAN_MAX_ARRAY_LENGTH).map((item) => toAnyValue(item)),
      },
    };
  }
  return { stringValue: truncate(String(value), SPAN_MAX_ATTR_LENGTH) };
}

function toKeyValues(attrs: Map<string, TracingAttributeValue>): Array<{ key: string; value: OtlpAnyValue }> {
  const out: Array<{ key: string; value: OtlpAnyValue }> = [];
  for (const [key, value] of attrs) out.push({ key, value: toAnyValue(value) });
  return out;
}

/** Fill `target` from `source`, honoring the per-span attribute cap; returns how many were dropped. */
function mergeAttributes(
  target: Map<string, TracingAttributeValue>,
  source: TracingAttributes | undefined,
): number {
  if (source === undefined || source === null || typeof source !== "object") return 0;
  let dropped = 0;
  for (const key of Object.keys(source)) {
    if (!target.has(key) && target.size >= SPAN_MAX_ATTRIBUTES) {
      dropped += 1;
      continue;
    }
    target.set(key, source[key]!);
  }
  return dropped;
}

interface SpanEvent {
  timeUnixNano: string;
  name: string;
  attributes: Array<{ key: string; value: OtlpAnyValue }>;
}

/** A sampled-out span: valid identity for propagation, nothing recorded. */
class NonRecordingSpan implements OtlpSpan {
  constructor(private readonly sc: TracingSpanContext) {}
  setAttribute(): void {}
  setAttributes(): void {}
  setStatus(): void {}
  recordException(): void {}
  updateName(): void {}
  addEvent(): void {}
  end(): void {}
  spanContext(): TracingSpanContext {
    return this.sc;
  }
  isRecording(): boolean {
    return false;
  }
}

/** A sampled span; serialized into the export queue once on `end()`. */
class RecordingSpan implements OtlpSpan {
  private name: string;
  private readonly attributes = new Map<string, TracingAttributeValue>();
  private droppedAttributes = 0;
  private readonly events: SpanEvent[] = [];
  private droppedEvents = 0;
  private status: { code: number; message?: string } = { code: 0 };
  private readonly startNanos: bigint;
  private ended = false;

  constructor(
    name: string,
    private readonly kind: number,
    private readonly sc: TracingSpanContext,
    private readonly parentSpanId: string | undefined,
    initial: TracingAttributes | undefined,
    private readonly clock: () => bigint,
    private readonly enqueue: (span: unknown) => void,
  ) {
    this.name = truncate(String(name), SPAN_MAX_NAME_LENGTH);
    this.startNanos = clock();
    this.droppedAttributes += mergeAttributes(this.attributes, initial);
  }

  setAttribute(key: string, value: TracingAttributeValue): void {
    if (this.ended) return;
    this.droppedAttributes += mergeAttributes(this.attributes, { [key]: value });
  }

  setAttributes(attrs: TracingAttributes): void {
    if (this.ended) return;
    this.droppedAttributes += mergeAttributes(this.attributes, attrs);
  }

  setStatus(status: { code: number; message?: string }): void {
    if (this.ended) return;
    const code = status.code === 1 || status.code === 2 ? status.code : 0;
    // Per the OTel spec, a description is only meaningful on ERROR.
    this.status =
      code === 2 && typeof status.message === "string"
        ? { code, message: truncate(status.message, SPAN_MAX_ATTR_LENGTH) }
        : { code };
  }

  updateName(name: string): void {
    if (this.ended) return;
    this.name = truncate(String(name), SPAN_MAX_NAME_LENGTH);
  }

  addEvent(name: string, attributes?: TracingAttributes): void {
    if (this.ended) return;
    if (this.events.length >= SPAN_MAX_EVENTS) {
      this.droppedEvents += 1;
      return;
    }
    const attrs = new Map<string, TracingAttributeValue>();
    mergeAttributes(attrs, attributes);
    this.events.push({
      timeUnixNano: this.clock().toString(),
      name: truncate(String(name), SPAN_MAX_NAME_LENGTH),
      attributes: toKeyValues(attrs),
    });
  }

  recordException(err: unknown): void {
    const error = err instanceof Error ? err : undefined;
    const attrs: TracingAttributes = {
      "exception.type": error?.name || "Error",
      "exception.message": error?.message ?? String(err),
    };
    if (typeof error?.stack === "string") attrs["exception.stacktrace"] = error.stack;
    this.addEvent("exception", attrs);
  }

  spanContext(): TracingSpanContext {
    return this.sc;
  }

  isRecording(): boolean {
    return !this.ended;
  }

  end(endTime?: number): void {
    if (this.ended) return;
    this.ended = true;
    let endNanos =
      typeof endTime === "number" && Number.isFinite(endTime)
        ? msToNanos(endTime)
        : this.clock();
    if (endNanos < this.startNanos) endNanos = this.startNanos;
    const span: Record<string, unknown> = {
      traceId: this.sc.traceId,
      spanId: this.sc.spanId,
      name: this.name,
      // The OTLP wire enum is the API SpanKind + 1 (0 = UNSPECIFIED).
      kind: this.kind,
      startTimeUnixNano: this.startNanos.toString(),
      endTimeUnixNano: endNanos.toString(),
      attributes: toKeyValues(this.attributes),
      events: this.events,
      status: this.status,
    };
    if (this.parentSpanId !== undefined) span.parentSpanId = this.parentSpanId;
    if (this.droppedAttributes > 0) span.droppedAttributesCount = this.droppedAttributes;
    if (this.droppedEvents > 0) span.droppedEventsCount = this.droppedEvents;
    this.enqueue(span);
  }
}

/**
 * Create a dependency-free tracer that batches ended spans and pushes them to
 * the collector as OTLP/HTTP JSON (`/v1/traces`), or `null` when no endpoint
 * is configured or the operator disabled traces.
 *
 * Span and trace ids come from `crypto.getRandomValues`. Sampling is
 * parent-based with a trace-id ratio for new roots (see
 * {@link OtlpTracerOptions.sampleRatio}); sampled-out spans are cheap
 * no-op spans that still carry a valid identity for propagation. Fail-safe
 * by contract like the other exporters: the queue is bounded (drop-oldest),
 * per-span attributes, events, and value lengths are capped, every POST
 * times out and refuses redirects, and {@link OtlpTracer.flush} never
 * rejects.
 *
 * The tracer does not install a context manager: to nest a child span, pass
 * the parent span as the third `startSpan` argument.
 *
 * @param opts - Exporter overrides plus an optional `sampleRatio`; defaults from `OTEL_*` env vars.
 * @returns The tracer, or `null` when no endpoint is configured.
 * @throws {RangeError} When `sampleRatio` is outside `[0, 1]`.
 * @since 1.11.0
 */
export function createOtlpTracer(opts: OtlpTracerOptions = {}): OtlpTracer | null {
  const sampler = resolveSampler(opts.sampleRatio);
  const transport = resolveTransport("traces", opts);
  if (transport === null) return null;
  const { url, headers, resourceAttributes, fetchImpl, timeoutMs } = transport;
  const clock = createClock();

  const queue: unknown[] = [];
  let dropped = 0;

  const flush = singleFlightFlush(async () => {
    try {
      while (queue.length > 0) {
        const batch = queue.splice(0, SPAN_MAX_BATCH);
        const payload = {
          resourceSpans: [
            {
              resource: { attributes: resourceAttributes },
              scopeSpans: [{ scope: { name: "daloyjs" }, spans: batch }],
            },
          ],
        };
        const res = await fetchImpl(
          url,
          exportRequestInit(headers, JSON.stringify(payload), timeoutMs),
        );
        if (!res.ok) dropped += 1;
      }
    } catch {
      dropped += 1;
      queue.length = 0; // never let a dead collector grow the queue
    }
  });

  const enqueue = (span: unknown): void => {
    if (queue.length >= SPAN_MAX_QUEUE) {
      queue.shift();
      dropped += 1;
    }
    queue.push(span);
    // A full batch ships without waiting for the interval.
    if (queue.length >= SPAN_MAX_BATCH) void flush();
  };

  startFlushTimer(opts.flushIntervalMs ?? SPAN_FLUSH_INTERVAL_MS, flush);

  return {
    startSpan(name, options, parent) {
      const parentCtx = parentContextOf(parent);
      const traceId = parentCtx?.traceId ?? randomHex(16);
      const sampled =
        parentCtx !== undefined && sampler.parentBased
          ? (parentCtx.traceFlags & 1) === 1
          : sampledByRatio(traceId, sampler.ratio);
      const sc: TracingSpanContext = {
        traceId,
        spanId: randomHex(8),
        traceFlags: sampled ? 1 : 0,
      };
      if (!sampled) return new NonRecordingSpan(sc);
      const apiKind = options?.kind;
      const wireKind =
        typeof apiKind === "number" && Number.isInteger(apiKind) && apiKind >= 0 && apiKind <= 4
          ? apiKind + 1
          : 1; // INTERNAL
      return new RecordingSpan(
        name,
        wireKind,
        sc,
        parentCtx?.spanId,
        options?.attributes,
        clock,
        enqueue,
      );
    },
    flush,
    get droppedBatches() {
      return dropped;
    },
  };
}

/** Options for {@link semconvHttpMetrics}. */
export interface SemconvHttpMetricsOptions {
  /** Skip instrumentation for matching request paths (e.g. a metrics scrape route). */
  exclude?: (path: string) => boolean;
}

/** Monotonic clock in milliseconds, falling back to `Date.now` where needed. */
function nowMs(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

const SEMCONV_START_TIMES = new WeakMap<Request, number>();

/**
 * A `Hooks` bundle recording `http.server.request.duration` per the OTel HTTP
 * semantic conventions into an {@link OtlpMetricsExporter}:
 *
 * - unit `s`, spec bucket boundaries
 *   ({@link HTTP_SERVER_REQUEST_DURATION_BUCKETS});
 * - attributes `http.request.method` (well-known set, else `_OTHER`),
 *   `http.response.status_code`, `url.scheme`, `http.route` (the matched
 *   route **template** via `ctx.routePath`), and `error.type` (the status
 *   code, on `5xx` only).
 *
 * Only requests that matched a route (and so carry a route template) are
 * recorded. Unmatched 404 / 405 responses and synthetic OPTIONS preflights
 * record nothing, which is the strongest possible cardinality guarantee: a
 * hostile client can never mint metric series, or even samples, from raw
 * paths.
 *
 * Install it **before** registering routes (group-hook ordering), or let
 * `new App({ telemetry: true })` install it for you.
 *
 * @param sink - Metrics exporter the duration histogram is recorded into.
 * @param opts - Optional path exclusion.
 * @returns A `Hooks` object for `app.use(...)` or `new App({ hooks })`.
 * @since 1.2.0
 */
export function semconvHttpMetrics(
  sink: OtlpMetricsExporter,
  opts: SemconvHttpMetricsOptions = {},
): Hooks {
  return {
    onRequest(req) {
      SEMCONV_START_TIMES.set(req, nowMs());
    },
    onResponse(res, ctx) {
      const request = ctx?.request;
      if (request === undefined) return;
      const started = SEMCONV_START_TIMES.get(request);
      if (started === undefined) return;
      SEMCONV_START_TIMES.delete(request);
      // Unmatched requests carry no route template: record nothing, so an
      // unmatched-path flood cannot reach the exporter at all.
      const routePath = (ctx as BaseContext<any, any>).routePath;
      if (typeof routePath !== "string") return;
      const url = request.url;
      if (opts.exclude !== undefined) {
        let pathname = "/";
        try {
          pathname = new URL(url).pathname;
        } catch {
          /* malformed URL — keep the fallback */
        }
        if (opts.exclude(pathname)) return;
      }
      const colon = url.indexOf(":");
      const scheme = colon > 0 ? url.slice(0, colon) : "http";
      const rawMethod = request.method.toUpperCase();
      const attributes: Record<string, string> = {
        "http.request.method": KNOWN_METHODS.has(rawMethod)
          ? rawMethod
          : "_OTHER",
        "http.response.status_code": String(res.status),
        "url.scheme": scheme,
        // The matched template, never the raw pathname.
        "http.route": routePath,
      };
      if (res.status >= 500) attributes["error.type"] = String(res.status);
      sink.record(
        "http.server.request.duration",
        attributes,
        (nowMs() - started) / 1000,
        { unit: "s", boundaries: HTTP_SERVER_REQUEST_DURATION_BUCKETS },
      );
    },
  };
}

/**
 * Options for `telemetry: { traces: ... }`.
 *
 * @since 1.11.0
 */
export interface TelemetryTraceOptions {
  /**
   * Continue an upstream trace from the inbound W3C `traceparent` header.
   * Default `true`, the norm between your own services. On an
   * internet-facing edge a client controls that header, so it can pick the
   * trace id and, through the sampled flag, opt its own requests out of
   * sampling. Set `false` there (or strip `traceparent` at the edge) to
   * start every request as a new root trace.
   */
  propagate?: boolean;
  /** Root-trace sampling ratio; see {@link OtlpTracerOptions.sampleRatio}. */
  sampleRatio?: number;
  /**
   * Bind `trace_id` / `span_id` onto `ctx.state.log`, so handler log lines
   * link to their trace (the OTLP log exporter promotes them to the record's
   * trace context). Default `true`.
   */
  correlateLogs?: boolean;
}

/**
 * Configuration for the `App` `telemetry` option. Passing `true` is
 * equivalent to `{}` — logs and metrics default on, reading the standard
 * `OTEL_*` environment variables; traces are opt-in (`traces: true`). When
 * no endpoint is present (and no explicit `exporter.endpoint` is given) the
 * option is a silent no-op, so it is safe to leave enabled in development. A
 * caller-supplied `Logger` instance is not intercepted (it owns its own
 * sink). On isolate runtimes use `toFetchHandler` / `toLambdaHandler` so a
 * per-request flush actually runs; Node/Bun/Deno long-lived processes flush
 * on the interval and on shutdown. The collector endpoint is operator
 * config, so export uses raw `fetch` (not `fetchGuard`) — the same trust
 * class as a database URL.
 *
 * @since 1.2.0
 */
export interface TelemetryOptions {
  /**
   * Tee the app logger's output to the collector as OTLP logs. Default
   * `true`. Applies only when the app constructs its own logger (`logger`
   * omitted, `{ level }`, or defaulted) — a caller-supplied `Logger`
   * instance controls its own sink and is not intercepted.
   */
  logs?: boolean;
  /**
   * Record `http.server.request.duration` per the OTel HTTP semantic
   * conventions and push it to the collector. Default `true`.
   */
  metrics?: boolean;
  /**
   * Trace every matched route with `otelTracing()` backed by
   * {@link createOtlpTracer}, and push the spans to the collector. Default
   * `false`. `true` is `{}`; see {@link TelemetryTraceOptions}.
   *
   * @since 1.11.0
   */
  traces?: boolean | TelemetryTraceOptions;
  /** Endpoint/header/resource/interval overrides shared by every signal. */
  exporter?: OtlpExporterOptions;
}

/**
 * Internal wiring bundle produced by {@link createAppTelemetry} and consumed
 * by the `App` constructor. Exposed for advanced composition and tests.
 *
 * @since 1.2.0
 */
export interface AppTelemetry {
  /** Log exporter, or `null` when logs are disabled or unconfigured. */
  logs: OtlpLogExporter | null;
  /** Metrics exporter, or `null` when metrics are disabled or unconfigured. */
  metrics: OtlpMetricsExporter | null;
  /**
   * Tracer, or `null` when traces are disabled or unconfigured.
   *
   * @since 1.11.0
   */
  traces: OtlpTracer | null;
  /** Hooks to install when HTTP metrics are active. */
  hooks: Hooks | undefined;
  /**
   * `otelTracing()` hooks to install when traces are active.
   *
   * @since 1.11.0
   */
  traceHooks: Hooks | undefined;
  /** Logger `write` sink that tees to stdout and the log exporter. */
  logWrite: ((line: string) => void) | undefined;
  /**
   * Collector endpoint for display (origin + path; userinfo and query are
   * stripped because they can carry credentials), or `null` when no
   * exporter is active.
   */
  endpoint: string | null;
  /** Flush every signal. Never rejects. */
  flush(): Promise<void>;
}

/**
 * Build the exporters, hooks, and logger sink for the `App` `telemetry`
 * option. Returns an inert bundle (all `null`/`undefined`) when no endpoint
 * is configured, so `telemetry: true` costs nothing in development.
 *
 * @param options - The resolved {@link TelemetryOptions}.
 * @returns The wiring bundle.
 * @throws {RangeError} When `traces.sampleRatio` is outside `[0, 1]`.
 * @since 1.2.0
 */
export function createAppTelemetry(options: TelemetryOptions): AppTelemetry {
  const exporterOpts = options.exporter ?? {};
  const logs =
    options.logs === false ? null : createOtlpLogExporter(exporterOpts);
  const metrics =
    options.metrics === false ? null : createOtlpMetricsExporter(exporterOpts);
  const traceOpts: TelemetryTraceOptions | undefined =
    options.traces === true
      ? {}
      : options.traces === false || options.traces === undefined
        ? undefined
        : options.traces;
  const traces =
    traceOpts === undefined
      ? null
      : createOtlpTracer(
          traceOpts.sampleRatio === undefined
            ? exporterOpts
            : { ...exporterOpts, sampleRatio: traceOpts.sampleRatio },
        );

  const logWrite =
    logs === null
      ? undefined
      : (line: string): void => {
          const proc = (
            globalThis as {
              process?: { stdout?: { write?: (chunk: string) => unknown } };
            }
          ).process;
          if (proc?.stdout?.write !== undefined) proc.stdout.write(line + "\n");
          // eslint-disable-next-line no-console
          else console.log(line);
          logs.pushLine(line);
        };

  const traceHooks =
    traces === null
      ? undefined
      : otelTracing({
          tracer: traces,
          correlateLogs: traceOpts?.correlateLogs !== false,
          ...(traceOpts?.propagate === false
            ? {}
            : {
                contextFromRequest: (req: Request) =>
                  parseTraceparent(req.headers.get("traceparent")),
              }),
        });

  let endpoint: string | null = null;
  const active: OtlpSignal[] = [];
  if (logs !== null) active.push("logs");
  if (metrics !== null) active.push("metrics");
  if (traces !== null) active.push("traces");
  if (active.length > 0) {
    const raw =
      exporterOpts.endpoint ??
      envVar("OTEL_EXPORTER_OTLP_ENDPOINT") ??
      resolveSignalUrl(active[0]!, undefined);
    endpoint = raw === undefined ? null : redactEndpoint(raw);
  }

  return {
    logs,
    metrics,
    traces,
    hooks: metrics === null ? undefined : semconvHttpMetrics(metrics),
    traceHooks,
    logWrite,
    endpoint,
    async flush(): Promise<void> {
      await Promise.all([logs?.flush(), metrics?.flush(), traces?.flush()]);
    },
  };
}
