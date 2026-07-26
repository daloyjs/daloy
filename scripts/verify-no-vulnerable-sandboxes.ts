/**
 * Vulnerable-JS-sandbox CI grep gate.
 *
 * The Socket Research Team published certified patches for a critical
 * sandbox escape in `vm2` (CVE-2026-26956 / GHSA-ffh4-j6h5-pg66, see
 * https://socket.dev/blog/free-certified-patches-for-critical-vm2-sandbox-escape).
 * Socket's testing confirmed the exploit across 66 releases of `vm2`
 * (0.2.2 through 3.10.4) on any Node.js version that exposes
 * `WebAssembly.JSTag` — which now includes the supported Node 24 / 25
 * lines. Attacker-controlled JavaScript reaching `VM.run()` can escape
 * the sandbox, grab the host `process` object, and execute arbitrary
 * OS commands.
 *
 * `vm2` has a long history of sandbox escapes and has been deprecated
 * by its author. The lesson is broader than one CVE: every in-process
 * "sandbox" library that tries to wall off untrusted JS using the same
 * V8 isolate as the host has eventually been broken. The same class
 * includes eval-wrapping *deserializers* that revive functions from a
 * string format — most famously `node-serialize` (CVE-2017-5941: a
 * payload tagged `_$$ND_FUNC$$_` is fed straight into `eval`, turning
 * any reachable `unserialize()` call on user input into RCE), the
 * historically vulnerable `serialize-to-js`, and `funcster` (which
 * round-trips JavaScript functions by `eval`ing the serialized body on
 * deserialize — the same RCE-on-decode shape). See
 * https://snyk.io/blog/preventing-insecure-deserialization-node-js/.
 * The same class is what attackers exploited in Microsoft SharePoint
 * CVE-2026-45659 (deserialization of untrusted data → RCE for any
 * authenticated Site Member); see
 * https://msrc.microsoft.com/update-guide/vulnerability/CVE-2026-45659.
 *
 * Daloy treats this combined class — `vm2`, `vm2-sandbox-escape`,
 * `safe-eval`, `notevil`, `static-eval`, `eval-sandbox`,
 * `node-serialize`, `serialize-to-js`, `funcster` — as forbidden direct
 * dependencies, in any `package.json` shipped from this repo (core,
 * `create-daloy`, and every scaffolded template), and additionally
 * refuses to resolve them at the root lockfile level so they cannot
 * slip in transitively under a renamed alias. Daloy core itself
 * deserializes user input with `safeJsonParse` (which strips
 * `__proto__` / `constructor` / `prototype`) and never deserializes
 * functions; see `src/security.ts`.
 *
 * Daloy core already declares zero runtime dependencies
 * (`scripts/verify-no-runtime-deps.ts`), so the only realistic ways one
 * of these packages could reach a user are (a) a scaffolded template
 * adding it, or (b) a transitive dep pulling it in. This gate catches
 * both at PR-review time, before any release runs.
 *
 * For untrusted code execution, users should rely on real isolation
 * boundaries (separate processes / containers / `isolated-vm` with a
 * fresh isolate, or a serverless edge sandbox), not in-process tricks.
 *
 * Exit code:
 *   0 — no forbidden sandbox package found in any tracked `package.json`
 *       and the root `pnpm-lock.yaml` does not resolve any of them.
 *   1 — at least one forbidden sandbox package was found; offending
 *       locations are printed to stderr.
 *
 * @since 0.45.0
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = new URL("../", import.meta.url);

/**
 * Packages this gate refuses to allow anywhere in the repo. Keep the
 * list short and well-justified: every entry must be a JS sandbox,
 * eval-wrapper, or eval-wrapping deserializer library with a
 * documented history of sandbox escapes or arbitrary-code-execution
 * CVEs.
 */
export const FORBIDDEN_SANDBOX_PACKAGES: readonly string[] = [
  "vm2",
  "vm2-sandbox-escape",
  "safe-eval",
  "notevil",
  "static-eval",
  "eval-sandbox",
  // Eval-wrapping deserializers: `unserialize()` evals function payloads.
  // See https://snyk.io/blog/preventing-insecure-deserialization-node-js/
  "node-serialize",
  "serialize-to-js",
  // `funcster` round-trips JavaScript functions by stringifying them on
  // serialize and `eval`ing the body on deserialize — the same
  // RCE-on-decode shape as `node-serialize`, and the Node analog of the
  // .NET BinaryFormatter / SOAP deserialization RCE class behind
  // Microsoft SharePoint CVE-2026-45659.
  "funcster",
];

export interface SandboxFinding {
  readonly file: string;
  readonly packageName: string;
  readonly reason: string;
}

interface PackageJsonLike {
  readonly dependencies?: Record<string, unknown>;
  readonly devDependencies?: Record<string, unknown>;
  readonly peerDependencies?: Record<string, unknown>;
  readonly optionalDependencies?: Record<string, unknown>;
  readonly bundledDependencies?: readonly unknown[];
  readonly bundleDependencies?: readonly unknown[];
}

const DEP_BUCKETS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/**
 * Inspect a parsed `package.json` for any direct dependency entry
 * (across all dep buckets, plus `bundledDependencies` arrays) on a
 * forbidden sandbox package. Returned findings include the file path
 * passed in so the caller can aggregate across the whole repo.
 */
export function findForbiddenSandboxesInPackageJson(
  file: string,
  pkg: PackageJsonLike
): readonly SandboxFinding[] {
  const out: SandboxFinding[] = [];
  for (const bucket of DEP_BUCKETS) {
    const deps = pkg[bucket];
    if (!deps || typeof deps !== "object") continue;
    for (const name of Object.keys(deps)) {
      if (FORBIDDEN_SANDBOX_PACKAGES.includes(name)) {
        out.push({
          file,
          packageName: name,
          reason: `\`${name}\` listed in \`${bucket}\` (known vulnerable JS sandbox or eval-wrapping deserializer)`,
        });
      }
    }
  }
  const bundled = pkg.bundledDependencies ?? pkg.bundleDependencies;
  if (Array.isArray(bundled)) {
    for (const name of bundled) {
      if (typeof name === "string" && FORBIDDEN_SANDBOX_PACKAGES.includes(name)) {
        out.push({
          file,
          packageName: name,
          reason: `\`${name}\` listed in \`bundledDependencies\` (known vulnerable JS sandbox or eval-wrapping deserializer)`,
        });
      }
    }
  }
  return out;
}

/**
 * Scan the raw contents of a `pnpm-lock.yaml` for resolved versions of
 * any forbidden package. pnpm's v9 lockfile format keys snapshots as
 * `"/<name>@<version>"` or, for scoped names, `"/<scope>/<name>@<ver>"`.
 * We look for the literal `/<name>@` substring at the start of a line
 * (after optional whitespace), which is robust against both the legacy
 * and current pnpm lockfile layouts. We do *not* try to parse YAML —
 * this gate must run from a script with zero deps.
 */
export function findForbiddenSandboxesInLockfile(
  file: string,
  source: string
): readonly SandboxFinding[] {
  const out: SandboxFinding[] = [];
  const lines = source.split(/\r?\n/);
  for (const name of FORBIDDEN_SANDBOX_PACKAGES) {
    // Match either bare-name keys (`'/vm2@3.10.4':`) or the modern
    // pnpm-9 form (`vm2@3.10.4:`) anywhere in the file.
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(String.raw`(?:^|[\s'"/])` + escaped + String.raw`@\d`);
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i]!)) {
        out.push({
          file: `${file}:${i + 1}`,
          packageName: name,
          reason: `\`${name}\` resolved in lockfile (known vulnerable JS sandbox or eval-wrapping deserializer)`,
        });
        break;
      }
    }
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

async function* walkForPackageJson(dir: URL): AsyncGenerator<string> {
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
      yield* walkForPackageJson(child);
    } else if (entry.isFile() && entry.name === "package.json") {
      yield fileURLToPath(child);
    }
  }
}

async function main(): Promise<void> {
  const findings: SandboxFinding[] = [];

  for await (const absolute of walkForPackageJson(REPO_ROOT)) {
    const text = await readFile(absolute, "utf8");
    let parsed: PackageJsonLike;
    try {
      parsed = JSON.parse(text) as PackageJsonLike;
    } catch {
      // A malformed `package.json` is not this gate's problem; let the
      // other tooling complain.
      continue;
    }
    const rel = relative(fileURLToPath(REPO_ROOT), absolute).replaceAll("\\", "/");
    findings.push(...findForbiddenSandboxesInPackageJson(rel, parsed));
  }

  const lockfilePath = fileURLToPath(new URL("pnpm-lock.yaml", REPO_ROOT));
  try {
    const stats = await stat(lockfilePath);
    if (stats.isFile()) {
      const lock = await readFile(lockfilePath, "utf8");
      findings.push(...findForbiddenSandboxesInLockfile("pnpm-lock.yaml", lock));
    }
  } catch {
    // No lockfile is unusual for this repo but not this gate's job to
    // enforce.
  }

  if (findings.length === 0) return;
  console.error(
    `verify-no-vulnerable-sandboxes: ${findings.length} forbidden sandbox ` +
      `dependenc${findings.length === 1 ? "y" : "ies"} found:`
  );
  for (const f of findings) {
    console.error(`  - ${f.file}: ${f.reason}`);
  }
  console.error(
    "These packages have documented sandbox-escape / arbitrary-code-execution " +
      "CVEs (see https://socket.dev/blog/free-certified-patches-for-critical-vm2-sandbox-escape " +
      "and https://snyk.io/blog/preventing-insecure-deserialization-node-js/). " +
      "For untrusted code execution use real isolation (separate process, container, " +
      "or a fresh `isolated-vm` isolate) instead of an in-process JS sandbox. " +
      "For deserialization, use `JSON.parse` (or Daloy's `safeJsonParse`) — never " +
      "a library that revives functions from strings."
  );
  process.exitCode = 1;
}

if (process.argv[1]?.endsWith("verify-no-vulnerable-sandboxes.ts")) {
  await main();
}
