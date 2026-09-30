import { BLOG_POSTS } from "@/lib/blog-posts";
import { SITE_NAME, SITE_URL } from "@/lib/seo";

/**
 * Escape text for an XML element body or attribute value.
 *
 * @param value - Untrusted-shaped text (post titles, descriptions).
 * @returns The escaped string.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Render the blog as an RSS 2.0 feed, newest first, from the same
 * `BLOG_POSTS` list that drives the blog index and llms.txt.
 *
 * @returns The feed XML.
 */
export function buildBlogRss(): string {
  const items = BLOG_POSTS.map((post) => {
    const url = `${SITE_URL}/blog/${post.slug}`;
    return [
      "    <item>",
      `      <title>${escapeXml(post.title)}</title>`,
      `      <link>${url}</link>`,
      `      <guid isPermaLink="true">${url}</guid>`,
      `      <description>${escapeXml(post.description)}</description>`,
      `      <pubDate>${new Date(`${post.date}T00:00:00Z`).toUTCString()}</pubDate>`,
      `      <dc:creator>${escapeXml(post.author)}</dc:creator>`,
      "    </item>",
    ].join("\n");
  });
  const latest = BLOG_POSTS[0]?.date;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    "  <channel>",
    `    <title>${escapeXml(`${SITE_NAME} blog`)}</title>`,
    `    <link>${SITE_URL}/blog</link>`,
    `    <atom:link href="${SITE_URL}/blog/rss.xml" rel="self" type="application/rss+xml" />`,
    "    <description>Posts about DaloyJS, contract-first APIs, and secure-by-default backends.</description>",
    "    <language>en</language>",
    latest ? `    <lastBuildDate>${new Date(`${latest}T00:00:00Z`).toUTCString()}</lastBuildDate>` : "",
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
