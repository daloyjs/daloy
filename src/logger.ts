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
  /** Maximum recursion depth when walking nested objects. Deeper objects and arrays are censored in full. Default: 6. */
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
  opt: LoggerRedactionOptions | false | undefined
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
 * Redact `record`, replacing any value whose key (case-insensitive) matches
 * `cfg.keys` and any string value shaped like a JWT / credential (when enabled)
 * with `cfg.censor`. Exported for custom logger implementations that want the
 * same defaults. Objects and arrays beyond the depth budget are replaced with
 * the censor rather than serialized uninspected.
 *
 * Security: only the top-level keys of `record` are rewritten in place. Nested
 * objects and arrays are **never mutated** — a redacted copy is substituted
 * (copy-on-write along changed paths only), so logging a live object such as
 * `{ input: ctx.body }` cannot overwrite the caller's data with the censor.
 * Cycle back-edges become `"[Circular]"`; objects with `toJSON()` are
 * redacted on its output (censor if it throws). Unchanged subtrees are shared
 * by reference, so a record needing no
 * redaction allocates nothing beyond a lazily created cycle/alias memo.
 *
 * @param record - Log record to redact. Top-level keys are updated in place.
 * @param cfg - Resolved redaction settings (key set, censor, JWT/credential toggles, max depth).
 * @returns The same `record` object, for chaining.
 * @since 0.15.0
 */
export function redactRecord(
  record: Record<string, unknown>,
  cfg: ResolvedRedaction
): Record<string, unknown> {
  let memo: Map<object, unknown> | undefined;
  for (const key of Object.keys(record)) {
    const v = record[key];
    let next: unknown;
    if (cfg.keys.has(key.toLowerCase())) {
      next = cfg.censor;
    } else if (typeof v === "string") {
      next = redactString(v, cfg);
    } else if (v !== null && typeof v === "object") {
      if (memo === undefined) {
        memo = new Map();
        // A nested reference back to the root resolves to the root itself.
        memo.set(record, record);
      }
      next = redactValue(v, cfg, 0, memo);
    } else {
      continue;
    }
    if (next !== v) record[key] = next;
  }
  return record;
}

/** Marker for a node whose redaction is in progress (i.e. a cycle back-edge). */
const REDACT_IN_PROGRESS: unique symbol = Symbol("redact.inProgress");

/** Placeholder substituted for a cycle back-edge so the original is never exposed. */
const REDACT_CIRCULAR = "[Circular]";

/**
 * Shallow-copy `obj` onto a fresh object with the same prototype. Errors also
 * keep their non-enumerable `name` / `message` / `stack` / `cause` (still
 * non-enumerable, so JSON output is unchanged).
 */
function shallowCopy(obj: object): Record<string, unknown> {
  const out = Object.create(Object.getPrototypeOf(obj)) as Record<string, unknown>;
  if (obj instanceof Error) {
    for (const k of ["name", "message", "stack", "cause"]) {
      const d = Object.getOwnPropertyDescriptor(obj, k);
      if (d === undefined) continue;
      // V8 may expose `stack` as an accessor bound to the original's internal
      // slot; snapshot its value as a plain non-enumerable data property.
      const value = "value" in d ? d.value : (obj as unknown as Record<string, unknown>)[k];
      Object.defineProperty(out, k, { value, writable: true, configurable: true, enumerable: false });
    }
  }
  return Object.assign(out, obj);
}

/**
 * Redact a child value found at `depth`. Strings are pattern-redacted; objects
 * past the depth cap become the censor; other objects recurse copy-on-write.
 */
function redactValue(
  v: unknown,
  cfg: ResolvedRedaction,
  depth: number,
  memo: Map<object, unknown>
): unknown {
  if (typeof v === "string") return redactString(v, cfg);
  if (v === null || typeof v !== "object") return v;
  if (depth >= cfg.maxDepth) return cfg.censor;
  return redactNode(v, cfg, depth + 1, memo);
}

/**
 * Return `node` unchanged when nothing beneath it needs redaction, otherwise a
 * shallow copy (same prototype) with only the changed children replaced. The
 * input is never mutated. `memo` maps every visited node to its result so an
 * object referenced twice is redacted consistently; a cycle back-edge becomes
 * `"[Circular]"` so the unredacted original is never reachable from the output.
 * Objects with a callable `toJSON` are replaced by their redacted `toJSON()`
 * result (or the censor if it throws).
 */
function redactNode(
  node: object,
  cfg: ResolvedRedaction,
  depth: number,
  memo: Map<object, unknown>
): unknown {
  const prior = memo.get(node);
  if (prior !== undefined) return prior === REDACT_IN_PROGRESS ? REDACT_CIRCULAR : prior;
  memo.set(node, REDACT_IN_PROGRESS);
  // JSON.stringify serializes toJSON()'s result, not the instance, so redact
  // that result (class instances with #private fields, Date, custom wrappers).
  // Keep the instance when nothing in the result needed redaction.
  const toJSON = (node as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === "function") {
    let result: unknown;
    try {
      const json: unknown = toJSON.call(node);
      let redacted: unknown;
      if (json !== null && typeof json === "object") {
        redacted = json === node ? node : redactNode(json, cfg, depth, memo);
      } else {
        redacted = redactValue(json, cfg, depth, memo);
      }
      result = redacted === json ? node : redacted;
    } catch {
      result = cfg.censor;
    }
    memo.set(node, result);
    return result;
  }
  let out: Record<string, unknown> | unknown[] | undefined;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v = node[i];
      const next = redactValue(v, cfg, depth, memo);
      if (next !== v) {
        if (out === undefined) out = node.slice();
        (out as unknown[])[i] = next;
      }
    }
  } else {
    const obj = node as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      const next = cfg.keys.has(key.toLowerCase()) ? cfg.censor : redactValue(v, cfg, depth, memo);
      if (next !== v) {
        if (out === undefined) out = shallowCopy(obj);
        (out as Record<string, unknown>)[key] = next;
      }
    }
  }
  const result = out ?? node;
  memo.set(node, result);
  return result;
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

const SENSITIVE_URL_QUERY_KEY_SET = new Set(SENSITIVE_URL_QUERY_KEYS.map((k) => k.toLowerCase()));

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
  if (url.indexOf("?") === -1 && url.indexOf("#") === -1 && url.indexOf("@") === -1) {
    return url;
  }
  try {
    const parsed = new URL(url);
    if (parsed.search === "" && parsed.hash === "") {
      return `${parsed.origin}${parsed.pathname}`;
    }
    const safe = new URL(parsed.origin + parsed.pathname);
    appendRedactedParams(parsed.searchParams, safe.searchParams);
    return safe.toString();
  } catch {
    const cut = url.search(/[?#]/);
    return cut === -1 ? url : url.slice(0, cut);
  }
}

/**
 * Copy every `key=value` pair from `from` into `to`, replacing the value with
 * `[REDACTED]` when the key is secret-bearing ({@link SENSITIVE_URL_QUERY_KEYS}
 * / {@link SENSITIVE_URL_QUERY_KEY_PREFIXES}) or the value looks like a JWT or
 * credential.
 */
function appendRedactedParams(from: URLSearchParams, to: URLSearchParams): void {
  for (const [key, value] of from) {
    const sensitiveKey = isSensitiveUrlQueryKey(key.toLowerCase());
    const sensitiveValue = JWT_LIKE_RE.test(value) || CREDENTIAL_LIKE_RE.test(value);
    CREDENTIAL_LIKE_RE.lastIndex = 0;
    to.append(key, sensitiveKey || sensitiveValue ? "[REDACTED]" : value);
  }
}

/**
 * Produce a telemetry/log-safe form of a URL query string, applying exactly the
 * same redaction as {@link sanitizeUrlForLog}: values of
 * {@link SENSITIVE_URL_QUERY_KEYS} / {@link SENSITIVE_URL_QUERY_KEY_PREFIXES}
 * and JWT-like / credential-like values become `[REDACTED]` (serialized
 * form-encoded as `%5BREDACTED%5D`). Used by `otelTracing()` for the
 * `url.query` span attribute so OAuth codes, `access_token`s and presigned-URL
 * signatures are never exported to a tracing backend.
 *
 * @param search - Query string, with or without the leading `?`.
 * @returns The redacted query without a leading `?` (`""` for an empty query).
 * @since 1.3.7
 */
export function sanitizeUrlQueryForLog(search: string): string {
  const raw = search.charCodeAt(0) === 63 /* ? */ ? search.slice(1) : search;
  if (raw === "") return "";
  const out = new URLSearchParams();
  appendRedactedParams(new URLSearchParams(raw), out);
  return out.toString();
}
