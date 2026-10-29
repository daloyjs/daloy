import { notFound } from "next/navigation";

import { resolveLocale } from "@/lib/i18n-route";
import { TRANSLATED_LOCALES } from "@/lib/i18n";
import { getMdxDoc, getTranslatedMdxDoc } from "@/lib/mdx/content";
import { translatedDocParams } from "@/lib/mdx/doc-page";
import {
  ogImageContentType,
  ogImageSize,
  renderPageOgImage,
} from "@/lib/og-image";

export const alt = "DaloyJS documentation";
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
 * Card for a translated docs page. Chinese renders the English page's card:
 * the OG renderer ships Latin fonts only.
 */
export default async function Image({ params }: { params: Promise<{ locale: string; child: string; slug: string }> }) {
  const locale = await resolveLocale(params);
  const { slug, child } = await params;
  const doc = await getTranslatedMdxDoc(locale, [slug, child]);
  if (!doc) notFound();

  if (locale === "zh") {
    const english = await getMdxDoc([slug, child]);
    if (!english) notFound();
    return renderPageOgImage({ label: "Docs", title: english.frontmatter.title, path: english.route });
  }
  return renderPageOgImage({ label: "Documentación", title: doc.frontmatter.title, path: doc.route });
}
