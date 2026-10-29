import { notFound } from "next/navigation";

import { resolveLocale } from "@/lib/i18n-route";
import { OG_USES_ENGLISH_CARD, TRANSLATED_LOCALES, type TranslatedLocale } from "@/lib/i18n";
import { getMdxDoc, getTranslatedMdxDoc } from "@/lib/mdx/content";
import { translatedDocParams } from "@/lib/mdx/doc-page";
import {
  ogImageContentType,
  ogImageSize,
  renderPageOgImage,
} from "@/lib/og-image";

export const alt = "DaloyJS documentation";

/** The card's label pill, in the page's language. */
const DOCS_LABEL: Record<TranslatedLocale, string> = {
  es: "Documentación",
  zh: "Docs",
  fr: "Documentation",
  pt: "Documentação",
  ar: "Docs",
  ru: "Docs",
};
export const size = ogImageSize;
export const contentType = ogImageContentType;

export async function generateStaticParams() {
  const perLocale = await Promise.all(
    TRANSLATED_LOCALES.map(async (locale) =>
      (await translatedDocParams(locale, 2)).map((params) => ({ locale, ...params })),
    ),
  );
  return perLocale.flat();
}

/**
 * Card for a translated docs page. A locale in a non-Latin script (Chinese)
 * renders the English page's card: the OG renderer ships Latin fonts only.
 */
export default async function Image({ params }: { params: Promise<{ locale: string; child: string; slug: string }> }) {
  const locale = await resolveLocale(params);
  const { slug, child } = await params;
  const doc = await getTranslatedMdxDoc(locale, [slug, child]);
  if (!doc) notFound();

  if (OG_USES_ENGLISH_CARD[locale]) {
    const english = await getMdxDoc([slug, child]);
    if (!english) notFound();
    return renderPageOgImage({ label: "Docs", title: english.frontmatter.title, path: english.route });
  }
  return renderPageOgImage({ label: DOCS_LABEL[locale], title: doc.frontmatter.title, path: doc.route });
}
