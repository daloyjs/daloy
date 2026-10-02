import { cacheLife } from "next/cache";

import { getAllDocPages } from "./docs-content";
import type { DocsPageMeta } from "./docs-page-meta-shared";
import { getLastModifiedMap, lastModifiedIso, sourceFileForRoute } from "./git-dates";

/**
 * Build the route → `DocsPageMeta` map passed to the docs layout's
 * client chrome. Cached for the deployment; the docs tree is static at runtime.
 *
 * @returns Metadata keyed by docs route (e.g. `/docs/routing`).
 */
export async function getDocsPageMeta(): Promise<Record<string, DocsPageMeta>> {
  "use cache";
  cacheLife("max");

  const [pages, dates] = await Promise.all([getAllDocPages(), getLastModifiedMap()]);
  const meta: Record<string, DocsPageMeta> = {};

  for (const page of pages) {
    const file = sourceFileForRoute(page.href);
    const lastModified = lastModifiedIso(page.href, dates);
    meta[page.href] = {
      source: file ? `website/${file}` : null,
      ...(lastModified ? { lastModified } : {}),
    };
  }

  return meta;
}
