"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import { rankDocPages } from "@/lib/docs-ranking";
import { useDocsSearchIndex } from "@/lib/docs-search-client";

/**
 * Turn a missing path into a search query: `/docs/rate-limits/redis` →
 * `"rate limits redis"`. The `docs` prefix and file extensions are dropped.
 *
 * @param pathname - The path that 404ed.
 * @returns Space-separated words to rank docs pages with.
 */
export function queryFromPath(pathname: string): string {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Malformed escapes: fall back to the raw path.
  }
  return decoded
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word && word !== "docs")
    .join(" ");
}

/**
 * "Did you mean" list on the 404 page: ranks the docs search index against
 * the words in the missing URL, like Fumadocs' not-found suggestions, using
 * the same ranker as the docs search dialog. Renders nothing until the index
 * loads, or when nothing scores.
 */
export function NotFoundSuggestions() {
  const pathname = usePathname();
  const query = queryFromPath(pathname);
  const { items, status } = useDocsSearchIndex(query.length > 0);
  const suggestions = React.useMemo(
    () => (query ? rankDocPages(items, query, 5).map(({ page }) => page) : []),
    [items, query]
  );

  if (status !== "ready" || suggestions.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Suggested pages" className="rounded-2xl border bg-muted/30 p-5">
      <h2 className="text-sm font-semibold text-foreground">Were you looking for one of these?</h2>
      <ul className="mt-3 space-y-3">
        {suggestions.map((page) => (
          <li key={page.href}>
            <Link href={page.href as Route} className="font-medium underline underline-offset-4">
              {page.title}
            </Link>
            <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{page.description}</p>
          </li>
        ))}
      </ul>
    </nav>
  );
}
