import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// The published API surface is the `exports` map in `package.json` (npm, points
// at built `dist/*`) and `jsr.json` (JSR, points at `src/*`). These must stay in
// parity, and every advertised subpath must resolve to a real source file —
// otherwise a renamed/deleted module leaves a dangling public export that only
// fails at a consumer's install/import time.
//
// Resolve from the current working directory (the repo root in both `pnpm test`
// and `pnpm coverage:branches`) rather than from `import.meta.url`. The compiled
// `coverage:branches` run lives in `dist-coverage/tests/` whose parent is
// `dist-coverage/`, not the repo root — an `import.meta.url`-based `..` would
// read `dist-coverage/package.json` and throw ENOENT.
const REPO_ROOT = process.cwd();

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
