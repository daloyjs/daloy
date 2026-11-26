/**
 * Single-source-of-truth secret-comparison CI grep gate.
 *
 * Scans the security-sensitive source files and refuses any non-constant-time
 * comparison against a value that was clearly derived from a request
 * `Authorization`, `Cookie`, `X-API-Key`, or `X-*-Signature*` header. Every
 * such comparison MUST go through {@link timingSafeEqual} (from
 * `src/security.ts`) so the framework's secret-comparison surface is
 * internally self-consistent and resistant to timing attacks.
 *
 * The gate catches the full family of short-circuiting string operations
 * that the Snyk "Node.js timing attack from the CCC CTF" write-up exploits
 * (<https://snyk.io/blog/node-js-timing-attack-ccc-ctf/>):
 *
 *   - Strict and loose equality: `===`, `!==`, `==`, `!=`
 *   - Prefix / suffix / substring probes: `.startsWith()`, `.endsWith()`,
 *     `.includes()`, `.indexOf()`
 *   - Locale-aware compares: `.localeCompare()`
 *
 * V8 returns early on the first differing byte (and on length mismatch) for
 * every one of these, which leaks the secret one character at a time over a
 * remote timing channel. `timingSafeEqual()` is the only acceptable
 * primitive for comparing a request-supplied secret to an expected value.
 *
 * Files in scope:
 *   - src/session.ts
 *   - src/security.ts
 *   - src/security-schemes.ts
 *   - src/middleware.ts
 *
 * (`src/csrf.ts` is referenced in the plan; CSRF lives in `src/middleware.ts`
 * in this codebase. Both are scanned together.)
 *
 * Exit code:
 *   0 — no forbidden comparisons found.
 *   1 — at least one forbidden comparison was found; offending lines are
 *       printed to stderr.
 *
 * @since 0.27.0
 */

import { readdir, readFile } from "node:fs/promises";
import { stripSource } from "./lib/strip-source.js";
import { isSourceFile } from "./lib/source-files.js";

/**
 * Root audited by this gate: every TypeScript file under `src/`. It used to
 * be a hand-kept list of four files, which left the modules that actually
 * compare credentials (mTLS, MCP, A2A, HTTP signatures, webhooks) unaudited.
 */
export const AUDITED_ROOT = "src/";

/**
 * Identifiers / expressions whose value clearly came from a header named in
 * the plan. The matcher is intentionally a conservative substring
 * test because any positive match is a code-review smell — false positives
 * are cheap (rename the variable) while false negatives are a security bug.
 */
const HEADER_DERIVED_TOKENS: readonly RegExp[] = [
  /\bauthorization(?:Header|Value|Token|Credential|Credentials)\b/i,
  /\bcookie\b/i,
  /x-api-key/i,
  /apiKey/i,
  /x-csrf-token/i,
  /csrfToken/i,
  /xsrf/i,
  /-signature/i,
  /signatureHeader/i,
  /bearerToken/i,
  /sessionToken/i,
  // The names a credential usually gets once it has left the header.
  /\b(?:provided|presented|supplied)(?:Token|Secret|Signature|Sig|Password|Key|Digest|Hmac|Mac|Credential)?\b/,
  /\b(?:received|incoming|candidate)(?:Token|Secret|Signature|Sig|Password|Key|Digest|Hmac|Mac|Credential)\b/,
  // camelCase or lower-case names only: ALL_CAPS constants are limits, not secrets.
  /\b(?:[a-z][a-zA-Z0-9]*(?:Secret|Password|Passphrase|Signature|Hmac)|secret|password|passphrase|signature|hmac)[a-zA-Z0-9]*\b/,
  /\bauthorization\b/,
];

/** Same-line opt-out for a comparison that is not against a secret. A reason is required. */
const ALLOW_MARKER_RE = /\/\/\s*daloy-allow-compare:\s*\S+/;

/**
 * Comparisons against `undefined`, `null`, a boolean or a number say nothing
 * about a secret's bytes, so they are removed before looking for a
 * secret-named operand. A comparison against a string literal stays: a
 * hard-coded key compared with `===` is still a timing leak.
 */
const LITERAL_COMPARISON_RE =
  /(?:===|!==|==|!=)\s*(?:undefined\b|null\b|true\b|false\b|-?\d+(?:\.\d+)?\b)|(?:\bundefined|\bnull|\btrue|\bfalse|\b\d+)\s*(?:===|!==|==|!=)/g;

/**
 * Boundaries between independent sub-expressions on a line. Each segment is
 * judged alone, so `if (key === "secure") cookie.secure = true` is not read
 * as a comparison involving `cookie`.
 */
const SEGMENT_SPLIT_RE = /&&|\|\||[?;{},]|\)\s/;

const STRING_LITERAL_RE = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;
const DIRECT_HEADER_READ_RE =
  /\.get\(\s*["'](?:(?:proxy-)?authorization|cookie|x-api-key|x-[^"']*(?:signature|secret|token)[^"']*)["']\s*\)\s*(?:\?\?\s*""\s*\)?\s*)?(?:===|!==|==|!=)/i;

const EQUALITY_RE = /===|!==|(?<![=!<>])==(?!=)|(?<![=!<>])!=(?!=)/g;
const OPERAND_CHAR_RE = /[\w$.?!]/;

/**
 * The expression directly left of position `end` in `text`: an identifier or
 * member chain, with any call or index it ends in (`String(apiKey)`,
 * `cookie?.value`, `headers["x"]`).
 */
function operandBefore(text: string, end: number): string {
  let i = end;
  while (i > 0 && /\s/.test(text[i - 1]!)) i--;
  const stop = i;
  while (i > 0) {
    const ch = text[i - 1]!;
    if (ch === ")" || ch === "]") {
      const open = ch === ")" ? "(" : "[";
      let depth = 0;
      let j = i - 1;
      for (; j >= 0; j--) {
        if (text[j] === ch) depth++;
        else if (text[j] === open && --depth === 0) break;
      }
      if (j < 0) break;
      i = j;
    } else if (OPERAND_CHAR_RE.test(ch)) i--;
    else break;
  }
  return text.slice(i, stop);
}

/** The expression directly right of position `start` in `text`; see {@link operandBefore}. */
function operandAfter(text: string, start: number): string {
  let i = start;
  while (i < text.length && /\s/.test(text[i]!)) i++;
  const from = i;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "(" || ch === "[") {
      const close = ch === "(" ? ")" : "]";
      let depth = 0;
      let j = i;
      for (; j < text.length; j++) {
        if (text[j] === ch) depth++;
        else if (text[j] === close && --depth === 0) break;
      }
      if (j >= text.length) break;
      i = j + 1;
    } else if (OPERAND_CHAR_RE.test(ch)) i++;
    else break;
  }
  return text.slice(from, i);
}

/**
 * Whether an equality operator in `cleaned` has a secret-named operand. The
 * operand is the whole expression next to the operator, so a secret wrapped
 * in a call (`String(apiKey) === expected`, `sha256(providedSecret) !== x`)
 * or read through an optional chain (`cookie?.value === expected`) counts.
 * Splitting the line into text segments put those operands and their
 * operator in different segments, and the comparison went unreported.
 */
function hasSecretOperand(cleaned: string): boolean {
  for (const m of cleaned.matchAll(EQUALITY_RE)) {
    const left = operandBefore(cleaned, m.index);
    const right = operandAfter(cleaned, m.index + m[0].length);
    if (HEADER_DERIVED_TOKENS.some((re) => re.test(left) || re.test(right))) return true;
  }
  return false;
}

export interface ForbiddenComparison {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

const COMPARISON_RE =
  /(?:===|!==|(?<![=!<>])==(?!=)|(?<![=!<>])!=(?!=)|\.(?:startsWith|endsWith|includes|indexOf|localeCompare)\s*\()/;

export function findForbiddenSecretComparisons(
  file: string,
  source: string
): readonly ForbiddenComparison[] {
  const out: ForbiddenComparison[] = [];
  const lines = source.split(/\r?\n/);
  const views = stripSource(source);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const noComments = views.noComments[i]!;
    if (noComments.trim().length === 0) continue;
    // A comparison whose operands wrap onto the next line is judged as one,
    // whether the operator ends this line or starts it.
    const wrapped = /(?:===|!==|==|!=)\s*$/.test(noComments.trimEnd())
      ? `${noComments} ${views.noComments[i + 1] ?? ""}`
      : noComments;
    const joined = /^\s*(?:===|!==|==|!=)/.test(noComments)
      ? `${views.noComments[i - 1] ?? ""} ${wrapped}`
      : wrapped;
    // Length checks compare sizes, not bytes; literal comparisons are not secrets.
    const cleaned = joined
      // `typeof x === "string"` and comparisons with the empty string are
      // shape checks, decided before string contents are blanked.
      .replace(/\btypeof\s+[\w.$?]+\s*(?:===|!==|==|!=)\s*(?:"[a-z]*"|'[a-z]*')/g, " ")
      .replace(/(?:===|!==|==|!=)\s*(?:""|'')(?!\s*\+)|(?:""|'')\s*(?:===|!==|==|!=)/g, " ")
      .replace(STRING_LITERAL_RE, '""')
      .replace(/\.length\s*(?:===|!==|==|!=|<=?|>=?)\s*[\w.$]+|[\w.$]+\s*(?:===|!==|==|!=)\s*[\w.$]+\.length\b/g, " ")
      .replace(LITERAL_COMPARISON_RE, " ");
    const secretSegment = cleaned
      .split(SEGMENT_SPLIT_RE)
      .some((part) => COMPARISON_RE.test(part) && HEADER_DERIVED_TOKENS.some((re) => re.test(part)));
    if (!secretSegment && !hasSecretOperand(cleaned) && !DIRECT_HEADER_READ_RE.test(joined)) continue;
    if (ALLOW_MARKER_RE.test(raw)) continue;
    out.push({ file, line: i + 1, text: raw.trim() });
  }
  return out;
}

async function* walk(dir: URL, rel: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      yield* walk(new URL(`${entry.name}/`, dir), `${rel}${entry.name}/`);
    } else if (entry.isFile() && isSourceFile(entry.name)) {
      yield `${rel}${entry.name}`;
    }
  }
}

async function main(): Promise<void> {
  let total = 0;
  const files: string[] = [];
  for await (const rel of walk(new URL(`../${AUDITED_ROOT}`, import.meta.url), AUDITED_ROOT)) {
    files.push(rel);
  }
  if (files.length === 0) {
    console.error(`verify-secret-comparisons: no source files found under ${AUDITED_ROOT}`);
    process.exitCode = 1;
    return;
  }
  for (const rel of files) {
    let text: string;
    try {
      text = await readFile(new URL(`../${rel}`, import.meta.url), "utf8");
    } catch (err) {
      console.error(`verify-secret-comparisons: cannot read ${rel}: ${(err as Error).message}`);
      process.exitCode = 1;
      continue;
    }
    const findings = findForbiddenSecretComparisons(rel, text);
    for (const f of findings) {
      console.error(`${f.file}:${f.line}: forbidden secret comparison: ${f.text}`);
      total++;
    }
  }
  if (total > 0) {
    console.error(
      `verify-secret-comparisons: ${total} forbidden comparison${total === 1 ? "" : "s"} found. ` +
        "Replace `===` / `!==` / `==` / `!=` / `.startsWith()` / `.endsWith()` / " +
        "`.includes()` / `.indexOf()` / `.localeCompare()` against header-derived " +
        "values with `timingSafeEqual()` — these short-circuit on the first " +
        "differing byte and leak secrets via remote timing channels " +
        "(see https://snyk.io/blog/node-js-timing-attack-ccc-ctf/)."
    );
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("verify-secret-comparisons.ts")) {
  await main();
}
