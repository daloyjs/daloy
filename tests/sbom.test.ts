import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildCycloneDx, buildSpdx, deriveMetadata } from "../scripts/generate-sbom.ts";
import { verifyTarget } from "../scripts/verify-sbom.ts";

const FIXED_DATE = new Date("2026-05-21T00:00:00Z");
const REPO_ROOT = pathToFileURL(`${process.cwd()}/`);

test("deriveMetadata throws when package.json is missing required fields", () => {
  assert.throws(() => deriveMetadata({}), /must declare a non-empty `name`/);
  assert.throws(
    () => deriveMetadata({ name: "@daloyjs/core" }),
    /must declare a non-empty `version`/
  );
});

test("deriveMetadata produces deterministic serialNumber from (name, version, timestamp)", () => {
  const meta1 = deriveMetadata({ name: "@daloyjs/core", version: "0.33.0" }, { now: FIXED_DATE });
  const meta2 = deriveMetadata({ name: "@daloyjs/core", version: "0.33.0" }, { now: FIXED_DATE });
  assert.equal(meta1.serialNumber, meta2.serialNumber);
  assert.match(meta1.serialNumber, /^urn:uuid:[0-9a-f-]{36}$/);
  const meta3 = deriveMetadata({ name: "@daloyjs/core", version: "0.34.0" }, { now: FIXED_DATE });
  assert.notEqual(meta1.serialNumber, meta3.serialNumber);
});

test("deriveMetadata normalises repository.url and strips git+ / .git suffix", () => {
  const meta = deriveMetadata(
    {
      name: "@daloyjs/core",
      version: "0.33.0",
      repository: { url: "git+https://github.com/daloyjs/daloy.git" },
    },
    { now: FIXED_DATE }
  );
  assert.equal(meta.repository, "https://github.com/daloyjs/daloy");
});

test("buildCycloneDx emits CycloneDX 1.5 with zero components for zero-runtime-deps package", () => {
  const pkg = {
    name: "@daloyjs/core",
    version: "0.33.0",
    description: "test",
    license: "MIT",
    dependencies: {},
  };
  const meta = deriveMetadata(pkg, { now: FIXED_DATE });
  const cdx = buildCycloneDx(pkg, meta);
  assert.equal(cdx.bomFormat, "CycloneDX");
  assert.equal(cdx.specVersion, "1.5");
  assert.deepEqual(cdx.components, []);
  const metadataComponent = (
    cdx.metadata as { component: { name: string; version: string; swid: { tagId: string } } }
  ).component;
  assert.equal(metadataComponent.name, "@daloyjs/core");
  assert.equal(metadataComponent.version, "0.33.0");
  assert.match(metadataComponent.swid.tagId, /^swidtag-[a-z0-9-]+-0\.33\.0$/);
});

test("buildCycloneDx emits distribution externalReference for publishable npm names", () => {
  // Mirrors the enriched-SBOM shape consumed by tools like Snyk Parlay,
  // bomber, and Dependency-Track: a `distribution` link to the npm
  // tarball page so downstream SCA/procurement scanners don't have to
  // re-resolve the purl.
  const pkg = {
    name: "@daloyjs/core",
    version: "0.33.0",
    license: "MIT",
    homepage: "https://daloyjs.dev",
    repository: { url: "https://github.com/daloyjs/daloy.git" },
    dependencies: {},
  };
  const meta = deriveMetadata(pkg, { now: FIXED_DATE });
  const cdx = buildCycloneDx(pkg, meta) as unknown as {
    metadata: {
      component: {
        externalReferences: ReadonlyArray<{ type: string; url: string }>;
      };
    };
  };
  const refs = cdx.metadata.component.externalReferences;
  const distribution = refs.find((r) => r.type === "distribution");
  assert.ok(distribution, "expected a distribution externalReference");
  assert.equal(distribution?.url, "https://www.npmjs.com/package/@daloyjs/core");
  assert.ok(refs.some((r) => r.type === "vcs"));
  assert.ok(refs.some((r) => r.type === "website"));
});

test("buildCycloneDx omits distribution externalReference for non-publishable package names", () => {
  // Defensive: workspace-private names like `my app` or `internal pkg`
  // (containing spaces or other invalid npm-name chars) should not
  // produce a bogus npmjs.com URL.
  const pkg = {
    name: "internal workspace pkg",
    version: "1.0.0",
    license: "MIT",
    dependencies: {},
  };
  const meta = deriveMetadata(pkg, { now: FIXED_DATE });
  const cdx = buildCycloneDx(pkg, meta) as unknown as {
    metadata: {
      component: {
        externalReferences: ReadonlyArray<{ type: string; url: string }>;
      };
    };
  };
  assert.equal(
    cdx.metadata.component.externalReferences.find((r) => r.type === "distribution"),
    undefined
  );
});

test("buildCycloneDx lists runtime dependencies sorted by name", () => {
  const pkg = {
    name: "demo",
    version: "1.0.0",
    license: "MIT",
    dependencies: { "z-lib": "^1.0.0", "a-lib": "^2.0.0" },
  };
  const meta = deriveMetadata(pkg, { now: FIXED_DATE });
  const cdx = buildCycloneDx(pkg, meta) as unknown as {
    components: Array<{ name: string; purl: string }>;
  };
  assert.equal(cdx.components.length, 2);
  assert.equal(cdx.components[0]?.name, "a-lib");
  assert.equal(cdx.components[1]?.name, "z-lib");
  assert.equal(cdx.components[0]?.purl, "pkg:npm/a-lib@^2.0.0");
});

test("buildSpdx emits SPDX-2.3 with CC0-1.0 dataLicense and matching root package", () => {
  const pkg = {
    name: "@daloyjs/core",
    version: "0.33.0",
    license: "MIT",
    dependencies: {},
  };
  const meta = deriveMetadata(pkg, { now: FIXED_DATE });
  const spdx = buildSpdx(pkg, meta) as unknown as {
    spdxVersion: string;
    dataLicense: string;
    packages: Array<{ name: string; versionInfo: string; licenseConcluded: string }>;
    relationships: Array<{ relationshipType: string }>;
  };
  assert.equal(spdx.spdxVersion, "SPDX-2.3");
  assert.equal(spdx.dataLicense, "CC0-1.0");
  assert.equal(spdx.packages.length, 1);
  assert.equal(spdx.packages[0]?.name, "@daloyjs/core");
  assert.equal(spdx.packages[0]?.versionInfo, "0.33.0");
  assert.equal(spdx.packages[0]?.licenseConcluded, "MIT");
  assert.equal(spdx.relationships[0]?.relationshipType, "DESCRIBES");
});

test("verifyTarget passes when SBOM matches package.json and has zero components", async () => {
  const dir = await mkdtemp(join(tmpdir(), "daloy-sbom-"));
  try {
    const pkg = { name: "@daloyjs/core", version: "0.33.0", license: "MIT", dependencies: {} };
    const meta = deriveMetadata(pkg, { now: FIXED_DATE });
    await writeFile(join(dir, "package.json"), JSON.stringify(pkg));
    await writeFile(join(dir, "sbom.cdx.json"), JSON.stringify(buildCycloneDx(pkg, meta)));
    await writeFile(join(dir, "sbom.spdx.json"), JSON.stringify(buildSpdx(pkg, meta)));
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const result = await verifyTarget({
        packageJson: "./package.json",
        cycloneDx: "./sbom.cdx.json",
        spdx: "./sbom.spdx.json",
        requireZeroComponents: true,
      });
      assert.equal(result.ok, true, result.issues.join("\n"));
    } finally {
      process.chdir(cwd);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("verifyTarget fails when CycloneDX SBOM is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "daloy-sbom-"));
  try {
    const pkg = { name: "@daloyjs/core", version: "0.33.0", license: "MIT", dependencies: {} };
    await writeFile(join(dir, "package.json"), JSON.stringify(pkg));
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const result = await verifyTarget({
        packageJson: "./package.json",
        cycloneDx: "./sbom.cdx.json",
        spdx: "./sbom.spdx.json",
        requireZeroComponents: true,
      });
      assert.equal(result.ok, false);
      assert.ok(
        result.issues.some((i) => i.includes("CycloneDX SBOM missing")),
        result.issues.join("\n")
      );
    } finally {
      process.chdir(cwd);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("verifyTarget fails when SBOM has unexpected runtime components", async () => {
  const dir = await mkdtemp(join(tmpdir(), "daloy-sbom-"));
  try {
    const pkg = { name: "@daloyjs/core", version: "0.33.0", license: "MIT", dependencies: {} };
    const dirtyPkg = {
      ...pkg,
      dependencies: { "smuggled-dep": "^1.0.0" },
    };
    const meta = deriveMetadata(pkg, { now: FIXED_DATE });
    await writeFile(join(dir, "package.json"), JSON.stringify(pkg));
    // SBOM declares a runtime dep that package.json does NOT — this is the
    // exact "SBOM claims more than the manifest" mismatch the gate catches.
    await writeFile(join(dir, "sbom.cdx.json"), JSON.stringify(buildCycloneDx(dirtyPkg, meta)));
    await writeFile(join(dir, "sbom.spdx.json"), JSON.stringify(buildSpdx(pkg, meta)));
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const result = await verifyTarget({
        packageJson: "./package.json",
        cycloneDx: "./sbom.cdx.json",
        spdx: "./sbom.spdx.json",
        requireZeroComponents: true,
      });
      assert.equal(result.ok, false);
      assert.ok(
        result.issues.some((i) => i.includes("expected zero runtime components")),
        result.issues.join("\n")
      );
    } finally {
      process.chdir(cwd);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("verifyTarget fails when SBOM version drifts from package.json", async () => {
  const dir = await mkdtemp(join(tmpdir(), "daloy-sbom-"));
  try {
    const pkg = { name: "@daloyjs/core", version: "0.33.0", license: "MIT", dependencies: {} };
    const stalePkg = { ...pkg, version: "0.32.0" };
    const meta = deriveMetadata(stalePkg, { now: FIXED_DATE });
    await writeFile(join(dir, "package.json"), JSON.stringify(pkg));
    await writeFile(join(dir, "sbom.cdx.json"), JSON.stringify(buildCycloneDx(stalePkg, meta)));
    await writeFile(join(dir, "sbom.spdx.json"), JSON.stringify(buildSpdx(stalePkg, meta)));
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const result = await verifyTarget({
        packageJson: "./package.json",
        cycloneDx: "./sbom.cdx.json",
        spdx: "./sbom.spdx.json",
        requireZeroComponents: true,
      });
      assert.equal(result.ok, false);
      assert.ok(
        result.issues.some((i) => i.includes("does not match package.json#version")),
        result.issues.join("\n")
      );
    } finally {
      process.chdir(cwd);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the in-repo SBOMs are present and match the current published manifests", async () => {
  // This locks the invariant that `pnpm gen:sbom` ran before commit.
  const coreCdx = JSON.parse(await readFile(new URL("dist/sbom.cdx.json", REPO_ROOT), "utf8"));
  const corePkg = JSON.parse(await readFile(new URL("package.json", REPO_ROOT), "utf8"));
  assert.equal(coreCdx.bomFormat, "CycloneDX");
  assert.equal(coreCdx.specVersion, "1.5");
  assert.equal(coreCdx.metadata.component.name, corePkg.name);
  assert.equal(coreCdx.metadata.component.version, corePkg.version);
  assert.deepEqual(coreCdx.components, []);

  const createDaloyCdx = JSON.parse(
    await readFile(new URL("packages/create-daloy/sbom.cdx.json", REPO_ROOT), "utf8")
  );
  const createDaloyPkg = JSON.parse(
    await readFile(new URL("packages/create-daloy/package.json", REPO_ROOT), "utf8")
  );
  assert.equal(createDaloyCdx.metadata.component.name, createDaloyPkg.name);
  assert.equal(createDaloyCdx.metadata.component.version, createDaloyPkg.version);
});
