/**
 * Regression coverage for the Socket "npm shrinkwrap" gate
 * (`scripts/verify-no-shrinkwrap.ts`).
 *
 * The end-to-end CI execution runs as `pnpm verify:no-shrinkwrap` in
 * both [`ci.yml`](.github/workflows/ci.yml) and the pre-publish
 * `verify` job of [`release.yml`](.github/workflows/release.yml).
 * These unit tests pin the manifest-classification helper so a
 * future change to the allowlist/`scripts` shape cannot silently
 * weaken the gate.
 *
 * @since 0.35.1
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { findShrinkwrapManifestIssues } from "../scripts/verify-no-shrinkwrap.js";

test("findShrinkwrapManifestIssues passes a clean manifest", () => {
  assert.deepEqual(
    findShrinkwrapManifestIssues({
      files: ["dist", "bin", "README.md"],
      scripts: { build: "tsc -p tsconfig.json", test: "node --test" },
    }),
    [],
  );
});

test("findShrinkwrapManifestIssues flags `files` allowlist that includes npm-shrinkwrap.json", () => {
  const result = findShrinkwrapManifestIssues({
    files: ["dist", "npm-shrinkwrap.json"],
  });
  assert.deepEqual(result, [
    "manifest files allowlist includes npm-shrinkwrap.json",
  ]);
});

test("findShrinkwrapManifestIssues flags `files` entry with surrounding whitespace", () => {
  const result = findShrinkwrapManifestIssues({
    files: ["dist", "  npm-shrinkwrap.json  "],
  });
  assert.deepEqual(result, [
    "manifest files allowlist includes npm-shrinkwrap.json",
  ]);
});

test("findShrinkwrapManifestIssues flags a script that runs `npm shrinkwrap`", () => {
  const result = findShrinkwrapManifestIssues({
    scripts: { freeze: "npm shrinkwrap" },
  });
  assert.deepEqual(result, [
    "manifest scripts reference npm shrinkwrap command",
  ]);
});

test("findShrinkwrapManifestIssues flags a chained `npm shrinkwrap` in a longer script", () => {
  const result = findShrinkwrapManifestIssues({
    scripts: { prepare: "pnpm build && npm shrinkwrap && echo done" },
  });
  assert.deepEqual(result, [
    "manifest scripts reference npm shrinkwrap command",
  ]);
});

test("findShrinkwrapManifestIssues does NOT flag the gate's own script name", () => {
  assert.deepEqual(
    findShrinkwrapManifestIssues({
      scripts: {
        "verify:no-shrinkwrap": "node --import tsx scripts/verify-no-shrinkwrap.ts",
      },
    }),
    [],
  );
});

test("findShrinkwrapManifestIssues does NOT flag prose mentioning shrinkwrap", () => {
  assert.deepEqual(
    findShrinkwrapManifestIssues({
      scripts: { doc: "echo 'documents shrinkwrap behaviour'" },
    }),
    [],
  );
});

test("findShrinkwrapManifestIssues tolerates missing or malformed fields", () => {
  assert.deepEqual(findShrinkwrapManifestIssues({}), []);
  assert.deepEqual(
    findShrinkwrapManifestIssues({ files: 42 as unknown, scripts: "no" as unknown }),
    [],
  );
  assert.deepEqual(
    findShrinkwrapManifestIssues({
      files: [42, null, "dist"] as unknown as readonly string[],
    }),
    [],
  );
});
