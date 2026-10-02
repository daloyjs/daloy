import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { blogPostJsonLd } from "../../components/blog-post-layout";
import { BLOG_POST_SCOPES } from "../../components/blog";
import { BLOG_POSTS, blogFrontmatterSchema, getBlogPost } from "../../lib/blog-posts";
import { getAllBlogPostOgContent, getBlogPostOgContent } from "../../lib/og-content";
import { buildMetadata } from "../../lib/seo";

const contentDir = path.join(process.cwd(), "content", "blog");
const appBlogDir = path.join(process.cwd(), "app", "blog");
const contentSlugs = readdirSync(contentDir)
  .filter((name) => name.endsWith(".mdx"))
  .map((name) => name.replace(/\.mdx$/, ""))
  .sort();

test("every post in content/blog is listed and gets an OG image with its own title", async () => {
  assert.deepEqual(BLOG_POSTS.map((post) => post.slug).sort(), contentSlugs);
  const og = await getAllBlogPostOgContent();
  for (const post of BLOG_POSTS) {
    const entry = og.find((item) => item.path === `/blog/${post.slug}`);
    assert.ok(entry, `${post.slug}: missing from the OG image static params`);
    assert.equal(entry.title, post.title);
  }
});

test("blog posts are MDX only: no page.tsx per post, only custom OG folders", () => {
  for (const entry of readdirSync(appBlogDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("[") || entry.name === "rss.xml") continue;
    assert.ok(!existsSync(path.join(appBlogDir, entry.name, "page.tsx")), `${entry.name}: a page.tsx post shadows content/blog`);
    assert.ok(getBlogPost(entry.name), `${entry.name}: custom OG folder for a post that does not exist`);
    assert.deepEqual(readdirSync(path.join(appBlogDir, entry.name)), ["opengraph-image.tsx"]);
  }
});

test("BLOG_POSTS is newest first and frontmatter is complete", () => {
  for (let index = 1; index < BLOG_POSTS.length; index += 1) {
    assert.ok(BLOG_POSTS[index - 1]!.date >= BLOG_POSTS[index]!.date, "posts must be sorted newest first");
  }
  for (const post of BLOG_POSTS) {
    assert.ok(post.title && post.description && post.readingTime && post.author && post.authorRole);
    if (post.footerLinks) assert.ok(post.authorBio, `${post.slug}: the author card needs authorBio`);
  }
});

test("blog frontmatter rejects bad dates, unknown fields and off-site footer links", () => {
  const base = { title: "T", description: "D", date: "2026-10-01", readingTime: "1 min read", author: "A", authorRole: "R" };
  assert.ok(blogFrontmatterSchema.safeParse(base).success);
  assert.equal(blogFrontmatterSchema.safeParse({ ...base, date: "Oct 1, 2026" }).success, false);
  assert.equal(blogFrontmatterSchema.safeParse({ ...base, publishedAt: "2026-10-01" }).success, false);
  assert.equal(blogFrontmatterSchema.safeParse({ ...base, footerLinks: [{ label: "x", href: "https://evil.example" }] }).success, false);
});

test("helper registry matches components/blog modules and only names real posts", () => {
  const modules = readdirSync(path.join(process.cwd(), "components", "blog"))
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => name.replace(/\.tsx$/, ""))
    .sort();
  assert.deepEqual(Object.keys(BLOG_POST_SCOPES).sort(), modules);
  for (const slug of modules) assert.ok(getBlogPost(slug), `${slug}: helper module for a post that does not exist`);
});

test("blog posts use their own OG route and the same JSON-LD shape as before", () => {
  const metadata = buildMetadata({ title: "T", description: "D", path: "/blog/some-post" });
  assert.match(JSON.stringify(metadata.openGraph?.images), /\/blog\/some-post\/opengraph-image/);
  assert.match(JSON.stringify(metadata.twitter), /\/blog\/some-post\/opengraph-image/);
  const post = BLOG_POSTS[0]!;
  assert.deepEqual(Object.keys(blogPostJsonLd(post)), [
    "@context", "@type", "headline", "description", "datePublished", "dateModified", "author", "publisher", "mainEntityOfPage", "url",
  ]);
  assert.equal(blogPostJsonLd(post).datePublished, post.date);
});

test("OG lookup rejects unknown and unsafe slugs", async () => {
  assert.equal(await getBlogPostOgContent("does-not-exist"), null);
  assert.equal(await getBlogPostOgContent("../../package.json"), null);
});
