/**
 * Runtime remote-exec primitives CI gate (Aikido BlokTrooper-class defense).
 *
 * Aikido's 2026-03-18 write-up
 * (https://www.aikido.dev/blog/fast-draft-open-vsx-bloktrooper) documents
 * the `fast-draft` Open VSX compromise: a trusted publisher's extension
 * shipped a malicious update that, on activation, fetched a GitHub-hosted
 * shell script and piped it into `sh`, deploying a RAT and an infostealer
 * onto 26 000+ developer machines. The same attack class translated to a
 * Node library is "import-time `fetch(url).then(text => exec(text))`" or
 * "import-time `child_process.exec('curl ... | sh')`" — both have been
 * observed in the broader npm worm landscape (Shai-Hulud, node-ipc).
 *
 * Daloy's runtime source MUST NOT use the primitives that make this
 * pattern possible:
 *
 *   - `node:child_process` / `'child_process'`  (process spawn — shell out)
 *   - `node:vm`            / `'vm'`             (compile downloaded code)
 *   - bare `eval(...)` calls                    (interpret downloaded code)
 *   - `new Function(...)`                       (compile downloaded code)
 *   - dynamic `import("http://...")` / `import("https://...")` of remote
 *     code at runtime (Node's experimental network imports)
 *
 * If a future PR — accidentally or maliciously — adds any of these to
 * `src/**`, this gate refuses to merge it. CLI binaries that legitimately
 * spawn a user-selected runtime (`node`, `bun`, `deno`) live under
 * `bin/` and `packages/create-daloy/bin/` and are intentionally out of
 * scope here; they ship as separate publishable surfaces.
 *
 * Member-access `.eval(...)` (e.g. the Redis client's Lua `eval` method
 * in `src/rate-limit-redis.ts`) is NOT a JavaScript-`eval` call — it is a
 * named method on a foreign object — and is allowed.
 *
 * Exit code:
 *   0 — no forbidden remote-exec primitives found in `src/**`.
 *   1 — at least one was found; offending lines are printed to stderr.
 *
 * @since 0.34.0
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { relative } from "node:path";

const SRC_ROOT = new URL("../src/", import.meta.url);

export interface ForbiddenRemoteExecCall {
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
    // ES module import / re-export of child_process (with or without `node:` prefix).
    re: /\bfrom\s+["'](?:node:)?child_process["']/,
    reason:
      "`child_process` import in core enables shell-out / `curl | sh` payloads (BlokTrooper class)",
  },
  {
    // CommonJS require of child_process.
    re: /\brequire\s*\(\s*["'](?:node:)?child_process["']\s*\)/,
    reason:
      "`child_process` require in core enables shell-out / `curl | sh` payloads (BlokTrooper class)",
  },
  {
    re: /\bfrom\s+["'](?:node:)?vm["']/,
    reason: "`node:vm` import in core enables compiling downloaded code (BlokTrooper class)",
  },
  {
    re: /\brequire\s*\(\s*["'](?:node:)?vm["']\s*\)/,
    reason: "`node:vm` require in core enables compiling downloaded code (BlokTrooper class)",
  },
  {
    // Dynamic import of a remote URL (Node's experimental network imports).
    // Lives in the import-group so the URL string literal is still intact
    // when this regex runs (Phase 2 strips string literals).
    re: /\bimport\s*\(\s*["']https?:\/\//,
    reason: "remote dynamic `import('http(s)://...')` in core can pull arbitrary code (BlokTrooper class)",
  },
  {
    // Bare `eval(...)` call. The leading character must be an
    // expression-position operator/punctuator so that:
    //   - method-shorthand declarations `eval(args) { ... }` inside an
    //     object literal (e.g. the Redis adapter wrapper in
    //     `src/rate-limit-redis.ts`) do NOT trip (they appear after
    //     leading whitespace at line start),
    //   - TS interface method signatures `eval(args): Type` do NOT trip
    //     (same reason),
    //   - member-access `.eval(args)` (e.g. the Redis client's Lua
    //     `eval` method) does NOT trip (preceded by `.`, not in our set).
    // Real call sites — `= eval(x)`, `; eval(x)`, `(eval(x))`,
    // `! eval(x)`, `return eval(x)` (the `return` token is followed by a
    // space and then by the operator-free part, but `return` ends in a
    // word char so we accept it via `\breturn\s+eval\s*\(` below) — DO
    // trip.
    re: /(?:[=(,?:!&|+\-*/\[<>%^~;{}]|\b(?:return|await|throw|typeof|delete|void|new|in|of|yield)\b)\s*eval\s*\(/,
    reason:
      "bare `eval(...)` in core can execute downloaded source as JS (BlokTrooper class); " +
      "use a typed parser instead",
  },
  {
    re: /\bnew\s+Function\s*\(/,
    reason:
      "`new Function(...)` in core compiles a string into JS at runtime (BlokTrooper class); " +
      "use a typed parser instead",
  },
];

const STRING_LITERAL_RE = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;

/**
 * Find the start index of a line comment (`//`) that is NOT inside a
 * string literal. This matters because URLs (e.g. `"https://..."`) embed
 * `//` and would otherwise be mistakenly treated as a line-comment start
 * by a naive `indexOf("//")`, truncating the line BEFORE the
 * remote-dynamic-import regex gets to see the URL.
 */
function findLineCommentStart(s: string): number {
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) {
      i++;
      continue;
    }
    if (inSingle) {
      if (c === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (c === '"') inDouble = false;
      continue;
    }
    if (inBacktick) {
      if (c === "`") inBacktick = false;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      continue;
    }
    if (c === "`") {
      inBacktick = true;
      continue;
    }
    if (c === "/" && s[i + 1] === "/") return i;
  }
  return -1;
}

function stripCommentsAndStrings(line: string): string {
  let out = line;
  out = out.replace(/\/\*[\s\S]*?\*\//g, " ");
  const lineCommentIndex = findLineCommentStart(out);
  if (lineCommentIndex >= 0) out = out.slice(0, lineCommentIndex);
  // For import / require detection we must keep the module-name string,
  // so only strip *non-module* string literals. We detect import/require
  // first, then strip strings and check the eval/new-Function patterns.
  return out;
}

const IMPORT_OR_REQUIRE_PATTERNS = FORBIDDEN_PATTERNS.slice(0, 5);
const CODE_GEN_PATTERNS = FORBIDDEN_PATTERNS.slice(5);

export function findForbiddenRemoteExecCalls(
  file: string,
  source: string,
): readonly ForbiddenRemoteExecCall[] {
  const out: ForbiddenRemoteExecCall[] = [];
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
    // Drop line comments only (keep string literals so import/require patterns match).
    // Use a string-aware scanner so that `//` inside a URL (e.g.
    // `"https://..."`) is NOT treated as a line-comment start.
    const lineCommentIndex = findLineCommentStart(working);
    const noComments = lineCommentIndex >= 0 ? working.slice(0, lineCommentIndex) : working;
    if (noComments.trim().length === 0) continue;

    // Phase 1: import / require / remote-import patterns — string literals stay intact.
    let matched = false;
    for (const pattern of IMPORT_OR_REQUIRE_PATTERNS) {
      if (pattern.re.test(noComments)) {
        out.push({ file, line: i + 1, text: raw.trim(), reason: pattern.reason });
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Phase 2: code-generation patterns — strip string literals so a
    // word like "eval" inside a doc string / error message doesn't trip.
    const codeOnly = stripCommentsAndStrings(noComments).replace(STRING_LITERAL_RE, '""');
    for (const pattern of CODE_GEN_PATTERNS) {
      if (pattern.re.test(codeOnly)) {
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
      yield child.pathname;
    }
  }
}

async function main(): Promise<void> {
  let total = 0;
  try {
    await stat(SRC_ROOT);
  } catch (err) {
    console.error(
      `verify-no-remote-exec: cannot stat src/: ${(err as Error).message}`,
    );
    process.exitCode = 1;
    return;
  }
  for await (const absolute of walk(SRC_ROOT)) {
    const rel = "src/" + relative(SRC_ROOT.pathname, absolute);
    const text = await readFile(absolute, "utf8");
    const findings = findForbiddenRemoteExecCalls(rel, text);
    for (const f of findings) {
      console.error(`${f.file}:${f.line}: forbidden remote-exec primitive (${f.reason}): ${f.text}`);
      total++;
    }
  }
  if (total > 0) {
    console.error(
      `verify-no-remote-exec: ${total} forbidden remote-exec primitive${total === 1 ? "" : "s"} found. ` +
        "Core source must not import `node:child_process` / `node:vm`, call bare `eval(...)` or " +
        "`new Function(...)`, or dynamically `import('http(s)://...')`. These are the runtime " +
        "primitives the BlokTrooper / Shai-Hulud class of supply-chain worm uses to fetch a " +
        "remote payload and execute it. See https://www.aikido.dev/blog/fast-draft-open-vsx-bloktrooper.",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("verify-no-remote-exec.ts")) {
  await main();
}
