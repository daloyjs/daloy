import type { MetadataRoute } from "next";

import { BLOG_POSTS } from "@/lib/blog-posts";
import { getMdxDocs } from "@/lib/mdx/content";
import { SITE_URL } from "@/lib/seo";

/** One sitemap row before `lastModified` is attached. */
export type SitemapEntry = {
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
};

/**
 * The site's hand-maintained pages. Docs and blog posts are NOT listed here:
 * docs come from `content/docs/**` (with optional `sitemap` frontmatter) and
 * posts from `BLOG_POSTS`, so a new page is in the sitemap automatically.
 */
const SITE_PAGES: SitemapEntry[] = [
  { path: "/", changeFrequency: "weekly", priority: 1.0 },
  { path: "/blog", changeFrequency: "weekly", priority: 0.8 },
  { path: "/about", changeFrequency: "yearly", priority: 0.6 },
  { path: "/contact", changeFrequency: "yearly", priority: 0.6 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.6 },
  { path: "/about-the-name", changeFrequency: "yearly", priority: 0.5 },
];

/** Defaults for docs pages that do not set `sitemap` in their frontmatter. */
const DOC_DEFAULTS = { changeFrequency: "monthly", priority: 0.7 } as const;

/**
 * Every sitemap entry: the site pages above, every blog post, and every docs
 * page.
 *
 * @returns Entries without `lastModified` (added by `app/sitemap.ts`).
 */
export async function buildSitemapEntries(): Promise<SitemapEntry[]> {
  const docs = (await getMdxDocs()).map((doc) => ({
    path: doc.route,
    changeFrequency: doc.frontmatter.sitemap?.changeFrequency ?? DOC_DEFAULTS.changeFrequency,
    priority: doc.frontmatter.sitemap?.priority ?? DOC_DEFAULTS.priority,
  }));
  const posts = BLOG_POSTS.map((post) => ({
    path: `/blog/${post.slug}`,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));
  return [...SITE_PAGES, ...posts, ...docs];
}
