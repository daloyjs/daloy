import { TranslatedDocsNavList } from "@/components/translated-docs-nav-list";
import {
  localizedPath,
  TRANSLATED_PATHS,
  translatedDocsIndex,
  type TranslatedLocale,
} from "@/lib/i18n";
import { getTranslatedMdxDocs } from "@/lib/mdx/content";

/** Chrome strings of the translated docs section, per locale. */
export const TRANSLATED_DOCS_COPY: Record<
  TranslatedLocale,
  { indexTitle: string; allDocs: string; allDocsBody: string; tocLabel: string }
> = {
  es: {
    indexTitle: "Documentación en español",
    allDocs: "Toda la documentación (en inglés)",
    allDocsBody:
      "Seguridad, adaptadores, bases de datos, autenticación y la referencia completa de la API.",
    tocLabel: "En esta página",
  },
  zh: {
    indexTitle: "中文文档",
    allDocs: "全部文档（英文）",
    allDocsBody: "安全、适配器、数据库、身份验证以及完整的 API 参考。",
    tocLabel: "本页内容",
  },
};

/** A locale's translated docs in reading order: the order of `TRANSLATED_PATHS`. */
async function orderedTranslatedDocs(locale: TranslatedLocale) {
  const docs = await getTranslatedMdxDocs(locale);
  const order = TRANSLATED_PATHS.filter((path) => path.startsWith("/docs/")).map((path) =>
    localizedPath(path, locale),
  );
  return docs
    .filter((doc) => order.includes(doc.route))
    .sort((a, b) => order.indexOf(a.route) - order.indexOf(b.route));
}

/**
 * Sidebar for a translated docs section: the translated pages, then a link
 * out to the full English docs (a plain `<a>`: crossing locales reloads the
 * document).
 *
 * @param props.locale - Translated locale.
 */
export async function TranslatedDocsNav({ locale }: { locale: TranslatedLocale }) {
  const docs = await orderedTranslatedDocs(locale);
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
        {copy.allDocs} →
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
  return (await orderedTranslatedDocs(locale)).map((doc) => ({
    href: doc.route,
    title: doc.frontmatter.title,
    description: doc.frontmatter.description,
  }));
}
