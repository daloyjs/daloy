#!/usr/bin/env node
// Build the local Daloy checkout before a cross-framework benchmark and fail
// closed if pnpm currently resolves @daloyjs/core from somewhere else. This
// keeps stale dist output or a node_modules directory copied from another
// checkout from silently producing misleading benchmark results.

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BENCH_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = realpathSync.native(path.resolve(BENCH_ROOT, "../.."));
const EXPECTED_DIST = path.join(REPO_ROOT, "dist");

// The root build script is `tsc -p tsconfig.build.json`. Invoke that exact
// compiler and config without starting pnpm's package-manager version check,
// which may require network access and would add unrelated pre-benchmark noise.
// Resolve the compiler through the repo root's own module resolution so this
// keeps working wherever pnpm hoists `typescript` rather than assuming a fixed
// `node_modules/typescript` layout.
let tscEntry;
try {
  // `typescript/bin/tsc` is not an exported subpath, so resolve the package's
  // manifest and derive the CLI entry from its directory instead.
  const tsPackageJson = createRequire(path.join(REPO_ROOT, "package.json")).resolve(
    "typescript/package.json"
  );
  tscEntry = path.join(path.dirname(tsPackageJson), "bin", "tsc");
} catch (error) {
  console.error("[bench] Cannot locate the TypeScript compiler in the repo root.");
  console.error("[bench] Run `pnpm install` at the repository root, then try again.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
console.error(`[bench] Building local @daloyjs/core from ${REPO_ROOT}`);
execFileSync(process.execPath, [tscEntry, "-p", "tsconfig.build.json"], {
  cwd: REPO_ROOT,
  stdio: "inherit",
});

let resolvedEntry;
try {
  resolvedEntry = realpathSync.native(fileURLToPath(import.meta.resolve("@daloyjs/core")));
} catch (error) {
  console.error("[bench] Cannot resolve the local @daloyjs/core dependency.");
  console.error("[bench] Run `pnpm install` in bench/cross-framework, then try again.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const relativeEntry = path.relative(EXPECTED_DIST, resolvedEntry);
const resolvesFromCurrentDist =
  relativeEntry !== "" &&
  relativeEntry !== ".." &&
  !relativeEntry.startsWith(`..${path.sep}`) &&
  !path.isAbsolute(relativeEntry);

if (!resolvesFromCurrentDist) {
  console.error(`[bench] Refusing to benchmark @daloyjs/core from: ${resolvedEntry}`);
  console.error(`[bench] Expected it to resolve inside: ${EXPECTED_DIST}`);
  console.error(
    "[bench] Repair the local link with `pnpm install --force` in bench/cross-framework."
  );
  process.exit(1);
}

console.error(`[bench] Using ${resolvedEntry}`);
