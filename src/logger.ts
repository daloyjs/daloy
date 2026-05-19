/**
 * Pluggable logger interface.
 *
 * The default logger is a tiny structured JSON logger writing to stdout.
 * Plug pino / winston / your own by implementing `Logger`.
 */

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface Logger {
  level: LogLevel;
  trace(obj: object | string, msg?: string): void;
  debug(obj: object | string, msg?: string): void;
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
  fatal(obj: object | string, msg?: string): void;
  child(bindings: Record<string, unknown>): Logger;
}

const LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/**
 * Redaction configuration for {@link createLogger}. Keys are matched
 * case-insensitively at any depth. Pass `false` to disable the safe
 * defaults. When omitted, the secure-by-default set
 * ({@link DEFAULT_REDACT_KEYS}) is used and string values shaped like a JWT
 * (`eyJ...`) are also replaced.
 *
 * @since 0.15.0
 */
export interface LoggerRedactionOptions {
  /** Additional case-insensitive keys to redact. Merged with the defaults unless `useDefaults` is `false`. */
  keys?: readonly string[];
  /** Replacement string. Default: `"[REDACTED]"`. */
  censor?: string;
  /** Include the {@link DEFAULT_REDACT_KEYS} list. Default: `true`. */
  useDefaults?: boolean;
  /** Replace string values shaped like a JWT (`eyJ...`) regardless of key. Default: `true`. */
  redactJwtLikeStrings?: boolean;
  /** Maximum recursion depth when walking nested objects. Default: 6. */
  maxDepth?: number;
}

/**
 * Default set of header / field names redacted from every structured log
 * record. These are the keys most commonly observed leaking credentials
 * into log aggregators in real-world incidents. Matched case-insensitively.
 *
 * @since 0.15.0
 */
export const DEFAULT_REDACT_KEYS: readonly string[] = Object.freeze([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "apikey",
  "password",
  "passwd",
  "secret",
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "client_secret",
]);

export interface ConsoleLoggerOptions {
  level?: LogLevel;
  bindings?: Record<string, unknown>;
  /** Where to write. Defaults to process.stdout.write or console.log. */
  write?: (line: string) => void;
  /**
   * Redact sensitive fields from log records before serialization. Pass
   * `false` to disable the default redaction; pass an options object to
   * extend it. Default: on, with {@link DEFAULT_REDACT_KEYS}.
   *
   * @since 0.15.0
   */
  redact?: LoggerRedactionOptions | false;
}

const JWT_LIKE_RE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

interface ResolvedRedaction {
  keys: Set<string>;
  censor: string;
  redactJwt: boolean;
  maxDepth: number;
}

function resolveRedaction(
  opt: LoggerRedactionOptions | false | undefined,
): ResolvedRedaction | null {
  if (opt === false) return null;
  const cfg = opt ?? {};
  const useDefaults = cfg.useDefaults ?? true;
  const keys = new Set<string>();
  if (useDefaults) for (const k of DEFAULT_REDACT_KEYS) keys.add(k.toLowerCase());
  if (cfg.keys) for (const k of cfg.keys) keys.add(k.toLowerCase());
  return {
    keys,
    censor: cfg.censor ?? "[REDACTED]",
    redactJwt: cfg.redactJwtLikeStrings ?? true,
    maxDepth: cfg.maxDepth ?? 6,
  };
}

/**
 * Walk `record` in place, replacing any value whose key (case-insensitive)
 * matches `cfg.keys` and any string value shaped like a JWT (when
 * `cfg.redactJwt` is on) with `cfg.censor`. Exported for direct use by
 * custom logger implementations that want the same defaults.
 *
 * @since 0.15.0
 */
export function redactRecord(
  record: Record<string, unknown>,
  cfg: ResolvedRedaction,
): Record<string, unknown> {
  walkRedact(record, cfg, 0, new WeakSet());
  return record;
}

function walkRedact(
  node: unknown,
  cfg: ResolvedRedaction,
  depth: number,
  seen: WeakSet<object>,
): void {
  if (depth > cfg.maxDepth) return;
  if (node === null || typeof node !== "object") return;
  if (seen.has(node as object)) return;
  seen.add(node as object);
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v = node[i];
      if (cfg.redactJwt && typeof v === "string" && JWT_LIKE_RE.test(v)) {
        node[i] = cfg.censor;
      } else {
        walkRedact(v, cfg, depth + 1, seen);
      }
    }
    return;
  }
  const obj = node as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const lower = key.toLowerCase();
    if (cfg.keys.has(lower)) {
      obj[key] = cfg.censor;
      continue;
    }
    const v = obj[key];
    if (cfg.redactJwt && typeof v === "string" && JWT_LIKE_RE.test(v)) {
      obj[key] = cfg.censor;
    } else {
      walkRedact(v, cfg, depth + 1, seen);
    }
  }
}

/**
 * Build a structured JSON logger writing one record per line to stdout (or
 * any sink you supply). Records always include `level`, `time`, and the
 * caller's bindings; objects are merged shallowly and the optional `msg` is
 * placed under the `msg` key for compatibility with downstream tools.
 *
 * @example
 * ```ts
 * import { createLogger, App } from "@daloyjs/core";
 *
 * const log = createLogger({ level: "info", bindings: { service: "books-api" } });
 * const app = new App({ logger: log });
 * log.info({ event: "boot" }, "server starting");
 * ```
 *
 * @param opts - Level, bindings merged into every record, and custom sink.
 * @returns A {@link Logger} instance.
 * @since 0.1.0
 */
export function createLogger(opts: ConsoleLoggerOptions = {}): Logger {
  const level = opts.level ?? "info";
  const threshold = LEVELS[level];
  const bindings = opts.bindings ?? {};
  const redaction = resolveRedaction(opts.redact);
  const write =
    opts.write ??
    (typeof process !== "undefined" && process.stdout?.write
      ? (line: string) => {
          process.stdout.write(line + "\n");
        }
      : (line: string) => console.log(line));

  function emit(lvl: LogLevel, obj: object | string, msg?: string) {
    if (LEVELS[lvl] < threshold) return;
    const base: Record<string, unknown> = {
      level: lvl,
      time: new Date().toISOString(),
      ...bindings,
    };
    if (typeof obj === "string") {
      base.msg = obj;
    } else {
      Object.assign(base, obj);
      if (msg !== undefined) base.msg = msg;
    }
    if (redaction) redactRecord(base, redaction);
    try {
      write(JSON.stringify(base));
    } catch {
      write(`{"level":"${lvl}","time":"${base.time}","msg":"<unserializable log>"}`);
    }
  }

  const logger: Logger = {
    level,
    trace: (o, m) => emit("trace", o, m),
    debug: (o, m) => emit("debug", o, m),
    info: (o, m) => emit("info", o, m),
    warn: (o, m) => emit("warn", o, m),
    error: (o, m) => emit("error", o, m),
    fatal: (o, m) => emit("fatal", o, m),
    child(extra) {
      return createLogger({
        level,
        bindings: { ...bindings, ...extra },
        write,
        redact: opts.redact,
      });
    },
  };
  return logger;
}

/**
 * A {@link Logger} that discards every record. Used internally when the App
 * is constructed with `{ logger: false }` and exported so tests can silence
 * specific subsystems without monkey-patching console.
 *
 * @since 0.1.0
 */
export const noopLogger: Logger = {
  level: "fatal",
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  child() {
    return noopLogger;
  },
};
