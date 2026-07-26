import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_LICENSES,
  evaluatePackage,
  extractLicenseString,
  isLicenseAllowed,
  iteratePnpmManifests,
} from "../scripts/verify-dep-licenses.ts";

test("extractLicenseString reads string license", () => {
  assert.equal(extractLicenseString({ license: "MIT" }), "MIT");
});

test("extractLicenseString reads legacy {type} object", () => {
  assert.equal(extractLicenseString({ license: { type: "Apache-2.0" } }), "Apache-2.0");
});

test("extractLicenseString reads legacy licenses[] array", () => {
  assert.equal(
    extractLicenseString({ licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] }),
    "(MIT OR Apache-2.0)"
  );
});

test("extractLicenseString reads legacy licenses[] of strings", () => {
  assert.equal(extractLicenseString({ licenses: ["MIT", "ISC"] }), "(MIT OR ISC)");
});

test("extractLicenseString returns NOASSERTION for missing/empty/null", () => {
  assert.equal(extractLicenseString({}), "NOASSERTION");
  assert.equal(extractLicenseString({ license: "" }), "NOASSERTION");
  assert.equal(extractLicenseString({ license: null }), "NOASSERTION");
  assert.equal(extractLicenseString({ licenses: [] }), "NOASSERTION");
  assert.equal(extractLicenseString({ license: { type: "" } }), "NOASSERTION");
  assert.equal(extractLicenseString({ licenses: [{}, 42] }), "NOASSERTION");
});

test("isLicenseAllowed accepts permissive ids", () => {
  for (const id of ["MIT", "Apache-2.0", "BSD-3-Clause", "ISC", "0BSD", "MPL-2.0"]) {
    assert.equal(isLicenseAllowed(id), true, id);
  }
});

test("isLicenseAllowed rejects copyleft and source-available ids", () => {
  for (const id of [
    "GPL-3.0",
    "GPL-3.0-or-later",
    "AGPL-3.0",
    "LGPL-2.1",
    "BUSL-1.1",
    "SSPL-1.0",
    "Commons-Clause",
    "CC-BY-NC-4.0",
    "UNLICENSED",
    "NOASSERTION",
    "",
  ]) {
    assert.equal(isLicenseAllowed(id), false, id);
  }
});

test("isLicenseAllowed handles OR — passes if any branch is allowed", () => {
  assert.equal(isLicenseAllowed("(MIT OR GPL-3.0)"), true);
  assert.equal(isLicenseAllowed("GPL-3.0 OR Apache-2.0"), true);
  assert.equal(isLicenseAllowed("(AGPL-3.0 OR GPL-3.0)"), false);
});

test("isLicenseAllowed handles AND — passes only if all branches allowed", () => {
  assert.equal(isLicenseAllowed("(MIT AND Apache-2.0)"), true);
  assert.equal(isLicenseAllowed("(MIT AND GPL-3.0)"), false);
});

test("isLicenseAllowed handles trailing + (e.g. Apache-2.0+)", () => {
  assert.equal(isLicenseAllowed("Apache-2.0+"), true);
});

test("isLicenseAllowed rejects 'SEE LICENSE IN ...' (not machine-verifiable)", () => {
  assert.equal(isLicenseAllowed("SEE LICENSE IN LICENSE"), false);
});

test("evaluatePackage returns null for an allowed package", () => {
  assert.equal(evaluatePackage({ name: "foo", version: "1.0.0", license: "MIT" }), null);
});

test("evaluatePackage flags missing license field", () => {
  const off = evaluatePackage({ name: "bar", version: "2.0.0" });
  assert.ok(off);
  assert.equal(off!.name, "bar");
  assert.equal(off!.version, "2.0.0");
  assert.equal(off!.license, "NOASSERTION");
  assert.match(off!.reason, /no `license` field declared/);
});

test("evaluatePackage flags UNLICENSED with a specific reason", () => {
  const off = evaluatePackage({ name: "p", version: "0.1.0", license: "UNLICENSED" });
  assert.ok(off);
  assert.match(off!.reason, /proprietary/);
});

test("evaluatePackage flags copyleft with allow-list reason", () => {
  const off = evaluatePackage({ name: "p", version: "0.1.0", license: "GPL-3.0" });
  assert.ok(off);
  assert.match(off!.reason, /not on the Daloy allow-list/);
});

test("evaluatePackage honours a custom allow-list", () => {
  // Caller can tighten or loosen; here we tighten to MIT-only.
  const tightened = new Set(["MIT"]);
  assert.equal(
    evaluatePackage({ name: "p", version: "1.0.0", license: "Apache-2.0" }, tightened)?.reason,
    "license 'Apache-2.0' is not on the Daloy allow-list"
  );
  assert.equal(evaluatePackage({ name: "p", version: "1.0.0", license: "MIT" }, tightened), null);
});

test("ALLOWED_LICENSES contains the permissive OSI core", () => {
  for (const id of ["MIT", "Apache-2.0", "BSD-3-Clause", "ISC", "MPL-2.0"]) {
    assert.ok(ALLOWED_LICENSES.has(id), id);
  }
  for (const id of ["GPL-3.0", "AGPL-3.0", "BUSL-1.1"]) {
    assert.ok(!ALLOWED_LICENSES.has(id), id);
  }
});

test("iteratePnpmManifests yields nothing for a missing store dir", async () => {
  let count = 0;
  for await (const _ of iteratePnpmManifests("this/dir/does/not/exist")) count += 1;
  assert.equal(count, 0);
});

test("iteratePnpmManifests yields every installed dep with an allowed license (real tree)", async () => {
  let count = 0;
  let offenders = 0;
  for await (const pkg of iteratePnpmManifests()) {
    count += 1;
    if (evaluatePackage(pkg)) offenders += 1;
  }
  assert.ok(count > 0, "expected to find packages under node_modules/.pnpm");
  assert.equal(
    offenders,
    0,
    "real dev-dependency closure has a non-allow-listed license; see scripts/verify-dep-licenses.ts"
  );
});
