import type { Metadata } from "next";

import { resolveLocale } from "@/lib/i18n-route";
import { TRANSLATED_LOCALES } from "@/lib/i18n";
import { TranslatedMdxDocPage, translatedDocMetadata, translatedDocParams } from "@/lib/mdx/doc-page";

type Params = { locale: string; slug: string };

// instant = false: same contract as the English docs loaders. An untranslated
// path or unknown locale must 404 before anything streams.
export const instant = false;

/** Translated docs pages 1 segment(s) under `<prefix>/docs`, for every locale. */
export async function generateStaticParams() {
  const perLocale = await Promise.all(
    TRANSLATED_LOCALES.map(async (locale) =>
      (await translatedDocParams(locale, 1)).map((params) => ({ locale, ...params })),
    ),
  );
  return perLocale.flat() as Params[];
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { slug } = await params;
  return translatedDocMetadata(locale, [slug]);
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const locale = await resolveLocale(params);
  const { slug } = await params;
  return <TranslatedMdxDocPage locale={locale} segments={[slug]} />;
}
