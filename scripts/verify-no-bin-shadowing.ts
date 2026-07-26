/**
 * Socket "bin script confusion" governance gate.
 *
 * Socket's 2022-10-19 write-up
 * (https://socket.dev/blog/npm-bin-script-confusion) documents an
 * attack class — **bin script confusion** / **bin script shell
 * injection** — in which a malicious (or compromised) npm package
 * declares a `bin` field whose key shadows a real shell command, most
 * dangerously `node`, `npm`, `npx`, `pnpm`, `yarn`, `bun`, `deno`,
 * `git`, `sh`, `bash`, `tsc`, `tsx`, etc. Because `npm` / `pnpm`
 * symlinks every transitive `bin` into `node_modules/.bin/` and
 * prepends that directory to `$PATH` while running **any** npm script,
 * a subsequent `pnpm start` / `pnpm test` / `npm run build` silently
 * invokes the attacker's payload instead of the real binary. The
 * widely-cited mitigation `--ignore-scripts` does **not** stop this
 * (the article explicitly calls that out): `bin` symlinks are
 * unrelated to lifecycle hooks.
 *
 * This gate gives Daloy two layers of defence:
 *
 *   1. **Publisher-side**: assert that every published Daloy manifest
 *      (`@daloyjs/core`, `create-daloy`, and every scaffolded template
 *      under `packages/create-daloy/templates/**`) only declares
 *      `bin` keys from a tiny allowlist (`daloy`, `create-daloy`). A
 *      future maintainer who quietly adds a `"node": "evil.mjs"`
 *      entry to a template `package.json` cannot land it — the PR
 *      gate fails.
 *
 *   2. **Workspace-side**: if `node_modules/` exists at audit time
 *      (i.e. CI has run `pnpm install`), walk the installed tree and
 *      fail if any dependency declares a `bin` key whose name
 *      matches a reserved system command. pnpm hoists every
 *      transitive bin into `node_modules/.bin/`, so a typosquat
 *      sitting deep in the graph is just as dangerous as a direct
 *      dep. This catches the supply-chain compromise scenario the
 *      Socket article describes (any transitive dep shadowing
 *      `node`) before a developer's next `pnpm test` triggers it.
 *
 * The allowlist of bin names we ship is intentionally tiny — it is
 * the only safe approach. A `bin: { "daloy": "..." }` entry is fine
 * because nobody else has a system command called `daloy`; a
 * `bin: { "build": "..." }` entry would not shadow a real binary
 * but it does clash with npm-script semantics, so we still flag
 * unknown names so a reviewer is forced to think.
 *
 * Exit code:
 *   0 — every checked manifest is clean.
 *   1 — at least one offending `bin` entry was found; offending
 *       entries are printed to stderr with file + name.
 *
 * @since 0.34.0
 */

import { readdir, readFile, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * System / package-manager command names a malicious `bin` key would
 * shadow on `$PATH`. Sourced from the Socket "bin script confusion"
 * write-up (which calls out `node` and `npm` as the worst offenders)
 * plus the rest of the JS-toolchain commands the framework's CI
 * actually invokes (`pnpm`, `yarn`, `bun`, `deno`, `npx`, `tsc`,
 * `tsx`) and the POSIX shells / source-control / fetch tools an
 * exfiltration payload would reach for (`sh`, `bash`, `zsh`, `git`,
 * `curl`, `wget`, `ssh`, `python`, `python3`).
 */
const RESERVED_COMMANDS = new Set<string>([
  "node",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "bun",
  "deno",
  "tsc",
  "tsx",
  "sh",
  "bash",
  "zsh",
  "fish",
  "dash",
  "git",
  "curl",
  "wget",
  "ssh",
  "scp",
  "python",
  "python3",
  "ruby",
  "perl",
  "java",
  "go",
  "rustc",
  "cargo",
  "make",
  "cmake",
]);

/**
 * Bin names the Daloy project itself is allowed to publish. Anything
 * else in a Daloy manifest is a review-grade surprise even if it
 * doesn't shadow a `RESERVED_COMMANDS` entry.
 */
const PUBLISHED_BIN_ALLOWLIST = new Set<string>(["daloy", "create-daloy"]);

/**
 * Third-party packages legitimately permitted to publish a reserved
 * bin name. The mapping is `{ binName -> allowed package names }`.
 *
 * The Socket write-up specifically calls out that pnpm/npm has a race
 * condition where two packages exporting the same bin produce
 * non-deterministic results — so it is **not** safe to allow `tsc`
 * from any package; it must come from `typescript`. A malicious
 * typosquat that publishes `bin: { tsc: "evil.mjs" }` from a package
 * named `typescriptt` will still be flagged.
 *
 * Add entries here only after manually verifying the upstream package
 * legitimately owns the binary name.
 */
const THIRD_PARTY_BIN_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  tsc: ["typescript"],
  tsx: ["tsx"],
};

interface PackageJsonLike {
  readonly name?: unknown;
  readonly bin?: unknown;
}

export interface BinViolation {
  readonly manifest: string;
  readonly packageName: string;
  readonly binName: string;
  readonly reason: "reserved" | "not-allowlisted";
}

/**
 * Extracts the set of `bin` entry names from a parsed manifest.
 * Supports both the object form (`{ "daloy": "bin/daloy.mjs" }`) and
 * the string form (`"bin": "cli.mjs"`, which uses the package's
 * `name` as the bin key per npm's spec).
 */
export function extractBinNames(pkg: PackageJsonLike): readonly string[] {
  const bin = pkg.bin;
  if (typeof bin === "string") {
    const name = typeof pkg.name === "string" ? pkg.name : "";
    const trimmed = name.startsWith("@") ? (name.split("/")[1] ?? name) : name;
    return trimmed ? [trimmed] : [];
  }
  if (bin && typeof bin === "object" && !Array.isArray(bin)) {
    return Object.keys(bin as Record<string, unknown>);
  }
  return [];
}

/**
 * Classifies a `bin` key against the RESERVED_COMMANDS list and the
 * project's PUBLISHED_BIN_ALLOWLIST. `enforceAllowlist` is true only
 * for manifests *we* ship — for third-party `node_modules` entries
 * we only care about the reserved-command shadow. `packageName` is
 * the `name` field of the declaring package, used to honour the
 * `THIRD_PARTY_BIN_ALLOWLIST` mapping.
 */
export function classifyBinName(
  binName: string,
  enforceAllowlist: boolean,
  packageName?: string
): BinViolation["reason"] | null {
  if (RESERVED_COMMANDS.has(binName)) {
    if (!enforceAllowlist) {
      const allowed = THIRD_PARTY_BIN_ALLOWLIST[binName];
      if (allowed && packageName && allowed.includes(packageName)) return null;
    }
    return "reserved";
  }
  if (enforceAllowlist && !PUBLISHED_BIN_ALLOWLIST.has(binName)) {
    return "not-allowlisted";
  }
  return null;
}

/**
 * Walks a directory tree of installed packages (pnpm or npm layout)
 * and yields the path of every `package.json` belonging to a
 * dependency. Depth is capped so a pathological tree cannot hang CI.
 */
async function* walkManifests(root: string, depth = 0): AsyncGenerator<string> {
  if (depth > 8) return;
  let entries: Dirent<string>[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (name === ".bin" || name === ".pnpm-store") continue;
    const child = join(root, name);
    if (name.startsWith("@")) {
      yield* walkManifests(child, depth + 1);
      continue;
    }
    if (name === ".pnpm" || name === "node_modules") {
      yield* walkManifests(child, depth + 1);
      continue;
    }
    const manifest = join(child, "package.json");
    try {
      const s = await stat(manifest);
      if (s.isFile()) yield manifest;
    } catch {
      /* not a package dir */
    }
    // Recurse to catch nested node_modules (npm hoisting fallback).
    yield* walkManifests(join(child, "node_modules"), depth + 1);
  }
}

async function checkManifest(
  path: string,
  enforceAllowlist: boolean
): Promise<readonly BinViolation[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return [];
  }
  let pkg: PackageJsonLike;
  try {
    pkg = JSON.parse(text) as PackageJsonLike;
  } catch {
    return [];
  }
  const names = extractBinNames(pkg);
  if (names.length === 0) return [];
  const pkgName = typeof pkg.name === "string" ? pkg.name : "(unknown)";
  const violations: BinViolation[] = [];
  for (const binName of names) {
    const reason = classifyBinName(binName, enforceAllowlist, pkgName);
    if (reason) violations.push({ manifest: path, packageName: pkgName, binName, reason });
  }
  return violations;
}

const PUBLISHED_MANIFESTS: readonly string[] = [
  "../package.json",
  "../packages/create-daloy/package.json",
];

async function findTemplateManifests(): Promise<readonly string[]> {
  const root = new URL("../packages/create-daloy/templates/", import.meta.url);
  const out: string[] = [];
  let entries: Dirent<string>[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = new URL(`${entry.name}/package.json`, root);
    try {
      const s = await stat(candidate);
      if (s.isFile()) out.push(fileURLToPath(candidate));
    } catch {
      /* template has no package.json (e.g. deno-basic uses deno.json) */
    }
  }
  return out;
}

async function main(): Promise<void> {
  const violations: BinViolation[] = [];

  // Layer 1: our own published manifests + every scaffolded template.
  for (const rel of PUBLISHED_MANIFESTS) {
    const url = new URL(rel, import.meta.url);
    violations.push(...(await checkManifest(fileURLToPath(url), true)));
  }
  for (const path of await findTemplateManifests()) {
    violations.push(...(await checkManifest(path, true)));
  }

  // Layer 2: installed dependency tree, if present. Skipped silently
  // when node_modules doesn't exist (e.g. on a freshly cloned dev box
  // running this script before `pnpm install`).
  const nodeModules = fileURLToPath(new URL("../node_modules/", import.meta.url));
  try {
    const s = await stat(nodeModules);
    if (s.isDirectory()) {
      for await (const manifest of walkManifests(nodeModules)) {
        violations.push(...(await checkManifest(manifest, false)));
      }
    }
  } catch {
    /* no node_modules to scan */
  }

  if (violations.length === 0) return;
  console.error(
    `verify-no-bin-shadowing: ${violations.length} forbidden ` +
      `bin entr${violations.length === 1 ? "y" : "ies"} detected ` +
      "(Socket bin-script-confusion gate):"
  );
  for (const v of violations) {
    const why =
      v.reason === "reserved"
        ? `shadows reserved system command \`${v.binName}\``
        : `bin name \`${v.binName}\` is not on the Daloy publish allowlist`;
    console.error(`  - ${v.packageName}: ${why} (${v.manifest})`);
  }
  console.error(
    "A bin key whose name matches a real shell command (node, npm, npx, " +
      "pnpm, yarn, bun, deno, sh, bash, git, curl, ...) hijacks `$PATH` " +
      "inside every subsequent npm script, even with `--ignore-scripts`. " +
      "See https://socket.dev/blog/npm-bin-script-confusion. If a new bin " +
      "is genuinely required, add it to PUBLISHED_BIN_ALLOWLIST in " +
      "scripts/verify-no-bin-shadowing.ts with a SECURITY.md review note."
  );
  process.exitCode = 1;
}

if (process.argv[1]?.endsWith("verify-no-bin-shadowing.ts")) {
  await main();
}
