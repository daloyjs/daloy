/**
 * Prometheus / OpenMetrics exposition for DaloyJS.
 *
 * The third observability pillar alongside the structured logger
 * (`logger.ts`) and the OpenTelemetry-compatible tracer (`tracing.ts`): a
 * dependency-free metrics registry plus a RED (Rate / Errors / Duration)
 * instrumentation hook and a Prometheus text-format renderer. Pair it with
 * {@link App.metrics} for an opt-in, auth-guarded `/metrics` route, or wire
 * the pieces manually:
 *
 * - {@link MetricsRegistry} — holds {@link Counter}, {@link Gauge}, and
 *   {@link Histogram} series, validates metric/label names, caps total
 *   cardinality, and serializes everything to the Prometheus text exposition
 *   format via {@link MetricsRegistry.render}.
 * - {@link httpMetrics} — a `Hooks` bundle that records per-request RED
 *   metrics (`http_requests_total`, `http_request_duration_seconds`,
 *   `http_requests_in_flight`) into a registry.
 *
 * Everything is built on Web-standard primitives (plus optional `process.*`
 * gauges guarded for non-Node runtimes), so it runs unchanged on Node, Bun,
 * Deno, Cloudflare Workers, and Vercel.
 *
 * @module
 * @since 0.37.0
 */

import type { BaseContext, Hooks } from "./types.js";

/**
 * Default latency histogram bucket boundaries, in seconds. Mirrors the
 * conventional Prometheus client defaults so dashboards and recording rules
 * authored against other ecosystems work without re-bucketing.
 */
export const DEFAULT_DURATION_BUCKETS: readonly number[] = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

/** Prometheus metric-name grammar (`[a-zA-Z_:][a-zA-Z0-9_:]*`). */
const METRIC_NAME_RE = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
/** Prometheus label-name grammar (`[a-zA-Z_][a-zA-Z0-9_]*`). */
const LABEL_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Labels attached to a single metric sample. */
export type MetricLabels = Record<string, string | number>;

/**
 * Escape a `# HELP` text value per the Prometheus exposition format:
 * backslash and newline only.
 */
function escapeHelp(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
}

/**
 * Escape a label value per the Prometheus exposition format: backslash,
 * double-quote, and newline. This is the structural defense that prevents a
 * hostile label value (e.g. a user-controlled route segment) from breaking
 * out of the `{...}` block and injecting forged samples.
 */
function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/**
 * Validate and normalize a label bag: every key must match the Prometheus
 * label-name grammar, values are coerced to strings. Returns a new object
 * with stably-sorted keys so identical label sets always serialize to the
 * same series key. Rejects the reserved `le` label (used by histogram
 * buckets) so user labels cannot corrupt bucket rendering.
 *
 * @throws {Error} If a label name is invalid or reserved.
 */
function normalizeLabels(labels: MetricLabels | undefined): Array<[string, string]> {
  if (!labels) return [];
  const entries: Array<[string, string]> = [];
  for (const key of Object.keys(labels)) {
    if (!LABEL_NAME_RE.test(key)) {
      throw new Error(`Invalid metric label name: ${JSON.stringify(key)}.`);
    }
    if (key === "le") {
      throw new Error('Label name "le" is reserved for histogram buckets.');
    }
    entries.push([key, String(labels[key])]);
  }
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return entries;
}

/** Build the canonical series key from sorted label entries. */
function seriesKey(entries: Array<[string, string]>): string {
  if (entries.length === 0) return "";
  let key = "";
  for (const [k, v] of entries) key += `${k}\u0000${v}\u0001`;
  return key;
}

/** Render the `{k="v",...}` label block (already-sorted entries). */
function renderLabelBlock(entries: Array<[string, string]>, extra?: [string, string]): string {
  const all = extra ? [...entries, extra] : entries;
  if (all.length === 0) return "";
  const parts: string[] = [];
  for (const [k, v] of all) parts.push(`${k}="${escapeLabelValue(v)}"`);
  return `{${parts.join(",")}}`;
}

/** Internal: shared base for the three metric kinds. */
abstract class Metric {
  /** Fully-qualified metric name (registry prefix already applied). */
  readonly name: string;
  /** `# HELP` text. */
  readonly help: string;
  protected readonly registry: MetricsRegistry;

  constructor(registry: MetricsRegistry, name: string, help: string) {
    if (!METRIC_NAME_RE.test(name)) {
      throw new Error(`Invalid metric name: ${JSON.stringify(name)}.`);
    }
    this.registry = registry;
    this.name = name;
    this.help = help;
  }

  /** @internal Serialize this metric to Prometheus text (no trailing newline). */
  abstract render(): string;

  /** @internal Drop every recorded series, keeping the metric definition. */
  abstract clear(): void;
}

/** A monotonically increasing counter (RED "Rate" + "Errors"). */
export class Counter extends Metric {
  private series = new Map<string, { labels: Array<[string, string]>; value: number }>();

  /**
   * Increment the counter for the given label set.
   *
   * @param labels - Label bag (validated + sorted). Omit for an unlabelled series.
   * @param value - Positive increment. Default `1`.
   * @throws {Error} If `value` is negative (counters never decrease).
   */
  inc(labels?: MetricLabels, value = 1): void {
    if (value < 0) throw new Error("Counter increment must be non-negative.");
    const entries = normalizeLabels(labels);
    const key = seriesKey(entries);
    const existing = this.series.get(key);
    if (existing) {
      existing.value += value;
      return;
    }
    if (!this.registry._admitSeries(this.series.size)) return;
    this.series.set(key, { labels: entries, value });
  }

  /** @internal */
  render(): string {
    const lines = [`# HELP ${this.name} ${escapeHelp(this.help)}`, `# TYPE ${this.name} counter`];
    for (const { labels, value } of this.series.values()) {
      lines.push(`${this.name}${renderLabelBlock(labels)} ${value}`);
    }
    return lines.join("\n");
  }

  /** @internal */
  clear(): void {
    this.series.clear();
  }
}

/** A gauge that can move up and down (RED/USE "Utilization", "Saturation"). */
export class Gauge extends Metric {
  private series = new Map<string, { labels: Array<[string, string]>; value: number }>();

  /** Set the gauge to an absolute value for the given label set. */
  set(labels: MetricLabels | undefined, value: number): void {
    const entries = normalizeLabels(labels);
    const key = seriesKey(entries);
    const existing = this.series.get(key);
    if (existing) {
      existing.value = value;
      return;
    }
    if (!this.registry._admitSeries(this.series.size)) return;
    this.series.set(key, { labels: entries, value });
  }

  /** Increment the gauge (default `1`). */
  inc(labels?: MetricLabels, value = 1): void {
    const entries = normalizeLabels(labels);
    const key = seriesKey(entries);
    const existing = this.series.get(key);
    if (existing) {
      existing.value += value;
      return;
    }
    if (!this.registry._admitSeries(this.series.size)) return;
    this.series.set(key, { labels: entries, value });
  }

  /** Decrement the gauge (default `1`). */
  dec(labels?: MetricLabels, value = 1): void {
    this.inc(labels, -value);
  }

  /** @internal */
  render(): string {
    const lines = [`# HELP ${this.name} ${escapeHelp(this.help)}`, `# TYPE ${this.name} gauge`];
    for (const { labels, value } of this.series.values()) {
      lines.push(`${this.name}${renderLabelBlock(labels)} ${value}`);
    }
    return lines.join("\n");
  }

  /** @internal */
  clear(): void {
    this.series.clear();
  }
}

interface HistogramSeries {
  labels: Array<[string, string]>;
  /** Cumulative counts aligned to {@link Histogram.bounds}. */
  counts: number[];
  sum: number;
  count: number;
}

/** A cumulative histogram (RED "Duration"). */
export class Histogram extends Metric {
  /** Sorted, de-duplicated upper bucket boundaries (the implicit `+Inf` is the total count). */
  readonly bounds: readonly number[];
  private series = new Map<string, HistogramSeries>();

  constructor(registry: MetricsRegistry, name: string, help: string, buckets: readonly number[]) {
    super(registry, name, help);
    const sorted = [...new Set(buckets)].sort((a, b) => a - b);
    if (sorted.length === 0 || sorted.some((b) => !Number.isFinite(b))) {
      throw new Error("Histogram buckets must be a non-empty list of finite numbers.");
    }
    this.bounds = sorted;
  }

  /**
   * Record an observation (e.g. a request duration in seconds) for the given
   * label set. The value lands in every bucket whose upper bound is `>=`
   * the value (cumulative), plus the `_sum` and `_count` series.
   */
  observe(labels: MetricLabels | undefined, value: number): void {
    const entries = normalizeLabels(labels);
    const key = seriesKey(entries);
    let s = this.series.get(key);
    if (!s) {
      if (!this.registry._admitSeries(this.series.size)) return;
      s = { labels: entries, counts: new Array(this.bounds.length).fill(0), sum: 0, count: 0 };
      this.series.set(key, s);
    }
    s.count += 1;
    s.sum += value;
    for (let i = 0; i < this.bounds.length; i++) {
      if (value <= this.bounds[i]!) s.counts[i]! += 1;
    }
  }

  /** @internal */
  render(): string {
    const lines = [`# HELP ${this.name} ${escapeHelp(this.help)}`, `# TYPE ${this.name} histogram`];
    for (const s of this.series.values()) {
      for (let i = 0; i < this.bounds.length; i++) {
        lines.push(
          `${this.name}_bucket${renderLabelBlock(s.labels, ["le", String(this.bounds[i])])} ${s.counts[i]}`
        );
      }
      lines.push(`${this.name}_bucket${renderLabelBlock(s.labels, ["le", "+Inf"])} ${s.count}`);
      lines.push(`${this.name}_sum${renderLabelBlock(s.labels)} ${s.sum}`);
      lines.push(`${this.name}_count${renderLabelBlock(s.labels)} ${s.count}`);
    }
    return lines.join("\n");
  }

  /** @internal */
  clear(): void {
    this.series.clear();
  }
}

/** Options for {@link MetricsRegistry}. */
export interface MetricsRegistryOptions {
  /** Prefix applied to every metric name. Default `"daloy_"`. Pass `""` for none. */
  prefix?: string;
  /**
   * Hard cap on the number of distinct series **per metric**. Once reached,
   * new label combinations are dropped (and counted in
   * `<prefix>metrics_series_dropped_total`) — a memory-exhaustion defense
   * against unbounded label cardinality. Default `5000`.
   */
  maxSeries?: number;
  /**
   * Register process/runtime gauges (`process_resident_memory_bytes`,
   * `process_heap_used_bytes`, `process_uptime_seconds`) collected at scrape
   * time. No-op on runtimes without `process`. Default `true`.
   */
  collectDefaultMetrics?: boolean;
}

/**
 * The Prometheus / OpenMetrics content type, including the format version.
 * Served by {@link App.metrics}.
 */
export const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

/**
 * A registry of {@link Counter}, {@link Gauge}, and {@link Histogram} series
 * that renders to the Prometheus text exposition format.
 *
 * Metric handles are memoized by name: calling {@link MetricsRegistry.counter}
 * twice with the same name returns the same {@link Counter}. Construct one
 * registry per application, hand it to {@link httpMetrics} (or
 * {@link App.metrics}) for RED instrumentation, and add your own
 * business metrics on the side.
 *
 * @since 0.37.0
 */
export class MetricsRegistry {
  /** Metric-name prefix applied to every series. */
  readonly prefix: string;
  private readonly maxSeries: number;
  private readonly metrics = new Map<string, Metric>();
  private readonly collectors: Array<() => void> = [];
  private droppedCounter: Counter | undefined;

  constructor(opts: MetricsRegistryOptions = {}) {
    this.prefix = opts.prefix ?? "daloy_";
    this.maxSeries = opts.maxSeries ?? 5000;
    if (!Number.isInteger(this.maxSeries) || this.maxSeries <= 0) {
      throw new Error("MetricsRegistry maxSeries must be a positive integer.");
    }
    if (opts.collectDefaultMetrics !== false) this.registerDefaultMetrics();
  }

  /**
   * @internal Admission control for a new series. Returns `false` (and bumps
   * the dropped-series counter) when the per-metric cardinality cap is hit.
   */
  _admitSeries(currentSize: number): boolean {
    if (currentSize < this.maxSeries) return true;
    if (this.droppedCounter) this.droppedCounter.inc();
    return false;
  }

  /** Get or create a {@link Counter}. */
  counter(name: string, help = name): Counter {
    return this.getOrCreate(name, () => new Counter(this, this.prefix + name, help), Counter);
  }

  /** Get or create a {@link Gauge}. */
  gauge(name: string, help = name): Gauge {
    return this.getOrCreate(name, () => new Gauge(this, this.prefix + name, help), Gauge);
  }

  /** Get or create a {@link Histogram} with the given (or default) buckets. */
  histogram(
    name: string,
    help = name,
    buckets: readonly number[] = DEFAULT_DURATION_BUCKETS
  ): Histogram {
    return this.getOrCreate(
      name,
      () => new Histogram(this, this.prefix + name, help, buckets),
      Histogram
    );
  }

  /**
   * Register a callback run immediately before each {@link render}, used to
   * refresh point-in-time gauges (memory, in-flight, queue depth) only when
   * the endpoint is actually scraped.
   */
  collect(fn: () => void): void {
    this.collectors.push(fn);
  }

  /**
   * Serialize every registered metric to the Prometheus text exposition
   * format. Runs all {@link collect} callbacks first. The output ends with a
   * trailing newline, as the format requires.
   */
  render(): string {
    for (const fn of this.collectors) fn();
    const blocks: string[] = [];
    for (const metric of this.metrics.values()) blocks.push(metric.render());
    return blocks.join("\n") + "\n";
  }

  /**
   * Clear every recorded series value while keeping metric definitions (and
   * any handles already held by instrumentation). Intended for tests.
   */
  reset(): void {
    for (const metric of this.metrics.values()) metric.clear();
  }

  private getOrCreate<T extends Metric>(
    name: string,
    make: () => T,
    kind: new (...args: any[]) => T
  ): T {
    const existing = this.metrics.get(name);
    if (existing) {
      if (!(existing instanceof kind)) {
        throw new Error(`Metric ${JSON.stringify(name)} already registered with a different type.`);
      }
      return existing;
    }
    const metric = make();
    this.metrics.set(name, metric);
    return metric;
  }

  private registerDefaultMetrics(): void {
    this.droppedCounter = this.counter(
      "metrics_series_dropped_total",
      "Series dropped after hitting the per-metric cardinality cap."
    );
    if (typeof process === "undefined") return;
    const rss = this.gauge("process_resident_memory_bytes", "Resident memory size in bytes.");
    const heap = this.gauge("process_heap_used_bytes", "Node.js heap used in bytes.");
    const uptime = this.gauge("process_uptime_seconds", "Process uptime in seconds.");
    this.collect(() => {
      try {
        if (typeof process.memoryUsage === "function") {
          const mem = process.memoryUsage();
          rss.set(undefined, mem.rss);
          heap.set(undefined, mem.heapUsed);
        }
        if (typeof process.uptime === "function") uptime.set(undefined, process.uptime());
      } catch {
        /* memoryUsage/uptime unavailable on this runtime — skip silently */
      }
    });
  }
}

/** Options for {@link httpMetrics}. */
export interface HttpMetricsOptions {
  /** Registry the RED metrics are recorded into. */
  registry: MetricsRegistry;
  /**
   * Resolve the low-cardinality `route` label from the request context.
   * Strongly recommended: return the route **template** (e.g. `/books/:id`),
   * not the raw path, to keep series cardinality bounded. When omitted the
   * request pathname is used, capped by {@link HttpMetricsOptions.maxRouteCardinality}.
   */
  route?: (ctx: BaseContext<any, any>) => string | undefined;
  /**
   * Maximum distinct values for the default (pathname-derived) `route` label
   * before further values collapse to `"<other>"`. Ignored when a custom
   * {@link HttpMetricsOptions.route} resolver is supplied. Default `100`.
   */
  maxRouteCardinality?: number;
  /** Skip instrumentation for matching request paths (e.g. the scrape route). */
  exclude?: (path: string) => boolean;
  /** Latency histogram buckets, in seconds. Default {@link DEFAULT_DURATION_BUCKETS}. */
  buckets?: readonly number[];
}

/** Monotonic clock in milliseconds, falling back to `Date.now` where needed. */
function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

const START_TIMES = new WeakMap<Request, number>();

/**
 * A `Hooks` bundle that records RED (Rate / Errors / Duration) HTTP metrics
 * into a {@link MetricsRegistry}:
 *
 * - `<prefix>http_requests_total{method,route,status}` — request counter
 *   (rate; errors are the subset with a `5xx`/`4xx` status).
 * - `<prefix>http_request_duration_seconds{method,route}` — latency histogram.
 * - `<prefix>http_requests_in_flight` — gauge of concurrently-handled requests.
 *
 * Install it **before** registering routes (group-hook ordering) so it wraps
 * them. {@link App.metrics} installs this for you.
 *
 * @param opts - Registry plus optional route-label / bucket configuration.
 * @returns A `Hooks` object for `app.use(...)` or `new App({ hooks })`.
 * @since 0.37.0
 */
export function httpMetrics(opts: HttpMetricsOptions): Hooks {
  const { registry } = opts;
  const maxRouteCardinality = opts.maxRouteCardinality ?? 100;
  const buckets = opts.buckets ?? DEFAULT_DURATION_BUCKETS;
  const requests = registry.counter("http_requests_total", "Total HTTP requests.");
  const duration = registry.histogram(
    "http_request_duration_seconds",
    "HTTP request latency in seconds.",
    buckets
  );
  const inFlight = registry.gauge("http_requests_in_flight", "In-flight HTTP requests.");
  const seenRoutes = new Set<string>();

  const routeLabel = (ctx: BaseContext<any, any>): string => {
    if (opts.route) return opts.route(ctx) ?? "<unknown>";
    let path = "/";
    try {
      path = new URL(ctx.request.url).pathname;
    } catch {
      /* malformed URL — fall back to "/" */
    }
    if (seenRoutes.has(path)) return path;
    if (seenRoutes.size >= maxRouteCardinality) return "<other>";
    seenRoutes.add(path);
    return path;
  };

  return {
    onRequest(req) {
      START_TIMES.set(req, nowMs());
      inFlight.inc();
    },
    onSend(res, ctx) {
      if (!ctx) return;
      const path = (() => {
        try {
          return new URL(ctx.request.url).pathname;
        } catch {
          return "/";
        }
      })();
      const started = START_TIMES.get(ctx.request);
      START_TIMES.delete(ctx.request);
      // Only balance in-flight and record metrics when onRequest was actually
      // called for this Request. Framework-synthesised contexts such as an OPTIONS
      // preflight handled via preflightHooks (no registered OPTIONS route) invoke
      // onSend without a prior groupHook onRequest, so started is undefined and
      // decrementing the gauge would drive it negative.
      if (started === undefined) return;
      inFlight.dec();
      if (opts.exclude && opts.exclude(path)) return;
      const method = ctx.request.method.toUpperCase();
      const route = routeLabel(ctx);
      requests.inc({ method, route, status: res.status });
      duration.observe({ method, route }, (nowMs() - started) / 1000);
    },
  };
}
