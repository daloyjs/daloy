import assert from "node:assert/strict";
import { test } from "node:test";

import { buildBlogRss, escapeXml } from "../../lib/blog-rss";
import { BLOG_POSTS } from "../../lib/blog-posts";

test("RSS feed lists every blog post with an absolute permalink", () => {
  const xml = buildBlogRss();
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.equal(xml.match(/<item>/g)?.length, BLOG_POSTS.length);
  const first = BLOG_POSTS[0]!;
  assert.ok(xml.includes(`<guid isPermaLink="true">https://daloyjs.dev/blog/${first.slug}</guid>`));
});

test("RSS escaping neutralizes markup in titles and descriptions", () => {
  assert.equal(escapeXml(`<script>"a" & 'b'</script>`), "&lt;script&gt;&quot;a&quot; &amp; &apos;b&apos;&lt;/script&gt;");
  assert.ok(!/<item>[\s\S]*<script/.test(buildBlogRss()));
});
