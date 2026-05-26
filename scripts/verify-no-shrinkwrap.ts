/**
 * Socket "npm shrinkwrap" governance gate.
 *
 * Socket's 2024-08-09 write-up
 * (https://socket.dev/blog/understanding-the-security-concerns-of-npm-shrinkwrap)
 * documents `npm-shrinkwrap.json` as a high-severity supply-chain
 * risk: unlike `package-lock.json`, an `npm-shrinkwrap.json` file
 * **is published with the package** and, when present at the package
 * root, takes precedence over any consumer's `package-lock.json` on
 * `npm install`. That single file lets a published package:
 *
 *   - lock every transitive dependency to a specific (potentially
 *     unsigned, potentially malicious) version that bypasses the
 *     consumer's own resolver constraints,
 *   - point a transitive at a non-`registry.npmjs.org` tarball URL
 *     (and historically, an HTTP URL — npm warned in 2016 that this
 *     enables MITM RCE: see
 *     https://blog.npmjs.org/post/154400916805/avoid-http-urls-in-shrinkwrap-files.html),
 *   - silently freeze a known-vulnerable transitive forever even
 *     after the consumer updates their direct deps,
 *   - hide install-tree changes from most SCA tools, which scan
 *     `package-lock.json` and `pnpm-lock.yaml` but not shrinkwrap.
 *
 * `pnpm` itself ignores `npm-shrinkwrap.json` from dependencies (it
 * uses its own `pnpm-lock.yaml`), so DaloyJS's own install path is
 * safe from a transitive dep that ships one. But:
 *
 *   1. A contributor who accidentally runs `npm shrinkwrap` in the
 *      DaloyJS repo and commits the file would silently override the
 *      pnpm posture for **any** consumer who installs `@daloyjs/core`
 *      with plain `npm install` (or whose CI does so). This gate
 *      refuses to ship in that state.
 *   2. The `create-daloy` scaffolder ships templates verbatim to user
 *      projects; if any template ever included an `npm-shrinkwrap.json`,
 *      a scaffolded user project would inherit a shrinkwrap they
 *      never asked for. This gate fails the build before publish if
 *      that ever sneaks into a template directory.
 *   3. Any committed `package.json` that *adds* `npm-shrinkwrap.json`
 *      to its `files` allowlist is rejected, so a publish cannot be
 *      tricked into shipping one even if it appears in a checkout.
 *
 * The framework's own published `files` allowlist (`@daloyjs/core`:
 * `dist`, `bin`, `README.md`; `create-daloy`: `bin`, `templates`,
 * `README.md`, SBOMs) already prevents a stray shrinkwrap from
 * leaking out — this gate makes that property *enforced*, not
 * merely incidental, so a future "convenience" change cannot quietly
 * regress it.
 *
 * Exit code:
 *   0 — no `npm-shrinkwrap.json` anywhere in the working tree and
 *       no `package.json` lists one in its `files` allowlist.
 *   1 — at least one offending file or manifest entry was found;
 *       the offending paths are printed to stderr.
 *
 * @since 0.35.1
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

export interface ShrinkwrapViolation {
  readonly path: string;
  readonly reason:
    | "committed shrinkwrap file"
    | "manifest files allowlist includes npm-shrinkwrap.json"
    | "manifest scripts reference npm shrinkwrap command";
}

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);

/**
 * Directories we never recurse into when scanning for a stray
 * `npm-shrinkwrap.json`. These either contain third-party content
 * (`node_modules`) or generated/cache output that may legitimately
 * embed the string in a `package.json` of a transitive dep.
 */
const SKIP_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "dist-coverage",
  "coverage",
  ".pnpm-store",
  ".next",
  ".vercel",
  ".turbo",
  ".cache",
  "temp_tarball",
]);

/**
 * Walks the working tree from `root` and yields the absolute path of
 * every regular file, skipping {@link SKIP_DIRECTORIES}. Symlinks are
 * not followed to keep the walk bounded.
 */
async function* walkFiles(root: string, depth = 0): AsyncGenerator<string> {
  if (depth > 12) return;
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const child = join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      yield* walkFiles(child, depth + 1);
      continue;
    }
    if (entry.isFile()) yield child;
  }
}

interface PackageJsonLike {
  readonly files?: unknown;
  readonly scripts?: unknown;
}

/**
 * Inspect a parsed `package.json` for the two non-file shrinkwrap
 * regressions we care about:
 *
 *   - `files` lists `npm-shrinkwrap.json` (which would unlock
 *     publishing one even if the framework's restrictive allowlist
 *     is loosened in a future edit).
 *   - `scripts` invokes `npm shrinkwrap` (which would generate one
 *     on demand inside CI or in a developer workflow).
 */
export function findShrinkwrapManifestIssues(
  manifest: PackageJsonLike,
): readonly ShrinkwrapViolation["reason"][] {
  const issues: ShrinkwrapViolation["reason"][] = [];
  const files = manifest.files;
  if (Array.isArray(files)) {
    for (const entry of files) {
      if (typeof entry === "string" && entry.trim() === "npm-shrinkwrap.json") {
        issues.push("manifest files allowlist includes npm-shrinkwrap.json");
        break;
      }
    }
  }
  const scripts = manifest.scripts;
  if (scripts && typeof scripts === "object" && !Array.isArray(scripts)) {
    for (const value of Object.values(scripts as Record<string, unknown>)) {
      if (typeof value !== "string") continue;
      // Match `npm shrinkwrap` as a whole word so a script literally
      // documenting the gate (e.g. `verify:no-shrinkwrap`) does not
      // self-trip. The trailing boundary is `$` or whitespace / `&` /
      // `;` / `|` so any chained form is still caught.
      if (/(?:^|[\s&;|])npm\s+shrinkwrap(?:$|[\s&;|])/i.test(value)) {
        issues.push("manifest scripts reference npm shrinkwrap command");
        break;
      }
    }
  }
  return issues;
}

async function main(): Promise<void> {
  const violations: ShrinkwrapViolation[] = [];

  for await (const file of walkFiles(REPO_ROOT)) {
    const base = file.slice(file.lastIndexOf("/") + 1);
    if (base === "npm-shrinkwrap.json") {
      violations.push({
        path: relative(REPO_ROOT, file),
        reason: "committed shrinkwrap file",
      });
      continue;
    }
    if (base !== "package.json") continue;
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    let parsed: PackageJsonLike;
    try {
      parsed = JSON.parse(text) as PackageJsonLike;
    } catch {
      continue;
    }
    for (const reason of findShrinkwrapManifestIssues(parsed)) {
      violations.push({ path: relative(REPO_ROOT, file), reason });
    }
  }

  if (violations.length === 0) return;
  for (const v of violations) {
    console.error(`${v.path}: ${v.reason}`);
  }
  process.exitCode = 1;
}

/**
 * Tolerant `require.main === module` check that works under both
 * `tsx` (which appends `.ts`) and the compiled `dist-coverage` build
 * (which appends `.js`).
 */
if (
  process.argv[1]?.endsWith("verify-no-shrinkwrap.ts") ||
  process.argv[1]?.endsWith("verify-no-shrinkwrap.js")
) {
  await main();
}

// Re-export internals for unit testing without invoking main().
export const __internal = { REPO_ROOT, SKIP_DIRECTORIES, walkFiles };
