/**
 * Unsafe-`Buffer` API CI grep gate.
 *
 * Daloy's source MUST NOT use the legacy `new Buffer(...)` constructor or
 * `Buffer.allocUnsafe(...)` / `Buffer.allocUnsafeSlow(...)`. Both classes
 * of call return memory that is *not* zero-filled, so any code path that
 * doesn't immediately overwrite every byte can leak whatever happened to
 * be sitting on the heap (recent request bodies, cookies, secrets...).
 * The legacy constructor additionally has the API-confusion problem
 * (`Buffer(number)` vs `Buffer(string)`) that Node deprecated for security
 * reasons. See the Snyk write-up:
 * https://snyk.io/blog/exploiting-buffer/.
 *
 * Use `Buffer.alloc(size)`, `Buffer.from(input)`, or a plain `Uint8Array`
 * instead. Daloy is already runtime-portable and prefers `Uint8Array` for
 * adapter-shared code paths.
 *
 * Scope: every file under `src/**` (the production surface that ships in
 * the published tarball). Tests and benches can legitimately reach for
 * `Buffer.alloc()` for binary fixtures, so they are out of scope.
 *
 * Exit code:
 *   0 — no forbidden Buffer calls found in `src/**`.
 *   1 — at least one forbidden Buffer call was found; offending lines are
 *       printed to stderr.
 *
 * @since 0.34.0
 */

import { stripSource } from "./lib/strip-source.js";
import { readdir, readFile, stat } from "node:fs/promises";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_ROOT = new URL("../src/", import.meta.url);

export interface ForbiddenBufferCall {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly reason: string;
}

interface ForbiddenPattern {
  readonly re: RegExp;
  readonly reason: string;
}

const FORBIDDEN_PATTERNS: readonly ForbiddenPattern[] = [
  {
    re: /\bnew\s+Buffer\s*\(/,
    reason:
      "deprecated `new Buffer(...)` constructor; use `Buffer.alloc(size)` or `Buffer.from(input)`",
  },
  {
    // Any reference, not only a direct call: `const alloc = Buffer.allocUnsafe`,
    // `Buffer["allocUnsafe"](n)` and `const { allocUnsafe } = Buffer` are the
    // same primitive under another name.
    re: /\ballocUnsafe(?:Slow)?\b|\bnew\s+SlowBuffer\b/,
    reason:
      "`Buffer.allocUnsafe*` returns uninitialized memory; use `Buffer.alloc(size)` or `Uint8Array`",
  },
];

const STRING_LITERAL_RE = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;

/**
 * Strip line + block comments and string literals so a banned identifier
 * that only appears inside documentation or an error message does not trip
 * the gate. (Important: this script itself mentions `Buffer.allocUnsafe`
 * in prose; the gate would otherwise fail on its own SECURITY.md row.)
 */
function stripCommentsAndStrings(line: string): string {
  let out = line;
  // Block-comment fragments on a single line: `/* ... */`.
  out = out.replace(/\/\*[\s\S]*?\*\//g, " ");
  // Line comments.
  const lineCommentIndex = out.indexOf("//");
  if (lineCommentIndex >= 0) out = out.slice(0, lineCommentIndex);
  out = out.replace(STRING_LITERAL_RE, '""');
  return out;
}

export function findForbiddenBufferCalls(
  file: string,
  source: string
): readonly ForbiddenBufferCall[] {
  const out: ForbiddenBufferCall[] = [];
  const lines = source.split(/\r?\n/);
  // Comments are removed by a whole-file scan (see strip-source.ts): a
  // per-line guess mistook `"/*"` in a string for a comment opener.
  const views = stripSource(source);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const stripped = views.code[i]!;
    const trimmed = stripped.trim();
    if (trimmed.length === 0) continue;
    // Computed access (`Buffer["allocUnsafe"]`) keeps its name in a string,
    // which `stripped` blanks, so test that one form on the unblanked line.
    const computed = /\bBuffer\s*\[\s*["'`]allocUnsafe(?:Slow)?["'`]\s*\]/.test(views.noComments[i]!);
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.re.test(stripped) || (computed && pattern.re.source.includes("allocUnsafe"))) {
        out.push({ file, line: i + 1, text: raw.trim(), reason: pattern.reason });
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
    console.error(`verify-no-unsafe-buffer: cannot stat src/: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }
  for await (const absolute of walk(SRC_ROOT)) {
    const rel = "src/" + relative(fileURLToPath(SRC_ROOT), absolute).replaceAll("\\", "/");
    const text = await readFile(absolute, "utf8");
    const findings = findForbiddenBufferCalls(rel, text);
    for (const f of findings) {
      console.error(`${f.file}:${f.line}: forbidden Buffer call (${f.reason}): ${f.text}`);
      total++;
    }
  }
  if (total > 0) {
    console.error(
      `verify-no-unsafe-buffer: ${total} forbidden Buffer call${total === 1 ? "" : "s"} found. ` +
        "Replace `new Buffer(...)` / `Buffer.allocUnsafe*` with `Buffer.alloc(size)`, " +
        "`Buffer.from(input)`, or a plain `Uint8Array`. " +
        "See https://snyk.io/blog/exploiting-buffer/."
    );
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("verify-no-unsafe-buffer.ts")) {
  await main();
}
