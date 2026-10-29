import { HomePage } from "@/components/home/home-page";
import { HOME_COPY_ES } from "@/components/home/home-copy-es";
import { HOME_DESCRIPTION_ES, HOME_TITLE_ES } from "@/lib/i18n-es";
import {
  buildMetadata,
  buildOrganizationJsonLd,
  buildSoftwareApplicationJsonLd,
  SITE_URL,
  WEBSITE_ID,
} from "@/lib/seo";

export const metadata = buildMetadata({
  title: HOME_TITLE_ES,
  description: HOME_DESCRIPTION_ES,
  path: "/es",
  locale: "es",
  translatedPath: "/",
  image: "/es/opengraph-image",
  keywords: [
    "DaloyJS en español",
    "framework TypeScript",
    "API REST TypeScript",
    "seguro por defecto",
    "OpenAPI 3.1",
    "cliente tipado",
    "cadena de suministro",
    "cero dependencias",
    "servidor MCP",
  ],
});

export default function Page() {
  // Same entity graph as the English home page, plus a WebPage node that
  // declares this URL's language and ties it to the shared WebSite.
  const jsonLd = [
    buildOrganizationJsonLd(),
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "@id": `${SITE_URL}/es#webpage`,
      url: `${SITE_URL}/es`,
      name: HOME_TITLE_ES,
      description: HOME_DESCRIPTION_ES,
      inLanguage: "es-ES",
      isPartOf: { "@id": WEBSITE_ID },
    },
    buildSoftwareApplicationJsonLd(),
  ];

  return <HomePage copy={HOME_COPY_ES} jsonLd={jsonLd} />;
}
