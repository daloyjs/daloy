import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The published API surface is the `exports` map in `package.json` (npm, points
// at built `dist/*`) and `jsr.json` (JSR, points at `src/*`). These must stay in
// parity, and every advertised subpath must resolve to a real source file —
// otherwise a renamed/deleted module leaves a dangling public export that only
// fails at a consumer's install/import time.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readExports(rel: string): Record<string, unknown> {
  const json = JSON.parse(readFileSync(path.join(REPO_ROOT, rel), "utf8")) as {
    exports?: Record<string, unknown>;
  };
  assert.ok(json.exports, `${rel} must declare an "exports" map`);
  return json.exports;
}

const pkgExports = readExports("package.json");
const jsrExports = readExports("jsr.json");

test("package.json and jsr.json advertise the same export subpaths", () => {
  assert.deepEqual(
    Object.keys(pkgExports).sort(),
    Object.keys(jsrExports).sort(),
    "package.json and jsr.json export maps have drifted out of parity",
  );
});

test("every jsr export resolves to an existing source file", () => {
  for (const [subpath, src] of Object.entries(jsrExports)) {
    assert.equal(
      typeof src,
      "string",
      `jsr export "${subpath}" must map to a source path`,
    );
    assert.ok(
      existsSync(path.join(REPO_ROOT, src as string)),
      `jsr export "${subpath}" -> ${String(src)} does not exist on disk`,
    );
  }
});
