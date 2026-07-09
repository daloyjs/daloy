import type { Route } from "next";
import { readFile } from "node:fs/promises";
import { docsNav } from "@/components/docs-nav";
import {
  docsDir,
  extractBodyText,
  parseDocFrontmatter,
  walkDocsPages,
} from "@/lib/docs-content";

export type DocsSearchItem = {
  title: string;
  href: Route;
  description: string;
  keywords: string;
};

export type DocsSearchSection = {
  heading: string;
  items: DocsSearchItem[];
};

type DiscoveredDoc = {
  title: string;
  href: Route;
  description: string;
  keywords: string[];
  body: string;
};

/** Per-page cap on extracted body text (chars) sent to the client. */
const BODY_INDEX_LIMIT = 2_400;

function extractMetadata(source: string, filePath: string): DiscoveredDoc {
  const frontmatter = parseDocFrontmatter(source, filePath);

  return {
    ...frontmatter,
    body: extractBodyText(source, BODY_INDEX_LIMIT),
  };
}

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
  const pageFiles = await walkDocsPages(docsDir);
  const discoveredDocs = await Promise.all(
    pageFiles.map(async (filePath) => extractMetadata(await readFile(filePath, "utf8"), filePath)),
  );

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
      keywords: [
        heading,
        doc.title,
        navTitle,
        doc.href.replaceAll("/", " "),
        doc.description,
        ...doc.keywords,
        doc.body,
      ]
        .filter(Boolean)
        .join(" "),
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
 * Process-lifetime memo for {@link getDocsSearchSections}. The search index is
 * derived from the static docs tree, so it is built at most once per process.
 */
let docsSearchSectionsPromise: Promise<DocsSearchSection[]> | undefined;

/**
 * Build the grouped docs search index. Memoized for the lifetime of the
 * deployment since the docs tree is static at runtime.
 *
 * The memoization replaces a `"use cache"` directive: nonce-based CSP requires
 * dropping the `cacheComponents`/PPR flag that `"use cache"` depends on, and a
 * module-level promise gives the same once-per-deployment caching for this
 * build-invariant computation.
 *
 * @returns The docs search sections in navigation order.
 */
export async function getDocsSearchSections(): Promise<DocsSearchSection[]> {
  docsSearchSectionsPromise ??= computeDocsSearchSections();
  return docsSearchSectionsPromise;
}