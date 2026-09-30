import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { BLOG_POSTS } from "../../lib/blog-posts";
import { getAllBlogPostOgContent, getBlogPostOgContent } from "../../lib/og-content";
import { buildMetadata } from "../../lib/seo";

const blogDir = path.join(process.cwd(), "app", "blog");
const postSlugs = readdirSync(blogDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("[") && existsSync(path.join(blogDir, entry.name, "page.tsx")))
  .map((entry) => entry.name)
  .sort();

test("every blog post folder gets a generated OG image with its own title", async () => {
  const og = await getAllBlogPostOgContent();
  const ogPaths = new Set(og.map((entry) => entry.path));
  for (const slug of postSlugs) {
    assert.ok(ogPaths.has(`/blog/${slug}`), `${slug}: missing from the OG image static params`);
    const entry = await getBlogPostOgContent(slug);
    const source = readFileSync(path.join(blogDir, slug, "page.tsx"), "utf8");
    assert.ok(entry && source.includes(entry.title.slice(0, 20)), `${slug}: OG title not read from the page's metadata`);
  }
});

test("blog posts use their own OG route, never another image", () => {
  for (const slug of postSlugs) {
    const source = readFileSync(path.join(blogDir, slug, "page.tsx"), "utf8");
    const call = source.match(/buildMetadata\(\{[\s\S]*?\}\)/)?.[0] ?? "";
    assert.ok(call, `${slug}: no buildMetadata({...}) call`);
    const image = call.match(/\bimage\s*:\s*([^,\n]+)/)?.[1]?.trim();
    // An explicit image is fine only when it is the post's own OG route.
    if (image) {
      const own = [`"/blog/${slug}/opengraph-image"`, "`/blog/${POST.slug}/opengraph-image`"];
      assert.ok(own.includes(image), `${slug}: OG image overridden to ${image}`);
    }
  }
  const metadata = buildMetadata({ title: "T", description: "D", path: "/blog/some-post" });
  const images = JSON.stringify(metadata.openGraph?.images);
  assert.match(images, /\/blog\/some-post\/opengraph-image/);
  assert.match(JSON.stringify(metadata.twitter), /\/blog\/some-post\/opengraph-image/);
});

test("every blog post folder is listed in BLOG_POSTS and vice versa", () => {
  assert.deepEqual([...BLOG_POSTS.map((post) => post.slug)].sort(), postSlugs);
});

test("OG lookup rejects unknown and unsafe slugs", async () => {
  assert.equal(await getBlogPostOgContent("does-not-exist"), null);
  assert.equal(await getBlogPostOgContent("../../package.json"), null);
});
