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

const {
  extractBodyText,
  parseDocFrontmatter,
  getRouteFromFile,
  normalizeDocRoute,
  getAllDocPages,
  getDocPage,
  docsDir,
} = await import("../../lib/docs-content");

// ─────────────────────────── extractBodyText ───────────────────────────

const SAMPLE_PAGE = `import { CodeBlock } from "@/components/code-block";
export const metadata = buildMetadata({ title: "Sample", description: "Desc", path: "/docs/sample", keywords: ["alpha"] });
export default function Page() {
  return (
    <main className={wrapClass}>
      <h1 className={titleClass}>Hello &amp; welcome</h1>
      <p>Routing is simple.</p>
      <CodeBlock code={\`const answer = 42;\`} language="ts" />
    </main>
  );
}`;

test("extractBodyText keeps prose and code, drops imports and metadata", () => {
  const text = extractBodyText(SAMPLE_PAGE);
  assert.match(text, /Hello & welcome/);
  assert.match(text, /Routing is simple\./);
  assert.match(text, /const answer = 42;/);
  assert.doesNotMatch(text, /import/);
  assert.doesNotMatch(text, /buildMetadata/);
});

test("extractBodyText honors the optional length limit", () => {
  assert.ok(extractBodyText(SAMPLE_PAGE, 5).length <= 5);
});

test("extractBodyText returns an empty string for empty input", () => {
  assert.equal(extractBodyText(""), "");
});

// ─────────────────────────── parseDocFrontmatter ───────────────────────────

test("parseDocFrontmatter extracts title, description, route, and keywords", () => {
  const fm = parseDocFrontmatter(SAMPLE_PAGE, path.join(docsDir, "sample", "page.tsx"));
  assert.equal(fm.title, "Sample");
  assert.equal(fm.description, "Desc");
  assert.equal(fm.href, "/docs/sample");
  assert.deepEqual(fm.keywords, ["alpha"]);
});

test("parseDocFrontmatter falls back to defaults and a file-derived route", () => {
  const fm = parseDocFrontmatter("export default function P() { return null; }", path.join(docsDir, "foo", "page.tsx"));
  assert.equal(fm.title, "Untitled");
  assert.equal(fm.description, "Documentation page");
  assert.equal(fm.href, "/docs/foo");
});

// ─────────────────────────── getRouteFromFile ───────────────────────────

test("getRouteFromFile maps nested pages and the docs root", () => {
  assert.equal(getRouteFromFile(path.join(docsDir, "security", "csrf", "page.tsx")), "/docs/security/csrf");
  assert.equal(getRouteFromFile(path.join(docsDir, "page.tsx")), "/docs");
});

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
