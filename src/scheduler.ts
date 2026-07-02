/**
 * In-process scheduled tasks (cron) for DaloyJS.
 *
 * A queue-agnostic schedule primitive — the in-process counterpart to an
 * external job queue. Where a queue answers *&ldquo;run this work somewhere,
 * eventually&rdquo;*, the {@link Scheduler} answers *&ldquo;run this work in
 * this process, on this clock&rdquo;* — the three things a production
 * in-process scheduler needs:
 *
 * - **Flexible schedules.** Fixed intervals (`intervalMs`) or 5-field cron
 *   expressions (`cron`, with `@hourly`/`@daily`/… aliases and an optional
 *   IANA `timeZone`), parsed once into a fast matcher with no backtracking
 *   regex.
 * - **Single-flight guarantees.** A task never overlaps itself: if a tick
 *   fires while the previous run is still in progress, the tick is *skipped*
 *   (and counted), so a slow task can never pile up unbounded concurrent runs.
 * - **Graceful-shutdown integration.** {@link Scheduler.stop} clears every
 *   timer and waits for in-flight runs to settle (up to a deadline, then
 *   aborts their {@link AbortSignal}), so it slots cleanly into the app's
 *   `onClose` drain. Timers are `unref`'d, so a scheduler never keeps an
 *   otherwise-idle process alive on its own.
 *
 * Everything is built on Web-standard primitives (`AbortController`,
 * `Intl.DateTimeFormat` for timezone wall-clock math, `setTimeout`), so it
 * runs unchanged on Node, Bun, Deno, Cloudflare Workers, and Vercel, with
 * zero runtime dependencies. Pair it with {@link App.cron} for an app-managed
 * scheduler whose lifecycle is tied to graceful shutdown, or drive a
 * {@link Scheduler} directly.
 *
 * @example
 * ```ts
 * const scheduler = new Scheduler();
 * scheduler.define({ name: "cleanup", cron: "0 * * * *" }, async ({ signal }) => {
 *   await purgeExpiredSessions({ signal });
 * });
 * scheduler.start();
 * // ... later, during shutdown:
 * await scheduler.stop(5_000);
 * ```
 *
 * @module
 * @since 0.37.0
 */

/**
 * Thrown when a cron expression cannot be parsed, or describes a time that can
 * never occur (for example `0 0 30 2 *` — the 30th of February).
 *
 * @since 0.37.0
 */
export class CronParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CronParseError";
  }
}

/**
 * A minimal structured logger, structurally compatible with the DaloyJS
 * application logger. Only the levels the scheduler emits are required.
 *
 * @since 0.37.0
 */
export interface SchedulerLogger {
  /** Log at debug level (task definitions as they are registered). */
  debug(obj: object | string, msg?: string): void;
  /** Log at info level (scheduler started / stopped lifecycle events). */
  info(obj: object | string, msg?: string): void;
  /** Log at warn level (overrun-skipped runs, stop grace-period timeouts). */
  warn(obj: object | string, msg?: string): void;
  /** Log at error level (a task handler threw or rejected). */
  error(obj: object | string, msg?: string): void;
}

/**
 * Pluggable timer primitives, injectable for deterministic testing. The
 * default uses `setTimeout`/`clearTimeout` and `unref`s the handle so a
 * pending tick never keeps an idle process alive.
 *
 * @since 0.37.0
 */
export interface TimerFns {
  /** Schedule `callback` to run after `delayMs`, returning an opaque handle. */
  set(callback: () => void, delayMs: number): unknown;
  /** Cancel a previously scheduled timer by its handle. */
  clear(handle: unknown): void;
}

/**
 * Context handed to a task handler on each run.
 *
 * @since 0.37.0
 */
export interface TaskRunContext {
  /** The task's unique name. */
  readonly name: string;
  /** The wall-clock time the run was scheduled for. */
  readonly scheduledFor: Date;
  /** Monotonically increasing run number for this task (1-based). */
  readonly runCount: number;
  /**
   * Aborted when the per-run `timeoutMs` elapses, or when {@link Scheduler.stop}
   * runs out of grace time. Well-behaved handlers should forward it to any
   * I/O they perform so shutdown stays prompt.
   */
  readonly signal: AbortSignal;
}

/**
 * A handler invoked on each scheduled run.
 *
 * @since 0.37.0
 */
export type TaskHandler = (ctx: TaskRunContext) => void | Promise<void>;

/**
 * Information passed to a task's `onError` callback.
 *
 * @since 0.37.0
 */
export interface TaskErrorInfo {
  /** The task's unique name. */
  readonly name: string;
  /** The run number that failed (1-based). */
  readonly runCount: number;
  /** `true` when the failure was the per-run timeout aborting the handler. */
  readonly timedOut: boolean;
}

/**
 * Definition of a single scheduled task. Exactly one of {@link intervalMs} or
 * {@link cron} must be provided.
 *
 * @since 0.37.0
 */
export interface TaskDefinition {
  /** Unique, non-empty task name. Used in logs and {@link Scheduler.getState}. */
  name: string;
  /**
   * Fixed delay, in milliseconds, between the **start** of consecutive runs
   * (fixed-rate cadence). Must be a positive integer. If a run outlasts the
   * interval, the next tick is skipped (single-flight) rather than overlapping.
   * Mutually exclusive with {@link cron}.
   */
  intervalMs?: number;
  /**
   * A 5-field cron expression (`minute hour day-of-month month day-of-week`)
   * or a named alias (`@yearly`/`@annually`, `@monthly`, `@weekly`, `@daily`/
   * `@midnight`, `@hourly`). Mutually exclusive with {@link intervalMs}.
   */
  cron?: string;
  /**
   * IANA timezone (e.g. `"America/New_York"`) the cron expression is evaluated
   * in. Defaults to UTC. Ignored for interval schedules.
   */
  timeZone?: string;
  /**
   * Run the task once immediately when the scheduler starts, in addition to
   * its normal schedule. Defaults to `false`.
   */
  runOnStart?: boolean;
  /**
   * Abort the run's {@link TaskRunContext.signal} after this many milliseconds.
   * `0` (the default) disables the per-run timeout.
   */
  timeoutMs?: number;
  /**
   * Invoked when a run throws or times out. Errors are always logged; this
   * hook is for custom handling (alerting, metrics). Exceptions thrown here
   * are swallowed.
   */
  onError?: (error: unknown, info: TaskErrorInfo) => void;
}

/**
 * Options for constructing a {@link Scheduler}.
 *
 * @since 0.37.0
 */
export interface SchedulerOptions {
  /** Structured logger for scheduler lifecycle and task events. */
  logger?: SchedulerLogger;
  /** Injectable clock (milliseconds since epoch). Defaults to `Date.now`. */
  now?: () => number;
  /** Injectable timer primitives. Defaults to `unref`'d `setTimeout`. */
  timers?: TimerFns;
}

/**
 * A point-in-time snapshot of a task's execution statistics.
 *
 * @since 0.37.0
 */
export interface TaskState {
  /** The task's unique name. */
  readonly name: string;
  /** Whether a run is currently in progress. */
  readonly running: boolean;
  /** Total completed runs (successful or failed). */
  readonly runs: number;
  /** Total failed runs (threw or timed out). */
  readonly failures: number;
  /** Ticks skipped because the previous run was still in progress. */
  readonly skipped: number;
  /** Epoch ms the most recent run started, or `undefined` if never run. */
  readonly lastRunAt: number | undefined;
  /** Wall-clock duration of the most recent completed run, in ms. */
  readonly lastDurationMs: number | undefined;
  /** The most recent run error, or `undefined`. */
  readonly lastError: unknown;
  /** Epoch ms the next run is scheduled for, or `undefined` if stopped. */
  readonly nextRunAt: number | undefined;
}

// ── cron parsing ────────────────────────────────────────────────────

/**
 * A cron expression compiled into per-field membership sets. Each set lists
 * the allowed numeric values for that field.
 *
 * @since 0.37.0
 */
export interface CronFields {
  /** Allowed minutes (0–59). */
  readonly minute: ReadonlySet<number>;
  /** Allowed hours (0–23). */
  readonly hour: ReadonlySet<number>;
  /** Allowed days of month (1–31). */
  readonly dayOfMonth: ReadonlySet<number>;
  /** Allowed months (1–12). */
  readonly month: ReadonlySet<number>;
  /** Allowed days of week (0–6, Sunday = 0). */
  readonly dayOfWeek: ReadonlySet<number>;
  /** `true` when day-of-month was restricted (not `*`). */
  readonly domRestricted: boolean;
  /** `true` when day-of-week was restricted (not `*`). */
  readonly dowRestricted: boolean;
}

const CRON_ALIASES: Readonly<Record<string, string>> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

const MONTH_NAMES: Readonly<Record<string, number>> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const DAY_NAMES: Readonly<Record<string, number>> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function resolveNamed(token: string, names: Readonly<Record<string, number>>): string {
  const lower = token.toLowerCase();
  return lower in names ? String(names[lower]) : token;
}

/**
 * Parse a single cron field (e.g. `"*\/5"`, `"1-5"`, `"1,15,30"`) into the set
 * of allowed values within `[min, max]`. Parsing is purely arithmetic — it
 * splits on `,`, `-`, and `/` and validates each integer — so there is no
 * regular-expression backtracking to exploit.
 */
function parseField(
  field: string,
  min: number,
  max: number,
  fieldName: string,
  names?: Readonly<Record<string, number>>
): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    if (part === "") {
      throw new CronParseError(`Empty ${fieldName} segment in cron field "${field}".`);
    }
    const [rangePart, stepPart] = part.split("/") as [string, string?];
    let step = 1;
    if (stepPart !== undefined) {
      step = Number(stepPart);
      if (!Number.isInteger(step) || step <= 0) {
        throw new CronParseError(`Invalid step "${stepPart}" in ${fieldName} field.`);
      }
    }

    let lo: number;
    let hi: number;
    if (rangePart === "*") {
      lo = min;
      hi = max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-") as [string, string?];
      if (b === undefined) {
        throw new CronParseError(`Invalid range "${rangePart}" in ${fieldName} field.`);
      }
      lo = Number(names ? resolveNamed(a, names) : a);
      hi = Number(names ? resolveNamed(b, names) : b);
    } else {
      lo = Number(names ? resolveNamed(rangePart, names) : rangePart);
      hi = lo;
    }

    if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
      throw new CronParseError(`Non-integer value in ${fieldName} field "${field}".`);
    }
    if (lo < min || hi > max || lo > hi) {
      throw new CronParseError(
        `Value out of range in ${fieldName} field "${field}" (allowed ${min}-${max}).`
      );
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

/**
 * Parse a 5-field cron expression (or a named alias) into a {@link CronFields}
 * matcher.
 *
 * Supported syntax per field: `*`, lists (`1,2,3`), ranges (`1-5`), steps
 * (`*\/5`, `1-10/2`), and case-insensitive month (`JAN`–`DEC`) / day
 * (`SUN`–`SAT`) names. Day-of-week accepts both `0` and `7` for Sunday.
 *
 * @param expression - A cron expression or alias.
 * @returns The compiled field sets.
 * @throws {@link CronParseError} if the expression is malformed.
 * @since 0.37.0
 */
export function parseCron(expression: string): CronFields {
  const trimmed = expression.trim();
  const expanded = trimmed.startsWith("@") ? CRON_ALIASES[trimmed.toLowerCase()] : trimmed;
  if (expanded === undefined) {
    throw new CronParseError(`Unknown cron alias "${trimmed}".`);
  }
  const fields = expanded.split(/\s+/);
  if (fields.length !== 5) {
    throw new CronParseError(
      `Cron expression must have 5 fields, got ${fields.length}: "${expression}".`
    );
  }
  const [min, hr, dom, mon, dow] = fields as [string, string, string, string, string];

  const minute = parseField(min, 0, 59, "minute");
  const hour = parseField(hr, 0, 23, "hour");
  const dayOfMonth = parseField(dom, 1, 31, "day-of-month");
  const month = parseField(mon, 1, 12, "month", MONTH_NAMES);
  // Day-of-week allows 7 as an alias for Sunday; normalize 7 -> 0.
  const dowRaw = parseField(dow.replace(/7/g, "0"), 0, 6, "day-of-week", DAY_NAMES);

  return {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek: dowRaw,
    domRestricted: dom !== "*",
    dowRestricted: dow !== "*",
  };
}

interface WallClock {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
}

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function wallClockOf(date: Date, timeZone: string | undefined): WallClock {
  if (timeZone === undefined || timeZone === "UTC") {
    return {
      minute: date.getUTCMinutes(),
      hour: date.getUTCHours(),
      dayOfMonth: date.getUTCDate(),
      month: date.getUTCMonth() + 1,
      dayOfWeek: date.getUTCDay(),
    };
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "0";
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0; // some ICU builds render midnight as 24
  return {
    minute: Number(get("minute")),
    hour,
    dayOfMonth: Number(get("day")),
    month: Number(get("month")),
    dayOfWeek: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

function matches(fields: CronFields, wc: WallClock): boolean {
  if (!fields.minute.has(wc.minute)) return false;
  if (!fields.hour.has(wc.hour)) return false;
  if (!fields.month.has(wc.month)) return false;
  // Cron's day-of-month / day-of-week quirk: when BOTH are restricted, a match
  // on EITHER counts (Vixie cron semantics). When only one is restricted, that
  // one must match.
  const domOk = fields.dayOfMonth.has(wc.dayOfMonth);
  const dowOk = fields.dayOfWeek.has(wc.dayOfWeek);
  if (fields.domRestricted && fields.dowRestricted) return domOk || dowOk;
  if (fields.domRestricted) return domOk;
  if (fields.dowRestricted) return dowOk;
  return true;
}

// Five years of minutes — a generous upper bound for finding the next match.
// A satisfiable cron matches far sooner; an unsatisfiable one (e.g. Feb 30)
// hits this cap and surfaces as a CronParseError instead of looping forever.
const MAX_LOOKAHEAD_MINUTES = 5 * 366 * 24 * 60;

/**
 * Compute the next instant (strictly after `after`) that a cron expression
 * matches, evaluated in `timeZone` (UTC by default).
 *
 * @param expression - A compiled {@link CronFields} or a raw cron expression.
 * @param after - The instant to search after. Defaults to now.
 * @param timeZone - IANA timezone the expression is evaluated in.
 * @returns The next matching `Date`.
 * @throws {@link CronParseError} if no match occurs within five years
 *   (an unsatisfiable expression).
 * @since 0.37.0
 */
export function nextCronRun(
  expression: string | CronFields,
  after: Date = new Date(),
  timeZone?: string
): Date {
  const fields = typeof expression === "string" ? parseCron(expression) : expression;
  // Advance to the start of the next whole minute.
  const start = Math.floor(after.getTime() / 60_000) * 60_000 + 60_000;
  for (let i = 0; i < MAX_LOOKAHEAD_MINUTES; i++) {
    const candidate = new Date(start + i * 60_000);
    if (matches(fields, wallClockOf(candidate, timeZone))) return candidate;
  }
  throw new CronParseError(`Cron expression matches no time within five years (unsatisfiable).`);
}

// ── scheduler ───────────────────────────────────────────────────────

const defaultTimers: TimerFns = {
  set(callback, delayMs) {
    const handle = setTimeout(callback, delayMs);
    (handle as { unref?: () => void }).unref?.();
    return handle;
  },
  clear(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

interface RegisteredTask {
  readonly def: TaskDefinition;
  readonly handler: TaskHandler;
  readonly fields?: CronFields;
  timer: unknown;
  running: boolean;
  current?: { controller: AbortController; promise: Promise<void> };
  runs: number;
  failures: number;
  skipped: number;
  lastRunAt?: number;
  lastDurationMs?: number;
  lastError?: unknown;
  nextRunAt?: number;
}

/**
 * An in-process task scheduler with cron / interval schedules, single-flight
 * overlap protection, and graceful shutdown. See the module overview for the
 * design rationale.
 *
 * @since 0.37.0
 */
export class Scheduler {
  readonly #tasks = new Map<string, RegisteredTask>();
  readonly #logger?: SchedulerLogger;
  readonly #now: () => number;
  readonly #timers: TimerFns;
  #started = false;
  #stopped = false;

  constructor(options: SchedulerOptions = {}) {
    this.#logger = options.logger;
    this.#now = options.now ?? Date.now;
    this.#timers = options.timers ?? defaultTimers;
  }

  /** `true` once {@link start} has been called and {@link stop} has not. */
  get running(): boolean {
    return this.#started && !this.#stopped;
  }

  /** The number of registered tasks. */
  get size(): number {
    return this.#tasks.size;
  }

  /**
   * Register a task. May be called before or after {@link start}; tasks added
   * after start are scheduled immediately.
   *
   * @param def - The task definition. Exactly one of `intervalMs` / `cron`.
   * @param handler - The function to run on each tick.
   * @returns This scheduler, for chaining.
   * @throws {RangeError} on invalid options (bad name, both/neither schedule,
   *   non-positive interval, negative timeout, duplicate name).
   * @throws {@link CronParseError} if a `cron` expression is malformed.
   */
  define(def: TaskDefinition, handler: TaskHandler): this {
    if (typeof def.name !== "string" || def.name.trim() === "") {
      throw new RangeError("Scheduler task requires a non-empty name.");
    }
    if (this.#tasks.has(def.name)) {
      throw new RangeError(`Scheduler task "${def.name}" is already defined.`);
    }
    const hasInterval = def.intervalMs !== undefined;
    const hasCron = def.cron !== undefined;
    if (hasInterval === hasCron) {
      throw new RangeError(
        `Scheduler task "${def.name}" requires exactly one of intervalMs or cron.`
      );
    }
    if (hasInterval && (!Number.isInteger(def.intervalMs) || def.intervalMs! <= 0)) {
      throw new RangeError(`Scheduler task "${def.name}" intervalMs must be a positive integer.`);
    }
    if (def.timeoutMs !== undefined && (!Number.isInteger(def.timeoutMs) || def.timeoutMs < 0)) {
      throw new RangeError(
        `Scheduler task "${def.name}" timeoutMs must be a non-negative integer.`
      );
    }
    const fields = hasCron ? parseCron(def.cron!) : undefined;

    const task: RegisteredTask = {
      def,
      handler,
      ...(fields ? { fields } : {}),
      timer: undefined,
      running: false,
      runs: 0,
      failures: 0,
      skipped: 0,
    };
    this.#tasks.set(def.name, task);
    this.#logger?.debug(
      {
        event: "scheduler.task.defined",
        task: def.name,
        cron: def.cron,
        intervalMs: def.intervalMs,
      },
      `Scheduled task "${def.name}" defined`
    );
    if (this.#started && !this.#stopped) this.#arm(task, def.runOnStart === true);
    return this;
  }

  /**
   * Start the scheduler. Idempotent: a second call is a no-op. Each task is
   * armed for its next run (or run immediately when `runOnStart` is set).
   *
   * @returns This scheduler, for chaining.
   */
  start(): this {
    if (this.#started) return this;
    this.#started = true;
    this.#stopped = false;
    this.#logger?.info(
      { event: "scheduler.started", tasks: this.#tasks.size },
      "Scheduler started"
    );
    for (const task of this.#tasks.values()) this.#arm(task, task.def.runOnStart === true);
    return this;
  }

  /**
   * Stop the scheduler gracefully. Clears every pending timer so no new runs
   * start, then waits up to `graceMs` for in-flight runs to finish; any run
   * still going when the grace period elapses has its {@link AbortSignal}
   * aborted. Idempotent.
   *
   * @param graceMs - Milliseconds to wait for in-flight runs. Defaults to 5000.
   * @returns A promise that resolves once all runs have settled (or been
   *   aborted and settled).
   */
  async stop(graceMs = 5_000): Promise<void> {
    if (!this.#started || this.#stopped) {
      this.#stopped = true;
      return;
    }
    this.#stopped = true;
    for (const task of this.#tasks.values()) {
      if (task.timer !== undefined) {
        this.#timers.clear(task.timer);
        task.timer = undefined;
      }
      task.nextRunAt = undefined;
    }

    const inflight = (): RegisteredTask[] =>
      [...this.#tasks.values()].filter((t) => t.current !== undefined);

    if (inflight().length === 0) {
      this.#logger?.info({ event: "scheduler.stopped" }, "Scheduler stopped");
      return;
    }

    let timedOut = false;
    const deadline = new Promise<void>((resolve) => {
      const t = this.#timers.set(() => {
        timedOut = true;
        resolve();
      }, graceMs);
      // Best-effort: nothing references the deadline handle after resolve.
      void t;
    });
    const settled = Promise.all(inflight().map((t) => t.current!.promise)).then(() => undefined);

    await Promise.race([settled, deadline]);

    if (timedOut) {
      const stuck = inflight();
      if (stuck.length > 0) {
        this.#logger?.warn(
          { event: "scheduler.stop.timeout", tasks: stuck.map((t) => t.def.name) },
          `Scheduler grace period elapsed; aborting ${stuck.length} in-flight task(s)`
        );
        for (const t of stuck) t.current!.controller.abort();
        // Wait for the aborted runs to unwind.
        await Promise.all(stuck.map((t) => t.current!.promise)).catch(() => undefined);
      }
    }
    this.#logger?.info({ event: "scheduler.stopped" }, "Scheduler stopped");
  }

  /**
   * Trigger a task immediately, out of band, respecting the single-flight
   * guarantee (a manual run is skipped if the task is already running). The
   * task's normal schedule is unaffected.
   *
   * @param name - The task name.
   * @returns A promise that resolves when the manual run settles, with `true`
   *   if it ran or `false` if it was skipped because a run was in progress.
   * @throws {RangeError} if no task with that name exists.
   */
  async runNow(name: string): Promise<boolean> {
    const task = this.#tasks.get(name);
    if (task === undefined) {
      throw new RangeError(`Scheduler has no task named "${name}".`);
    }
    if (task.running) {
      task.skipped++;
      this.#logger?.warn(
        { event: "scheduler.task.overrun", task: name, trigger: "manual" },
        `Manual run of "${name}" skipped: a run is already in progress`
      );
      return false;
    }
    await this.#run(task);
    return true;
  }

  /**
   * Read a snapshot of a task's execution statistics.
   *
   * @param name - The task name.
   * @returns The {@link TaskState}, or `undefined` if no such task exists.
   */
  getState(name: string): TaskState | undefined {
    const task = this.#tasks.get(name);
    return task ? this.#snapshot(task) : undefined;
  }

  /**
   * List execution-statistics snapshots for every registered task.
   *
   * @returns A snapshot array in definition order.
   */
  list(): readonly TaskState[] {
    return [...this.#tasks.values()].map((t) => this.#snapshot(t));
  }

  #snapshot(task: RegisteredTask): TaskState {
    return {
      name: task.def.name,
      running: task.running,
      runs: task.runs,
      failures: task.failures,
      skipped: task.skipped,
      lastRunAt: task.lastRunAt,
      lastDurationMs: task.lastDurationMs,
      lastError: task.lastError,
      nextRunAt: task.nextRunAt,
    };
  }

  #arm(task: RegisteredTask, immediate: boolean): void {
    if (this.#stopped) return;
    if (immediate) {
      task.nextRunAt = this.#now();
      // Defer to a microtask-free timer so start()/define() return first.
      task.timer = this.#timers.set(() => {
        void this.#tick(task);
      }, 0);
      return;
    }
    const delay = this.#nextDelay(task);
    task.nextRunAt = this.#now() + delay;
    task.timer = this.#timers.set(() => {
      void this.#tick(task);
    }, delay);
  }

  #nextDelay(task: RegisteredTask): number {
    if (task.fields !== undefined) {
      const next = nextCronRun(task.fields, new Date(this.#now()), task.def.timeZone);
      return Math.max(0, next.getTime() - this.#now());
    }
    return task.def.intervalMs!;
  }

  async #tick(task: RegisteredTask): Promise<void> {
    task.timer = undefined;
    if (this.#stopped) return;
    // Re-arm the next cadence tick FIRST (fixed-rate), so the schedule keeps
    // its cadence independent of how long this run takes. Exactly one timer is
    // ever pending per task.
    const scheduledForMs = task.nextRunAt ?? this.#now();
    this.#arm(task, false);
    if (task.running) {
      // Single-flight: a previous run is still going. Skip this tick.
      task.skipped++;
      this.#logger?.warn(
        { event: "scheduler.task.overrun", task: task.def.name, trigger: "tick" },
        `Tick for "${task.def.name}" skipped: previous run still in progress`
      );
      return;
    }
    await this.#run(task, scheduledForMs);
  }

  async #run(task: RegisteredTask, scheduledForMs?: number): Promise<void> {
    const controller = new AbortController();
    const runCount = task.runs + 1;
    const scheduledFor = new Date(scheduledForMs ?? this.#now());
    task.running = true;
    task.lastRunAt = this.#now();

    let timeoutTimer: unknown;
    let timedOut = false;
    if (task.def.timeoutMs !== undefined && task.def.timeoutMs > 0) {
      timeoutTimer = this.#timers.set(() => {
        timedOut = true;
        controller.abort();
      }, task.def.timeoutMs);
    }

    const promise = (async () => {
      const startedAt = this.#now();
      try {
        await task.handler({
          name: task.def.name,
          scheduledFor,
          runCount,
          signal: controller.signal,
        });
        task.lastError = undefined;
      } catch (error) {
        task.failures++;
        task.lastError = error;
        this.#logger?.error(
          {
            event: "scheduler.task.failed",
            task: task.def.name,
            runCount,
            timedOut,
            err: serializeError(error),
          },
          `Scheduled task "${task.def.name}" failed`
        );
        try {
          task.def.onError?.(error, { name: task.def.name, runCount, timedOut });
        } catch {
          // Never let an onError handler crash the scheduler loop.
        }
      } finally {
        if (timeoutTimer !== undefined) this.#timers.clear(timeoutTimer);
        task.runs++;
        task.lastDurationMs = this.#now() - startedAt;
        task.running = false;
        task.current = undefined;
      }
    })();
    task.current = { controller, promise };
    await promise;
  }
}

function serializeError(error: unknown): { name?: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { message: String(error) };
}
