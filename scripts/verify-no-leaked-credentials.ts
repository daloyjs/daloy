/**
 * Pre-publish credential-leak gate.
 *
 * Scans every file that the `files` whitelist of a publishable package would
 * include in its npm tarball and refuses to publish if any of the following
 * appear:
 *
 *  - **Secret-shaped filenames** (`.env`, `.env.production`, `id_rsa`,
 *    `*.pem`, `*.key`, `*.p12`, `*.pfx`, `.npmrc`, `.netrc`,
 *    `credentials.json`, `secrets.json`, `service-account*.json`, …). The
 *    `.env.example` / `.env.sample` allowlist matches the gitignore
 *    convention in every `create-daloy` template.
 *  - **Credential-shaped strings** inside any included file: AWS access
 *    key ids (`AKIA…`), GitHub PATs / OAuth / server-to-server / refresh /
 *    fine-grained tokens, npm access tokens, Slack tokens, Stripe live
 *    secret keys, Google API keys (`AIza…`), JWT-shaped strings, PEM
 *    `-----BEGIN … PRIVATE KEY-----` blocks, and npm-registry
 *    `_authToken=` lines.
 *
 * Closes the Snyk "leaked credentials in packages" class
 * (<https://snyk.io/blog/leaked-credentials-in-packages/>) — the article
 * documents how a single misplaced `.env`, `id_rsa`, or hard-coded provider
 * key in a published tarball routinely exposes production secrets. Daloy's
 * `files` whitelist (`dist/` + `bin/` + `README.md` for `@daloyjs/core`;
 * `bin/` + `templates/` + `README.md` for `create-daloy`) is the primary
 * defense; this gate is the regression net that makes "we forgot one" a
 * publish-blocking error instead of a Sigstore-attested leak.
 *
 * Exit codes:
 *   0 — no forbidden filenames or credential-shaped strings found.
 *   1 — at least one finding; offending paths/lines printed to stderr.
 *
 * @since 0.41.0
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/** Publishable packages whose tarball contents must be scanned. */
export interface PublishablePackage {
  /** Human-readable name used in error messages. */
  readonly name: string;
  /** Directory containing the `package.json`, relative to the repo root. */
  readonly packageDir: string;
}

export const PUBLISHABLE_PACKAGES: readonly PublishablePackage[] = [
  { name: "@daloyjs/core", packageDir: "." },
  { name: "create-daloy", packageDir: "packages/create-daloy" },
];

/**
 * Filenames that must never appear in a published tarball, regardless of
 * directory. Matched case-insensitively against the basename only.
 */
const FORBIDDEN_FILENAME_PATTERNS: readonly RegExp[] = [
  /^\.env$/i,
  /^\.env\..+$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /^\.npmrc$/i,
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
 * Filenames that look forbidden but are legitimately part of a published
 * tarball (template placeholders, example-only env files, …).
 */
const ALLOWED_FILENAME_PATTERNS: readonly RegExp[] = [
  /^\.env\.example$/i,
  /^\.env\.sample$/i,
  /^\.env\.template$/i,
];

/** Credential-shaped string patterns scanned in every included file. */
export const CREDENTIAL_CONTENT_PATTERNS: readonly { name: string; re: RegExp }[] =
  Object.freeze([
    { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
    { name: "GitHub personal access token (ghp_)", re: /\bghp_[A-Za-z0-9]{36}\b/ },
    { name: "GitHub OAuth token (gho_)", re: /\bgho_[A-Za-z0-9]{36}\b/ },
    { name: "GitHub server-to-server token (ghs_)", re: /\bghs_[A-Za-z0-9]{36}\b/ },
    { name: "GitHub refresh token (ghr_)", re: /\bghr_[A-Za-z0-9]{36}\b/ },
    { name: "GitHub user-to-server token (ghu_)", re: /\bghu_[A-Za-z0-9]{36}\b/ },
    {
      name: "GitHub fine-grained PAT (github_pat_)",
      re: /\bgithub_pat_[A-Za-z0-9_]{82}\b/,
    },
    { name: "npm access token (npm_)", re: /\bnpm_[A-Za-z0-9]{36}\b/ },
    { name: "Slack token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
    { name: "Stripe live secret key", re: /\bsk_live_[A-Za-z0-9]{24,}\b/ },
    { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
    {
      name: "PEM private-key block",
      re: /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/,
    },
    {
      name: "JWT-shaped string",
      re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    },
    { name: "npm-registry _authToken", re: /(^|[\s,;])_authToken\s*=\s*\S+/im },
  ]);

/**
 * Binary file extensions skipped by the content scanner. Avoids spurious
 * matches inside compiled artifacts that legitimately appear in a tarball.
 */
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

export interface CredentialFinding {
  readonly pkg: string;
  readonly file: string;
  readonly kind: "filename" | "content";
  readonly detail: string;
  readonly line?: number;
}

function isAllowedFilename(basename: string): boolean {
  return ALLOWED_FILENAME_PATTERNS.some((re) => re.test(basename));
}

function isForbiddenFilename(basename: string): boolean {
  if (isAllowedFilename(basename)) return false;
  return FORBIDDEN_FILENAME_PATTERNS.some((re) => re.test(basename));
}

function isBinary(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return BINARY_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

export function scanFileContentForCredentials(
  source: string,
): readonly { line: number; detail: string }[] {
  const out: { line: number; detail: string }[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const { name, re } of CREDENTIAL_CONTENT_PATTERNS) {
      if (re.test(line)) {
        out.push({ line: i + 1, detail: name });
      }
    }
  }
  return out;
}

async function* walk(root: string): AsyncIterable<string> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const p = join(root, ent.name);
    if (ent.isDirectory()) {
      yield* walk(p);
    } else if (ent.isFile()) {
      yield p;
    }
  }
}

/**
 * Resolve the literal disk paths that match a single entry of the
 * `package.json` `files` array. Accepts a plain file, a directory (walked
 * recursively), or a `**` glob suffix. Other glob patterns are not
 * supported — the `files` whitelist convention in this repo uses literal
 * paths.
 */
async function* resolveFilesEntry(pkgDir: string, entry: string): AsyncIterable<string> {
  const abs = resolve(pkgDir, entry);
  let s;
  try {
    s = await stat(abs);
  } catch {
    return; // missing path is silently skipped (e.g. dist/ pre-build)
  }
  if (s.isDirectory()) {
    yield* walk(abs);
  } else if (s.isFile()) {
    yield abs;
  }
}

export async function findCredentialLeaks(
  pkg: PublishablePackage,
  rootDir: string = REPO_ROOT,
): Promise<readonly CredentialFinding[]> {
  const pkgDir = resolve(rootDir, pkg.packageDir);
  const pkgJsonPath = join(pkgDir, "package.json");
  let pkgJsonText: string;
  try {
    pkgJsonText = await readFile(pkgJsonPath, "utf8");
  } catch (err) {
    throw new Error(`cannot read ${pkgJsonPath}: ${(err as Error).message}`);
  }
  const manifest = JSON.parse(pkgJsonText) as { files?: unknown };
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error(
      `${pkg.name}: package.json must declare a non-empty "files" whitelist ` +
        "(defense against publishing every file under the package dir).",
    );
  }

  const findings: CredentialFinding[] = [];
  // Always scan the manifest itself — a stray "publishToken" or similar
  // field would otherwise sail through the gate.
  await scanOnePath(pkg, pkgDir, pkgJsonPath, findings);

  for (const entry of manifest.files as readonly unknown[]) {
    if (typeof entry !== "string") continue;
    for await (const file of resolveFilesEntry(pkgDir, entry)) {
      await scanOnePath(pkg, pkgDir, file, findings);
    }
  }
  return findings;
}

async function scanOnePath(
  pkg: PublishablePackage,
  pkgDir: string,
  file: string,
  findings: CredentialFinding[],
): Promise<void> {
  const rel = posix.normalize(relative(pkgDir, file).split(/[\\/]/g).join("/"));
  const basename = rel.includes("/") ? rel.slice(rel.lastIndexOf("/") + 1) : rel;
  if (isForbiddenFilename(basename)) {
    findings.push({
      pkg: pkg.name,
      file: rel,
      kind: "filename",
      detail: `forbidden secret-shaped filename "${basename}"`,
    });
    return;
  }
  if (isBinary(rel)) return;
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return; // unreadable or non-UTF-8 — treated as binary
  }
  for (const hit of scanFileContentForCredentials(text)) {
    findings.push({ pkg: pkg.name, file: rel, kind: "content", detail: hit.detail, line: hit.line });
  }
}

async function main(): Promise<void> {
  let total = 0;
  for (const pkg of PUBLISHABLE_PACKAGES) {
    let findings: readonly CredentialFinding[];
    try {
      findings = await findCredentialLeaks(pkg);
    } catch (err) {
      console.error(`verify-no-leaked-credentials: ${(err as Error).message}`);
      process.exitCode = 1;
      continue;
    }
    for (const f of findings) {
      const where = f.line ? `${f.file}:${f.line}` : f.file;
      console.error(`${f.pkg} ${where}: ${f.detail}`);
      total++;
    }
  }
  if (total > 0) {
    console.error(
      `verify-no-leaked-credentials: ${total} credential leak${total === 1 ? "" : "s"} ` +
        "detected in publishable tarball contents. Remove the file or value before " +
        "release (see https://snyk.io/blog/leaked-credentials-in-packages/).",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("verify-no-leaked-credentials.ts")) {
  await main();
}
