import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isTranslatedPath, OG_USES_ENGLISH_CARD, type TranslatedLocale } from "@/lib/i18n";
import { buildMetadata } from "@/lib/seo";

import { getMdxDoc, getMdxDocs, getTranslatedMdxDoc, getTranslatedMdxDocs } from "./content";
import {
  TranslatedDocsBreadcrumb,
  TranslatedDocsLastUpdated,
  TranslatedDocsPager,
} from "@/components/translated-docs-nav";

import { MdxContent } from "./render";

/**
 * Static params for the MDX docs pages that live `depth` segments below
 * `/docs` (1 for `/docs/routing`, 2 for `/docs/security/session`).
 *
 * @param depth - Number of route segments under `/docs`.
 * @returns One `{ slug }` / `{ slug, child }` entry per page at that depth.
 */
export async function mdxDocParams(depth: 1 | 2): Promise<Array<{ slug: string; child?: string }>> {
  const docs = await getMdxDocs();
  return docs
    .filter((doc) => doc.segments.length === depth)
    .map((doc) => (depth === 1 ? { slug: doc.segments[0]! } : { slug: doc.segments[0]!, child: doc.segments[1]! }));
}

/**
 * `generateMetadata` for an MDX docs page: frontmatter through `buildMetadata`
 * (canonical URL, OpenGraph image, markdown alternate, and `hreflang`
 * alternates when the page has translations).
 *
 * @param segments - Route segments under `/docs` (empty for `/docs`).
 * @returns Page metadata, or `{}` when no page exists (the page then 404s).
 */
export async function mdxDocMetadata(segments: string[]): Promise<Metadata> {
  const doc = await getMdxDoc(segments);
  if (!doc) return {};
  return buildMetadata({
    ...doc.frontmatter,
    path: doc.route,
    type: "article",
    ...(isTranslatedPath(doc.route) ? { translatedPath: doc.route } : {}),
  });
}

/**
 * Render an MDX docs page, or a real 404 when there is none. Callers await
 * `params` before calling this and export `instant = false`, so an unknown
 * path is refused before anything streams (see app/docs/[slug]/[child]/page.tsx).
 *
 * @param segments - Route segments under `/docs` (empty for `/docs`).
 * @returns The rendered page body.
 */
export async function MdxDocPage({ segments }: { segments: string[] }) {
  const doc = await getMdxDoc(segments);
  if (!doc) notFound();
  return <MdxContent source={doc.body} file={doc.file} />;
}

/**
 * English route a translated docs page translates: `<prefix>/docs/a/b` →
 * `/docs/a/b`.
 *
 * @param segments - Route segments under `<prefix>/docs`.
 * @returns The English docs route.
 */
export function englishDocRoute(segments: string[]): string {
  return segments.length ? `/docs/${segments.join("/")}` : "/docs";
}

/**
 * Static params for a translated locale's docs pages `depth` segments below
 * `<prefix>/docs`.
 *
 * @param locale - Translated locale.
 * @param depth - Number of route segments under `<prefix>/docs`.
 * @returns One `{ slug }` / `{ slug, child }` entry per translated page.
 */
export async function translatedDocParams(
  locale: TranslatedLocale,
  depth: 1 | 2,
): Promise<Array<{ slug: string; child?: string }>> {
  const docs = await getTranslatedMdxDocs(locale);
  return docs
    .filter((doc) => doc.segments.length === depth)
    .map((doc) => (depth === 1 ? { slug: doc.segments[0]! } : { slug: doc.segments[0]!, child: doc.segments[1]! }));
}

/**
 * `generateMetadata` for a translated docs page: localized OpenGraph,
 * `hreflang` pairing with the English original and the other translations.
 *
 * @param locale - Translated locale.
 * @param segments - Route segments under `<prefix>/docs`.
 * @returns Page metadata, or `{}` when the page does not exist (it then 404s).
 */
export async function translatedDocMetadata(
  locale: TranslatedLocale,
  segments: string[],
): Promise<Metadata> {
  const doc = await getTranslatedMdxDoc(locale, segments);
  const english = englishDocRoute(segments);
  if (!doc || !isTranslatedPath(english)) return {};
  // Chinese pages render the English page's card (Latin-only OG fonts), so
  // the alt text must describe that card, not the Chinese title.
  const englishTitle = OG_USES_ENGLISH_CARD[locale] ? (await getMdxDoc(segments))?.frontmatter.title : undefined;
  return buildMetadata({
    ...doc.frontmatter,
    path: doc.route,
    type: "article",
    locale,
    translatedPath: english,
    // The route's own opengraph-image file (Chinese renders the English card:
    // the OG renderer ships Latin fonts only).
    image: `${doc.route}/opengraph-image`,
    ...(englishTitle ? { imageAlt: `${englishTitle} · DaloyJS` } : {}),
  });
}

const TRANSLATION_NOTICE: Record<TranslatedLocale, { before: string; link: string; after: string }> = {
  es: {
    before: "Traducción de la página original en inglés. Si algo no cuadra, prevalece la ",
    link: "versión en inglés",
    after: ".",
  },
  zh: {
    before: "本页译自英文原文。如有出入，以",
    link: "英文版本",
    after: "为准。",
  },
  fr: {
    before: "Traduction de la page originale en anglais. En cas de divergence, la ",
    link: "version anglaise",
    after: " fait foi.",
  },
  pt: {
    before: "Tradução da página original em inglês. Em caso de divergência, vale a ",
    link: "versão em inglês",
    after: ".",
  },
  ar: {
    before: "هذه ترجمة للصفحة الأصلية بالإنجليزية. عند وجود أي اختلاف، تُعتمد ",
    link: "النسخة الإنجليزية",
    after: ".",
  },
  ru: {
    before: "Перевод страницы с английского оригинала. При расхождениях приоритет имеет ",
    link: "английская версия",
    after: ".",
  },
};

/**
 * Render a translated docs page with a link back to the English original, or
 * a real 404 for an untranslated path. Same `instant = false` contract as
 * {@link MdxDocPage}.
 *
 * @param props.locale - Translated locale.
 * @param props.segments - Route segments under `<prefix>/docs`.
 * @returns The rendered page body.
 */
export async function TranslatedMdxDocPage({
  locale,
  segments,
}: {
  locale: TranslatedLocale;
  segments: string[];
}) {
  const doc = await getTranslatedMdxDoc(locale, segments);
  if (!doc) notFound();
  const english = englishDocRoute(segments);
  const notice = TRANSLATION_NOTICE[locale];
  return (
    <>
      <TranslatedDocsBreadcrumb locale={locale} title={doc.frontmatter.title} />
      <p className="not-prose mb-6 rounded-lg border bg-muted/40 px-4 py-3 text-sm leading-6 text-muted-foreground">
        {notice.before}
        {/* Cross-locale: a full document load (see lib/i18n.ts). */}
        <a className="underline underline-offset-4" href={english} hrefLang="en">
          {notice.link}
        </a>
        {notice.after}
      </p>
      <MdxContent source={doc.body} file={doc.file} locale={locale} />
      <TranslatedDocsLastUpdated locale={locale} route={doc.route} />
      <TranslatedDocsPager locale={locale} route={doc.route} />
    </>
  );
}
