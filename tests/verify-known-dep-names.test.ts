import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import {
  ALLOWED_DEP_NAMES,
  SCANNED_PACKAGE_JSONS,
  findAliasedDependencySpecifiers,
  findGitOrUrlDependencySpecifiers,
  findUnknownDependencyNames,
} from "../scripts/verify-known-dep-names.ts";

// Resolve from the current working directory (the repo root in both
// `pnpm test` and `pnpm coverage:branches`) rather than from
// `import.meta.url`. The compiled `coverage:branches` run lives in
// `dist-coverage/tests/` whose parent is `dist-coverage/`, not the repo
// root — so an `import.meta.url`-based resolution would miss the real
// `package.json` and produce ENOENT.
const REPO_ROOT = pathToFileURL(`${process.cwd()}/`);

test("every scanned package.json has zero unknown top-level dep names", async () => {
  for (const rel of SCANNED_PACKAGE_JSONS) {
    const text = await readFile(new URL(rel, REPO_ROOT), "utf8");
    const pkg = JSON.parse(text);
    const offending = findUnknownDependencyNames(rel, pkg);
    assert.deepEqual(
      offending,
      [],
      `unexpected slopsquatting-allowlist violations in ${rel}: ${offending
        .map((v) => `${v.block}["${v.name}"]`)
        .join(", ")}`
    );
  }
});

test("flags a classic hallucinated package name (request-promise-native2)", () => {
  const out = findUnknownDependencyNames("fake.json", {
    dependencies: { "request-promise-native2": "^1.0.0" },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.name, "request-promise-native2");
  assert.equal(out[0]!.block, "dependencies");
});

test("flags a hallucinated @types/* squat", () => {
  const out = findUnknownDependencyNames("fake.json", {
    devDependencies: { "@types/fastify-helmet": "^1.0.0" },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.name, "@types/fastify-helmet");
});

test("flags hallucinated names across every dep block", () => {
  const out = findUnknownDependencyNames("fake.json", {
    dependencies: { "hallucinated-a": "1" },
    devDependencies: { "hallucinated-b": "1" },
    peerDependencies: { "hallucinated-c": "1" },
    optionalDependencies: { "hallucinated-d": "1" },
  });
  assert.equal(out.length, 4);
  assert.deepEqual(out.map((v) => v.block).sort(), [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]);
});

test("does not flag a name that is on the allowlist (zod)", () => {
  const out = findUnknownDependencyNames("fake.json", {
    peerDependencies: { zod: "^4" },
  });
  assert.deepEqual(out, []);
});

test("respects an explicit allowlist override (pure function)", () => {
  const out = findUnknownDependencyNames(
    "fake.json",
    { dependencies: { "made-up": "1" } },
    new Set(["made-up"])
  );
  assert.deepEqual(out, []);
});

test("ignores absent dep blocks and non-object dep blocks", () => {
  assert.deepEqual(findUnknownDependencyNames("a.json", {}), []);
  assert.deepEqual(
    findUnknownDependencyNames("a.json", {
      dependencies: null as unknown as Record<string, unknown>,
    }),
    []
  );
});

test("ALLOWED_DEP_NAMES is non-empty and contains the framework peer", () => {
  assert.ok(ALLOWED_DEP_NAMES.size > 0);
  assert.ok(ALLOWED_DEP_NAMES.has("zod"));
  assert.ok(ALLOWED_DEP_NAMES.has("@daloyjs/core"));
});

test("every scanned package.json has zero npm-alias dep specifiers", async () => {
  for (const rel of SCANNED_PACKAGE_JSONS) {
    const text = await readFile(new URL(rel, REPO_ROOT), "utf8");
    const pkg = JSON.parse(text);
    const aliased = findAliasedDependencySpecifiers(rel, pkg);
    assert.deepEqual(
      aliased,
      [],
      `unexpected npm-alias dependency specifiers in ${rel}: ${aliased
        .map((v) => `${v.block}["${v.name}"]="${v.specifier}"`)
        .join(", ")}`
    );
  }
});

test("flags an npm:-aliased dep specifier (dependency-confusion-via-aliasing)", () => {
  const out = findAliasedDependencySpecifiers("fake.json", {
    dependencies: {
      "deneuve-package-private": "npm:deneuve-package-test@1.0.0",
    },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.name, "deneuve-package-private");
  assert.equal(out[0]!.block, "dependencies");
  assert.equal(out[0]!.specifier, "npm:deneuve-package-test@1.0.0");
});

test("flags npm:-aliased specs across every dep block", () => {
  const out = findAliasedDependencySpecifiers("fake.json", {
    dependencies: { a: "npm:real-a@1" },
    devDependencies: { b: "npm:real-b@1" },
    peerDependencies: { c: "npm:real-c@1" },
    optionalDependencies: { d: "npm:real-d@1" },
  });
  assert.equal(out.length, 4);
  assert.deepEqual(out.map((v) => v.block).sort(), [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]);
});

test("does not flag normal semver / range / tag / file: / git+ specifiers", () => {
  const out = findAliasedDependencySpecifiers("fake.json", {
    dependencies: {
      a: "^1.2.3",
      b: "1.2.3",
      c: "*",
      d: "latest",
      e: "file:../local-pkg",
      f: "git+https://github.com/o/r.git#v1",
      g: "https://example.com/pkg.tgz",
      h: "workspace:*",
    },
  });
  assert.deepEqual(out, []);
});

test("ignores non-string specifier values (defensive)", () => {
  const out = findAliasedDependencySpecifiers("fake.json", {
    dependencies: {
      a: 42 as unknown as string,
      b: null as unknown as string,
      c: "npm:real@1",
    },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.name, "c");
});

test("every scanned package.json has zero git/url dep specifiers", async () => {
  for (const rel of SCANNED_PACKAGE_JSONS) {
    const text = await readFile(new URL(rel, REPO_ROOT), "utf8");
    const pkg = JSON.parse(text);
    const nonRegistry = findGitOrUrlDependencySpecifiers(rel, pkg);
    assert.deepEqual(
      nonRegistry,
      [],
      `unexpected non-registry dep specifiers in ${rel}: ${nonRegistry
        .map((v) => `${v.block}["${v.name}"]="${v.specifier}"`)
        .join(", ")}`
    );
  }
});

test("flags every git-dependency shorthand (Socket gitDependency alert)", () => {
  const out = findGitOrUrlDependencySpecifiers("fake.json", {
    dependencies: {
      a: "git+https://github.com/o/r.git#v1",
      b: "git+ssh://git@github.com/o/r.git",
      c: "git://github.com/o/r.git",
      d: "github:o/r#v1",
      e: "gitlab:o/r",
      f: "bitbucket:o/r",
      g: "gist:abc123",
      h: "git@github.com:o/r.git",
      i: "ssh://git@github.com/o/r.git",
    },
  });
  assert.equal(out.length, 9);
  assert.ok(out.every((v) => v.kind === "git"));
});

test("flags raw http(s) tarball specifiers (Socket httpDependency alert)", () => {
  const out = findGitOrUrlDependencySpecifiers("fake.json", {
    dependencies: {
      a: "https://example.com/pkg.tgz",
      b: "http://example.com/pkg.tgz",
    },
  });
  assert.equal(out.length, 2);
  assert.ok(out.every((v) => v.kind === "url"));
});

test("does not flag normal registry specifiers, workspace:, or file:", () => {
  const out = findGitOrUrlDependencySpecifiers("fake.json", {
    dependencies: {
      a: "^1.2.3",
      b: "1.2.3",
      c: "*",
      d: "latest",
      e: "file:../local-pkg",
      f: "workspace:*",
      g: "npm:real@1",
      h: "~2.0.0",
    },
  });
  assert.deepEqual(out, []);
});

test("ignores non-string specifier values in git/url scan (defensive)", () => {
  const out = findGitOrUrlDependencySpecifiers("fake.json", {
    dependencies: {
      a: 42 as unknown as string,
      b: null as unknown as string,
      c: "git+https://github.com/o/r.git",
    },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.name, "c");
});
