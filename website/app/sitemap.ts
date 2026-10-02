import type { MetadataRoute } from "next";

import { lastModifiedForRoute } from "@/lib/git-dates";
import { SITE_URL } from "@/lib/seo";
import { buildSitemapEntries } from "@/lib/sitemap-entries";

/**
 * `lastModified` comes from the last git commit touching each page's source
 * ({@link lastModifiedForRoute}). When history is unavailable (shallow clone,
 * no git) the field is omitted rather than stamped with the build time, which
 * would tell crawlers every page changed on every deploy.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return Promise.all(
    (await buildSitemapEntries()).map(async ({ path, changeFrequency, priority }) => {
      const lastModified =
        path.startsWith("/docs") || path.startsWith("/blog/") ? await lastModifiedForRoute(path) : undefined;
      return {
        url: `${SITE_URL}${path}`,
        ...(lastModified ? { lastModified } : {}),
        changeFrequency,
        priority,
      };
    }),
  );
}
