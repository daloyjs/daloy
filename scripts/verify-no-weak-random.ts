/**
 * Weak-randomness CI grep gate (Aikido "Top 10 Python Security
 * Vulnerabilities" item #10 — *Insufficient Randomness*).
 *
 * Aikido's 2025-10-05 write-up
 * (https://www.aikido.dev/blog/python-security-vulnerabilities) calls
 * out `random.random()` / `random.randrange()` as a recurring source of
 * security bugs: developers reach for the standard PRNG when generating
 * password-reset tokens, session ids, CSRF tokens, or nonces — but those
 * generators are designed for **modeling and simulation**, not security.
 * Python's documentation explicitly directs callers to the `secrets`
 * module for any security-sensitive value. The exact same trap exists
 * in JavaScript: `Math.random()` is a non-cryptographic, deterministic
 * PRNG that should never be used to mint tokens, ids, or comparison
 * salts.
 *
 * Daloy's runtime source MUST NOT call `Math.random()` for any new
 * security-relevant code path. The Web Crypto API (`crypto.randomUUID`,
 * `crypto.getRandomValues`) is available on every supported runtime
 * (Node 20+/Bun/Deno/Workers/Edge) and is what `randomId()` in
 * [`src/security.ts`](../src/security.ts) already uses.
 *
 * Exactly one fallback site is allow-listed: the last-resort branch of
 * `randomId()` that runs only when *both* `crypto.randomUUID` and
 * `crypto.getRandomValues` are unavailable — a condition that, per the
 * comment on the line, is documented to be impossible on every runtime
 * Daloy supports. That line opts in via the inline marker
 *
 *     // daloy-allow-weak-random: <reason>
 *
 * which the gate honors per-line. The marker is intentionally noisy so
 * any future use stands out in code review; reviewers should reject
 * PRs that add the marker without a documented runtime gap.
 *
 * Scope: every file under `src/**`. Tests, benches, and scripts may
 * legitimately call `Math.random()` (e.g. fuzz inputs, jitter probes)
 * and are out of scope.
 *
 * Exit code:
 *   0 — no forbidden `Math.random()` call found in `src/**`.
 *   1 — at least one was found; offending lines are printed to stderr.
 *
 * @since 0.46.0
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_ROOT = new URL("../src/", import.meta.url);

export interface ForbiddenWeakRandomCall {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly reason: string;
}

const FORBIDDEN_RE = /\bMath\s*\.\s*random\s*\(/;
const ALLOW_MARKER_RE = /\/\/\s*daloy-allow-weak-random\b/;

const STRING_LITERAL_RE = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;

/**
 * Strip line + block comments and string literals so a banned identifier
 * that only appears inside documentation or an error message does not
 * trip the gate.
 */
function stripCommentsAndStrings(line: string): string {
  let out = line;
  out = out.replace(/\/\*[\s\S]*?\*\//g, " ");
  const lineCommentIndex = out.indexOf("//");
  if (lineCommentIndex >= 0) out = out.slice(0, lineCommentIndex);
  out = out.replace(STRING_LITERAL_RE, '""');
  return out;
}

export function findForbiddenWeakRandomCalls(
  file: string,
  source: string
): readonly ForbiddenWeakRandomCall[] {
  const out: ForbiddenWeakRandomCall[] = [];
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
    if (stripped.trim().length === 0) continue;
    if (!FORBIDDEN_RE.test(stripped)) continue;
    if (ALLOW_MARKER_RE.test(raw)) continue;
    out.push({
      file,
      line: i + 1,
      text: raw.trim(),
      reason:
        "`Math.random()` is a non-cryptographic PRNG; use `crypto.randomUUID()` " +
        "or `crypto.getRandomValues()` for any security-relevant value " +
        "(tokens, ids, nonces, comparison salts). " +
        "If this is a documented runtime-gap fallback, opt in with " +
        "`// daloy-allow-weak-random: <reason>` on the same line.",
    });
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
    console.error(`verify-no-weak-random: cannot stat src/: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }
  for await (const absolute of walk(SRC_ROOT)) {
    const rel = "src/" + relative(fileURLToPath(SRC_ROOT), absolute).replaceAll("\\", "/");
    const text = await readFile(absolute, "utf8");
    const findings = findForbiddenWeakRandomCalls(rel, text);
    for (const f of findings) {
      console.error(`${f.file}:${f.line}: forbidden Math.random() (${f.reason}): ${f.text}`);
      total++;
    }
  }
  if (total > 0) {
    console.error(
      `verify-no-weak-random: ${total} forbidden Math.random() call${
        total === 1 ? "" : "s"
      } found. ` +
        "Replace with `crypto.randomUUID()` / `crypto.getRandomValues()`, " +
        "or — only for a documented runtime-gap fallback — opt in with " +
        "`// daloy-allow-weak-random: <reason>` on the same line. " +
        "See https://www.aikido.dev/blog/python-security-vulnerabilities (item #10)."
    );
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("verify-no-weak-random.ts")) {
  await main();
}
