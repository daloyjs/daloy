import type { Route } from "next";
import { cacheLife } from "next/cache";
import { docsNav } from "@/components/docs-nav";
import { getAllDocPages } from "./docs-content";

/**
 * One page in the client search index. Carries the same fields the shared
 * ranker (`rankDocPages` in `docs-ranking.ts`) reads, so the search dialog
 * ranks exactly like the MCP `search_docs` tool.
 */
export type DocsSearchItem = {
  title: string;
  href: Route;
  description: string;
  /** Page keywords plus the section heading and sidebar title. */
  keywords: string[];
  /** Plain-text body, capped at {@link BODY_INDEX_LIMIT} characters. */
  body: string;
  /** Sidebar section the page belongs to. */
  section: string;
};

export type DocsSearchSection = {
  heading: string;
  items: DocsSearchItem[];
};

/** Per-page cap on extracted body text (chars) sent to the client. */
const BODY_INDEX_LIMIT = 2_400;

function getSectionForRoute(href: Route, navSectionLookup: Map<Route, string>) {
  if (navSectionLookup.has(href)) {
    return navSectionLookup.get(href) ?? "More docs";
  }

  let bestMatch: Route | "" = "";
  let matchedSection = "More docs";

  for (const [navHref, section] of navSectionLookup.entries()) {
    if (href.startsWith(`${navHref}/`) && navHref.length > bestMatch.length) {
      bestMatch = navHref;
      matchedSection = section;
    }
  }

  return matchedSection;
}

async function computeDocsSearchSections(): Promise<DocsSearchSection[]> {
  // Same corpus as MCP, OG images and llms.txt (TSX and MDX pages alike).
  const discoveredDocs = (await getAllDocPages()).map((doc) => ({
    ...doc,
    body: doc.body.slice(0, BODY_INDEX_LIMIT),
  }));

  const navOrder = new Map(docsNav.flatMap((section) => section.items.map((item, index) => [item.href, index] as const)));
  const navTitles = new Map(docsNav.flatMap((section) => section.items.map((item) => [item.href, item.title] as const)));
  const navSectionLookup = new Map(docsNav.flatMap((section) => section.items.map((item) => [item.href, section.title] as const)));

  const grouped = new Map<string, DocsSearchItem[]>();

  for (const doc of discoveredDocs) {
    const heading = getSectionForRoute(doc.href, navSectionLookup);
    const navTitle = navTitles.get(doc.href);
    const sectionItems = grouped.get(heading) ?? [];

    sectionItems.push({
      title: doc.title,
      href: doc.href,
      description: doc.description,
      keywords: [heading, navTitle, ...doc.keywords].filter((value): value is string => Boolean(value)),
      body: doc.body,
      section: heading,
    });

    grouped.set(heading, sectionItems);
  }

  const orderedSections = docsNav.map((section) => section.title);
  const extraSections = [...grouped.keys()].filter((heading) => !orderedSections.includes(heading)).sort();

  return [...orderedSections, ...extraSections]
    .map((heading) => {
      const items = grouped.get(heading);

      if (!items?.length) {
        return null;
      }

      const sortedItems = items.sort((left, right) => {
        const leftOrder = navOrder.get(left.href) ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = navOrder.get(right.href) ?? Number.MAX_SAFE_INTEGER;

        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }

        return left.title.localeCompare(right.title);
      });

      return { heading, items: sortedItems };
    })
    .filter((section): section is DocsSearchSection => section !== null);
}

/**
 * Build the grouped docs search index. Cached for the lifetime of the
 * deployment (`cacheLife("max")`) because the docs tree is static at runtime
 * and only changes when a new build ships.
 *
 * @returns The docs search sections in navigation order.
 */
export async function getDocsSearchSections(): Promise<DocsSearchSection[]> {
  "use cache";
  cacheLife("max");
  return computeDocsSearchSections();
}