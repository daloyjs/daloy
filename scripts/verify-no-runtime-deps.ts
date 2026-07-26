/**
 * Zero-external-runtime-dependency governance gate.
 *
 * Daloy's hard policy: `@daloyjs/core` ships zero entries in the
 * `dependencies` block of `package.json`. Adapter-specific bindings live
 * behind subpath exports as peer dependencies; validator libraries
 * (Zod / Valibot / ArkType / TypeBox) live in `peerDependencies`; build /
 * test tooling lives in `devDependencies`.
 *
 * This script enforces that posture at PR review time so a future
 * contributor cannot quietly add a runtime dep without a SECURITY.md
 * review note.
 *
 * Exit code:
 *   0 — `dependencies` block is empty.
 *   1 — at least one runtime dependency was found; offending names are
 *       printed to stderr.
 *
 * @since 0.27.0
 */

import { readFile } from "node:fs/promises";

interface PackageJsonLike {
  readonly name?: unknown;
  readonly dependencies?: Record<string, unknown>;
}

export function findForbiddenRuntimeDependencies(packageJson: PackageJsonLike): readonly string[] {
  const deps = packageJson.dependencies;
  if (!deps || typeof deps !== "object") return [];
  return Object.keys(deps);
}

async function main(): Promise<void> {
  const text = await readFile(new URL("../package.json", import.meta.url), "utf8");
  const pkg = JSON.parse(text) as PackageJsonLike;
  const offending = findForbiddenRuntimeDependencies(pkg);
  if (offending.length === 0) return;
  console.error(
    `verify-no-runtime-deps: ${offending.length} forbidden runtime ` +
      `dependenc${offending.length === 1 ? "y" : "ies"} in @daloyjs/core/package.json:`
  );
  for (const dep of offending) console.error(`  - ${dep}`);
  console.error(
    "Move adapter bindings to peerDependencies, validators to peerDependencies, " +
      "and build/test tools to devDependencies. If a runtime dep is unavoidable, " +
      "add a SECURITY.md review note justifying the addition."
  );
  process.exitCode = 1;
}

if (process.argv[1]?.endsWith("verify-no-runtime-deps.ts")) {
  await main();
}
