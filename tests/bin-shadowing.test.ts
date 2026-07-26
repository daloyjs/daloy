/**
 * Regression coverage for the Socket "bin script confusion" gate
 * shipped in 0.34.0 (see `scripts/verify-no-bin-shadowing.ts`).
 *
 * The gate has two layers; the unit tests below pin the
 * `classifyBinName` + `extractBinNames` helpers that classify a
 * manifest's `bin` field. The end-to-end CI execution is exercised by
 * `pnpm verify:no-bin-shadowing` in `.github/workflows/ci.yml` and
 * `.github/workflows/release.yml`.
 *
 * @since 0.34.0
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyBinName, extractBinNames } from "../scripts/verify-no-bin-shadowing.js";

test("extractBinNames returns keys of an object-form bin", () => {
  assert.deepEqual(extractBinNames({ name: "@daloyjs/core", bin: { daloy: "bin/daloy.mjs" } }), [
    "daloy",
  ]);
});

test("extractBinNames derives bin name from package name when bin is a string", () => {
  assert.deepEqual(extractBinNames({ name: "create-daloy", bin: "x.mjs" }), ["create-daloy"]);
});

test("extractBinNames strips the @scope/ prefix for string-form bins", () => {
  assert.deepEqual(extractBinNames({ name: "@daloyjs/core", bin: "x.mjs" }), ["core"]);
});

test("extractBinNames returns [] when bin is missing or malformed", () => {
  assert.deepEqual(extractBinNames({ name: "x" }), []);
  assert.deepEqual(extractBinNames({ name: "x", bin: 42 as unknown }), []);
  assert.deepEqual(extractBinNames({ name: "x", bin: [] as unknown }), []);
});

test("classifyBinName flags reserved system commands regardless of allowlist", () => {
  for (const reserved of ["node", "npm", "npx", "pnpm", "sh", "bash", "git"]) {
    assert.equal(
      classifyBinName(reserved, false),
      "reserved",
      `expected ${reserved} to be flagged as reserved`
    );
    assert.equal(
      classifyBinName(reserved, true),
      "reserved",
      `expected ${reserved} to be flagged as reserved under allowlist mode`
    );
  }
});

test("classifyBinName honours the third-party trusted-publisher allowlist", () => {
  // Legitimate `tsc` bin coming from the real `typescript` package is OK.
  assert.equal(classifyBinName("tsc", false, "typescript"), null);
  assert.equal(classifyBinName("tsx", false, "tsx"), null);
  // But a typosquat publishing the same bin is rejected.
  assert.equal(classifyBinName("tsc", false, "typescriptt"), "reserved");
  assert.equal(classifyBinName("tsx", false, "ts-x"), "reserved");
  // And the allowlist must NOT relax Daloy's own publish gate.
  assert.equal(classifyBinName("tsc", true, "typescript"), "reserved");
});

test("classifyBinName allows the daloy publish allowlist when enforcing", () => {
  assert.equal(classifyBinName("daloy", true), null);
  assert.equal(classifyBinName("create-daloy", true), null);
});

test("classifyBinName flags unknown names only when allowlist is enforced", () => {
  // Third-party deps: only reserved names matter.
  assert.equal(classifyBinName("eslint", false), null);
  // Our own manifests: anything outside the allowlist is a review-grade
  // surprise even if it doesn't shadow a real system command.
  assert.equal(classifyBinName("eslint", true), "not-allowlisted");
});
