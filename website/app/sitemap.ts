import type { MetadataRoute } from "next";

import { lastModifiedForRoute } from "@/lib/git-dates";
import { isTranslatedDocsPath } from "@/lib/i18n";
import { SITE_URL } from "@/lib/seo";
import { buildSitemapEntries, sitemapLastModified } from "@/lib/sitemap-entries";

/**
 * `lastModified` comes from the last git commit touching each page's source
 * ({@link lastModifiedForRoute}). When history is unavailable (shallow clone,
 * no git), blog posts fall back to their frontmatter publication date and
 * every other page omits the field rather than being stamped with the build
 * time, which would tell crawlers every page changed on every deploy (see
 * {@link sitemapLastModified}).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return Promise.all(
    (await buildSitemapEntries()).map(async (entry) => {
      const { path, changeFrequency, priority, languages } = entry;
      const lastModified = sitemapLastModified(
        entry,
        path.startsWith("/docs") || path.startsWith("/blog/") || isTranslatedDocsPath(path)
          ? await lastModifiedForRoute(path)
          : undefined,
      );
      return {
        url: `${SITE_URL}${path}`,
        ...(lastModified ? { lastModified } : {}),
        changeFrequency,
        priority,
        ...(languages
          ? {
              alternates: {
                languages: Object.fromEntries(
                  Object.entries(languages).map(([lang, p]) => [lang, `${SITE_URL}${p}`]),
                ),
              },
            }
          : {}),
      };
    }),
  );
}
