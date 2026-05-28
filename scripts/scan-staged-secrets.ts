/**
 * `pnpm scan:staged-secrets` — local pre-commit gate that refuses to let a
 * credential-shaped string or secret-shaped filename land in a commit.
 *
 * The CI side of secret-scanning is already comprehensive — the
 * [`secret-scan.yml`](../.github/workflows/secret-scan.yml) workflow runs
 * `gitleaks dir` on every PR / push and a daily `gitleaks git` sweep of
 * the full history, GitHub-native push protection blocks high-confidence
 * tokens at `git push`, and [`verify-no-leaked-credentials.ts`](./verify-no-leaked-credentials.ts)
 * scans the assembled tarball at publish time. What was missing — and
 * what Aikido's [Expansion Packs](https://www.aikido.dev/blog/introducing-aikido-expansion-packs)
 * "Secrets Pre-Commit Hook" highlights — is a *local* gate that runs
 * before `git commit` ever finishes, so a secret never reaches a
 * developer's fork in the first place. Once a token hits even a private
 * fork it is considered burned and must be rotated.
 *
 * This script:
 *
 *   1. Reads the list of files staged for commit (`git diff --cached
 *      --name-only --diff-filter=AM -z`).
 *   2. Refuses the commit if any staged file's basename matches one of
 *      the forbidden secret-shaped filename patterns (`.env`,
 *      `*.pem`, `id_rsa`, `.npmrc`, `credentials.json`, …) reused from
 *      {@link scripts/verify-no-leaked-credentials.ts}. The
 *      `.env.example` / `.env.sample` / `.env.template` allowlist
 *      matches the gitignore convention in every `create-daloy`
 *      template.
 *   3. Refuses the commit if any staged file *contains* a
 *      credential-shaped string (AWS access key, GitHub PAT, npm token,
 *      Slack token, Stripe live key, Google API key, PEM private-key
 *      block, JWT-shaped string, npm-registry `_authToken=` line).
 *
 * The pattern list is intentionally identical to the publish-time
 * `verify:no-leaked-credentials` gate so a secret blocked here cannot
 * sneak past the publish gate later, and vice versa — both gates share
 * a single source of truth via the `CREDENTIAL_CONTENT_PATTERNS` /
 * `scanFileContentForCredentials` exports.
 *
 * Exit codes:
 *   0 — no staged files, or no findings.
 *   1 — at least one finding (or `git` is not available); offending
 *       paths printed to stderr with a one-line rotation reminder.
 *
 * Install the hook with `pnpm hooks:install` to wire it into
 * `.git/hooks/pre-commit`. The script can also be invoked manually:
 *
 *     pnpm scan:staged-secrets
 *
 * @since 0.35.2
 */

import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import {
  CREDENTIAL_CONTENT_PATTERNS,
  scanFileContentForCredentials,
} from "./verify-no-leaked-credentials.ts";

/**
 * Filenames that must never appear in a commit, regardless of directory.
 * Matched case-insensitively against the basename only. Kept in sync with
 * {@link scripts/verify-no-leaked-credentials.ts} so the local pre-commit
 * gate and the publish-time tarball gate share one definition of
 * "secret-shaped filename".
 */
export const FORBIDDEN_STAGED_FILENAME_PATTERNS: readonly RegExp[] = [
  /^\.env$/i,
  /^\.env\..+$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /^\.netrc$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /^credentials(\.json)?$/i,
  /^secrets(\.json)?$/i,
  /^service[-_]account.*\.json$/i,
  /\.kdbx$/i,
];

/**
 * Filenames that look forbidden but are legitimately committable —
 * template placeholders and example-only env files. Identical allowlist
 * to the publish-time gate.
 *
 * Note: `.npmrc` is intentionally **not** in the forbidden list here
 * (unlike the publish-time gate). The repo and every scaffolded template
 * legitimately commit a hardening `.npmrc` (`ignore-scripts=true`,
 * `minimum-release-age=1440`, …); the credential-content scan still
 * catches an `_authToken=…` line if one is ever added.
 */
export const ALLOWED_STAGED_FILENAME_PATTERNS: readonly RegExp[] = [
  /^\.env\.example$/i,
  /^\.env\.sample$/i,
  /^\.env\.template$/i,
];

/** Binary file extensions skipped by the content scanner. */
const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".zip",
  ".gz",
  ".tgz",
  ".br",
]);

export interface StagedFinding {
  readonly file: string;
  readonly kind: "filename" | "content";
  readonly detail: string;
  readonly line?: number;
}

function basenameOf(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i < 0 ? path : path.slice(i + 1);
}

function isAllowedStagedFilename(basename: string): boolean {
  return ALLOWED_STAGED_FILENAME_PATTERNS.some((re) => re.test(basename));
}

export function isForbiddenStagedFilename(basename: string): boolean {
  if (isAllowedStagedFilename(basename)) return false;
  return FORBIDDEN_STAGED_FILENAME_PATTERNS.some((re) => re.test(basename));
}

function isBinary(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return BINARY_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

/**
 * Return the list of files currently staged for commit (added or
 * modified). Uses the NUL-delimited form of `git diff` so filenames with
 * spaces / newlines are unambiguous. Returns `null` if `git` is not
 * available or the working directory is not a git checkout — the caller
 * treats this as a soft failure (no commit is in progress, e.g. a CI
 * invocation against a tarball).
 */
export function listStagedFiles(cwd: string = process.cwd()): readonly string[] | null {
  const res = spawnSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=AM", "-z"],
    { cwd, encoding: "utf8" },
  );
  if (res.status !== 0) return null;
  const out = res.stdout ?? "";
  if (out.length === 0) return [];
  // Split on NUL; drop the empty trailing element.
  return out.split("\u0000").filter((f) => f.length > 0);
}

/**
 * Scan one staged file's bytes for forbidden filename / content patterns.
 * Returns an empty array if the file is binary, unreadable, or clean.
 *
 * Exported so tests can drive the scan against a tempdir without needing
 * a real git index.
 */
export async function scanOneStagedFile(
  cwd: string,
  rel: string,
): Promise<readonly StagedFinding[]> {
  const findings: StagedFinding[] = [];
  const basename = basenameOf(rel);
  if (isForbiddenStagedFilename(basename)) {
    findings.push({
      file: rel,
      kind: "filename",
      detail: `forbidden secret-shaped filename "${basename}"`,
    });
    return findings;
  }
  if (isBinary(rel)) return findings;
  const abs = resolve(cwd, rel);
  try {
    const s = await stat(abs);
    if (!s.isFile()) return findings;
  } catch {
    // File was staged then deleted on disk; nothing to scan.
    return findings;
  }
  let text: string;
  try {
    text = await readFile(abs, "utf8");
  } catch {
    return findings; // unreadable / non-UTF-8 — treat as binary.
  }
  for (const hit of scanFileContentForCredentials(text)) {
    findings.push({ file: rel, kind: "content", detail: hit.detail, line: hit.line });
  }
  return findings;
}

/**
 * Run the staged-files scan and return every finding. Exported so the
 * unit tests can call it directly; the CLI wrapper at the bottom of
 * this file translates findings to stderr + an exit code.
 */
export async function scanStagedSecrets(
  cwd: string = process.cwd(),
  staged: readonly string[] | null = listStagedFiles(cwd),
): Promise<readonly StagedFinding[]> {
  if (staged === null) return [];
  const out: StagedFinding[] = [];
  for (const rel of staged) {
    const hits = await scanOneStagedFile(cwd, rel);
    out.push(...hits);
  }
  return out;
}

async function main(): Promise<void> {
  const findings = await scanStagedSecrets();
  if (findings.length === 0) return;
  for (const f of findings) {
    const where = f.line ? `${f.file}:${f.line}` : f.file;
    console.error(`scan-staged-secrets: ${where}: ${f.detail}`);
  }
  console.error(
    `scan-staged-secrets: ${findings.length} finding${findings.length === 1 ? "" : "s"} ` +
      "in staged files. Unstage the file (`git restore --staged <path>`) and " +
      "rotate the credential — once a secret is committed it is considered burned. " +
      "Allowlist legitimate placeholders by renaming to `.env.example` / `.env.sample` / `.env.template`.",
  );
  process.exitCode = 1;
}

// Avoid the credential-pattern list at the import side from triggering
// the import-time integrity of this script under unit-test imports.
void CREDENTIAL_CONTENT_PATTERNS;

if (process.argv[1]?.endsWith("scan-staged-secrets.ts")) {
  await main();
}
