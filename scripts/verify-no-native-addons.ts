/**
 * Snyk "Vulnerabilities in NodeJS C/C++ add-on extensions" CI grep gate.
 *
 * Snyk's 2024 research paper
 * (https://snyk.io/blog/nodejs-add-on-extensions/) catalogues the
 * vulnerability classes that ship with native Node.js add-ons built
 * via `node_api.h` / `napi.h` / `node-addon-api`: buffer overflow,
 * integer overflow, unchecked types (DoS), reachable assertions
 * (DoS), unhandled C++ exceptions (DoS), and memory leaks
 * (information disclosure). The vulnerable surface is the C/C++ code
 * itself — JavaScript-only consumers cannot defend against an OOB
 * read inside a `.node` binary except by **not loading it**.
 *
 * Daloy treats native add-ons as a class we do not ship and do not
 * pull in transitively. The framework guarantee is:
 *
 *  1. `@daloyjs/core` and `create-daloy` declare zero runtime
 *     dependencies (`scripts/verify-no-runtime-deps.ts`), so a
 *     `pnpm install @daloyjs/core` cannot pull a native add-on
 *     transitively.
 *  2. None of our `package.json`s — root, `packages/create-daloy`,
 *     or any scaffolded template — depends on the build-toolchain
 *     packages used to assemble or load `.node` binaries
 *     (`node-gyp`, `node-pre-gyp`, `@mapbox/node-pre-gyp`,
 *     `node-gyp-build`, `prebuild`, `prebuildify`, `prebuild-install`,
 *     `bindings`, `nan`, `node-addon-api`).
 *  3. The repo contains no `binding.gyp` (the node-gyp build manifest)
 *     and no `.node` binaries (the compiled add-on output).
 *  4. No `package.json` declares `"gypfile": true`, which is the
 *     opt-in flag that tells npm to invoke `node-gyp rebuild` on
 *     install.
 *
 * Together these close the Snyk add-on vulnerability surface for
 * every machine that runs `pnpm install @daloyjs/core` or
 * `pnpm create daloy`. A future contributor who wants to add a
 * native dependency to a scaffolded template (e.g. `better-sqlite3`)
 * must either justify it in `SECURITY.md` and extend the allowlist
 * here, or — much better — pick a pure-JS alternative.
 *
 * Exit code:
 *   0 — no native-addon toolchain dep, no `binding.gyp`, no `.node`
 *       binary, and no `gypfile: true` anywhere in the repo.
 *   1 — at least one finding; offending locations are printed to
 *       stderr.
 *
 * @since 0.46.0
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = new URL("../", import.meta.url);

/**
 * Packages this gate refuses to allow anywhere in the repo. Each entry
 * is part of the Node.js native-addon build or load toolchain — i.e.
 * its presence is strong evidence that a `.node` binary is being
 * compiled at install time, downloaded from a prebuild host, or
 * `require()`d at runtime. See the Snyk write-up at
 * https://snyk.io/blog/nodejs-add-on-extensions/ for the vulnerability
 * classes these binaries expose.
 */
export const FORBIDDEN_NATIVE_ADDON_PACKAGES: readonly string[] = [
  "node-gyp",
  "node-pre-gyp",
  "@mapbox/node-pre-gyp",
  "node-gyp-build",
  "prebuild",
  "prebuildify",
  "prebuild-install",
  "bindings",
  "nan",
  "node-addon-api",
];

export interface NativeAddonFinding {
  readonly file: string;
  readonly reason: string;
}

interface PackageJsonLike {
  readonly dependencies?: Record<string, unknown>;
  readonly devDependencies?: Record<string, unknown>;
  readonly peerDependencies?: Record<string, unknown>;
  readonly optionalDependencies?: Record<string, unknown>;
  readonly bundledDependencies?: readonly unknown[];
  readonly bundleDependencies?: readonly unknown[];
  readonly gypfile?: unknown;
  readonly binary?: unknown;
}

const DEP_BUCKETS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/**
 * Inspect a parsed `package.json` for any direct dependency on a
 * forbidden native-addon toolchain package (across all dep buckets and
 * `bundledDependencies`), plus the `"gypfile": true` opt-in and the
 * `"binary"` block used by `node-pre-gyp` / `prebuild-install` to
 * download `.node` artifacts at install time.
 */
export function findNativeAddonsInPackageJson(
  file: string,
  pkg: PackageJsonLike
): readonly NativeAddonFinding[] {
  const out: NativeAddonFinding[] = [];
  for (const bucket of DEP_BUCKETS) {
    const deps = pkg[bucket];
    if (!deps || typeof deps !== "object") continue;
    for (const name of Object.keys(deps)) {
      if (FORBIDDEN_NATIVE_ADDON_PACKAGES.includes(name)) {
        out.push({
          file,
          reason: `\`${name}\` listed in \`${bucket}\` (Node.js native-addon toolchain — see https://snyk.io/blog/nodejs-add-on-extensions/)`,
        });
      }
    }
  }
  const bundled = pkg.bundledDependencies ?? pkg.bundleDependencies;
  if (Array.isArray(bundled)) {
    for (const name of bundled) {
      if (typeof name === "string" && FORBIDDEN_NATIVE_ADDON_PACKAGES.includes(name)) {
        out.push({
          file,
          reason: `\`${name}\` listed in \`bundledDependencies\` (Node.js native-addon toolchain)`,
        });
      }
    }
  }
  if (pkg.gypfile === true) {
    out.push({
      file,
      reason: '`"gypfile": true` opts the package into `node-gyp rebuild` at install time',
    });
  }
  if (pkg.binary && typeof pkg.binary === "object") {
    out.push({
      file,
      reason:
        '`"binary"` block declared (downloads a `.node` artifact at install time via node-pre-gyp / prebuild-install)',
    });
  }
  return out;
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "dist-coverage",
  "coverage",
  "temp_tarball",
  "generated",
]);

async function* walkRepo(dir: URL): AsyncGenerator<{
  readonly absolute: string;
  readonly name: string;
}> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    if (entry.isDirectory()) {
      yield* walkRepo(child);
    } else if (entry.isFile()) {
      yield { absolute: fileURLToPath(child), name: entry.name };
    }
  }
}

async function main(): Promise<void> {
  const findings: NativeAddonFinding[] = [];

  for await (const file of walkRepo(REPO_ROOT)) {
    const rel = relative(fileURLToPath(REPO_ROOT), file.absolute).replaceAll("\\", "/");
    if (file.name === "package.json") {
      const text = await readFile(file.absolute, "utf8");
      let parsed: PackageJsonLike;
      try {
        parsed = JSON.parse(text) as PackageJsonLike;
      } catch {
        continue;
      }
      findings.push(...findNativeAddonsInPackageJson(rel, parsed));
    } else if (file.name === "binding.gyp") {
      findings.push({
        file: rel,
        reason:
          "`binding.gyp` is the node-gyp build manifest; its presence means a `.node` binary will be compiled at install time",
      });
    } else if (file.name.endsWith(".node")) {
      findings.push({
        file: rel,
        reason:
          "`.node` binary committed to the repo (compiled C/C++ add-on — see https://snyk.io/blog/nodejs-add-on-extensions/)",
      });
    }
  }

  const lockfilePath = fileURLToPath(new URL("pnpm-lock.yaml", REPO_ROOT));
  try {
    const stats = await stat(lockfilePath);
    if (stats.isFile()) {
      const lock = await readFile(lockfilePath, "utf8");
      findings.push(...findNativeAddonsInLockfile("pnpm-lock.yaml", lock));
    }
  } catch {
    /* no lockfile is not this gate's problem */
  }

  if (findings.length === 0) return;
  console.error(
    `verify-no-native-addons: ${findings.length} native-addon ` +
      `finding${findings.length === 1 ? "" : "s"}:`
  );
  for (const f of findings) {
    console.error(`  - ${f.file}: ${f.reason}`);
  }
  console.error(
    "Native Node.js add-ons expose buffer overflow, integer overflow, " +
      "unchecked-type DoS, reachable-assert DoS, unhandled-exception DoS, " +
      "and memory-leak information-disclosure surface that pure-JS code " +
      "cannot defend against (see https://snyk.io/blog/nodejs-add-on-extensions/). " +
      "`@daloyjs/core` and `create-daloy` therefore ship zero native " +
      "dependencies. If a future feature genuinely needs one, justify the " +
      "addition in SECURITY.md and extend the allowlist in this gate."
  );
  process.exitCode = 1;
}

/**
 * Scan a `pnpm-lock.yaml` for resolved versions of any forbidden
 * native-addon toolchain package. Mirrors the lockfile-scan style used
 * by `verify-no-vulnerable-sandboxes.ts` so the trust model is
 * identical: we look for `<name>@<digit>` keys at snapshot boundaries,
 * not arbitrary substrings, which avoids false positives on
 * coincidentally-named packages (e.g. `bindings-foo`, `nan-utils`).
 */
export function findNativeAddonsInLockfile(
  file: string,
  source: string
): readonly NativeAddonFinding[] {
  const out: NativeAddonFinding[] = [];
  const lines = source.split(/\r?\n/);
  for (const name of FORBIDDEN_NATIVE_ADDON_PACKAGES) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(String.raw`(?:^|[\s'"/])` + escaped + String.raw`@\d`);
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i]!)) {
        out.push({
          file: `${file}:${i + 1}`,
          reason: `\`${name}\` resolved in lockfile (Node.js native-addon toolchain)`,
        });
        break;
      }
    }
  }
  return out;
}

if (process.argv[1]?.endsWith("verify-no-native-addons.ts")) {
  await main();
}
