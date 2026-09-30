import { cacheLife } from "next/cache";

import { getAllDocPages } from "./docs-content";
import type { DocsPageMeta } from "./docs-page-meta-shared";
import { getLastModifiedMap, sourceFileForRoute } from "./git-dates";

/**
 * Build the route → `DocsPageMeta` map passed to the docs layout's
 * client chrome. Cached for the deployment; the docs tree is static at runtime.
 *
 * @returns Metadata keyed by docs route (e.g. `/docs/routing`).
 */
export async function getDocsPageMeta(): Promise<Record<string, DocsPageMeta>> {
  "use cache";
  // Short-lived in dev so new or edited content shows up without a restart.
  if (process.env.NODE_ENV === "development") cacheLife("seconds");
  else cacheLife("max");

  const [pages, dates] = await Promise.all([getAllDocPages(), getLastModifiedMap()]);
  const meta: Record<string, DocsPageMeta> = {};

  for (const page of pages) {
    const file = sourceFileForRoute(page.href);
    meta[page.href] = {
      source: file ? `website/${file}` : null,
      ...(file && dates[file] ? { lastModified: dates[file] } : {}),
    };
  }

  return meta;
}
