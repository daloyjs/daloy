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

import { readFile } from "node:fs/promises";

/** Files audited by this gate. Adjust the list when adding new security modules. */
export const AUDITED_FILES: readonly string[] = [
  "src/session.ts",
  "src/security.ts",
  "src/security-schemes.ts",
  "src/middleware.ts",
];

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
];

const STRING_LITERAL_RE = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;
const DIRECT_HEADER_READ_RE =
  /headers\.get\(\s*["'](?:authorization|cookie|x-api-key|x-[^"']*signature[^"']*)["']\s*\)/i;

export interface ForbiddenComparison {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

const COMPARISON_RE =
  /(?:===|!==|(?<![=!<>])==(?!=)|(?<![=!<>])!=(?!=)|\.(?:startsWith|endsWith|includes|indexOf|localeCompare)\s*\()/;

export function findForbiddenSecretComparisons(
  file: string,
  source: string,
): readonly ForbiddenComparison[] {
  const out: ForbiddenComparison[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    if (!COMPARISON_RE.test(trimmed)) continue;
    const withoutStrings = trimmed.replace(STRING_LITERAL_RE, "\"\"");
    if (
      !DIRECT_HEADER_READ_RE.test(trimmed) &&
      !HEADER_DERIVED_TOKENS.some((re) => re.test(withoutStrings))
    ) {
      continue;
    }
    out.push({ file, line: i + 1, text: trimmed });
  }
  return out;
}

async function main(): Promise<void> {
  let total = 0;
  for (const rel of AUDITED_FILES) {
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
        "(see https://snyk.io/blog/node-js-timing-attack-ccc-ctf/).",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("verify-secret-comparisons.ts")) {
  await main();
}
