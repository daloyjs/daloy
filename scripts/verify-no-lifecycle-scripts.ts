/**
 * Aikido Package Health "Supply-Chain Scripts" governance gate.
 *
 * Aikido's Package Health Score
 * (https://www.aikido.dev/blog/introducing-aikido-package-health) weighs five
 * categories; one of them — **Supply-Chain Scripts** — penalises any
 * install-time lifecycle script declared by a published package, because
 * lifecycle hooks are the primary execution channel for npm worm campaigns
 * (chalk/debug, node-ipc, Shai-Hulud, etc.).
 *
 * Daloy's published packages (`@daloyjs/core`, `create-daloy`) must therefore
 * declare **zero** install-time lifecycle hooks. This script enforces that
 * posture at PR review time so a future contributor cannot quietly add a
 * `postinstall` without a `SECURITY.md` review note.
 *
 * Forbidden hooks (npm runs these on `pnpm install` for the consumer):
 *   - preinstall
 *   - install
 *   - postinstall
 *   - prepare           (runs on `git+` installs and locally on `pnpm install`)
 *   - preprepare
 *   - postprepare
 *   - prepublish        (deprecated alias of `prepare` for older clients)
 *
 * Permitted hooks (maintainer-side only, never run by consumers of the
 * published tarball):
 *   - prepublishOnly    (runs only when *we* publish; the consumer's
 *                        install never invokes it)
 *   - any script under arbitrary names (`build`, `test`, `verify:*`, …) —
 *                        these are only run by humans / CI explicitly
 *
 * Exit code:
 *   0 — every checked package.json is clean.
 *   1 — at least one forbidden hook was found; offending entries are
 *       printed to stderr.
 *
 * @since 0.33.0
 */

import { readdir, readFile } from "node:fs/promises";

const FORBIDDEN_HOOKS = [
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "preprepare",
  "postprepare",
  "prepublish",
  // pnpm runs this before every install in the project that declares it.
  "pnpm:devPreinstall",
] as const;

const CHECKED_MANIFESTS: readonly string[] = [
  "../package.json",
  "../packages/create-daloy/package.json",
];

interface PackageJsonLike {
  readonly name?: unknown;
  readonly scripts?: Record<string, unknown>;
}

export function findForbiddenLifecycleScripts(packageJson: PackageJsonLike): readonly string[] {
  const scripts = packageJson.scripts;
  if (!scripts || typeof scripts !== "object") return [];
  return FORBIDDEN_HOOKS.filter((hook) => Object.prototype.hasOwnProperty.call(scripts, hook));
}

/**
 * Template manifests ship inside `create-daloy` and become the user's own
 * `package.json`, where an install hook would run on their machine.
 *
 * @returns Paths (relative to this script) of every template `package.json`.
 * @throws Error when no template manifest is found, so a moved templates
 *   directory cannot turn this check into a silent pass.
 */
async function templateManifests(): Promise<string[]> {
  const base = "../packages/create-daloy/templates/";
  const entries = await readdir(new URL(base, import.meta.url), { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const rel = `${base}${entry.name}/package.json`;
    const exists = await readFile(new URL(rel, import.meta.url), "utf8").then(
      () => true,
      () => false,
    );
    if (exists) found.push(rel);
  }
  if (found.length === 0) {
    throw new Error("verify-no-lifecycle-scripts: no template package.json found to check.");
  }
  return found;
}

async function main(): Promise<void> {
  let failed = 0;
  for (const relPath of [...CHECKED_MANIFESTS, ...(await templateManifests())]) {
    const url = new URL(relPath, import.meta.url);
    const text = await readFile(url, "utf8");
    const pkg = JSON.parse(text) as PackageJsonLike;
    const offending = findForbiddenLifecycleScripts(pkg);
    if (offending.length === 0) continue;
    const name = typeof pkg.name === "string" ? pkg.name : relPath;
    failed += offending.length;
    console.error(
      `verify-no-lifecycle-scripts: ${offending.length} forbidden ` +
        `install-time lifecycle script${offending.length === 1 ? "" : "s"} ` +
        `in ${name} (${relPath}):`
    );
    for (const hook of offending) console.error(`  - ${hook}`);
  }
  if (failed === 0) return;
  console.error(
    "Install-time lifecycle hooks (preinstall, install, postinstall, prepare, " +
      "preprepare, postprepare, prepublish) are the primary execution channel " +
      "for npm worm campaigns and are penalised by Aikido Package Health. If a " +
      "hook is unavoidable, add a SECURITY.md review note justifying it. " +
      "Maintainer-side `prepublishOnly` is fine — it never runs on a consumer's " +
      "install."
  );
  process.exitCode = 1;
}

if (process.argv[1]?.endsWith("verify-no-lifecycle-scripts.ts")) {
  await main();
}
