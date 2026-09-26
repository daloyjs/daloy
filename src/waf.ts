/**
 * WAF-lite signature/anomaly inbound-inspection middleware (OWASP CRS-lite).
 *
 * DaloyJS deliberately leaves a full Web Application Firewall to the operator's
 * edge (CDN / reverse proxy / ModSecurity CRS). {@link waf} is **not** that — it
 * is a first-party, opt-in, *defense-in-depth* layer for teams that do not have
 * an edge WAF, wiring the framework's high-confidence injection signatures
 * (SQLi, XSS, NoSQL-operator injection, command injection) into a single scored
 * inbound-inspection pass with per-rule enable/disable and a block-or-log mode.
 *
 * Each enabled rule contributes an **anomaly score** when it matches anywhere in
 * the inspected surface (the decoded URL path, the raw + decoded query string,
 * an optional header allowlist, and the validated request body). When a
 * request's total score reaches {@link WafOptions.blockThreshold}, the request is
 * either rejected with a generic `403` (block mode, the default) or merely
 * reported to {@link WafOptions.onMatch} (log mode) so operators can tune rules
 * against real traffic before enforcing.
 *
 * Design notes / secure-by-default posture:
 * - The `403` body is intentionally generic — it never tells the attacker which
 *   signature fired. Rule detail is delivered server-side via `onMatch` only.
 * - Body inspection covers the **validated** body (`ctx.body`), so it composes
 *   with the framework's schema-first contract. Routes without a body schema are
 *   not body-inspected (their body is never parsed); inspect their inputs with a
 *   schema to bring them under coverage.
 * - Header inspection is **opt-in** (off by default) because header values
 *   (notably `User-Agent` / `Cookie`) carry parentheses and punctuation that can
 *   trip signatures; enable it with an explicit allowlist.
 * - Scanning is bounded but never fails open: values longer than
 *   {@link WafOptions.maxValueLength} are scanned in overlapping windows (cost
 *   stays linear in the body-limited input), and a body walk truncated by
 *   {@link WafOptions.maxBodyNodes} is itself flagged as an anomaly (see
 *   {@link WafOptions.onLimitExceeded}), so padding cannot push a payload past
 *   inspection.
 * - Signatures are curated for **high confidence / low false-positive rate**;
 *   this is a complement to, not a replacement for, input schemas and parameter
 *   binding. Start in `"log"` mode, watch `onMatch`, then switch to `"block"`.
 *
 * The middleware is dependency-free and runtime-portable. It inspects the built
 * context in the {@link "./types.js".Hooks.beforeHandle} phase (so query, params,
 * headers, and the validated body are all available) and reuses
 * {@link "./security.js".hasMongoOperatorKeys} for structural NoSQL-operator
 * detection. Register it with `app.use(waf())`.
 *
 * @module
 * @since 0.37.0
 */

import type { BaseContext, Hooks } from "./types.js";
import { ForbiddenError } from "./errors.js";
import { hasMongoOperatorKeys } from "./security.js";
import { readRemoteAddress } from "./conn-info.js";

/**
 * Identifier of a built-in WAF rule category. Each maps to a curated set of
 * high-confidence signatures (plus, for `nosqli`, a structural body check).
 *
 * @since 0.37.0
 */
export type WafRuleId = "sqli" | "xss" | "nosqli" | "cmdi";

/** The four built-in rule categories, in stable order. */
const ALL_RULE_IDS: readonly WafRuleId[] = Object.freeze(["sqli", "xss", "nosqli", "cmdi"]);

/** Default anomaly score contributed by each rule when it matches. */
const DEFAULT_RULE_SCORE = 5;

/** Default total anomaly score at which a request is blocked / reported. */
const DEFAULT_BLOCK_THRESHOLD = 5;

/** Default cap on the length of any single string value that is scanned. */
const DEFAULT_MAX_VALUE_LENGTH = 8192;

/** Default cap on the number of body nodes walked during inspection. */
const DEFAULT_MAX_BODY_NODES = 10_000;

/**
 * Overlap between consecutive scan windows of an overlong value. Larger than
 * any bounded signature span, so a match cannot straddle two windows.
 */
const WINDOW_OVERLAP = 512;

/** Whitespace-run probe/collapser used only for overlong values. */
const WS_RUN_PROBE = /\s\s/;
const WS_RUN_GLOBAL = /\s+/g;

/**
 * Where in the request a signature matched. Surfaced on {@link WafMatch} so
 * operators can see whether the hit came from the path, query string, an
 * inspected header, or the request body.
 *
 * @since 0.37.0
 */
export type WafInspectionLocation = "path" | "query" | "header" | "body";

/**
 * Longest word-character run any signature quantifier consumes. Every
 * non-whitespace repetition is bounded by this (`{1,256}`), so, with
 * whitespace collapsed, a match spans well under {@link WINDOW_OVERLAP} and can
 * never straddle two scan windows unseen. Longer runs are shortened to this
 * length in an extra inspection variant (see {@link capWordRuns}), so a
 * `' OR <1000 digits>=<1000 digits>` tautology is still detected.
 */
const MAX_SIGNATURE_RUN = 256;

/**
 * Curated, high-confidence signatures per rule. Patterns are deliberately
 * conservative (anchored on injection-specific tokens) to keep the
 * false-positive rate low; this is a defense-in-depth complement to schemas,
 * not an exhaustive ModSecurity CRS.
 *
 * Invariant (unit-tested): no unbounded `+` / `*` except on `\s`; other runs
 * use `{1,256}` ({@link MAX_SIGNATURE_RUN}).
 */
const SQLI_SIGNATURES: readonly RegExp[] = Object.freeze([
  /\bUNION\b[\s\S]{0,40}?\bSELECT\b/i,
  /\b(?:OR|AND)\b\s+['"]?\d{1,256}['"]?\s*=\s*['"]?\d{1,256}/i,
  /'\s*(?:OR|AND)\s+'?[\w]{1,256}'?\s*=\s*'?[\w]{1,256}/i,
  // Parenthesized subquery behind a boolean operator — `1 OR (SELECT 1)`. The
  // tautology patterns above anchor on `= <digit>`, so a subquery carrying no
  // comparison slipped through. Paired with the comment-stripped inspection
  // variant this also catches `1/**/OR/**/(SELECT/**/1)`. High confidence:
  // prose query values virtually never contain `OR (` immediately followed by
  // the SELECT keyword.
  /\b(?:OR|AND)\s*\(\s*SELECT\b/i,
  /;\s*(?:DROP|DELETE|INSERT|UPDATE|TRUNCATE|ALTER|CREATE)\b/i,
  /\b(?:SLEEP|BENCHMARK|PG_SLEEP)\s*\(/i,
  /\bWAITFOR\s+DELAY\b/i,
  /\bINFORMATION_SCHEMA\b/i,
  /\bxp_cmdshell\b/i,
  /\b(?:LOAD_FILE|OUTFILE|DUMPFILE)\b/i,
]);

const XSS_SIGNATURES: readonly RegExp[] = Object.freeze([
  /<script[\s\S]{0,40}?>/i,
  /<\/script\s*>/i,
  /javascript:\s*\S/i,
  // Inline event-handler attributes. Explicit alternation (not `on\w+`) to
  // avoid false-positives on benign params like `online=`/`once=`, but broadened
  // well beyond the classic four to cover the paren-less handlers commonly used
  // to evade keyword blocklists (pointer/focus/touch/wheel/toggle events — see
  // the ES6-for-pentesters technique in the cure53-web-frontend-offense skill).
  /\bon(?:error|load|click|dblclick|aux(?:click)?|contextmenu|mouse(?:over|enter|move|down|up|out|leave)|pointer(?:over|enter|down|up|move|rawupdate|leave)|touch(?:start|move|end)|focus(?:in|out)?|blur|input|change|submit|reset|toggle|beforetoggle|scroll|wheel|drag|drop|copy|cut|paste|play|playing|canplay|show|hashchange|popstate|pageshow|pagehide|message|animation(?:start|end|iteration)|transitionend|key(?:down|up|press)|load(?:start|end)|progress)\s*=/i,
  /<iframe[\s>]/i,
  /<img[\s\S]{0,80}?\bonerror\s*=/i,
  /<svg[\s\S]{0,40}?\bonload\s*=/i,
  /<body[\s\S]{0,40}?\bonload\s*=/i,
  /\bdocument\.cookie\b/i,
]);

const NOSQLI_SIGNATURES: readonly RegExp[] = Object.freeze([
  /\$(?:ne|gt|gte|lt|lte|in|nin|where|regex|exists|elemMatch|expr|function|or|and|not)\b/i,
  /\{\s*"?\$\w{1,256}/,
]);

const CMDI_SIGNATURES: readonly RegExp[] = Object.freeze([
  /[;&|]\s*(?:cat|ls|rm|zsh|python|perl|ruby|php|powershell|pwsh|whoami|id|uname|chmod|chown|kill|nslookup|ping|nc|ncat|bash|sh|wget|curl)\b/i,
  /\$\([\s\S]{0,60}?\)/,
  /`[^`]{1,60}`/,
  /\|\s*(?:nc|ncat|bash|sh|wget|curl)\b/i,
  /&&\s*(?:cat|ls|rm|whoami|id|wget|curl)\b/i,
  /\/(?:etc\/passwd|etc\/shadow|bin\/sh|bin\/bash)\b/i,
]);

const SIGNATURES: Readonly<Record<WafRuleId, readonly RegExp[]>> = Object.freeze({
  sqli: SQLI_SIGNATURES,
  xss: XSS_SIGNATURES,
  nosqli: NOSQLI_SIGNATURES,
  cmdi: CMDI_SIGNATURES,
});

/**
 * Test-only view of the built-in signatures, used to assert the bounded-run
 * invariant. Not part of the public API.
 *
 * @internal
 */
export const _WAF_SIGNATURES_FOR_TESTS = SIGNATURES;

/** `true` for an ASCII word char (`[A-Za-z0-9_]`, i.e. regex `\w`). */
function isWordCode(c: number): boolean {
  return (
    (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95
  );
}

/**
 * Shorten every word-character run longer than {@link MAX_SIGNATURE_RUN} to
 * that length, or return `undefined` when no run is that long. Linear time (a
 * char loop, not a regex probe, so benign long runs cost nothing quadratic).
 */
function capWordRuns(value: string): string | undefined {
  let run = 0;
  let parts: string[] | undefined;
  let segStart = 0;
  for (let i = 0; i < value.length; i++) {
    if (isWordCode(value.charCodeAt(i))) {
      run++;
      if (run === MAX_SIGNATURE_RUN + 1) {
        // Drop this char and the rest of the run.
        parts ??= [];
        parts.push(value.slice(segStart, i));
        let j = i + 1;
        while (j < value.length && isWordCode(value.charCodeAt(j))) j++;
        segStart = j;
        i = j - 1;
        run = 0;
      }
    } else {
      run = 0;
    }
  }
  if (!parts) return undefined;
  parts.push(value.slice(segStart));
  return parts.join("");
}

/**
 * Per-rule configuration. Pass a boolean to enable/disable a rule, or an object
 * to enable it with a custom anomaly {@link WafRuleConfig.score}.
 *
 * @since 0.37.0
 */
export interface WafRuleConfig {
  /** Whether the rule is active. Default: `true`. */
  enabled?: boolean;
  /** Anomaly score this rule contributes when it matches. Default: `5`. */
  score?: number;
}

/**
 * One rule's contribution to a flagged request. Reported (deduplicated per rule)
 * in {@link WafEvent.matches}.
 *
 * @since 0.37.0
 */
export interface WafMatch {
  /**
   * Which rule category fired. `"limits"` (since 1.3.7) is the synthetic
   * anomaly recorded when the body walk hit {@link WafOptions.maxBodyNodes}.
   */
  ruleId: WafRuleId | "limits";
  /** The anomaly score this rule contributed. */
  score: number;
  /** Where the first matching value was found. */
  location: WafInspectionLocation;
  /** A short, truncated sample of the offending value (for server-side logs). */
  sample: string;
}

/**
 * Detail of a flagged request, passed to {@link WafOptions.onMatch}. Emitted only
 * when a request's total score reaches the block threshold (in both `"block"`
 * and `"log"` mode), so it always represents an actionable detection.
 *
 * @since 0.37.0
 */
export interface WafEvent {
  /** The mode the middleware is running in. */
  mode: WafMode;
  /**
   * Whether the request was rejected or allowed through. `"logged"` in log
   * mode, and in block mode for a limits-only flag under
   * `onLimitExceeded: "log"`.
   */
  action: "blocked" | "logged";
  /** The request method. */
  method: string;
  /** The request path (decoded pathname). */
  path: string;
  /** Best-effort client IP (socket remote address), when available. */
  clientIp: string | undefined;
  /** Total anomaly score accumulated across all fired rules. */
  score: number;
  /** The threshold the score met or exceeded. */
  threshold: number;
  /** The deduplicated per-rule matches that drove the score. */
  matches: readonly WafMatch[];
}

/**
 * Enforcement mode for {@link waf}.
 *
 * - `"block"` (default) — reject a flagged request with a generic `403`.
 * - `"log"` — never reject; only invoke {@link WafOptions.onMatch}. Use this to
 *   tune rules against production traffic before enforcing.
 *
 * @since 0.37.0
 */
export type WafMode = "block" | "log";

/**
 * Selects which parts of the request are inspected. Path, query, and body are
 * inspected by default; header inspection is opt-in via {@link WafInspectConfig.headers}.
 *
 * @since 0.37.0
 */
export interface WafInspectConfig {
  /** Inspect the decoded URL pathname. Default: `true`. */
  path?: boolean;
  /** Inspect the raw and decoded query string. Default: `true`. */
  query?: boolean;
  /** Inspect the validated request body (`ctx.body`). Default: `true`. */
  body?: boolean;
  /**
   * Inspect a specific allowlist of request headers (lower-cased names). Header
   * inspection is **off** unless you provide this list, because common headers
   * (`User-Agent`, `Cookie`, `Referer`) carry punctuation that can trip
   * signatures. Example: `["referer", "x-forwarded-host"]`.
   */
  headers?: readonly string[];
}

/**
 * Configuration for {@link waf}. Every field is optional — `waf()` ships secure,
 * low-false-positive defaults (all four rules on at score 5, block threshold 5,
 * block mode, path/query/body inspected, headers not).
 *
 * @since 0.37.0
 */
export interface WafOptions {
  /** Enforcement mode. Default: `"block"`. */
  mode?: WafMode;
  /**
   * Per-rule overrides. Any rule omitted here keeps its default (enabled, score
   * 5). Disable a noisy rule with `{ xss: false }`, or reweight one with
   * `{ sqli: { score: 8 } }`.
   */
  rules?: Partial<Record<WafRuleId, boolean | WafRuleConfig>>;
  /**
   * Total anomaly score at which a request is flagged (blocked or logged).
   * Default: `5` — any single high-confidence rule trips it. Raise it (e.g. `8`)
   * to require two independent rule categories to fire. Must be a positive number.
   */
  blockThreshold?: number;
  /** Which request parts to inspect. See {@link WafInspectConfig}. */
  inspect?: WafInspectConfig;
  /**
   * Scan-window size for a single string value. Values up to this length are
   * scanned whole; longer values are scanned in overlapping windows of this
   * size (plus a whitespace-collapsed form), so total work stays linear in the
   * input and a payload padded past the first window is still inspected.
   * Default: `8192`. Must be a positive integer.
   */
  maxValueLength?: number;
  /**
   * Cap on the number of nodes walked when inspecting the body, to bound CPU on
   * deeply nested or huge payloads. Default: `10000`. Must be a positive integer.
   * Hitting the cap leaves part of the body uninspected; see
   * {@link onLimitExceeded} for how that is handled.
   */
  maxBodyNodes?: number;
  /**
   * What to do when the body walk stops at {@link maxBodyNodes} with nodes left
   * uninspected (an attacker can hide a payload behind junk nodes).
   *
   * - `"block"` (default) — record a synthetic `"limits"` match scoring
   *   {@link blockThreshold}, so the request is flagged: rejected in `"block"`
   *   mode, reported via `onMatch` in `"log"` mode.
   * - `"log"` — report via `onMatch` (action `"logged"`) but never reject on
   *   this ground alone.
   * - `"ignore"` — inspect the first `maxBodyNodes` nodes only (pre-1.3.7
   *   behaviour; fails open).
   *
   * @since 1.3.7
   */
  onLimitExceeded?: "block" | "log" | "ignore";
  /**
   * Observability callback invoked once per flagged request (in both modes),
   * before any `403` is thrown. Receives the structured {@link WafEvent}. Must
   * not throw.
   */
  onMatch?: (event: WafEvent) => void;
}

interface ResolvedRule {
  ruleId: WafRuleId;
  score: number;
  signatures: readonly RegExp[];
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(
      `waf(): \`${label}\` must be a positive integer, received ${String(value)}`
    );
  }
}

/**
 * Resolve the per-rule config into the active rule set, applying defaults and
 * overrides and validating any custom scores.
 */
function resolveRules(
  overrides: Partial<Record<WafRuleId, boolean | WafRuleConfig>> | undefined
): ResolvedRule[] {
  const resolved: ResolvedRule[] = [];
  for (const ruleId of ALL_RULE_IDS) {
    const override = overrides?.[ruleId];
    let enabled = true;
    let score = DEFAULT_RULE_SCORE;
    if (override === false) {
      enabled = false;
    } else if (override === true || override === undefined) {
      // keep defaults
    } else {
      enabled = override.enabled ?? true;
      if (override.score !== undefined) {
        if (!Number.isFinite(override.score) || override.score <= 0) {
          throw new TypeError(
            `waf(): \`rules.${ruleId}.score\` must be a positive number, received ${String(override.score)}`
          );
        }
        score = override.score;
      }
    }
    if (enabled) resolved.push({ ruleId, score, signatures: SIGNATURES[ruleId] });
  }
  return resolved;
}

/** Truncate a value to `maxLen` for safe inclusion in a server-side log sample. */
function sample(value: string): string {
  const trimmed = value.length > 120 ? `${value.slice(0, 117)}...` : value;
  // Strip control characters so a log sink can't be tricked by embedded
  // newlines / escapes carried straight from the attacker's payload.
  return trimmed.replace(/[\u0000-\u001f\u007f]/g, " ");
}

/** Best-effort URL-decode; return the original string if decoding throws. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Maximum percent-decode passes applied when expanding inspection variants.
 *
 * One pass matches what most HTTP stacks hand the handler. A second pass
 * catches classic double-encoding WAF evasions (`%2527` → `%27` → `'`). A
 * third is omitted on purpose: deeper recursive decoding inflates false
 * positives on legitimately percent-bearing text and is not how frameworks
 * deliver query/path values.
 */
const MAX_DECODE_PASSES = 2;

/**
 * Control characters that are NOT matched by JS `\s`, used to split keywords
 * past whitespace-anchored signatures (e.g. `1'%00OR%001=1`).
 *
 * U+0009-U+000D (\t \n \v \f \r) are deliberately absent: `\s` already
 * matches them and every signature separates tokens with `\s`, `\b`, or
 * `[\s\S]`, so normalizing them would only duplicate an existing variant.
 *
 * Hoisted to module scope so the hot path neither re-creates the RegExp object
 * nor pays literal-evaluation overhead per inspected value. The probe is
 * non-global (stateless `test()`); the replace copy is global and `replace()`
 * resets `lastIndex`, so neither carries state between calls.
 */
const CONTROL_CHAR_PROBE = /[\u0000-\u0008\u000e-\u001f\u007f]/;
const CONTROL_CHAR_GLOBAL = /[\u0000-\u0008\u000e-\u001f\u007f]/g;

/**
 * Non-ASCII probe used to skip {@link String.prototype.normalize} on the pure
 * ASCII hot path. Fullwidth Latin (U+FF01–U+FF5E), compatibility ideographs,
 * and other NFKC-collapsible code points only appear when this matches.
 *
 * Hoisted so the hot path neither re-creates the RegExp nor pays a
 * literal-evaluation cost per inspected value.
 */
const NON_ASCII_PROBE = /[^\x00-\x7F]/;

/**
 * Expand a single inbound string into the variants the WAF should scan.
 *
 * Includes the raw value, up to {@link MAX_DECODE_PASSES} percent-decodes,
 * a `+`→space form (URLSearchParams parity), a SQL-comment-stripped
 * form so comment-split keywords (e.g. OR wrapped in block comments) score
 * the same as the whitespace-separated form, a control-character→space
 * form so embedded NUL / escape bytes cannot split keywords past the
 * whitespace-anchored signatures (e.g. `1'%00OR%001=1` → `1' OR 1=1`), and
 * an NFKC-normalized form so fullwidth / compatibility-homoglyph keywords
 * (e.g. `ｕｎｉｏｎ ｓｅｌｅｃｔ`) score the same as their ASCII counterparts.
 *
 * The NFKC fold is applied to the decode chain *before* the `+` / comment /
 * control-character passes, and its output joins that chain, so the transforms
 * **compose**: a payload mixing homoglyphs with comment- or NUL-splitting
 * (`＇%00ＯＲ%00＇１＇＝＇１`) still converges on the ASCII form the signatures
 * anchor on. Closing each evasion only in isolation leaves the combination open.
 *
 * Scanning variants is pure defense-in-depth: the handler still receives
 * whatever the framework's single-decode path produced. The variant set is
 * bounded (a fixed number of linear transforms) and deduplicated; overlong
 * variants are windowed by {@link scanValueVariants}, never truncated.
 *
 * @param value - Raw or already-decoded string from path/query/header/body.
 * @returns Deduplicated inspection variants in stable insertion order.
 */
function inspectionVariants(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (v: string): void => {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  };

  let current = value;
  push(current);
  for (let i = 0; i < MAX_DECODE_PASSES; i++) {
    const decoded = safeDecode(current);
    if (decoded === current) break;
    push(decoded);
    current = decoded;
  }

  // Snapshot before secondary transforms so we only expand the decode chain.
  const decodedChain = out.slice();

  // Fold compatibility characters FIRST, and extend the chain with the folded
  // forms, so the secondary transforms below run on them too. Order matters:
  // pushing the NFKC form after the loop (or without extending `decodedChain`)
  // leaves each evasion closed only in isolation, and composing two of them
  // reopens the hole — `＇%00ＯＲ%00＇１＇＝＇１` folds to a NUL-split ASCII
  // tautology that the control-char pass would catch, and control-strips to a
  // fullwidth tautology that the fold would catch, but neither variant is ever
  // subjected to the other transform. Extending the chain makes the passes
  // compose, so any combination of fold + decode + comment/control/`+`
  // splitting converges on the same ASCII form the signatures anchor on.
  for (const v of out.slice()) {
    if (NON_ASCII_PROBE.test(v)) {
      const nfkc = v.normalize("NFKC");
      if (nfkc !== v) {
        push(nfkc);
        decodedChain.push(nfkc);
      }
    }
  }

  for (const v of decodedChain) {
    if (v.includes("+")) push(v.replace(/\+/g, " "));
    if (v.includes("/*")) push(stripBlockComments(v));
    // Control characters (notably NUL) are not `\s`, so `1'%00OR%001=1` split
    // `OR` from `1=1` and walked past the whitespace-anchored signatures. Scan
    // a control-char→space form; benign traffic carries almost no C0 bytes, so
    // the false-positive surface is negligible.
    //
    // The class deliberately excludes U+0009-U+000D (\t \n \v \f \r): JS `\s`
    // already matches those, and every signature separates tokens with `\s`,
    // `\b`, or `[\s\S]`, so normalizing them only ever yields a variant that
    // scores identically to one already in the set. Including them cost ~13%
    // on every request carrying a multi-line body or query value.
    if (CONTROL_CHAR_PROBE.test(v)) {
      push(v.replace(CONTROL_CHAR_GLOBAL, " "));
    }
  }

  // Signature runs are bounded ({@link MAX_SIGNATURE_RUN}); shorten longer word
  // runs so `' OR <1000 digits>=<digits>` still matches. Only the tautology
  // signatures (which all need `=`) depend on a run being fully consumed.
  for (const v of out.slice()) {
    if (v.length > MAX_SIGNATURE_RUN && v.includes("=")) {
      const capped = capWordRuns(v);
      if (capped !== undefined) push(capped);
    }
  }
  return out;
}

function stripBlockComments(value: string): string {
  let cursor = 0;
  const parts: string[] = [];
  for (;;) {
    const start = value.indexOf("/*", cursor);
    if (start < 0) break;
    const end = value.indexOf("*/", start + 2);
    if (end < 0) break;
    parts.push(value.slice(cursor, start), " ");
    cursor = end + 2;
  }
  if (cursor === 0) return value;
  parts.push(value.slice(cursor));
  return parts.join("");
}

/**
 * Scan every inspection variant of `value` for the active rule set.
 *
 * @see inspectionVariants
 */
function scanValueVariants(
  value: string,
  location: WafInspectionLocation,
  rules: readonly ResolvedRule[],
  scored: Map<WafRuleId, WafMatch>,
  maxValueLength: number
): void {
  for (const variant of inspectionVariants(value)) {
    if (variant.length <= maxValueLength) {
      scanValue(variant, location, rules, scored);
    } else {
      // Overlong: scan every window, never just the prefix, so padding cannot
      // push a payload out of view. Also scan a whitespace-collapsed form so a
      // long `\s` run cannot stretch a match across a window boundary.
      scanWindows(variant, location, rules, scored, maxValueLength);
      if (scored.size === rules.length) return;
      if (WS_RUN_PROBE.test(variant)) {
        const collapsed = variant.replace(WS_RUN_GLOBAL, " ");
        if (collapsed.length <= maxValueLength) scanValue(collapsed, location, rules, scored);
        else scanWindows(collapsed, location, rules, scored, maxValueLength);
      }
    }
    // Early exit once every rule has already fired — no further variants needed.
    if (scored.size === rules.length) return;
  }
}

/**
 * Scan an overlong value in windows of `maxValueLength` that overlap by
 * {@link WINDOW_OVERLAP} (or half a window, if smaller). Every character is
 * covered and the total scanned length is at most ~2x the input.
 */
function scanWindows(
  value: string,
  location: WafInspectionLocation,
  rules: readonly ResolvedRule[],
  scored: Map<WafRuleId, WafMatch>,
  maxValueLength: number
): void {
  const overlap = Math.min(WINDOW_OVERLAP, maxValueLength >> 1);
  const stride = maxValueLength - overlap;
  for (let start = 0; ; start += stride) {
    scanValue(value.slice(start, start + maxValueLength), location, rules, scored);
    if (scored.size === rules.length || start + maxValueLength >= value.length) return;
  }
}

/**
 * Collect string values (and own keys) from a parsed body value into `out`,
 * walking at most `maxNodes` nodes so a hostile payload cannot turn inspection
 * into CPU-DoS. Prototype keys are never followed (only own enumerable
 * properties are walked).
 *
 * @returns `true` when the walk was truncated with nodes left uninspected.
 */
function collectBodyStrings(root: unknown, maxNodes: number, out: string[]): boolean {
  const stack: unknown[] = [root];
  let visited = 0;
  while (stack.length > 0 && visited < maxNodes) {
    const node = stack.pop();
    visited++;
    if (typeof node === "string") {
      out.push(node);
    } else if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
    } else if (node && typeof node === "object") {
      // Also scan own string keys — an injected `$where` can hide in a key.
      for (const key of Object.keys(node as Record<string, unknown>)) {
        out.push(key);
        stack.push((node as Record<string, unknown>)[key]);
      }
    }
  }
  return stack.length > 0;
}

/**
 * Run every enabled rule's signatures against a single value. Records the first
 * location/sample per rule into `matches` and accumulates the rule's score into
 * `scored` (so a rule contributes its score at most once per request).
 */
function scanValue(
  value: string,
  location: WafInspectionLocation,
  rules: readonly ResolvedRule[],
  scored: Map<WafRuleId, WafMatch>
): void {
  for (const rule of rules) {
    if (scored.has(rule.ruleId)) continue;
    for (const signature of rule.signatures) {
      if (signature.test(value)) {
        scored.set(rule.ruleId, {
          ruleId: rule.ruleId,
          score: rule.score,
          location,
          sample: sample(value),
        });
        break;
      }
    }
  }
}

/**
 * Build an opt-in, scored WAF-lite inbound-inspection middleware.
 *
 * Inspects the decoded path, query string, an optional header allowlist, and the
 * validated body for SQLi / XSS / NoSQL-operator / command-injection signatures.
 * When the summed anomaly score of the rules that fire reaches
 * {@link WafOptions.blockThreshold}, the request is rejected with a generic `403`
 * (block mode) or reported to {@link WafOptions.onMatch} (log mode).
 *
 * ```ts
 * import { App, waf } from "@daloyjs/core";
 *
 * const app = new App();
 *
 * // Start in log mode to tune against real traffic, then switch to block.
 * app.use(waf({
 *   mode: "log",
 *   onMatch: (e) => logger.warn({ waf: e }, "waf detection"),
 * }));
 * ```
 *
 * @param opts - Mode, per-rule overrides, threshold, inspection surface, and the `onMatch` hook.
 * @returns A {@link "./types.js".Hooks} bundle exposing only a `beforeHandle` hook.
 * @throws {TypeError} At construction when an option is invalid.
 * @throws {ForbiddenError} Per request, in block mode, when a request is flagged.
 * @since 0.37.0
 */
export function waf(opts: WafOptions = {}): Hooks {
  const mode: WafMode = opts.mode ?? "block";
  if (mode !== "block" && mode !== "log") {
    throw new TypeError(`waf(): \`mode\` must be "block" or "log", received ${String(mode)}`);
  }
  const blockThreshold = opts.blockThreshold ?? DEFAULT_BLOCK_THRESHOLD;
  if (!Number.isFinite(blockThreshold) || blockThreshold <= 0) {
    throw new TypeError(
      `waf(): \`blockThreshold\` must be a positive number, received ${String(blockThreshold)}`
    );
  }
  const maxValueLength = opts.maxValueLength ?? DEFAULT_MAX_VALUE_LENGTH;
  assertPositiveInteger(maxValueLength, "maxValueLength");
  const maxBodyNodes = opts.maxBodyNodes ?? DEFAULT_MAX_BODY_NODES;
  assertPositiveInteger(maxBodyNodes, "maxBodyNodes");
  const onLimitExceeded = opts.onLimitExceeded ?? "block";
  if (onLimitExceeded !== "block" && onLimitExceeded !== "log" && onLimitExceeded !== "ignore") {
    throw new TypeError(
      `waf(): \`onLimitExceeded\` must be "block", "log" or "ignore", received ${String(onLimitExceeded)}`
    );
  }

  const rules = resolveRules(opts.rules);
  const nosqliRule = rules.find((r) => r.ruleId === "nosqli");

  const inspectPath = opts.inspect?.path ?? true;
  const inspectQuery = opts.inspect?.query ?? true;
  const inspectBody = opts.inspect?.body ?? true;
  const headerAllowlist = (opts.inspect?.headers ?? []).map((h) => h.toLowerCase());
  const onMatch = opts.onMatch;

  return {
    beforeHandle(ctx: BaseContext<any, any>): void {
      // Nothing enabled — pay nothing.
      if (rules.length === 0) return;

      const scored = new Map<WafRuleId, WafMatch>();
      let limitMatch: WafMatch | undefined;
      const url = new URL(ctx.request.url);

      if (inspectPath) {
        // Path is scanned across raw + up to two decode passes so double-
        // encoded traversal / injection tokens in path segments still score.
        scanValueVariants(url.pathname, "path", rules, scored, maxValueLength);
      }

      if (inspectQuery && url.search.length > 1) {
        // Scan the raw query, bounded multi-decode variants, and each
        // URLSearchParams key/value. Multi-decode (max 2) closes classic
        // double-encoding WAF evasions (`%2527` → `%27` → `'`) without open-
        // ended recursive decoding. URLSearchParams also turns `+` into
        // space; inspectionVariants covers that form so `1+OR+1=1` scores
        // the same as `1 OR 1=1` (parser-differential defense).
        const raw = url.search.slice(1);
        scanValueVariants(raw, "query", rules, scored, maxValueLength);
        for (const [k, v] of url.searchParams) {
          scanValueVariants(k, "query", rules, scored, maxValueLength);
          scanValueVariants(v, "query", rules, scored, maxValueLength);
        }
      }

      if (headerAllowlist.length > 0) {
        for (const name of headerAllowlist) {
          const value = ctx.request.headers.get(name);
          if (value) scanValueVariants(value, "header", rules, scored, maxValueLength);
        }
      }

      if (inspectBody && ctx.body !== undefined && ctx.body !== null) {
        // Structural NoSQL-operator detection on the parsed body — catches
        // `{"password": {"$ne": null}}` even though no string value matches.
        if (
          nosqliRule &&
          !scored.has("nosqli") &&
          typeof ctx.body === "object" &&
          hasMongoOperatorKeys(ctx.body)
        ) {
          scored.set("nosqli", {
            ruleId: "nosqli",
            score: nosqliRule.score,
            location: "body",
            sample: "$-prefixed operator key",
          });
        }
        if (typeof ctx.body === "string") {
          scanValueVariants(ctx.body, "body", rules, scored, maxValueLength);
        } else if (typeof ctx.body === "object") {
          const strings: string[] = [];
          const truncated = collectBodyStrings(ctx.body, maxBodyNodes, strings);
          for (const value of strings) {
            scanValueVariants(value, "body", rules, scored, maxValueLength);
          }
          if (truncated && onLimitExceeded !== "ignore") {
            // Part of the body went uninspected; a payload may hide there.
            limitMatch = {
              ruleId: "limits",
              score: blockThreshold,
              location: "body",
              sample: `body exceeded maxBodyNodes (${maxBodyNodes})`,
            };
          }
        }
      }

      if (scored.size === 0 && limitMatch === undefined) return;

      let signatureTotal = 0;
      for (const match of scored.values()) signatureTotal += match.score;
      const total = signatureTotal + (limitMatch?.score ?? 0);
      if (total < blockThreshold) return;

      // A limits-only flag under `onLimitExceeded: "log"` never rejects.
      const enforce =
        mode === "block" && (signatureTotal >= blockThreshold || onLimitExceeded === "block");
      const matches: WafMatch[] = Array.from(scored.values());
      if (limitMatch) matches.push(limitMatch);
      const event: WafEvent = {
        mode,
        action: enforce ? "blocked" : "logged",
        method: ctx.request.method,
        path: url.pathname,
        clientIp: readRemoteAddress(ctx),
        score: total,
        threshold: blockThreshold,
        matches,
      };
      onMatch?.(event);

      if (enforce) {
        // Generic detail — never disclose which signature fired to the client.
        throw new ForbiddenError("Request blocked by security policy");
      }
    },
  };
}
