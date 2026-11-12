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
  readonly optionalDependencies?: Record<string, unknown>;
  readonly peerDependencies?: Record<string, unknown>;
  readonly peerDependenciesMeta?: Record<string, { optional?: unknown } | undefined>;
  readonly bundledDependencies?: unknown;
  readonly bundleDependencies?: unknown;
}

/**
 * List every dependency a consumer's install would pull in for this package.
 *
 * `dependencies` is the obvious block, but `optionalDependencies` and
 * non-optional `peerDependencies` are installed automatically too (npm >= 7
 * auto-installs peers), and `bundledDependencies` ships third-party code
 * inside the tarball. Any of them would break the zero-runtime-deps promise
 * while leaving `dependencies` empty. A peer marked `optional` in
 * `peerDependenciesMeta` is not installed automatically and is allowed.
 *
 * @param packageJson - Parsed `package.json`.
 * @returns Offending entries, prefixed with their block when it is not
 *   `dependencies`; empty when the package has no runtime dependencies.
 */
export function findForbiddenRuntimeDependencies(packageJson: PackageJsonLike): readonly string[] {
  const out: string[] = [];
  const keysOf = (block: unknown): string[] =>
    block && typeof block === "object" && !Array.isArray(block) ? Object.keys(block) : [];
  out.push(...keysOf(packageJson.dependencies));
  for (const name of keysOf(packageJson.optionalDependencies)) {
    out.push(`optionalDependencies: ${name}`);
  }
  const meta = packageJson.peerDependenciesMeta;
  for (const name of keysOf(packageJson.peerDependencies)) {
    if (meta?.[name]?.optional === true) continue;
    out.push(`peerDependencies (not optional): ${name}`);
  }
  for (const field of ["bundledDependencies", "bundleDependencies"] as const) {
    const bundled = packageJson[field];
    if (Array.isArray(bundled)) {
      for (const name of bundled) out.push(`${field}: ${String(name)}`);
    } else if (bundled === true) {
      out.push(`${field}: true`);
    }
  }
  return out;
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
