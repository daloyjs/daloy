import { TranslatedDocsNavList } from "@/components/translated-docs-nav-list";
import type { Route } from "next";
import Link from "next/link";

import { lastModifiedForRoute } from "@/lib/git-dates";
import { HTML_LANG, isRtl, translatedDocsIndex, type TranslatedLocale } from "@/lib/i18n";
import { getOrderedTranslatedDocs } from "@/lib/mdx/content";

/** Chrome strings of the translated docs section, per locale. */
export const TRANSLATED_DOCS_COPY: Record<
  TranslatedLocale,
  {
    indexTitle: string;
    allDocs: string;
    allDocsBody: string;
    tocLabel: string;
    breadcrumb: string;
    pager: string;
    previous: string;
    next: string;
    lastUpdated: string;
  }
> = {
  es: {
    indexTitle: "Documentación en español",
    allDocs: "Toda la documentación (en inglés)",
    allDocsBody:
      "Seguridad, adaptadores, bases de datos, autenticación y la referencia completa de la API.",
    tocLabel: "En esta página",
    breadcrumb: "Ruta de navegación",
    pager: "Navegación entre páginas",
    previous: "Anterior",
    next: "Siguiente",
    lastUpdated: "Última actualización:",
  },
  zh: {
    indexTitle: "中文文档",
    allDocs: "全部文档（英文）",
    allDocsBody: "安全、适配器、数据库、身份验证以及完整的 API 参考。",
    tocLabel: "本页内容",
    breadcrumb: "面包屑导航",
    pager: "页面导航",
    previous: "上一页",
    next: "下一页",
    lastUpdated: "最后更新：",
  },
  fr: {
    indexTitle: "Documentation en français",
    allDocs: "Toute la documentation (en anglais)",
    allDocsBody:
      "Sécurité, adaptateurs, bases de données, authentification et la référence complète de l’API.",
    tocLabel: "Sur cette page",
    breadcrumb: "Fil d’Ariane",
    pager: "Navigation entre les pages",
    previous: "Précédent",
    next: "Suivant",
    lastUpdated: "Dernière mise à jour :",
  },
  pt: {
    indexTitle: "Documentação em português",
    allDocs: "Toda a documentação (em inglês)",
    allDocsBody:
      "Segurança, adaptadores, bancos de dados, autenticação e a referência completa da API.",
    tocLabel: "Nesta página",
    breadcrumb: "Trilha de navegação",
    pager: "Navegação entre páginas",
    previous: "Anterior",
    next: "Próxima",
    lastUpdated: "Última atualização:",
  },
  ar: {
    indexTitle: "التوثيق بالعربية",
    allDocs: "التوثيق الكامل (بالإنجليزية)",
    allDocsBody: "الأمان والمحولات وقواعد البيانات والمصادقة والمرجع الكامل لواجهة البرمجة.",
    tocLabel: "في هذه الصفحة",
    breadcrumb: "مسار التنقل",
    pager: "التنقل بين الصفحات",
    previous: "السابق",
    next: "التالي",
    lastUpdated: "آخر تحديث:",
  },
  ru: {
    indexTitle: "Документация на русском",
    allDocs: "Вся документация (на английском)",
    allDocsBody: "Безопасность, адаптеры, базы данных, аутентификация и полный справочник API.",
    tocLabel: "На этой странице",
    breadcrumb: "Навигационная цепочка",
    pager: "Навигация по страницам",
    previous: "Назад",
    next: "Далее",
    lastUpdated: "Последнее обновление:",
  },
};

/**
 * Sidebar for a translated docs section: the translated pages, then a link
 * out to the full English docs (a plain `<a>`: crossing locales reloads the
 * document).
 *
 * @param props.locale - Translated locale.
 */
export async function TranslatedDocsNav({ locale }: { locale: TranslatedLocale }) {
  const docs = await getOrderedTranslatedDocs(locale);
  const copy = TRANSLATED_DOCS_COPY[locale];

  return (
    <nav aria-label={copy.indexTitle} className="flex flex-col gap-1 text-sm">
      <TranslatedDocsNavList
        index={{ href: translatedDocsIndex(locale), title: copy.indexTitle }}
        items={docs.map((doc) => ({ href: doc.route, title: doc.frontmatter.title }))}
      />
      <a
        href="/docs"
        hrefLang="en"
        className="mt-3 border-t px-2.5 pt-3 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {copy.allDocs} {isRtl(locale) ? "←" : "→"}
      </a>
    </nav>
  );
}

/**
 * A locale's translated docs pages as `{ href, title, description }`, in
 * reading order, for the docs index cards.
 *
 * @param locale - Translated locale.
 * @returns One entry per translated docs page.
 */
export async function translatedDocsList(
  locale: TranslatedLocale,
): Promise<Array<{ href: string; title: string; description: string }>> {
  return (await getOrderedTranslatedDocs(locale)).map((doc) => ({
    href: doc.route,
    title: doc.frontmatter.title,
    description: doc.frontmatter.description,
  }));
}

/**
 * Breadcrumb for a translated docs page: the locale's docs index, then the
 * page. Server-rendered, so it is in the HTML crawlers and agents read.
 *
 * @param props.locale - Translated locale.
 * @param props.title - Current page title.
 */
export function TranslatedDocsBreadcrumb({ locale, title }: { locale: TranslatedLocale; title: string }) {
  const copy = TRANSLATED_DOCS_COPY[locale];
  return (
    <nav data-md-skip aria-label={copy.breadcrumb} className="not-prose mb-4 text-sm text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1.5">
        <li>
          <Link href={translatedDocsIndex(locale) as Route} className="hover:text-foreground">
            {copy.indexTitle}
          </Link>
        </li>
        <li aria-hidden>›</li>
        <li aria-current="page" className="text-foreground">
          {title}
        </li>
      </ol>
    </nav>
  );
}

/**
 * Previous/next links between a locale's translated docs pages, in reading
 * order.
 *
 * @param props.locale - Translated locale.
 * @param props.route - Current page route.
 */
export async function TranslatedDocsPager({ locale, route }: { locale: TranslatedLocale; route: string }) {
  const docs = await getOrderedTranslatedDocs(locale);
  const index = docs.findIndex((doc) => doc.route === route);
  if (index === -1) return null;
  const copy = TRANSLATED_DOCS_COPY[locale];
  const previous = docs[index - 1];
  const next = docs[index + 1];
  if (!previous && !next) return null;

  const cell =
    "flex flex-col gap-1 rounded-xl border p-4 text-sm no-underline transition-colors hover:border-foreground/25 hover:bg-muted/40";
  return (
    <nav data-md-skip aria-label={copy.pager} className="not-prose mt-12 grid gap-3 sm:grid-cols-2">
      {previous ? (
        <Link href={previous.route as Route} className={cell}>
          <span className="text-muted-foreground">
            {isRtl(locale) ? "→" : "←"} {copy.previous}
          </span>
          <span className="font-medium text-foreground">{previous.frontmatter.title}</span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={next.route as Route} className={`${cell} sm:text-end`}>
          <span className="text-muted-foreground">
            {copy.next} {isRtl(locale) ? "←" : "→"}
          </span>
          <span className="font-medium text-foreground">{next.frontmatter.title}</span>
        </Link>
      ) : null}
    </nav>
  );
}

/**
 * Git-derived "last updated" line for a translated docs page, formatted for
 * the locale. Renders nothing when history is unavailable (shallow clone),
 * like the English footer.
 *
 * @param props.locale - Translated locale.
 * @param props.route - Current page route.
 */
export async function TranslatedDocsLastUpdated({ locale, route }: { locale: TranslatedLocale; route: string }) {
  const date = await lastModifiedForRoute(route);
  if (!date) return null;
  const formatted = new Intl.DateTimeFormat(HTML_LANG[locale], { dateStyle: "long" }).format(date);
  return (
    <p className="not-prose mt-10 text-sm text-muted-foreground">
      {TRANSLATED_DOCS_COPY[locale].lastUpdated}{" "}
      <time dateTime={date.toISOString()}>{formatted}</time>
    </p>
  );
}
