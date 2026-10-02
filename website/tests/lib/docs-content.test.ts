import { test, mock } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

/**
 * `getAllDocPages` / `getDocPage` call `cacheLife()` from `next/cache`, which
 * throws outside the Next.js runtime. Stub it before importing the module.
 *
 * Node 26 renamed this option to `exports` (and warns that `namedExports` is
 * deprecated), but the pinned `@types/node` only types `namedExports`, so it is
 * the one key that both typechecks and works today. Switch to `exports` once
 * the types catch up.
 */
mock.module("next/cache", {
  namedExports: { cacheLife: () => {}, cacheTag: () => {} },
});

const { normalizeDocRoute, getAllDocPages, getDocPage } = await import("../../lib/docs-content");

// ─────────────────────────── normalizeDocRoute ───────────────────────────

test("normalizeDocRoute accepts slugs, routes, and full URLs", () => {
  assert.equal(normalizeDocRoute("routing"), "/docs/routing");
  assert.equal(normalizeDocRoute("/docs/security"), "/docs/security");
  assert.equal(normalizeDocRoute("security/csrf"), "/docs/security/csrf");
  assert.equal(normalizeDocRoute("/docs"), "/docs");
  assert.equal(normalizeDocRoute("https://daloyjs.dev/docs/routing?q=1#x"), "/docs/routing");
  assert.equal(normalizeDocRoute("  /docs/routing/  "), "/docs/routing");
});

test("normalizeDocRoute returns null for empty or whitespace input", () => {
  assert.equal(normalizeDocRoute(""), null);
  assert.equal(normalizeDocRoute("   "), null);
});

test("normalizeDocRoute rejects path traversal", () => {
  assert.equal(normalizeDocRoute("../../etc/passwd"), null);
  assert.equal(normalizeDocRoute("/docs/../../secret"), null);
  assert.equal(normalizeDocRoute("routing/../../../etc"), null);
});

// ─────────────────────────── getAllDocPages / getDocPage ───────────────────────────

test("getAllDocPages reads the docs tree, sorted, all under /docs", async () => {
  const pages = await getAllDocPages();
  assert.ok(pages.length > 50, `expected many docs pages, got ${pages.length}`);
  assert.ok(pages.every((p) => p.href.startsWith("/docs")));

  const hrefs = pages.map((p) => p.href);
  const sorted = [...hrefs].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(hrefs, sorted);
});

test("getDocPage resolves a known slug to a page with a body", async () => {
  const page = await getDocPage("routing");
  assert.ok(page);
  assert.equal(page?.href, "/docs/routing");
  assert.ok((page?.body.length ?? 0) > 0);
});

test("getDocPage returns null for missing pages and traversal", async () => {
  assert.equal(await getDocPage("nope-not-real"), null);
  assert.equal(await getDocPage("../secret"), null);
});

test("the docs corpus is exactly the MDX content tree, with frontmatter metadata", async () => {
  const { readdirSync } = await import("node:fs");
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(path.join(dir, entry.name)) : entry.name.endsWith(".mdx") ? [path.join(dir, entry.name)] : [],
    );
  const files = walk(path.join(process.cwd(), "content", "docs"));
  const pages = await getAllDocPages();
  assert.equal(pages.length, files.length, "one docs page per .mdx file, and no page.tsx pages left");
  assert.ok(pages.some((p) => p.href === "/docs"), "content/docs/index.mdx is the docs root");
  for (const page of pages) {
    assert.ok(page.title && page.description, `${page.href} is missing frontmatter`);
    assert.ok(page.body.length > 100, `${page.href} has an empty body`);
  }
});
