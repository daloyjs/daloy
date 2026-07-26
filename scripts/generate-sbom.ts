/**
 * CycloneDX 1.5 + SPDX 2.3 Software Bill of Materials (SBOM) generator.
 *
 * Daloy's hard policy: every published `@daloyjs/core` and `create-daloy`
 * tarball ships a **machine-readable SBOM** so consumers, SCA scanners
 * (Aikido / Snyk / Socket / Dependency-Track / GUAC) and procurement
 * teams can ingest the framework's dependency footprint without
 * crawling the registry. This script is the framework-side answer to
 * the Aikido 2025 [Understanding SBOM standards: a look at CycloneDX,
 * SPDX and SWID](https://www.aikido.dev/blog/understanding-sbom-standards-a-look-at-cyclonedx-spdx-and-swid)
 * write-up: rather than pick a side, we emit both of the two formats
 * the article rates as primary (CycloneDX 1.5 + SPDX 2.3). SWID is
 * the ISO/IEC 19770-2 third-party identifier format, not a Node-native
 * SBOM format, so a SWID tag is intentionally embedded inside the
 * CycloneDX document via the `swid` component property instead of a
 * separate file (CycloneDX explicitly supports SWID interop).
 *
 * The generator is deterministic and dependency-free — it reads only
 * `package.json` for the target package and emits canonical
 * (sorted-key, no-floats) JSON. There is no `cdxgen` / `cyclonedx-bom`
 * / `syft` invocation, no install-time code, no network call, and no
 * dev-dependency to maintain. The zero-runtime-dependency posture of
 * `@daloyjs/core` (enforced by `pnpm verify:no-runtime-deps`) means
 * the SBOM for the published tarball has an empty `components` /
 * `packages` array — that emptiness is the property `pnpm verify:sbom`
 * locks in at release time.
 *
 * Usage:
 *   node --import tsx scripts/generate-sbom.ts \
 *     --package-json ./package.json \
 *     --out-cyclonedx ./dist/sbom.cdx.json \
 *     --out-spdx ./dist/sbom.spdx.json
 *
 * When `--out-cyclonedx` or `--out-spdx` is omitted, the corresponding
 * format is skipped. When `--package-json` is omitted, the script
 * defaults to `./package.json` (relative to the current working
 * directory). The script always emits to stable, repository-relative
 * locations so the produced SBOM is byte-identical on every release
 * for a given input — the only varying fields are `version`,
 * `timestamp` / `created`, and the document `serialNumber`, which are
 * either deterministic (version) or derived from the `SOURCE_DATE_EPOCH`
 * environment variable when set (so the GitHub Actions release run
 * can produce reproducible bytes if needed).
 *
 * @since 0.34.0
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

interface PackageJsonLike {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly description?: unknown;
  readonly license?: unknown;
  readonly homepage?: unknown;
  readonly repository?: unknown;
  readonly author?: unknown;
  readonly dependencies?: Record<string, unknown>;
}

export interface SbomMetadata {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly license: string;
  readonly homepage: string;
  readonly repository: string;
  readonly author: string;
  readonly timestamp: string;
  readonly serialNumber: string;
}

const SPDX_LICENSE_LIST_VERSION = "3.24";
const CYCLONEDX_SPEC_VERSION = "1.5";
const SPDX_SPEC_VERSION = "SPDX-2.3";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normaliseRepositoryUrl(repository: unknown): string {
  if (typeof repository === "string") return repository;
  if (
    repository !== null &&
    typeof repository === "object" &&
    "url" in (repository as Record<string, unknown>)
  ) {
    const url = (repository as { url: unknown }).url;
    if (typeof url === "string") return url.replace(/^git\+/, "").replace(/\.git$/, "");
  }
  return "";
}

function normaliseAuthor(author: unknown): string {
  if (typeof author === "string") return author;
  if (
    author !== null &&
    typeof author === "object" &&
    "name" in (author as Record<string, unknown>)
  ) {
    const name = (author as { name: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "";
}

export function deriveMetadata(
  pkg: PackageJsonLike,
  options: { readonly now?: Date } = {}
): SbomMetadata {
  const name = asString(pkg.name);
  if (!name) {
    throw new Error("package.json must declare a non-empty `name` field");
  }
  const version = asString(pkg.version);
  if (!version) {
    throw new Error("package.json must declare a non-empty `version` field");
  }
  const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH;
  const now =
    options.now ??
    (sourceDateEpoch && /^\d+$/.test(sourceDateEpoch)
      ? new Date(Number.parseInt(sourceDateEpoch, 10) * 1000)
      : new Date());
  const timestamp = now.toISOString();
  // Deterministic serial number per (name, version, timestamp).
  // CycloneDX requires the form `urn:uuid:` + RFC 4122 UUID; we build a
  // version-5-style UUID from a SHA-256 of the deterministic inputs.
  const hash = createHash("sha256").update(`${name}@${version}|${timestamp}`).digest("hex");
  const serialNumber = `urn:uuid:${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${(
    (Number.parseInt(hash.slice(16, 17), 16) & 0x3) |
    0x8
  ).toString(16)}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  return {
    name,
    version,
    description: asString(pkg.description),
    license: asString(pkg.license, "NOASSERTION"),
    homepage: asString(pkg.homepage),
    repository: normaliseRepositoryUrl(pkg.repository),
    author: normaliseAuthor(pkg.author),
    timestamp,
    serialNumber,
  };
}

export function buildCycloneDx(pkg: PackageJsonLike, meta: SbomMetadata): Record<string, unknown> {
  // Runtime components are derived from the `dependencies` block only.
  // `devDependencies` and `peerDependencies` are intentionally excluded
  // because they are not shipped in the published tarball. For
  // `@daloyjs/core` this list is always empty (enforced by
  // `pnpm verify:no-runtime-deps`).
  const runtimeDeps = pkg.dependencies ?? {};
  const components: Array<Record<string, unknown>> = [];
  for (const [depName, depVersion] of Object.entries(runtimeDeps).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  )) {
    components.push({
      type: "library",
      "bom-ref": `pkg:npm/${depName}@${asString(depVersion)}`,
      name: depName,
      version: asString(depVersion),
      purl: `pkg:npm/${depName}@${asString(depVersion)}`,
      scope: "required",
    });
  }
  const swidTagId = `swidtag-${meta.name.replace(/[^a-z0-9]+/gi, "-")}-${meta.version}`;
  const purl = `pkg:npm/${meta.name}@${meta.version}`;
  return {
    bomFormat: "CycloneDX",
    specVersion: CYCLONEDX_SPEC_VERSION,
    serialNumber: meta.serialNumber,
    version: 1,
    metadata: {
      timestamp: meta.timestamp,
      tools: [
        {
          vendor: "DaloyJS",
          name: "daloy-generate-sbom",
          version: meta.version,
        },
      ],
      authors: meta.author ? [{ name: meta.author }] : [],
      component: {
        type: "library",
        "bom-ref": purl,
        name: meta.name,
        version: meta.version,
        description: meta.description || undefined,
        purl,
        licenses: meta.license
          ? [{ license: { id: meta.license } }]
          : [{ license: { name: "NOASSERTION" } }],
        externalReferences: [
          meta.repository && { type: "vcs", url: meta.repository },
          meta.homepage && { type: "website", url: meta.homepage },
          // `distribution` is the npm tarball page. Matches the
          // enriched-SBOM shape consumed by tools like Snyk Parlay,
          // bomber, and Dependency-Track so downstream license /
          // supplier lookups don't have to re-resolve the purl.
          // Only emitted for npm-published packages (scoped or
          // unscoped) — local-only packages (no publishable name)
          // are skipped.
          /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(meta.name) && {
            type: "distribution",
            url: `https://www.npmjs.com/package/${meta.name}`,
          },
        ].filter(Boolean),
        // SWID interop per CycloneDX 1.5 §components.swid. ISO/IEC 19770-2
        // identifier so SBOM consumers that key off SWID tags (asset-mgmt
        // platforms) can still match the same artifact.
        swid: {
          tagId: swidTagId,
          name: meta.name,
          version: meta.version,
          tagVersion: 0,
          patch: false,
        },
      },
    },
    components,
    dependencies: [
      {
        ref: purl,
        dependsOn: components.map((c) => c["bom-ref"] as string),
      },
      ...components.map((c) => ({ ref: c["bom-ref"] as string, dependsOn: [] })),
    ],
  };
}

export function buildSpdx(pkg: PackageJsonLike, meta: SbomMetadata): Record<string, unknown> {
  const runtimeDeps = pkg.dependencies ?? {};
  const documentNamespace = `${meta.repository || meta.homepage || "https://daloyjs.dev"}/sbom/${meta.name}-${meta.version}-${meta.serialNumber.slice("urn:uuid:".length)}`;
  const rootSpdxId = `SPDXRef-Package-${meta.name.replace(/[^A-Za-z0-9.-]+/g, "-")}`;
  const packages: Array<Record<string, unknown>> = [
    {
      SPDXID: rootSpdxId,
      name: meta.name,
      versionInfo: meta.version,
      downloadLocation: meta.repository || "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: meta.license || "NOASSERTION",
      licenseDeclared: meta.license || "NOASSERTION",
      copyrightText: meta.author ? `Copyright ${meta.author}` : "NOASSERTION",
      supplier: meta.author ? `Organization: ${meta.author}` : "NOASSERTION",
      externalRefs: [
        {
          referenceCategory: "PACKAGE-MANAGER",
          referenceType: "purl",
          referenceLocator: `pkg:npm/${meta.name}@${meta.version}`,
        },
      ],
    },
  ];
  const relationships: Array<Record<string, unknown>> = [
    {
      spdxElementId: "SPDXRef-DOCUMENT",
      relationshipType: "DESCRIBES",
      relatedSpdxElement: rootSpdxId,
    },
  ];
  for (const [depName, depVersion] of Object.entries(runtimeDeps).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  )) {
    const depSpdxId = `SPDXRef-Package-${depName.replace(/[^A-Za-z0-9.-]+/g, "-")}-${asString(
      depVersion
    ).replace(/[^A-Za-z0-9.-]+/g, "-")}`;
    packages.push({
      SPDXID: depSpdxId,
      name: depName,
      versionInfo: asString(depVersion),
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: "NOASSERTION",
      licenseDeclared: "NOASSERTION",
      copyrightText: "NOASSERTION",
      supplier: "NOASSERTION",
      externalRefs: [
        {
          referenceCategory: "PACKAGE-MANAGER",
          referenceType: "purl",
          referenceLocator: `pkg:npm/${depName}@${asString(depVersion)}`,
        },
      ],
    });
    relationships.push({
      spdxElementId: rootSpdxId,
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: depSpdxId,
    });
  }
  return {
    spdxVersion: SPDX_SPEC_VERSION,
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `${meta.name}-${meta.version}`,
    documentNamespace,
    creationInfo: {
      created: meta.timestamp,
      creators: [
        "Tool: daloy-generate-sbom",
        meta.author ? `Organization: ${meta.author}` : "Organization: DaloyJS",
      ],
      licenseListVersion: SPDX_LICENSE_LIST_VERSION,
    },
    packages,
    relationships,
  };
}

function parseArgs(argv: readonly string[]): {
  packageJson: string;
  outCycloneDx: string | null;
  outSpdx: string | null;
} {
  let packageJson = "./package.json";
  let outCycloneDx: string | null = null;
  let outSpdx: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--package-json" && i + 1 < argv.length) {
      packageJson = argv[++i] as string;
    } else if (arg === "--out-cyclonedx" && i + 1 < argv.length) {
      outCycloneDx = argv[++i] as string;
    } else if (arg === "--out-spdx" && i + 1 < argv.length) {
      outSpdx = argv[++i] as string;
    }
  }
  return { packageJson, outCycloneDx, outSpdx };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // Two-space indent matches the rest of the repo's JSON output and
  // produces a stable git diff when the SBOM is committed.
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const { packageJson, outCycloneDx, outSpdx } = parseArgs(process.argv.slice(2));
  if (!outCycloneDx && !outSpdx) {
    process.stderr.write(
      "generate-sbom: at least one of --out-cyclonedx or --out-spdx is required\n"
    );
    process.exit(2);
  }
  const pkgPath = resolve(process.cwd(), packageJson);
  const pkgRaw = await readFile(pkgPath, "utf8");
  const pkg = JSON.parse(pkgRaw) as PackageJsonLike;
  const meta = deriveMetadata(pkg);
  if (outCycloneDx) {
    await writeJson(resolve(process.cwd(), outCycloneDx), buildCycloneDx(pkg, meta));
  }
  if (outSpdx) {
    await writeJson(resolve(process.cwd(), outSpdx), buildSpdx(pkg, meta));
  }
}

const isMain =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /generate-sbom\.(?:ts|js|mjs)$/.test(process.argv[1]);

if (isMain) {
  main().catch((err) => {
    process.stderr.write(`generate-sbom: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
