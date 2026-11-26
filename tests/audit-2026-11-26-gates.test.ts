/**
 * Audit 2026-11-26: four CI-gate gaps.
 *
 * 1. The shared comment stripper disagreed with the JavaScript lexer: it
 *    ended a `//` comment only at LF (not at a lone CR, U+2028 or U+2029),
 *    and read a regex literal after `if (...)` as a division, so the `/*`
 *    inside it opened a comment. Either way live code was hidden from six
 *    gates.
 * 2. The gates walked only `.ts` / `.mts` / `.js` / `.mjs`, while `tsc`
 *    also compiles `.cts` and `.tsx` under `src/`.
 * 3. `verify:secret-comparisons` missed a secret compared through a call,
 *    an optional chain, or a wrap that starts with the operator.
 * 4. `evals/pilot` (manifest, lockfile, workspace file) was read by no
 *    dependency gate.
 */

import { execFileSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";

import { isSourceFile } from "../scripts/lib/source-files.ts";
import { stripSource } from "../scripts/lib/strip-source.ts";
import {
  ALLOWED_DEP_NAMES,
  ALLOWED_OVERRIDE_NAMES,
  SCANNED_PACKAGE_JSONS,
  SCANNED_WORKSPACE_FILES,
  allowedDepNamesFor,
  allowedOverrideNamesFor,
  findSuspiciousOverrides,
  findUnknownDependencyNames,
} from "../scripts/verify-known-dep-names.ts";
import { SCANNED_LOCKFILES } from "../scripts/verify-lockfile-sources.ts";
import { findForbiddenRemoteExecCalls } from "../scripts/verify-no-remote-exec.ts";
import { findForbiddenBufferCalls } from "../scripts/verify-no-unsafe-buffer.ts";
import { findForbiddenWeakRandomCalls } from "../scripts/verify-no-weak-random.ts";
import { findForbiddenSecretComparisons } from "../scripts/verify-secret-comparisons.ts";

// Built from pieces so this file does not itself contain the banned calls.
const EVAL = `export const a = ${"ev"}${"al"}("40+2");`;
const RANDOM = `export const b = Math.${"ran"}${"dom"}();`;
const UNSAFE = `export const c = Buffer.${"alloc"}${"Unsafe"}(1).length;`;

const findings = (source: string): number =>
  findForbiddenRemoteExecCalls("src/x.ts", source).length +
  findForbiddenWeakRandomCalls("src/x.ts", source).length +
  findForbiddenBufferCalls("src/x.ts", source).length;

// ---------- 1. comment stripper vs the JavaScript lexer ----------

test("control: the gates flag the three banned calls in plain code", () => {
  assert.equal(findings(`${EVAL}\n${RANDOM}\n${UNSAFE}\n`), 3);
});

for (const [label, terminator] of [
  ["a lone CR", "\r"],
  ["U+2028", " "],
  ["U+2029", " "],
] as const) {
  test(`code after a // comment ended by ${label} is still scanned`, () => {
    const source = `// note${terminator}${EVAL}\n// note${terminator}${RANDOM}\n// note${terminator}${UNSAFE}\n`;
    assert.equal(findings(source), 3);
    // Line numbers still match `split(/\r?\n/)`.
    assert.equal(stripSource(source).noComments.length, source.split(/\r?\n/).length);
  });
}

test("a regex literal after an if/while/for head or else/do does not open a comment", () => {
  for (const head of [
    "if (s) /[/*]/.test(s);",
    "while (s) /[/*]/.test(s);",
    "for (;;) /[/*]/.test(s);",
    "if (s) {} else /[/*]/.test(s);",
    "do /[/*]/.test(s); while (0);",
    "if (fn(a, (b))) /[/*]/.test(s);",
  ]) {
    const source = `const s: string = "x";\n${head}\n${EVAL}\n${RANDOM}\n${UNSAFE}\n`;
    assert.equal(findings(source), 3, head);
  }
});

test("the stripper still treats real comments, divisions and strings as before", () => {
  // Banned calls only inside comments or strings are not code.
  assert.equal(findings(`// ${EVAL}\n/* ${RANDOM} */\nconst s = "${"ev"}al(x)";\n`), 0);
  // A CRLF file keeps one output line per source line.
  const crlf = stripSource("const a = 1; // one\r\nconst b = 2;\r\n");
  assert.deepEqual(crlf.noComments, ["const a = 1; ", "const b = 2;", ""]);
  // Division after a call's `)` and after an identifier is not a regex.
  const div = stripSource("const x = (a + b) / 2; /* gone */ const y = total / count; // gone\n");
  assert.equal(div.noComments[0], "const x = (a + b) / 2;   const y = total / count; ");
  // A block comment right after an `if (...)` head is a comment.
  assert.equal(stripSource("if (a) /* why */ run();\n").noComments[0], "if (a)   run();");
  // `/*` in a string or in an ordinary regex is not a comment opener.
  assert.equal(findings(`const route = "/*";\n${EVAL}\n`), 1);
  assert.equal(findings(`const re = /[/*]/;\n${EVAL}\n`), 1);
});

// ---------- 2. file extensions ----------

test("every extension the compiler accepts is scanned", () => {
  for (const name of ["a.ts", "a.mts", "a.cts", "a.tsx", "a.js", "a.mjs", "a.cjs", "a.jsx", "a.d.ts", "dir/evil.cts"])
    assert.equal(isSourceFile(name), true, name);
  for (const name of ["a.json", "a.md", "a.ts.bak", "tsx", "a.css", "README"])
    assert.equal(isSourceFile(name), false, name);
});

test("the live src/ tree holds no file the gates would not read", () => {
  const files = execFileSync("git", ["ls-files", "src"], { encoding: "utf8" }).split("\n").filter(Boolean);
  assert.ok(files.length > 50);
  const unread = files.filter((f) => !isSourceFile(f));
  assert.deepEqual(unread, [], "add the extension to isSourceFile or move the file out of src/");
});

// ---------- 3. secret comparisons ----------

const compare = (line: string): number => findForbiddenSecretComparisons("src/x.ts", line).length;

test("verify:secret-comparisons reports a secret compared through a call, optional chain or wrap", () => {
  for (const line of [
    "if (apiKey === expected) return true;",
    "if (String(apiKey) === expected) return true;",
    "if (sha256(providedSecret) !== storedDigest) throw new Error();",
    "const ok = cookie?.value === expected;",
    "const ok = expected === normalize(sessionToken);",
    "const ok =\n  sessionToken\n  === expected;",
    "const ok = sessionToken ===\n  expected;",
  ]) {
    assert.equal(compare(line), 1, JSON.stringify(line));
  }
});

test("verify:secret-comparisons still passes shape checks and unrelated comparisons", () => {
  for (const line of [
    'if (key === "secure") cookie.secure = true;',
    "if (apiKey === undefined) return;",
    'if (typeof password !== "string") return;',
    "if (signature.length !== expected.length) return false;",
    "if (count === limit) run(apiKey);",
    "const ok = String(status) === wanted;",
    "if (timingSafeEqual(a, b)) return providedToken;",
  ]) {
    assert.equal(compare(line), 0, JSON.stringify(line));
  }
  // The reasoned allow marker still works.
  assert.equal(compare("if (String(apiKey) === expected) return; // daloy-allow-compare: public id"), 0);
});

// ---------- 4. evals/pilot and every other committed manifest ----------

const tracked = (...patterns: string[]): string[] =>
  execFileSync("git", ["ls-files", ...patterns], { encoding: "utf8" }).split("\n").filter(Boolean);

test("every committed lockfile, workspace file and non-template manifest is on a gate's list", () => {
  assert.deepEqual(
    tracked("pnpm-lock.yaml", "*/pnpm-lock.yaml").filter((f) => !SCANNED_LOCKFILES.includes(f)),
    [],
    "add the lockfile to SCANNED_LOCKFILES in scripts/verify-lockfile-sources.ts",
  );
  assert.deepEqual(
    tracked("pnpm-workspace.yaml", "*/pnpm-workspace.yaml").filter((f) => !SCANNED_WORKSPACE_FILES.includes(f)),
    [],
    "add the file to SCANNED_WORKSPACE_FILES in scripts/verify-known-dep-names.ts",
  );
  assert.deepEqual(
    tracked("package.json", "*/package.json").filter(
      (f) => !SCANNED_PACKAGE_JSONS.includes(f) && !f.includes("/templates/") && !f.startsWith("evals/tasks/"),
    ),
    [],
    "add the manifest to SCANNED_PACKAGE_JSONS in scripts/verify-known-dep-names.ts",
  );
  for (const f of ["evals/pilot/package.json", "evals/pilot/pnpm-workspace.yaml", "evals/pilot/pnpm-lock.yaml"])
    assert.ok([...SCANNED_PACKAGE_JSONS, ...SCANNED_WORKSPACE_FILES, ...SCANNED_LOCKFILES].includes(f), f);
});

test("pilot-only names are allowed in evals/pilot and nowhere else", () => {
  const pkg = { devDependencies: { deepeval: "0.9.26" } };
  assert.deepEqual(findUnknownDependencyNames("evals/pilot/package.json", pkg, allowedDepNamesFor("evals/pilot/package.json")), []);
  assert.equal(findUnknownDependencyNames("package.json", pkg, allowedDepNamesFor("package.json")).length, 1);
  assert.equal(allowedDepNamesFor("website/package.json"), ALLOWED_DEP_NAMES);
  assert.equal(allowedOverrideNamesFor("pnpm-workspace.yaml"), ALLOWED_OVERRIDE_NAMES);
  // An unknown name in the pilot manifest is still refused.
  assert.equal(
    findUnknownDependencyNames("evals/pilot/package.json", { devDependencies: { "deepeval-helpers": "1.0.0" } }, allowedDepNamesFor("evals/pilot/package.json")).length,
    1,
  );
});

test("an override keyed parent>child is judged on the child it replaces", () => {
  const yaml = (key: string, value: string) => `overrides:\n  '${key}': '${value}'\n`;
  const allowed = allowedOverrideNamesFor("evals/pilot/pnpm-workspace.yaml");
  assert.deepEqual(findSuspiciousOverrides("w", yaml("deepeval@0.9.26>uuid", "11.1.1"), allowed), []);
  // The child is what gets checked: an allowed parent does not launder it.
  const bad = findSuspiciousOverrides("w", yaml("uuid@1.0.0>left-pad", "1.3.0"), allowed);
  assert.equal(bad.length, 1);
  assert.equal(bad[0]!.name, "left-pad");
  // A range containing `>` is still read from the front.
  const ranged = findSuspiciousOverrides("w", yaml("esbuild@>=0.20.0 <0.25.0", "0.25.0"), ALLOWED_OVERRIDE_NAMES);
  assert.deepEqual(ranged, []);
  // A non-registry target is refused even for an allowed name.
  assert.equal(findSuspiciousOverrides("w", yaml("deepeval@0.9.26>uuid", "github:someone/uuid"), allowed).length, 1);
});
