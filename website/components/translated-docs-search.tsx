"use client";

import * as React from "react";
import type { Route } from "next";
import Link from "next/link";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";

import { englishSearchQuery, glossaryMatches } from "@/lib/docs-glossary";
import { isSubstringTerm, rankDocPages, tokenize, type RankablePage } from "@/lib/docs-ranking";
import { useDocsSearchIndex } from "@/lib/docs-search-client";
import { HTML_DIR, HTML_LANG, type TranslatedLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Results shown per group. */
const MAX_RESULTS = 6;

const SEARCH_COPY: Record<
  TranslatedLocale,
  {
    label: string;
    placeholder: string;
    translated: string;
    english: string;
    englishTag: string;
    empty: string;
    loading: string;
    englishHint: string;
  }
> = {
  es: {
    label: "Buscar en la documentación",
    placeholder: "Buscar en la documentación…",
    translated: "En español",
    english: "Documentación en inglés",
    englishTag: "en inglés",
    empty: "No hay resultados.",
    loading: "Cargando el índice en inglés…",
    englishHint: "Para buscar en la documentación en inglés, prueba con palabras clave en inglés.",
  },
  zh: {
    label: "搜索文档",
    placeholder: "搜索文档…",
    translated: "中文",
    english: "英文文档",
    englishTag: "英文",
    empty: "没有找到结果。",
    loading: "正在加载英文索引…",
    englishHint: "搜索英文文档时，请尝试使用英文关键词。",
  },
  fr: {
    label: "Rechercher dans la documentation",
    placeholder: "Rechercher dans la documentation…",
    translated: "En français",
    english: "Documentation en anglais",
    englishTag: "en anglais",
    empty: "Aucun résultat.",
    loading: "Chargement de l’index anglais…",
    englishHint: "Pour chercher dans la documentation en anglais, essayez des mots-clés en anglais.",
  },
  pt: {
    label: "Pesquisar na documentação",
    placeholder: "Pesquisar na documentação…",
    translated: "Em português",
    english: "Documentação em inglês",
    englishTag: "em inglês",
    empty: "Nenhum resultado.",
    loading: "Carregando o índice em inglês…",
    englishHint: "Para pesquisar na documentação em inglês, tente palavras-chave em inglês.",
  },
  ar: {
    label: "البحث في التوثيق",
    placeholder: "ابحث في التوثيق…",
    translated: "بالعربية",
    english: "التوثيق بالإنجليزية",
    englishTag: "بالإنجليزية",
    empty: "لا توجد نتائج.",
    loading: "جارٍ تحميل الفهرس الإنجليزي…",
    englishHint: "للبحث في التوثيق الإنجليزي، جرّب كلمات مفتاحية بالإنجليزية.",
  },
  ru: {
    label: "Поиск по документации",
    placeholder: "Поиск по документации…",
    translated: "На русском",
    english: "Документация на английском",
    englishTag: "на английском",
    empty: "Ничего не найдено.",
    loading: "Загрузка английского индекса…",
    englishHint: "Для поиска по документации на английском попробуйте английские ключевые слова.",
  },
};

/**
 * Search box for a translated docs section. Ranks the translated pages
 * (passed in, already server-rendered) and, once the box is focused, the
 * English docs index, with the same ranker as the English search dialog.
 * Chinese and Spanish technical terms are mapped to English keywords for the
 * English index (lib/docs-glossary.ts).
 * English hits are plain `<a hreflang="en">` links marked as English:
 * crossing locales reloads the document (see lib/i18n.ts).
 *
 * @param props.locale - Translated locale.
 * @param props.pages - The locale's translated docs pages.
 */
export function TranslatedDocsSearch({
  locale,
  pages,
}: {
  locale: TranslatedLocale;
  pages: readonly RankablePage[];
}) {
  const copy = SEARCH_COPY[locale];
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [wantsIndex, setWantsIndex] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const resultsId = React.useId();
  const english = useDocsSearchIndex(wantsIndex);

  const trimmed = query.trim();
  const translatedHits = React.useMemo(
    () => (trimmed ? rankDocPages(pages, trimmed, MAX_RESULTS) : []),
    [pages, trimmed],
  );
  // Glossary: "限流" / "pruebas" also search the English index for
  // "rate limit" / "testing" (lib/docs-glossary.ts).
  const englishQuery = React.useMemo(() => englishSearchQuery(trimmed, glossaryMatches(trimmed)), [trimmed]);
  const englishHits = React.useMemo(
    () => (trimmed ? rankDocPages(english.items, englishQuery, MAX_RESULTS) : []),
    [english.items, englishQuery, trimmed],
  );
  // Chinese or Arabic: English pages will not match, so suggest English words.
  const queryIsUnspaced = tokenize(trimmed).some(isSubstringTerm);

  const handleKeyDown = React.useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape") setOpen(false);
  });
  const handlePointerDown = React.useEffectEvent((event: PointerEvent) => {
    if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
    setOpen(false);
  });
  React.useEffect(() => {
    if (!open) return;
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  const showPanel = open && trimmed.length > 0;
  const nothing = translatedHits.length === 0 && englishHits.length === 0;
  const row = "block rounded-lg px-3 py-2 text-sm no-underline transition-colors hover:bg-muted";

  return (
    <div ref={rootRef} role="search" className="relative w-full max-w-xl">
      <label className="relative block">
        <span className="sr-only">{copy.label}</span>
        <MagnifyingGlassIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 start-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          value={query}
          placeholder={copy.placeholder}
          aria-controls={resultsId}
          aria-expanded={showPanel}
          autoComplete="off"
          onFocus={() => {
            setWantsIndex(true);
            setOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          className="h-10 w-full rounded-lg border bg-background ps-9 pe-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
      <div
        id={resultsId}
        hidden={!showPanel}
        className="absolute top-[calc(100%+0.5rem)] inset-x-0 z-35 max-h-[70vh] overflow-y-auto rounded-xl border bg-background/95 p-2 shadow-lg backdrop-blur"
      >
        <p aria-live="polite" className="sr-only">
          {showPanel ? `${translatedHits.length + englishHits.length}` : ""}
        </p>
        {translatedHits.length > 0 ? (
          <section>
            <h2 className="px-3 pt-1 pb-1 text-xs font-semibold text-muted-foreground">{copy.translated}</h2>
            <ul>
              {translatedHits.map(({ page }) => (
                <li key={page.href}>
                  <Link href={page.href as Route} className={row} onClick={() => setOpen(false)}>
                    <span className="font-medium text-foreground">{page.title}</span>
                    <span className="line-clamp-1 text-muted-foreground">{page.description}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {englishHits.length > 0 ? (
          <section className={cn(translatedHits.length > 0 && "mt-2 border-t pt-2")}>
            <h2 className="px-3 pt-1 pb-1 text-xs font-semibold text-muted-foreground">{copy.english}</h2>
            <ul lang="en" dir="ltr">
              {englishHits.map(({ page }) => (
                <li key={page.href}>
                  <a href={page.href} hrefLang="en" className={row}>
                    <span className="font-medium text-foreground">
                      {page.title}{" "}
                      <span lang={HTML_LANG[locale]} dir={HTML_DIR[locale]} className="text-xs font-normal text-muted-foreground">
                        ({copy.englishTag})
                      </span>
                    </span>
                    <span className="line-clamp-1 text-muted-foreground">{page.description}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {nothing ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">
            {english.status === "loading" ? copy.loading : copy.empty}
          </p>
        ) : null}
        {englishHits.length === 0 && queryIsUnspaced && english.status === "ready" ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">{copy.englishHint}</p>
        ) : null}
      </div>
    </div>
  );
}
