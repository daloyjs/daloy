import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_DEP_NAMES,
  SCANNED_PACKAGE_JSONS,
  findAliasedDependencySpecifiers,
  findUnknownDependencyNames,
} from "../scripts/verify-known-dep-names.ts";

const REPO_ROOT = new URL("../", import.meta.url);

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
        .join(", ")}`,
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
  assert.deepEqual(
    out.map((v) => v.block).sort(),
    ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"],
  );
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
    new Set(["made-up"]),
  );
  assert.deepEqual(out, []);
});

test("ignores absent dep blocks and non-object dep blocks", () => {
  assert.deepEqual(findUnknownDependencyNames("a.json", {}), []);
  assert.deepEqual(
    findUnknownDependencyNames("a.json", {
      dependencies: null as unknown as Record<string, unknown>,
    }),
    [],
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
        .join(", ")}`,
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
  assert.deepEqual(
    out.map((v) => v.block).sort(),
    ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"],
  );
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
