/**
 * Pluggable logger interface.
 *
 * The default logger is a tiny structured JSON logger writing to stdout.
 * Plug pino / winston / your own by implementing `Logger`.
 */

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/**
 * Minimal structured-logger contract. Compatible with pino/winston via a
 * thin adapter; the default implementation is {@link createLogger}.
 */
export interface Logger {
  /** Minimum level emitted; records below this level are dropped. */
  level: LogLevel;
  /** Log at `trace` level. Pass a fields object plus optional message, or a message string. */
  trace(obj: object | string, msg?: string): void;
  /** Log at `debug` level. Pass a fields object plus optional message, or a message string. */
  debug(obj: object | string, msg?: string): void;
  /** Log at `info` level. Pass a fields object plus optional message, or a message string. */
  info(obj: object | string, msg?: string): void;
  /** Log at `warn` level. Pass a fields object plus optional message, or a message string. */
  warn(obj: object | string, msg?: string): void;
  /** Log at `error` level. Pass a fields object plus optional message, or a message string. */
  error(obj: object | string, msg?: string): void;
  /** Log at `fatal` level. Pass a fields object plus optional message, or a message string. */
  fatal(obj: object | string, msg?: string): void;
  /** Return a derived logger whose records always include `bindings` merged into each record. */
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
  /**
   * Replace substrings shaped like opaque provider credentials
   * (GitHub `ghp_`/`ghs_`/`gho_`/`ghu_`/`ghr_`/`github_pat_`, Slack
   * `xox[abprs]-`, AWS `AKIA…`/`ASIA…`, Stripe `sk_live_…`/`pk_live_…`,
   * npm `npm_…`, GitLab `glpat-…`, Google `AIza…`, OpenAI `sk-…`,
   * Anthropic `sk-ant-…`) inside any string value, regardless of key.
   * Defense-in-depth for the Composer/Packagist 2026 incident class
   * where a tool printed a rejected token value into stderr because
   * its hardcoded format check did not match the new token shape.
   * Default: `true`.
   * @since 0.69.0
   */
  redactCredentialLikeStrings?: boolean;
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
  // A structured field literally named `private_key` is always a secret and
  // has a negligible false-positive rate as a log-field name (mirrors the
  // existing `client_secret`). The broader OAuth/session query-string names
  // (`code`, `state`, `id`, `key`, `sid`, `session`, `signature`, `sig`,
  // `auth`, …) are DELIBERATELY NOT here: those are extremely common,
  // non-secret structured field names (record ids, sort keys, UI state) and
  // redacting them at every depth would corrupt normal operational logs.
  // Secrets that ride in a *URL query string* are handled instead by
  // {@link sanitizeUrlForLog} / {@link SENSITIVE_URL_QUERY_KEYS}, which only
  // applies to the `url` field where the query context makes them sensitive.
  "private_key",
  // AI / LLM provider credential headers and body fields. Added in response
  // to the LiteLLM 2026 "AI blast radius" incident class (Snyk 2026,
  // CVE-2026-42208 + CVE-2026-33634) — an AI gateway that brokers prompts
  // concentrates provider keys, so a single log line at the wrong level
  // can leak every downstream credential. See SECURITY.md
  // § "AI gateway blast radius (LiteLLM 2026 pattern)".
  "openai-api-key",
  "x-openai-api-key",
  "anthropic-api-key",
  "x-anthropic-api-key",
  "x-api-key-anthropic",
  "x-goog-api-key",
  "google-api-key",
  "x-google-api-key",
  "azure-api-key",
  "x-azure-api-key",
  "api-key-azure",
  "cohere-api-key",
  "x-cohere-api-key",
  "mistral-api-key",
  "x-mistral-api-key",
  "groq-api-key",
  "x-groq-api-key",
  "replicate-api-token",
  "huggingface-api-key",
  "x-huggingface-api-key",
  "x-litellm-master-key",
  "litellm-master-key",
  "litellm-api-key",
]);

/** Options for {@link createLogger}. */
export interface ConsoleLoggerOptions {
  /** Minimum level to emit. Defaults to `"info"`. */
  level?: LogLevel;
  /** Fields merged into every record emitted by this logger and its children. */
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

/**
 * Substring patterns for opaque provider credentials. Matches inside
 * larger strings (e.g. error messages that interpolate a rejected
 * token) and is replaced with the censor. Lengths are anchored
 * conservatively to avoid false positives on ordinary identifiers.
 *
 * Sources (token formats published by each provider as of 2026):
 * - GitHub: `gh[opru]_` 36–251 alphanumerics (opaque); `ghs_` 36+ of
 *   alnum/`.`/`-`/`_` to also cover the 2026 stateless installation-token
 *   format (a ~520-char `ghs_`-prefixed JWT with two dots — see
 *   <https://github.blog/changelog/2026-05-15-github-app-installation-tokens-per-request-override-header/>);
 *   `github_pat_` 40+ alnum/_
 * - Slack:  `xox[abprs]-` legacy/bot/user/refresh tokens
 * - AWS:    `AKIA`/`ASIA` + 16 uppercase alphanumerics
 * - Stripe: `sk|rk|pk` + `_live_|_test_` + 20+ alphanumerics
 * - npm:    `npm_` + 36 alphanumerics (publish tokens)
 * - GitLab: `glpat-` + 20+ alnum/_/-
 * - Google: `AIza` + 35 alnum/_/-
 * - Anthropic: `sk-ant-` + 20+ alnum/_/-
 * - OpenAI: `sk-` + 20+ alnum/_/- (matched after the `sk-ant-` form)
 */
const CREDENTIAL_LIKE_RE =
  /(?:ghs_[A-Za-z0-9._-]{36,1024}|gh[opru]_[A-Za-z0-9]{36,251}|github_pat_[A-Za-z0-9_]{40,255}|xox[abprs]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[A-Z0-9]{16}|(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{36}|glpat-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{35}|sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,})/g;

interface ResolvedRedaction {
  keys: Set<string>;
  censor: string;
  redactJwt: boolean;
  redactCredential: boolean;
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
    redactCredential: cfg.redactCredentialLikeStrings ?? true,
    maxDepth: cfg.maxDepth ?? 6,
  };
}

function redactString(value: string, cfg: ResolvedRedaction): string {
  if (cfg.redactJwt && JWT_LIKE_RE.test(value)) return cfg.censor;
  if (cfg.redactCredential && CREDENTIAL_LIKE_RE.test(value)) {
    // Reset lastIndex because the test() above advanced it on the global regex.
    CREDENTIAL_LIKE_RE.lastIndex = 0;
    return value.replace(CREDENTIAL_LIKE_RE, cfg.censor);
  }
  return value;
}

/**
 * Walk `record` in place, replacing any value whose key (case-insensitive)
 * matches `cfg.keys` and any string value shaped like a JWT (when
 * `cfg.redactJwt` is on) with `cfg.censor`. Exported for direct use by
 * custom logger implementations that want the same defaults.
 *
 * @param record - Log record to redact. Mutated in place (cycle-safe, depth-capped).
 * @param cfg - Resolved redaction settings (key set, censor, JWT/credential toggles, max depth).
 * @returns The same `record` object, for chaining.
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
      if (typeof v === "string") {
        const replaced = redactString(v, cfg);
        if (replaced !== v) node[i] = replaced;
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
    if (typeof v === "string") {
      const replaced = redactString(v, cfg);
      if (replaced !== v) obj[key] = replaced;
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

/**
 * Query parameter names whose values are redacted when a request URL is
 * bound into a log record. Case-insensitive. Covers OAuth redirect params,
 * API keys in query strings, signed-URL tokens, session identifiers, and the
 * exact-named parameters of AWS SigV4 / GCS V4 presigned URLs (the `x-amz-*`
 * and `x-goog-*` families are additionally matched by prefix — see
 * {@link SENSITIVE_URL_QUERY_KEY_PREFIXES}).
 *
 * @since 1.0.0
 */
export const SENSITIVE_URL_QUERY_KEYS: readonly string[] = Object.freeze([
  "authorization",
  "access_token",
  "refresh_token",
  "id_token",
  "token",
  "api_key",
  "apikey",
  "api-key",
  "key",
  "password",
  "passwd",
  "secret",
  "client_secret",
  "code",
  "state",
  "session_state",
  "session",
  "sid",
  "signature",
  "sig",
  "auth",
  "private_key",
  "x-api-key",
  // AWS SigV4 presigned URL parameters. `X-Amz-Signature` is the secret; the
  // credential (embeds the access-key id) and session token are equally
  // sensitive. Also covered by the `x-amz-` prefix below.
  "x-amz-signature",
  "x-amz-credential",
  "x-amz-security-token",
  // Google Cloud Storage V4 signed URL parameters. Also covered by `x-goog-`.
  "x-goog-signature",
  "x-goog-credential",
  "googleaccessid",
]);

/**
 * Case-insensitive query-key prefixes whose values are always redacted in a
 * logged URL. Covers the full AWS SigV4 (`X-Amz-*`) and GCS V4 (`X-Goog-*`)
 * presigned-URL parameter families so a signature never leaks even if a
 * provider adds a new signed parameter name. Redacting the non-secret members
 * of the bundle (`X-Amz-Date`, `X-Amz-Expires`, …) is harmless in a log line.
 *
 * @since 1.0.0
 */
export const SENSITIVE_URL_QUERY_KEY_PREFIXES: readonly string[] = Object.freeze([
  "x-amz-",
  "x-goog-",
]);

const SENSITIVE_URL_QUERY_KEY_SET = new Set(
  SENSITIVE_URL_QUERY_KEYS.map((k) => k.toLowerCase()),
);

/**
 * Whether a URL query-parameter name is treated as secret-bearing when a
 * request URL is bound into a log record. True when the lower-cased name is in
 * {@link SENSITIVE_URL_QUERY_KEYS} or starts with a
 * {@link SENSITIVE_URL_QUERY_KEY_PREFIXES} entry.
 *
 * @param lowerKey - Already-lower-cased query-parameter name.
 * @returns `true` if the value should be redacted.
 */
function isSensitiveUrlQueryKey(lowerKey: string): boolean {
  if (SENSITIVE_URL_QUERY_KEY_SET.has(lowerKey)) return true;
  for (const prefix of SENSITIVE_URL_QUERY_KEY_PREFIXES) {
    if (lowerKey.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Produce a log-safe form of a request URL.
 *
 * Keeps scheme, host, and path for operability. Redacts values of
 * {@link SENSITIVE_URL_QUERY_KEYS} / {@link SENSITIVE_URL_QUERY_KEY_PREFIXES}
 * (and JWT-like / credential-like query values) so OAuth `?code=`,
 * `?access_token=`, and presigned-URL signatures (`?X-Amz-Signature=`,
 * `?X-Goog-Signature=`) never land in durable error logs under the field name
 * `url` (which the structured redactor does not rename-match).
 *
 * Malformed URLs fall back to the path-only prefix before `?` / `#`.
 *
 * This runs once per request on the logging path, so it fast-paths the common
 * case: a URL with no query, no fragment, and no userinfo (`@`) delimiter is
 * already log-safe and is returned verbatim without the WHATWG URL parse (about
 * an order of magnitude cheaper). The `@` guard preserves userinfo stripping
 * for the rare inputs that carry credentials in the authority — `request.url`
 * itself never does, but this is a public utility.
 *
 * @param url - Absolute or relative request URL (typically `request.url`).
 * @returns A string safe to attach as a logger binding.
 * @since 1.0.0
 */
export function sanitizeUrlForLog(url: string): string {
  if (
    url.indexOf("?") === -1 &&
    url.indexOf("#") === -1 &&
    url.indexOf("@") === -1
  ) {
    return url;
  }
  try {
    const parsed = new URL(url);
    if (parsed.search === "" && parsed.hash === "") {
      return `${parsed.origin}${parsed.pathname}`;
    }
    const safe = new URL(parsed.origin + parsed.pathname);
    for (const [key, value] of parsed.searchParams) {
      const lower = key.toLowerCase();
      const sensitiveKey = isSensitiveUrlQueryKey(lower);
      const sensitiveValue =
        JWT_LIKE_RE.test(value) || CREDENTIAL_LIKE_RE.test(value);
      CREDENTIAL_LIKE_RE.lastIndex = 0;
      safe.searchParams.append(key, sensitiveKey || sensitiveValue ? "[REDACTED]" : value);
    }
    return safe.toString();
  } catch {
    const cut = url.search(/[?#]/);
    return cut === -1 ? url : url.slice(0, cut);
  }
}
