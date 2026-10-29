import { mock, test } from "node:test";
import assert from "node:assert/strict";

// lib/sitemap-entries reads docs through next/cache, whose cacheLife() throws
// outside the Next.js runtime (same stub as tests/mcp/route.test.ts).
mock.module("next/cache", {
  namedExports: { cacheLife: () => {}, cacheTag: () => {} },
});

const { buildSitemapEntries, sitemapLastModified } = await import("../../lib/sitemap-entries");
const { BLOG_POSTS } = await import("../../lib/blog-posts");

test("a git date wins over the fallback: it reflects later edits", () => {
  const git = new Date("2026-10-01T12:00:00Z");
  assert.equal(sitemapLastModified({ path: "/blog/x", changeFrequency: "monthly", priority: 0.7, fallbackDate: "2026-01-01" }, git), git);
});

test("without git history a blog post falls back to its publication date", () => {
  const date = sitemapLastModified({ path: "/blog/x", changeFrequency: "monthly", priority: 0.7, fallbackDate: "2026-07-09" }, undefined);
  assert.equal(date?.toISOString(), "2026-07-09T00:00:00.000Z");
});

test("pages without a trustworthy date stay undated instead of claiming the build time", () => {
  assert.equal(sitemapLastModified({ path: "/docs/routing", changeFrequency: "monthly", priority: 0.7 }, undefined), undefined);
  assert.equal(
    sitemapLastModified({ path: "/blog/x", changeFrequency: "monthly", priority: 0.7, fallbackDate: "not-a-date" }, undefined),
    undefined,
  );
});

test("every blog post entry carries its frontmatter date as the fallback", async () => {
  const entries = await buildSitemapEntries();
  const posts = entries.filter((entry) => entry.path.startsWith("/blog/"));
  assert.equal(posts.length, BLOG_POSTS.length);
  for (const post of BLOG_POSTS) {
    const entry = posts.find((candidate) => candidate.path === `/blog/${post.slug}`);
    assert.equal(entry?.fallbackDate, post.date, post.slug);
  }
  // Docs and marketing pages never get a fallback date.
  assert.ok(entries.filter((entry) => !entry.path.startsWith("/blog/")).every((entry) => entry.fallbackDate === undefined));
});
