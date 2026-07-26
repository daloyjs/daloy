/**
 * ReDoS-prone regex CI grep gate (Snyk 2023-04-06 write-up
 * https://snyk.io/blog/timing-out-synchronous-functions-with-regex/).
 *
 * The Snyk article walks through the failure mode in detail: a regex
 * with nested unbounded quantifiers — e.g. `/(a+)+$/` against
 * `"aaaaaaaaaaaaaaaaaaaaaaaaa!"` — causes catastrophic backtracking
 * that blocks the Node event loop. The framework-level mitigations
 * Daloy already ships (`bodyLimitBytes`, `requestTimeoutMs`) are
 * *necessary but not sufficient*: `requestTimeoutMs` uses
 * `Promise.race`, which the blog explicitly calls out as unable to
 * interrupt a synchronous regex hanging the event loop. The only
 * reliable fix is to never compile such a regex in the first place.
 *
 * Daloy never compiles a regex from network input (the only
 * `new RegExp(...)` call in `src/` is fed a developer-supplied path
 * pattern in `compilePathPattern`, and the alphabet it produces is
 * `[^/]*` / `.*` only — linear by construction). This gate enforces
 * that posture forward: it scans every `.ts` / `.js` regex literal
 * under `src/**` and rejects the catastrophic shapes the Snyk article
 * warns about.
 *
 * Banned shapes (per "Regular Expression Denial of Service - ReDoS"
 * OWASP cheat sheet and the Snyk write-up):
 *   - Nested unbounded quantifiers on a group:  `(...)+` / `(...)*`
 *     followed immediately by `+`, `*`, or `{n,}` — `(a+)+`,
 *     `(.*)+`, `(a*){2,}`, etc.
 *   - Nested unbounded quantifiers using `?` (lazy or optional):
 *     `(.+)?+`, `(.*?)+`.
 *   - Overlapping alternation under an unbounded quantifier:
 *     `(a|a)*`, `(a|aa)+`, `(a|ab|abc)*` — the classic
 *     "ambiguous repetition" backtracker.
 *
 * Suppressing a finding: if a line is genuinely safe (for example a
 * regex used only against a tightly bounded fixed string), opt in with
 * `// daloy-allow-redos: <reason>` on the same line. The marker is
 * intentionally noisy so reviewers see it; PRs that add the marker
 * without a clear justification should be rejected.
 *
 * Scope: every file under `src/**`. Tests, benches, scripts, and the
 * `examples/` tree are out of scope — they may legitimately demonstrate
 * the unsafe shape (e.g. in a security write-up).
 *
 * Exit code:
 *   0 — no banned regex shape found in `src/**`.
 *   1 — at least one was found; offending lines are printed to stderr.
 *
 * @since 0.46.0
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_ROOT = new URL("../src/", import.meta.url);

export interface ReDosFinding {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly pattern: string;
  readonly reason: string;
}

const ALLOW_MARKER_RE = /\/\/\s*daloy-allow-redos\b/;

/**
 * Banned shapes, applied to the *body* of each regex literal (between
 * the slashes / between the quotes for `new RegExp("...")`).
 *
 * Each entry is intentionally narrow: we'd rather under-flag than
 * pepper the codebase with noisy false positives. The shapes here are
 * the ones the Snyk article and the OWASP ReDoS cheat sheet single
 * out as catastrophic.
 */
const BANNED: ReadonlyArray<{
  readonly id: string;
  readonly re: RegExp;
  readonly hint: string;
}> = [
  {
    id: "nested-unbounded-quantifier",
    // A group whose body itself contains a quantifier (`+`, `*`, `?`,
    // or `{n,}`), immediately followed by an *outer* unbounded
    // quantifier (`+`, `*`, or `{n,}`). That is the canonical
    // catastrophic shape — `(a+)+`, `(.*)+`, `(\d+){2,}`, etc.
    // A group like `(foo)+` (no inner quantifier) is *not* flagged.
    re: /\([^()]*[+*?{][^()]*\)\s*(?:[+*]|\{\d+,\}?)/,
    hint: "nested unbounded quantifier (e.g. `(a+)+`, `(.*)+`) — catastrophic backtracking",
  },
  {
    id: "overlapping-alternation-repeated",
    // `(a|a)*` / `(a|ab|abc)+` — alternation that can match the same
    // prefix in multiple ways, under an unbounded outer quantifier.
    // Heuristic: a group containing `|` followed by `*`, `+`, or
    // `{n,}` where at least one alternative is a strict prefix of
    // another. We approximate "ambiguous" by requiring the group to
    // contain only literal letters/digits and `|`, then checking the
    // alternatives in JS at scan time.
    re: /\(([A-Za-z0-9|]+)\)\s*(?:[+*]|\{\d+,\}?)/,
    hint: "potentially overlapping alternation under unbounded quantifier (e.g. `(a|aa)*`)",
  },
];

const STRING_LITERAL_RE = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;

function stripCommentsAndStrings(line: string): string {
  let out = line;
  out = out.replace(/\/\*[\s\S]*?\*\//g, " ");
  const lineCommentIndex = out.indexOf("//");
  if (lineCommentIndex >= 0) out = out.slice(0, lineCommentIndex);
  out = out.replace(STRING_LITERAL_RE, '""');
  return out;
}

/**
 * Extract regex-literal bodies from a single source line.
 *
 * `slashLine` should already have comments and string literals
 * stripped (so we don't pick up a `/.../` shape that lives inside a
 * string). `rawLine` is the original line, used to find
 * `new RegExp("...")` calls whose pattern lives *inside* a string
 * literal and would otherwise be erased by the comment/string strip.
 */
function extractRegexBodies(slashLine: string, rawLine: string): readonly string[] {
  const bodies: string[] = [];
  // crude but effective: match `/.../[gimsuy]*` not preceded by an
  // identifier character (to avoid `a/b`), and not inside a string.
  const re = /(?:^|[^A-Za-z0-9_$)\]])\/((?:\\.|\[[^\]]*\]|[^/\\\n])+)\/[gimsuy]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(slashLine)) !== null) {
    bodies.push(m[1]!);
  }
  // `new RegExp("...")` / `new RegExp('...')` — first string argument.
  // Scanned on the raw line because `stripCommentsAndStrings` would
  // erase the pattern body before we could read it.
  const newRe = /\bnew\s+RegExp\s*\(\s*(["'])((?:\\.|(?!\1).)*)\1/g;
  while ((m = newRe.exec(rawLine)) !== null) {
    // Decode the JS string-literal escapes so `\\d+` in source
    // becomes `\d+` in the regex body we test against.
    let body = m[2]!;
    body = body.replace(/\\(.)/g, "$1");
    bodies.push(body);
  }
  return bodies;
}

/**
 * True if any two alternatives in `alts` overlap such that the regex
 * engine would have two ways to match the same prefix — the classic
 * "ambiguous" shape under an unbounded quantifier.
 */
function alternationIsAmbiguous(group: string): boolean {
  if (!group.includes("|")) return false;
  const alts = group.split("|");
  if (alts.length < 2) return false;
  for (let i = 0; i < alts.length; i++) {
    for (let j = 0; j < alts.length; j++) {
      if (i === j) continue;
      const a = alts[i]!;
      const b = alts[j]!;
      if (a.length === 0 || b.length === 0) continue;
      if (a === b) return true;
      if (b.startsWith(a)) return true;
    }
  }
  return false;
}

export function findReDosPatterns(file: string, source: string): readonly ReDosFinding[] {
  const out: ReDosFinding[] = [];
  const lines = source.split(/\r?\n/);
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    let working = raw;
    if (inBlockComment) {
      const end = working.indexOf("*/");
      if (end < 0) continue;
      working = working.slice(end + 2);
      inBlockComment = false;
    }
    const blockOpen = working.lastIndexOf("/*");
    const blockClose = working.lastIndexOf("*/");
    if (blockOpen >= 0 && blockClose < blockOpen) {
      working = working.slice(0, blockOpen);
      inBlockComment = true;
    }
    const stripped = stripCommentsAndStrings(working);
    if (stripped.trim().length === 0 && !/\bnew\s+RegExp\b/.test(raw)) continue;
    if (ALLOW_MARKER_RE.test(raw)) continue;

    const bodies = extractRegexBodies(stripped, raw);
    if (bodies.length === 0) continue;

    for (const body of bodies) {
      for (const rule of BANNED) {
        const match = rule.re.exec(body);
        if (!match) continue;
        if (rule.id === "overlapping-alternation-repeated") {
          const group = match[1]!;
          if (!alternationIsAmbiguous(group)) continue;
        }
        out.push({
          file,
          line: i + 1,
          text: raw.trim(),
          pattern: body,
          reason: rule.hint,
        });
        break;
      }
    }
  }
  return out;
}

async function* walk(dir: URL): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    if (entry.isDirectory()) {
      yield* walk(child);
    } else if (entry.isFile() && /\.(?:m?ts|m?js)$/.test(entry.name)) {
      yield fileURLToPath(child);
    }
  }
}

async function main(): Promise<void> {
  let total = 0;
  try {
    await stat(SRC_ROOT);
  } catch (err) {
    console.error(`verify-no-redos-patterns: cannot stat src/: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }
  for await (const absolute of walk(SRC_ROOT)) {
    const rel = "src/" + relative(fileURLToPath(SRC_ROOT), absolute).replaceAll("\\", "/");
    const text = await readFile(absolute, "utf8");
    const findings = findReDosPatterns(rel, text);
    for (const f of findings) {
      console.error(
        `${f.file}:${f.line}: ReDoS-prone regex (${f.reason}): /${f.pattern}/ — ${f.text}`
      );
      total++;
    }
  }
  if (total > 0) {
    console.error(
      `verify-no-redos-patterns: ${total} ReDoS-prone regex${
        total === 1 ? "" : "es"
      } found in src/. ` +
        "Rewrite to avoid nested unbounded quantifiers and overlapping alternation, " +
        "or — only with a documented justification — opt in with " +
        "`// daloy-allow-redos: <reason>` on the same line. " +
        "See https://snyk.io/blog/timing-out-synchronous-functions-with-regex/ " +
        "and the OWASP ReDoS cheat sheet."
    );
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("verify-no-redos-patterns.ts")) {
  await main();
}
