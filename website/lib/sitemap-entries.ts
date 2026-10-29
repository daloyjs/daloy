import type { MetadataRoute } from "next";

import { BLOG_POSTS } from "@/lib/blog-posts";
import {
  isTranslatedPath,
  languageAlternates,
  spanishPath,
  TRANSLATED_PATHS,
  type TranslatedPath,
} from "@/lib/i18n";
import { getMdxDocs } from "@/lib/mdx/content";
import { SITE_URL } from "@/lib/seo";

/** One sitemap row before `lastModified` is attached. */
export type SitemapEntry = {
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
  /** `hreflang` → site path, for pages that exist in every locale. */
  languages?: Record<string, string>;
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
  // Index of the Spanish docs on-ramp. It has no English twin (/docs lists
  // every page), so it carries no hreflang alternates.
  { path: "/es/docs", changeFrequency: "monthly", priority: 0.6 },
];

const TRANSLATED = new Set<string>(TRANSLATED_PATHS);

/**
 * {@link SITE_PAGES} plus each translated page's Spanish twin, with `hreflang`
 * alternates on both sides so crawlers pair them.
 *
 * @returns The hand-maintained site entries, Spanish twins included.
 */
export function localizedSitePages(): SitemapEntry[] {
  return SITE_PAGES.flatMap((page) => {
    if (!TRANSLATED.has(page.path)) return [page];
    const path = page.path as TranslatedPath;
    const languages = languageAlternates(path);
    return [
      { ...page, languages },
      { ...page, path: spanishPath(path), languages },
    ];
  });
}

/** Defaults for docs pages that do not set `sitemap` in their frontmatter. */
const DOC_DEFAULTS = { changeFrequency: "monthly", priority: 0.7 } as const;

/**
 * Every sitemap entry: the site pages above (and their Spanish versions),
 * every blog post, and every docs page (plus the Spanish twin of each
 * translated docs page).
 *
 * @returns Entries without `lastModified` (added by `app/sitemap.ts`).
 */
export async function buildSitemapEntries(): Promise<SitemapEntry[]> {
  const docs = (await getMdxDocs()).flatMap((doc): SitemapEntry[] => {
    const entry: SitemapEntry = {
      path: doc.route,
      changeFrequency: doc.frontmatter.sitemap?.changeFrequency ?? DOC_DEFAULTS.changeFrequency,
      priority: doc.frontmatter.sitemap?.priority ?? DOC_DEFAULTS.priority,
    };
    if (!isTranslatedPath(doc.route)) return [entry];
    // Translated docs page: list the Spanish twin and pair the two.
    const languages = languageAlternates(doc.route);
    return [
      { ...entry, languages },
      { ...entry, path: spanishPath(doc.route), languages },
    ];
  });
  const posts = BLOG_POSTS.map((post) => ({
    path: `/blog/${post.slug}`,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));
  return [...localizedSitePages(), ...posts, ...docs];
}
