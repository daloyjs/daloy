/**
 * OpenTelemetry OTLP push export — logs, metrics, and semantic-convention
 * HTTP server instrumentation, with zero runtime dependencies.
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
 * and cumulative metric temporality so totals survive failed pushes.
 *
 * @module
 * @since 1.2.0
 */

import type { BaseContext, Hooks } from "./types.js";

/** One OTLP string attribute (`{ key, value: { stringValue } }`). */
interface OtlpAttr {
  key: string;
  value: { stringValue: string };
}

/**
 * Shared configuration for {@link createOtlpLogExporter} and
 * {@link createOtlpMetricsExporter}. Every field falls back to the standard
 * `OTEL_*` environment variables, so on platforms that inject them no
 * explicit configuration is needed at all.
 *
 * @since 1.2.0
 */
export interface OtlpExporterOptions {
  /**
   * Collector base URL. Defaults to `OTEL_EXPORTER_OTLP_ENDPOINT`. The
   * conventional injected value is the gRPC form (`http://host:4317`); a
   * trailing `:4317` is rewritten to `:4318`, the collector's OTLP/HTTP port.
   * The signal path (`/v1/logs`, `/v1/metrics`) is appended automatically.
   */
  endpoint?: string;
  /**
   * Extra request headers. Defaults to `OTEL_EXPORTER_OTLP_HEADERS`
   * (`key=value,key2=value2`). Multi-tenant collectors route on these
   * (e.g. `tenant_id=...`), so treat the values as credentials: DaloyJS
   * never logs them and never includes them in errors.
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
   * process alive). Defaults: 5000 (logs), 15000 (metrics). Set `0` to
   * disable the timer and flush manually / on shutdown only.
   */
  flushIntervalMs?: number;
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
   * OTLP severity, and every remaining field ships as a string attribute
   * (surfacing as structured metadata in Loki-style backends). Non-JSON
   * lines ship verbatim as the body.
   */
  pushLine(line: string): void;
  /** Push pending records now. Never rejects; failures count as drops. */
  flush(): Promise<void>;
  /** Batches dropped because the queue overflowed or the collector errored. */
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
    options: OtlpHistogramOptions
  ): void;
  /** Push the current state now. Never rejects; failures count as drops. */
  flush(): Promise<void>;
  /** Pushes dropped because the collector rejected/errored, plus series dropped at the cardinality cap. */
  readonly droppedBatches: number;
}

/** Log-queue and batching caps (drop-oldest beyond the queue cap). */
const LOG_MAX_BATCH = 100;
const LOG_MAX_QUEUE = 1_000;
const LOG_FLUSH_INTERVAL_MS = 5_000;
/** Longest log body / attribute value shipped before truncation. */
const LOG_MAX_FIELD_LENGTH = 8_192;

const METRICS_FLUSH_INTERVAL_MS = 15_000;
/**
 * Cardinality guard: total metric series (counter + histogram) before new
 * series are dropped and counted. A hostile client must not be able to mint
 * unbounded series through attribute values.
 */
const METRICS_MAX_SERIES = 2_000;
/** Longest metric attribute value before truncation (cardinality + memory guard). */
const METRICS_MAX_ATTR_LENGTH = 256;

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

/** Portable environment lookup (Node/Bun/Deno-with-node-compat; undefined elsewhere). */
function envVar(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.[name];
}

/** Parse `key=value,key2=value2` lists (OTEL_EXPORTER_OTLP_HEADERS / OTEL_RESOURCE_ATTRIBUTES). */
function parseKvList(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const pair of raw.split(",")) {
    const trimmed = pair.trim();
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    out[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return out;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

function toAttrList(record: Record<string, string>, maxLength: number): OtlpAttr[] {
  return Object.entries(record).map(([key, value]) => ({
    key,
    value: { stringValue: truncate(value, maxLength) },
  }));
}

/** Resolved transport shared by both exporters; null when no endpoint is configured. */
interface OtlpTransport {
  url: string;
  headers: Record<string, string>;
  resourceAttributes: OtlpAttr[];
  fetchImpl: typeof fetch;
}

function resolveTransport(signalPath: string, opts: OtlpExporterOptions): OtlpTransport | null {
  const rawEndpoint = opts.endpoint ?? envVar("OTEL_EXPORTER_OTLP_ENDPOINT");
  if (!rawEndpoint) return null;
  const base = rawEndpoint.replace(/\/+$/, "").replace(/:4317$/, ":4318");
  const headers: Record<string, string> = { "content-type": "application/json" };
  Object.assign(headers, parseKvList(envVar("OTEL_EXPORTER_OTLP_HEADERS")), opts.headers ?? {});
  const resource: Record<string, string> = parseKvList(envVar("OTEL_RESOURCE_ATTRIBUTES"));
  const serviceName = envVar("OTEL_SERVICE_NAME");
  if (serviceName && resource["service.name"] === undefined) {
    resource["service.name"] = serviceName;
  }
  Object.assign(resource, opts.resourceAttributes ?? {});
  return {
    url: base + signalPath,
    headers,
    resourceAttributes: toAttrList(resource, LOG_MAX_FIELD_LENGTH),
    fetchImpl: opts.fetch ?? fetch,
  };
}

/** Start an `unref`'d repeating flush where the runtime supports timers. */
function startFlushTimer(intervalMs: number, flush: () => Promise<void>): void {
  if (intervalMs <= 0 || typeof setInterval !== "function") return;
  const timer = setInterval(() => void flush(), intervalMs) as { unref?: () => unknown };
  timer.unref?.();
}

/** Shape of one OTLP log record in the JSON protobuf mapping. */
interface OtlpLogRecord {
  timeUnixNano: string;
  severityNumber: number;
  severityText: string;
  body: { stringValue: string };
  attributes: OtlpAttr[];
}

function toLogRecord(line: string): OtlpLogRecord {
  let level = "info";
  let body = line;
  const attributes: OtlpAttr[] = [];
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    if (typeof parsed.level === "string") level = parsed.level;
    const msg = parsed.msg ?? parsed.message ?? parsed.event;
    body = typeof msg === "string" ? msg : line;
    for (const [key, value] of Object.entries(parsed)) {
      if (key === "level" || key === "msg" || key === "message") continue;
      attributes.push({
        key,
        value: {
          stringValue: truncate(
            typeof value === "string" ? value : JSON.stringify(value) ?? "null",
            LOG_MAX_FIELD_LENGTH
          ),
        },
      });
    }
  } catch {
    // Not a JSON object (boot banner etc.) — ship verbatim as the body.
  }
  const [severityNumber, severityText] = SEVERITY[level] ?? SEVERITY.info!;
  return {
    timeUnixNano: (BigInt(Date.now()) * 1_000_000n).toString(),
    severityNumber,
    severityText,
    body: { stringValue: truncate(body, LOG_MAX_FIELD_LENGTH) },
    attributes,
  };
}

/**
 * Create a batched OTLP/HTTP JSON log exporter, or `null` when no endpoint is
 * configured (local development, tests) so callers can no-op cheaply.
 *
 * Fail-safe by contract: {@link OtlpLogExporter.flush} never rejects, a dead
 * collector cannot grow the queue past its cap (oldest records are dropped
 * and counted), and export work is decoupled from request handling.
 *
 * @param opts - Endpoint/header/resource overrides; defaults from `OTEL_*` env vars.
 * @returns The exporter, or `null` when no endpoint is configured.
 * @since 1.2.0
 */
export function createOtlpLogExporter(opts: OtlpExporterOptions = {}): OtlpLogExporter | null {
  const transport = resolveTransport("/v1/logs", opts);
  if (transport === null) return null;
  const { url, headers, resourceAttributes, fetchImpl } = transport;

  const queue: OtlpLogRecord[] = [];
  let dropped = 0;
  let flushing = false;

  async function flush(): Promise<void> {
    if (flushing || queue.length === 0) return;
    flushing = true;
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
        const res = await fetchImpl(url, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
        if (!res.ok) dropped += 1;
      }
    } catch {
      dropped += 1;
      queue.length = 0; // never let a dead collector grow the queue
    } finally {
      flushing = false;
    }
  }

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
 * endpoint is configured.
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
  opts: OtlpExporterOptions = {}
): OtlpMetricsExporter | null {
  const transport = resolveTransport("/v1/metrics", opts);
  if (transport === null) return null;
  const { url, headers, resourceAttributes, fetchImpl } = transport;

  const counters = new Map<string, CounterSeries>();
  const histograms = new Map<string, HistogramSeries>();
  let dropped = 0;
  let flushing = false;
  let dirty = false;

  function seriesKey(name: string, entries: [string, string][]): string {
    let key = name;
    for (const [k, v] of entries) key += "|" + k + "=" + v;
    return key;
  }

  function sortedEntries(attributes: Record<string, string>): [string, string][] {
    return Object.entries(attributes)
      .map(([k, v]): [string, string] => [k, truncate(v, METRICS_MAX_ATTR_LENGTH)])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  }

  function atCapacity(): boolean {
    if (counters.size + histograms.size < METRICS_MAX_SERIES) return false;
    dropped += 1;
    return true;
  }

  async function flush(): Promise<void> {
    if (flushing || !dirty) return;
    flushing = true;
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
      const res = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      if (res.ok) dirty = false;
      else dropped += 1;
    } catch {
      dropped += 1; // totals retained; cumulative temporality self-heals
    } finally {
      flushing = false;
    }
  }

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
          attributes: entries.map(([k, v]) => ({ key: k, value: { stringValue: v } })),
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
      options: OtlpHistogramOptions
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
          attributes: entries.map(([k, v]) => ({ key: k, value: { stringValue: v } })),
          count: 0,
          sum: 0,
          bucketCounts: new Array<number>(options.boundaries.length + 1).fill(0),
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

/** Options for {@link semconvHttpMetrics}. */
export interface SemconvHttpMetricsOptions {
  /** Skip instrumentation for matching request paths (e.g. a metrics scrape route). */
  exclude?: (path: string) => boolean;
}

/** Monotonic clock in milliseconds, falling back to `Date.now` where needed. */
function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
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
 * Only requests that produce a request context are recorded. On the
 * unmatched-404 fast path the framework skips context construction entirely
 * (a deliberate allocation optimization), so unmatched floods record nothing
 * — which is also the strongest possible cardinality guarantee: a hostile
 * client can never mint metric series from raw paths.
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
  opts: SemconvHttpMetricsOptions = {}
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
      let pathname = "/";
      let scheme = "http";
      try {
        const parsed = new URL(request.url);
        pathname = parsed.pathname;
        scheme = parsed.protocol.replace(":", "");
      } catch {
        /* malformed URL — keep the fallbacks */
      }
      if (opts.exclude !== undefined && opts.exclude(pathname)) return;
      const rawMethod = request.method.toUpperCase();
      const attributes: Record<string, string> = {
        "http.request.method": KNOWN_METHODS.has(rawMethod) ? rawMethod : "_OTHER",
        "http.response.status_code": String(res.status),
        "url.scheme": scheme,
      };
      // Spec: http.route only when a route template is known. Never the raw
      // pathname — an unmatched-path flood must not mint metric series.
      const routePath = ctx?.routePath;
      if (typeof routePath === "string") attributes["http.route"] = routePath;
      if (res.status >= 500) attributes["error.type"] = String(res.status);
      sink.record(
        "http.server.request.duration",
        attributes,
        (nowMs() - started) / 1000,
        { unit: "s", boundaries: HTTP_SERVER_REQUEST_DURATION_BUCKETS }
      );
    },
  };
}

/**
 * Configuration for the `App` `telemetry` option. Passing `true` is
 * equivalent to `{}` — everything defaults on, reading the standard `OTEL_*`
 * environment variables. When no `OTEL_EXPORTER_OTLP_ENDPOINT` is present
 * (and no explicit `exporter.endpoint` is given) the option is a silent
 * no-op, so it is safe to leave enabled in development.
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
  /** Endpoint/header/resource/interval overrides shared by both signals. */
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
  /** Hooks to install when HTTP metrics are active. */
  hooks: Hooks | undefined;
  /** Logger `write` sink that tees to stdout and the log exporter. */
  logWrite: ((line: string) => void) | undefined;
  /** Resolved collector endpoint (no signal path), or `null` when inactive. */
  endpoint: string | null;
  /** Flush both signals. Never rejects. */
  flush(): Promise<void>;
}

/**
 * Build the exporters, hooks, and logger sink for the `App` `telemetry`
 * option. Returns an inert bundle (all `null`/`undefined`) when no endpoint
 * is configured, so `telemetry: true` costs nothing in development.
 *
 * @param options - The resolved {@link TelemetryOptions}.
 * @returns The wiring bundle.
 * @since 1.2.0
 */
export function createAppTelemetry(options: TelemetryOptions): AppTelemetry {
  const exporterOpts = options.exporter ?? {};
  const logs = options.logs === false ? null : createOtlpLogExporter(exporterOpts);
  const metrics = options.metrics === false ? null : createOtlpMetricsExporter(exporterOpts);

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

  const endpointRaw = exporterOpts.endpoint ?? envVar("OTEL_EXPORTER_OTLP_ENDPOINT") ?? null;

  return {
    logs,
    metrics,
    hooks: metrics === null ? undefined : semconvHttpMetrics(metrics),
    logWrite,
    endpoint: endpointRaw,
    async flush(): Promise<void> {
      await Promise.all([logs?.flush(), metrics?.flush()]);
    },
  };
}
