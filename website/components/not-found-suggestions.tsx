"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import { useSiteLocale } from "@/components/site-locale";
import { rankDocPages } from "@/lib/docs-ranking";
import { useDocsSearchIndex } from "@/lib/docs-search-client";
import { TRANSLATED_LOCALES, type SiteLocale } from "@/lib/i18n";

const SUGGESTION_COPY: Record<SiteLocale, { nav: string; heading: string; english?: string }> = {
  en: { nav: "Suggested pages", heading: "Were you looking for one of these?" },
  es: { nav: "Páginas sugeridas", heading: "¿Buscabas alguna de estas páginas?", english: "en inglés" },
  zh: { nav: "推荐页面", heading: "你是否在找以下页面？", english: "英文" },
  fr: { nav: "Pages suggérées", heading: "Cherchiez-vous l’une de ces pages ?", english: "en anglais" },
  pt: { nav: "Páginas sugeridas", heading: "Você estava procurando uma destas páginas?", english: "em inglês" },
};

const LOCALE_SEGMENTS = new Set<string>(TRANSLATED_LOCALES);

/**
 * Turn a missing path into a search query: `/docs/rate-limits/redis` →
 * `"rate limits redis"`. The `docs` prefix, a leading locale segment (`es`,
 * `zh`) and file extensions are dropped.
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
    .filter((word, index) => word && word !== "docs" && !(index <= 1 && LOCALE_SEGMENTS.has(word)))
    .join(" ");
}

/**
 * "Did you mean" list on the 404 page: ranks the docs search index against
 * the words in the missing URL, like Fumadocs' not-found suggestions, using
 * the same ranker as the docs search dialog. Renders nothing until the index
 * loads, or when nothing scores. The index is the English docs, so on a
 * translated 404 the links are plain `<a hreflang="en">` (crossing locales
 * reloads the document, see lib/i18n.ts) and marked as English.
 */
export function NotFoundSuggestions() {
  const locale = useSiteLocale();
  const copy = SUGGESTION_COPY[locale];
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
    <nav aria-label={copy.nav} className="rounded-2xl border bg-muted/30 p-5">
      <h2 className="text-sm font-semibold text-foreground">{copy.heading}</h2>
      <ul className="mt-3 space-y-3">
        {suggestions.map((page) => (
          <li key={page.href}>
            {locale === "en" ? (
              <Link href={page.href as Route} className="font-medium underline underline-offset-4">
                {page.title}
              </Link>
            ) : (
              <a href={page.href} hrefLang="en" className="font-medium underline underline-offset-4">
                {page.title} <span className="text-xs text-muted-foreground">({copy.english})</span>
              </a>
            )}
            <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{page.description}</p>
          </li>
        ))}
      </ul>
    </nav>
  );
}
