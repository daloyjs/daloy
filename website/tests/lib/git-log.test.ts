import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// lib/git-dates reads through next/cache, whose cacheLife() throws outside
// the Next.js runtime.
mock.module("next/cache", {
  namedExports: { cacheLife: () => {}, cacheTag: () => {} },
});

const { GIT_LASTMOD_ENV, findCheckoutRoot, parseEmbeddedDates, readGitDates } = await import("../../lib/git-log");
const { getLastModifiedMap } = await import("../../lib/git-dates");

test("readGitDates reads history in the checkout", () => {
  const result = readGitDates(process.cwd());
  assert.equal(result.status, "ok");
  assert.match(result.dates["content/docs/routing.mdx"] ?? "", /^\d{4}-\d{2}-\d{2}T/);
});

test("readGitDates reports a missing checkout instead of throwing", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "no-git-"));
  try {
    assert.deepEqual(readGitDates(dir), {
      dates: {},
      status: "unavailable",
      detail: "no .git directory above the website",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findCheckoutRoot finds the checkout above a nested directory", () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "checkout-")));
  try {
    mkdirSync(path.join(dir, ".git"));
    mkdirSync(path.join(dir, "website", "content"), { recursive: true });
    assert.equal(findCheckoutRoot(path.join(dir, "website", "content")), dir);
    // This website sits inside the real checkout.
    assert.ok(findCheckoutRoot(process.cwd()));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readGitDates reports git's own error when the checkout is broken", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "broken-git-"));
  try {
    // A `.git` file that is not a valid gitfile: git exits with a fatal error.
    writeFileSync(path.join(dir, ".git"), "not a gitdir\n");
    const result = readGitDates(dir);
    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.dates, {});
    assert.match(result.detail ?? "", /^fatal: /);
    assert.ok(!result.detail?.includes("\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseEmbeddedDates keeps only source path → ISO date pairs", () => {
  assert.deepEqual(
    parseEmbeddedDates(JSON.stringify({
      "content/docs/routing.mdx": "2026-10-29T21:04:11+01:00",
      "app/docs/page.tsx": "2026-10-01T08:00:00Z",
      "../etc/passwd": "2026-10-01T08:00:00Z",
      "/abs/content/x.mdx": "2026-10-01T08:00:00Z",
      "content/../x.mdx": "2026-10-01T08:00:00Z",
      "lib/seo.ts": "2026-10-01T08:00:00Z",
      "content/docs/bad-date.mdx": "yesterday",
      "content/docs/number.mdx": 1730000000,
      __proto__: "2026-10-01T08:00:00Z",
    })),
    {
      "content/docs/routing.mdx": "2026-10-29T21:04:11+01:00",
      "app/docs/page.tsx": "2026-10-01T08:00:00Z",
    },
  );
});

test("parseEmbeddedDates rejects empty, malformed and non-object values", () => {
  for (const raw of [undefined, "", "{}", "not json", "[]", "null", '"text"', "42", '{"lib/x.ts":"2026-10-01T08:00:00Z"}']) {
    assert.equal(parseEmbeddedDates(raw), null, String(raw));
  }
  // A polluted key never reaches Object.prototype.
  parseEmbeddedDates('{"__proto__":{"polluted":"2026-10-01T08:00:00Z"}}');
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("runtime dates come from the build-time embed when present, live git otherwise", async () => {
  const saved = process.env[GIT_LASTMOD_ENV];
  try {
    process.env[GIT_LASTMOD_ENV] = JSON.stringify({ "content/docs/routing.mdx": "2001-02-03T04:05:06Z" });
    assert.deepEqual(await getLastModifiedMap(), { "content/docs/routing.mdx": "2001-02-03T04:05:06Z" });
    // Unhappy path: a useless embed falls back to live git instead of dropping every date.
    process.env[GIT_LASTMOD_ENV] = "{}";
    assert.ok(Object.keys(await getLastModifiedMap()).length > 100);
  } finally {
    if (saved === undefined) delete process.env[GIT_LASTMOD_ENV];
    else process.env[GIT_LASTMOD_ENV] = saved;
  }
});

test("next.config embeds the git dates the runtime reads", async () => {
  const { readFileSync } = await import("node:fs");
  const config = readFileSync("next.config.ts", "utf8");
  assert.match(config, /env: \{ \[GIT_LASTMOD_ENV\]: JSON\.stringify\(gitDates\.dates\) \}/);
  // The runtime must read the literal process.env key for Next to inline it.
  assert.match(readFileSync("lib/git-dates.ts", "utf8"), /process\.env\.DALOY_GIT_LASTMOD/);
  assert.equal(GIT_LASTMOD_ENV, "DALOY_GIT_LASTMOD");
});
