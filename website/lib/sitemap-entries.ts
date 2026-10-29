import type { MetadataRoute } from "next";

import { BLOG_POSTS } from "@/lib/blog-posts";
import {
  isTranslatedPath,
  languageAlternates,
  localizedPath,
  TRANSLATED_LOCALES,
  TRANSLATED_PATHS,
  translatedDocsIndex,
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
  /**
   * Date to use as `lastModified` when git history is unavailable
   * (`YYYY-MM-DD`). Blog posts carry their publication date; other pages have
   * no trustworthy fallback and stay undated rather than claim a fake one.
   */
  fallbackDate?: string;
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

/**
 * Index of each locale's translated docs (`/es/docs`, `/zh/docs`). They have
 * no English twin (`/docs` lists every page), so they carry no hreflang
 * alternates.
 */
const TRANSLATED_DOCS_INDEXES: SitemapEntry[] = TRANSLATED_LOCALES.map((locale) => ({
  path: translatedDocsIndex(locale),
  changeFrequency: "monthly",
  priority: 0.6,
}));

/**
 * One entry per locale for a translated page, all sharing the same
 * `hreflang` map so crawlers pair them.
 */
function withTranslations(entry: SitemapEntry, path: TranslatedPath): SitemapEntry[] {
  const languages = languageAlternates(path);
  return [
    { ...entry, languages },
    ...TRANSLATED_LOCALES.map((locale) => ({ ...entry, path: localizedPath(path, locale), languages })),
  ];
}

const TRANSLATED = new Set<string>(TRANSLATED_PATHS);

/**
 * {@link SITE_PAGES} plus each translated page's versions in every locale,
 * with `hreflang` alternates on all of them so crawlers pair them, plus the
 * translated docs indexes.
 *
 * @returns The hand-maintained site entries, translations included.
 */
export function localizedSitePages(): SitemapEntry[] {
  return [
    ...SITE_PAGES.flatMap((page) =>
      TRANSLATED.has(page.path) ? withTranslations(page, page.path as TranslatedPath) : [page],
    ),
    ...TRANSLATED_DOCS_INDEXES,
  ];
}

/** Defaults for docs pages that do not set `sitemap` in their frontmatter. */
const DOC_DEFAULTS = { changeFrequency: "monthly", priority: 0.7 } as const;

/**
 * Every sitemap entry: the site pages above (and their translations), every
 * blog post, and every docs page (plus the translations of each translated
 * docs page).
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
    return isTranslatedPath(doc.route) ? withTranslations(entry, doc.route) : [entry];
  });
  const posts = BLOG_POSTS.map((post) => ({
    path: `/blog/${post.slug}`,
    changeFrequency: "monthly" as const,
    priority: 0.7,
    fallbackDate: post.date,
  }));
  return [...localizedSitePages(), ...posts, ...docs];
}

/**
 * The `lastModified` for one sitemap entry: the last git commit touching the
 * page's source when known (it reflects later edits), otherwise the entry's
 * {@link SitemapEntry.fallbackDate}, otherwise nothing. Never the build time,
 * which would tell crawlers every page changed on every deploy.
 *
 * @param entry - The sitemap row.
 * @param gitDate - Date from git history, or `undefined` when unavailable.
 * @returns The date to publish, or `undefined` to omit `<lastmod>`.
 */
export function sitemapLastModified(entry: SitemapEntry, gitDate: Date | undefined): Date | undefined {
  if (gitDate) return gitDate;
  if (!entry.fallbackDate) return undefined;
  const fallback = new Date(`${entry.fallbackDate}T00:00:00Z`);
  return Number.isNaN(fallback.getTime()) ? undefined : fallback;
}
