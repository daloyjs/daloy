import type { Metadata } from "next";

import { Card, Cards } from "@/components/cards";
import { TRANSLATED_DOCS_COPY, translatedDocsList } from "@/components/translated-docs-nav";
import { localeHome, translatedDocsIndex } from "@/lib/i18n";
import { PAGES_COPY } from "@/lib/i18n-pages";
import { resolveLocale } from "@/lib/i18n-route";
import { buildMetadata, HOME_TITLE, SITE_NAME } from "@/lib/seo";

export const instant = false;

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { title, description, keywords } = PAGES_COPY[locale].docsIndex;
  return buildMetadata({
    title,
    description,
    keywords,
    path: translatedDocsIndex(locale),
    locale,
    image: `${localeHome(locale)}/opengraph-image`,
    ...(PAGES_COPY[locale].home.ogFooter === null ? { imageAlt: `${SITE_NAME} - ${HOME_TITLE}` } : {}),
  });
}

/**
 * A translated docs index (`/es/docs`, `/zh/docs`). It has no English twin
 * (the English `/docs` index covers every page), so it declares no
 * `hreflang` alternates.
 */
export default async function TranslatedDocsIndexPage({ params }: Props) {
  const locale = await resolveLocale(params);
  const copy = PAGES_COPY[locale].docsIndex;
  const chrome = TRANSLATED_DOCS_COPY[locale];
  const pages = await translatedDocsList(locale);

  return (
    <>
      <h1>{copy.heading}</h1>
      <p>{copy.intro}</p>
      <Cards>
        {pages.map((page) => (
          <Card key={page.href} title={page.title} href={page.href} locale={locale}>
            {page.description}
          </Card>
        ))}
        <Card title={chrome.allDocs} href="/docs" locale={locale}>
          {chrome.allDocsBody}
        </Card>
      </Cards>
    </>
  );
}
