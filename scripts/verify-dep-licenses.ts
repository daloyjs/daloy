/**
 * Dependency-license policy gate — the missing "license scanning" pillar
 * from the typical Aikido continuous-code-quality CI/CD checklist
 * (https://www.aikido.dev/blog/continuous-code-quality-ci-cd).
 *
 * Daloy already covers the other Aikido pillars in CI:
 *
 *   - SAST: CodeQL workflow
 *   - DAST: dast.yml workflow
 *   - SCA / known-CVE: `pnpm audit --prod` + Dependabot + vuln-scan workflow
 *   - SBOMs (CycloneDX 1.5 + SPDX 2.3): `pnpm gen:sbom` + `pnpm verify:sbom`
 *   - Secrets: verify-no-leaked-credentials + verify-secret-comparisons
 *   - Malware / install-time exec: verify-no-lifecycle-scripts,
 *     verify-no-remote-exec, verify-no-registry-exfiltration,
 *     verify-no-encoded-payloads, verify-no-invisible-unicode,
 *     verify-no-vulnerable-sandboxes
 *   - CI/CD pipeline hardening: harden-runner, SHA-pinned actions
 *     (verify-actions-pinned), scorecard, zizmor
 *
 * The remaining gap is **license posture**: a copyleft / source-available /
 * commercial-only license sneaking into the dev-dependency closure would
 * not raise a CVE or trigger any of the existing gates, but it can still
 * pollute the published artifact's effective compliance story. This script
 * walks the resolved pnpm dev-dependency closure (`node_modules/.pnpm/*`)
 * and fails CI if any installed package declares a license that is not on
 * the explicit Daloy allow-list of permissive OSI licenses.
 *
 * Policy:
 *   ALLOW   — permissive OSI licenses Daloy ships under or freely composes
 *             with (MIT, Apache-2.0, BSD-{2,3}-Clause, ISC, 0BSD, CC0-1.0,
 *             Unlicense, BlueOak-1.0.0, Python-2.0, MPL-2.0, WTFPL).
 *   DENY    — copyleft / source-available / non-commercial / unknown
 *             (GPL-*, AGPL-*, LGPL-*, BUSL-*, SSPL-*, Commons-Clause,
 *             CC-BY-NC-*, UNLICENSED, NOASSERTION, missing field).
 *
 * SPDX expressions are parsed at a small subset of the official grammar:
 *
 *   - bare id                       e.g. "MIT"
 *   - "(A OR B)"                    pass if **any** branch is allowed
 *   - "(A AND B)"                   pass only if **all** branches are allowed
 *   - leading "SEE LICENSE IN ..."  fail (not machine-verifiable)
 *
 * Exit code:
 *   0 — every installed package has an allow-listed license.
 *   1 — at least one offending package was found; offending entries are
 *       printed to stderr.
 *
 * @since 0.35.1
 */

import { readdir, readFile } from "node:fs/promises";

export const ALLOWED_LICENSES: ReadonlySet<string> = new Set([
  "0BSD",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "CC-BY-4.0",
  "ISC",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "Python-2.0",
  "Unlicense",
  "WTFPL",
  "Zlib",
]);

const PNPM_STORE_DIR = "node_modules/.pnpm";

export interface LicenseOffender {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly reason: string;
}

interface PackageJsonLike {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly license?: unknown;
  readonly licenses?: unknown;
}

/**
 * Normalise the various legacy shapes of `license`/`licenses` in
 * package.json into a single SPDX-style string (or `"NOASSERTION"`).
 */
export function extractLicenseString(pkg: PackageJsonLike): string {
  const lic = pkg.license;
  if (typeof lic === "string" && lic.trim() !== "") return lic.trim();
  if (lic && typeof lic === "object") {
    const t = (lic as { type?: unknown }).type;
    if (typeof t === "string" && t.trim() !== "") return t.trim();
  }
  const arr = pkg.licenses;
  if (Array.isArray(arr) && arr.length > 0) {
    const parts: string[] = [];
    for (const entry of arr) {
      if (typeof entry === "string" && entry.trim() !== "") parts.push(entry.trim());
      else if (entry && typeof entry === "object") {
        const t = (entry as { type?: unknown }).type;
        if (typeof t === "string" && t.trim() !== "") parts.push(t.trim());
      }
    }
    if (parts.length > 0) return `(${parts.join(" OR ")})`;
  }
  return "NOASSERTION";
}

/**
 * Returns `true` iff every required branch of the SPDX expression is on
 * the allow-list. Supports the `(A OR B)` / `(A AND B)` / bare-id subset.
 */
export function isLicenseAllowed(
  expression: string,
  allowed: ReadonlySet<string> = ALLOWED_LICENSES,
): boolean {
  const expr = expression.trim();
  if (expr === "" || expr === "NOASSERTION" || expr === "UNLICENSED") return false;
  if (/^SEE\s+LICENSE/i.test(expr)) return false;
  // Strip a single outer pair of parentheses.
  const inner =
    expr.startsWith("(") && expr.endsWith(")") ? expr.slice(1, -1).trim() : expr;
  // Handle OR: pass if any branch is allowed.
  if (/\s+OR\s+/i.test(inner)) {
    return inner.split(/\s+OR\s+/i).some((b) => isLicenseAllowed(b, allowed));
  }
  // Handle AND: pass only if every branch is allowed.
  if (/\s+AND\s+/i.test(inner)) {
    return inner.split(/\s+AND\s+/i).every((b) => isLicenseAllowed(b, allowed));
  }
  // Bare id; strip a trailing "+" (e.g. "Apache-2.0+").
  const id = inner.replace(/\+$/, "").trim();
  return allowed.has(id);
}

export function evaluatePackage(
  pkg: PackageJsonLike,
  allowed: ReadonlySet<string> = ALLOWED_LICENSES,
): LicenseOffender | null {
  const name = typeof pkg.name === "string" ? pkg.name : "<unknown>";
  const version = typeof pkg.version === "string" ? pkg.version : "<unknown>";
  const license = extractLicenseString(pkg);
  if (isLicenseAllowed(license, allowed)) return null;
  const reason =
    license === "NOASSERTION"
      ? "no `license` field declared (or empty)"
      : license === "UNLICENSED"
        ? "declared `UNLICENSED` (proprietary)"
        : `license '${license}' is not on the Daloy allow-list`;
  return { name, version, license, reason };
}

/**
 * Walks `node_modules/.pnpm/<pkg>@<ver>/node_modules/...` and yields every
 * resolved package manifest. Scoped packages (`@scope/name`) live one
 * directory deeper.
 */
export async function* iteratePnpmManifests(
  storeDir: string = PNPM_STORE_DIR,
): AsyncGenerator<PackageJsonLike> {
  let entries;
  try {
    entries = await readdir(storeDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const nm = `${storeDir}/${entry.name}/node_modules`;
    let inner;
    try {
      inner = await readdir(nm, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const sub of inner) {
      const candidates = sub.name.startsWith("@")
        ? (await readdir(`${nm}/${sub.name}`, { withFileTypes: true })).map(
            (i) => `${sub.name}/${i.name}`,
          )
        : [sub.name];
      for (const rel of candidates) {
        try {
          const text = await readFile(`${nm}/${rel}/package.json`, "utf8");
          yield JSON.parse(text) as PackageJsonLike;
        } catch {
          // Not every directory is a package (e.g. .bin), ignore.
        }
      }
    }
  }
}

async function main(): Promise<void> {
  const offenders: LicenseOffender[] = [];
  const seen = new Set<string>();
  let scanned = 0;
  for await (const pkg of iteratePnpmManifests()) {
    scanned += 1;
    const off = evaluatePackage(pkg);
    if (off === null) continue;
    const key = `${off.name}@${off.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    offenders.push(off);
  }
  if (scanned === 0) {
    console.error(
      "verify-dep-licenses: no packages found under node_modules/.pnpm. " +
        "Run `pnpm install --frozen-lockfile --ignore-scripts` first.",
    );
    process.exitCode = 1;
    return;
  }
  if (offenders.length === 0) {
    console.log(
      `verify-dep-licenses: scanned ${scanned} resolved packages, all on the Daloy license allow-list.`,
    );
    return;
  }
  console.error(
    `verify-dep-licenses: ${offenders.length} dependenc${
      offenders.length === 1 ? "y" : "ies"
    } violate the Daloy license allow-list:`,
  );
  for (const o of offenders) {
    console.error(`  - ${o.name}@${o.version} :: ${o.reason}`);
  }
  console.error(
    "If a new dependency uses a license that is genuinely safe to ship with an " +
      "MIT framework, extend ALLOWED_LICENSES in scripts/verify-dep-licenses.ts " +
      "and add a SECURITY.md review note. Copyleft (GPL/AGPL/LGPL) and " +
      "source-available (BUSL/SSPL/Commons-Clause) licenses are not accepted.",
  );
  process.exitCode = 1;
}

if (process.argv[1]?.endsWith("verify-dep-licenses.ts")) {
  await main();
}
