/**
 * SBOM governance gate.
 *
 * Daloy's hard policy: every published `@daloyjs/core` and `create-daloy`
 * tarball ships a CycloneDX 1.5 + SPDX 2.3 SBOM, the SBOM's primary
 * component matches the published `package.json`, and `@daloyjs/core`'s
 * SBOM has **zero** runtime components (the same zero-runtime-deps
 * invariant `pnpm verify:no-runtime-deps` enforces at the manifest
 * level, re-checked from the SBOM bytes that are about to be published).
 *
 * The gate exists so a future maintainer cannot accidentally publish a
 * tarball whose SBOM is missing, stale, or claims dependencies the
 * manifest does not have. It is wired into the pre-publish `verify` job
 * in `release.yml` so the SBOM bytes are checked against the manifest
 * bytes inside the same hermetic runner that will run `pnpm publish`.
 *
 * Exit code:
 *   0 — every requested SBOM exists, parses, matches the manifest, and
 *       (for `@daloyjs/core`) declares zero runtime components.
 *   1 — at least one check failed; the failing reason is printed to
 *       stderr.
 *
 * @since 0.34.0
 */

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

export interface SbomTarget {
  readonly packageJson: string;
  readonly cycloneDx: string;
  readonly spdx: string;
  /** If true, the SBOM must declare zero runtime components. */
  readonly requireZeroComponents: boolean;
}

const DEFAULT_TARGETS: readonly SbomTarget[] = [
  {
    packageJson: "./package.json",
    cycloneDx: "./dist/sbom.cdx.json",
    spdx: "./dist/sbom.spdx.json",
    requireZeroComponents: true,
  },
  {
    packageJson: "./packages/create-daloy/package.json",
    cycloneDx: "./packages/create-daloy/sbom.cdx.json",
    spdx: "./packages/create-daloy/sbom.spdx.json",
    requireZeroComponents: false,
  },
];

interface CheckResult {
  readonly ok: boolean;
  readonly issues: readonly string[];
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function verifyTarget(target: SbomTarget): Promise<CheckResult> {
  const issues: string[] = [];
  const pkgPath = resolve(process.cwd(), target.packageJson);
  const cdxPath = resolve(process.cwd(), target.cycloneDx);
  const spdxPath = resolve(process.cwd(), target.spdx);

  if (!(await fileExists(pkgPath))) {
    return { ok: false, issues: [`manifest missing: ${target.packageJson}`] };
  }
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
    name?: unknown;
    version?: unknown;
    dependencies?: Record<string, unknown>;
  };
  const expectedName = typeof pkg.name === "string" ? pkg.name : "";
  const expectedVersion = typeof pkg.version === "string" ? pkg.version : "";
  const expectedRuntimeDeps = Object.keys(pkg.dependencies ?? {}).sort();

  if (!(await fileExists(cdxPath))) {
    issues.push(`CycloneDX SBOM missing: ${target.cycloneDx} (run \`pnpm gen:sbom\`)`);
  } else {
    const cdx = JSON.parse(await readFile(cdxPath, "utf8")) as Record<string, unknown>;
    if (cdx.bomFormat !== "CycloneDX") {
      issues.push(`${target.cycloneDx}: bomFormat is not "CycloneDX"`);
    }
    if (cdx.specVersion !== "1.5") {
      issues.push(`${target.cycloneDx}: specVersion is not "1.5"`);
    }
    const metadataComponent = (
      cdx.metadata as { component?: { name?: string; version?: string } } | undefined
    )?.component;
    if (metadataComponent?.name !== expectedName) {
      issues.push(
        `${target.cycloneDx}: metadata.component.name (${metadataComponent?.name ?? "<missing>"}) ` +
          `does not match package.json#name (${expectedName})`
      );
    }
    if (metadataComponent?.version !== expectedVersion) {
      issues.push(
        `${target.cycloneDx}: metadata.component.version (${metadataComponent?.version ?? "<missing>"}) ` +
          `does not match package.json#version (${expectedVersion})`
      );
    }
    const components = Array.isArray(cdx.components) ? cdx.components : [];
    const componentNames = components
      .map((c) => (c as { name?: unknown }).name)
      .filter((n): n is string => typeof n === "string")
      .sort();
    if (target.requireZeroComponents && components.length !== 0) {
      issues.push(
        `${target.cycloneDx}: expected zero runtime components (zero-runtime-deps invariant), ` +
          `found ${components.length}: ${componentNames.join(", ")}`
      );
    }
    const cdxNamesEqual =
      componentNames.length === expectedRuntimeDeps.length &&
      componentNames.every((n, i) => n === expectedRuntimeDeps[i]);
    if (!cdxNamesEqual) {
      issues.push(
        `${target.cycloneDx}: components do not match package.json#dependencies ` +
          `(SBOM: [${componentNames.join(", ")}], manifest: [${expectedRuntimeDeps.join(", ")}])`
      );
    }
  }

  if (!(await fileExists(spdxPath))) {
    issues.push(`SPDX SBOM missing: ${target.spdx} (run \`pnpm gen:sbom\`)`);
  } else {
    const spdx = JSON.parse(await readFile(spdxPath, "utf8")) as Record<string, unknown>;
    if (spdx.spdxVersion !== "SPDX-2.3") {
      issues.push(`${target.spdx}: spdxVersion is not "SPDX-2.3"`);
    }
    if (spdx.dataLicense !== "CC0-1.0") {
      issues.push(`${target.spdx}: dataLicense is not "CC0-1.0"`);
    }
    const packages = Array.isArray(spdx.packages) ? spdx.packages : [];
    const rootPkg = packages.find((p) => (p as { name?: unknown }).name === expectedName) as
      { versionInfo?: unknown } | undefined;
    if (!rootPkg) {
      issues.push(`${target.spdx}: no package entry for ${expectedName}`);
    } else if (rootPkg.versionInfo !== expectedVersion) {
      issues.push(
        `${target.spdx}: versionInfo for ${expectedName} (${String(rootPkg.versionInfo)}) ` +
          `does not match package.json#version (${expectedVersion})`
      );
    }
    const depPackages = packages.filter((p) => (p as { name?: unknown }).name !== expectedName);
    if (target.requireZeroComponents && depPackages.length !== 0) {
      const names = depPackages
        .map((p) => (p as { name?: unknown }).name)
        .filter((n): n is string => typeof n === "string");
      issues.push(
        `${target.spdx}: expected zero dependency packages, found ${depPackages.length}: ${names.join(", ")}`
      );
    }
  }

  return { ok: issues.length === 0, issues };
}

export async function verifyAll(
  targets: readonly SbomTarget[] = DEFAULT_TARGETS
): Promise<CheckResult> {
  const allIssues: string[] = [];
  for (const target of targets) {
    const result = await verifyTarget(target);
    if (!result.ok) {
      allIssues.push(...result.issues);
    }
  }
  return { ok: allIssues.length === 0, issues: allIssues };
}

async function main(): Promise<void> {
  const result = await verifyAll();
  if (!result.ok) {
    for (const issue of result.issues) {
      process.stderr.write(`verify-sbom: ${issue}\n`);
    }
    process.exit(1);
  }
  process.stdout.write("verify-sbom: OK\n");
}

const isMain =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /verify-sbom\.(?:ts|js|mjs)$/.test(process.argv[1]);

if (isMain) {
  main().catch((err) => {
    process.stderr.write(`verify-sbom: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
