import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { findUnpinnedActions } from "../scripts/verify-actions-pinned.ts";

const WORKFLOWS_DIR = new URL("../.github/workflows/", import.meta.url);

test("every shipped workflow has zero `uses:` violations", async () => {
  const entries = await readdir(WORKFLOWS_DIR, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && /\.ya?ml$/.test(e.name))
    .map((e) => e.name);
  assert.ok(files.length > 0, "expected at least one workflow file");
  for (const name of files) {
    const text = await readFile(new URL(name, WORKFLOWS_DIR), "utf8");
    const violations = findUnpinnedActions(`.github/workflows/${name}`, text);
    assert.deepEqual(
      violations,
      [],
      `unexpected verify-actions-pinned violations in ${name}: ${violations
        .map((v) => `${v.line}: ${v.reason}`)
        .join(", ")}`,
    );
  }
});

test("flags a mutable tag like @v4", () => {
  const yaml = "      - uses: actions/checkout@v4\n";
  const out = findUnpinnedActions("wf.yml", yaml);
  assert.equal(out.length, 1);
  assert.match(out[0]!.reason, /not a 40-character lowercase hex commit SHA/);
});

test("flags a branch tag like @main", () => {
  const yaml = "        uses: some/action@main\n";
  const out = findUnpinnedActions("wf.yml", yaml);
  assert.equal(out.length, 1);
  assert.match(out[0]!.reason, /not a 40-character lowercase hex commit SHA/);
});

test("flags a semver tag like @1.2.3", () => {
  const yaml = "        uses: some/action@1.2.3\n";
  const out = findUnpinnedActions("wf.yml", yaml);
  assert.equal(out.length, 1);
});

test("flags missing @ref", () => {
  const yaml = "        uses: some/action\n";
  const out = findUnpinnedActions("wf.yml", yaml);
  assert.equal(out.length, 1);
  assert.match(out[0]!.reason, /missing a `@<commit-sha>` ref/);
});

test("flags expression interpolation in uses", () => {
  const yaml = "        uses: ${{ env.ACTION }}@${{ env.REF }}\n";
  const out = findUnpinnedActions("wf.yml", yaml);
  assert.equal(out.length, 1);
  assert.match(out[0]!.reason, /interpolates a `\$\{\{ … \}\}` expression/);
});

test("flags the tj-actions/changed-files known-compromised action even when SHA-pinned", () => {
  const sha = "a".repeat(40);
  const yaml = `        uses: tj-actions/changed-files@${sha}\n`;
  const out = findUnpinnedActions("wf.yml", yaml);
  assert.equal(out.length, 1);
  assert.match(out[0]!.reason, /known-compromised deny-list/);
  assert.match(out[0]!.reason, /CVE-2025-30066/);
});

test("flags a subpath of a denied action (e.g. tj-actions/changed-files/foo)", () => {
  const sha = "b".repeat(40);
  const yaml = `        uses: tj-actions/changed-files/foo@${sha}\n`;
  const out = findUnpinnedActions("wf.yml", yaml);
  assert.equal(out.length, 1);
  assert.match(out[0]!.reason, /known-compromised deny-list/);
});

test("flags reviewdog/action-setup (the upstream of the tj-actions compromise)", () => {
  const sha = "c".repeat(40);
  const yaml = `        uses: reviewdog/action-setup@${sha}\n`;
  const out = findUnpinnedActions("wf.yml", yaml);
  assert.equal(out.length, 1);
  assert.match(out[0]!.reason, /known-compromised deny-list/);
});

test("accepts a properly SHA-pinned third-party action", () => {
  const sha = "de0fac2e4500dabe0009e67214ff5f5447ce83dd";
  const yaml = `      - uses: actions/checkout@${sha} # v6\n`;
  const out = findUnpinnedActions("wf.yml", yaml);
  assert.deepEqual(out, []);
});

test("accepts a SHA-pinned action with a subpath (codeql-action/init)", () => {
  const sha = "52485aec7be33610227643b0fe83936b8b5f061a";
  const yaml = `        uses: github/codeql-action/init@${sha} # v3\n`;
  const out = findUnpinnedActions("wf.yml", yaml);
  assert.deepEqual(out, []);
});

test("accepts a local action reference (./.github/actions/foo)", () => {
  const yaml = "        uses: ./.github/actions/foo\n";
  const out = findUnpinnedActions("wf.yml", yaml);
  assert.deepEqual(out, []);
});

test("ignores non-`uses:` lines", () => {
  const yaml = [
    "name: example",
    "on: push",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo uses: not-an-action@v1",
    "",
  ].join("\n");
  const out = findUnpinnedActions("wf.yml", yaml);
  assert.deepEqual(out, []);
});

test("rejects an uppercase-hex SHA (must be lowercase)", () => {
  const yaml = `        uses: actions/checkout@${"A".repeat(40)}\n`;
  const out = findUnpinnedActions("wf.yml", yaml);
  assert.equal(out.length, 1);
});

test("rejects a short (38-char) hex ref", () => {
  const yaml = `        uses: actions/checkout@${"a".repeat(38)}\n`;
  const out = findUnpinnedActions("wf.yml", yaml);
  assert.equal(out.length, 1);
});
