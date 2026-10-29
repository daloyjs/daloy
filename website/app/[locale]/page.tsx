import type { Metadata } from "next";

import { HomePage } from "@/components/home/home-page";
import { HOME_COPIES } from "@/components/home/home-copies";
import { HTML_LANG, localeHome } from "@/lib/i18n";
import { PAGES_COPY } from "@/lib/i18n-pages";
import { resolveLocale } from "@/lib/i18n-route";
import {
  buildMetadata,
  buildOrganizationJsonLd,
  buildSoftwareApplicationJsonLd,
  HOME_TITLE,
  SITE_NAME,
  SITE_URL,
  WEBSITE_ID,
} from "@/lib/seo";

export const instant = false;

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const home = PAGES_COPY[locale].home;
  return buildMetadata({
    title: home.title,
    description: home.description,
    keywords: home.keywords,
    path: localeHome(locale),
    locale,
    translatedPath: "/",
    image: `${localeHome(locale)}/opengraph-image`,
    // A locale without its own card (ogFooter: null) shows the English one.
    ...(home.ogFooter === null ? { imageAlt: `${SITE_NAME} - ${HOME_TITLE}` } : {}),
  });
}

export default async function Page({ params }: Props) {
  const locale = await resolveLocale(params);
  const home = PAGES_COPY[locale].home;
  // Same entity graph as the English home page, plus a WebPage node that
  // declares this URL's language and ties it to the shared WebSite.
  const jsonLd = [
    buildOrganizationJsonLd(),
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "@id": `${SITE_URL}${localeHome(locale)}#webpage`,
      url: `${SITE_URL}${localeHome(locale)}`,
      name: home.title,
      description: home.description,
      inLanguage: HTML_LANG[locale],
      isPartOf: { "@id": WEBSITE_ID },
    },
    buildSoftwareApplicationJsonLd(),
  ];

  return <HomePage copy={HOME_COPIES[locale]} jsonLd={jsonLd} />;
}
