import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";
import { Fragment } from "react";

import { HTML_LANG, localizedPath } from "@/lib/i18n";
import { PAGES_COPY } from "@/lib/i18n-pages";
import { resolveLocale } from "@/lib/i18n-route";
import {
  buildMetadata,
  buildOrganizationJsonLd,
  serializeJsonLd,
  SITE_URL,
} from "@/lib/seo";

export const instant = false;

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { title, description, keywords } = PAGES_COPY[locale].about;
  return buildMetadata({
    title,
    description,
    keywords,
    path: localizedPath("/about", locale),
    locale,
    translatedPath: "/about",
    type: "article",
  });
}

export default async function AboutPage({ params }: Props) {
  const locale = await resolveLocale(params);
  const pages = PAGES_COPY[locale];
  const copy = pages.about;
  const path = localizedPath("/about", locale);
  const jsonLd = [
    buildOrganizationJsonLd(),
    {
      "@context": "https://schema.org",
      "@type": "AboutPage",
      url: `${SITE_URL}${path}`,
      name: copy.heading,
      inLanguage: HTML_LANG[locale],
      mainEntity: { "@id": `${SITE_URL}/#organization` },
    },
  ];
  const links = copy.more.links;

  return (
    <main className="flex-1">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <section className="mx-auto max-w-3xl px-6 py-16 lg:py-20">
        <h1 className="text-4xl font-bold tracking-tight">{copy.heading}</h1>
        {copy.paragraphs.map((paragraph) => (
          <p
            key={paragraph.slice(0, 24)}
            className="mt-6 text-lg leading-8 text-muted-foreground"
          >
            {paragraph}
          </p>
        ))}
        <p className="mt-6 text-lg leading-8 text-muted-foreground">
          {copy.more.label}{" "}
          {links.map((link, index) => (
            <Fragment key={link.href}>
              {index === 0
                ? null
                : index === links.length - 1
                  ? copy.more.lastSeparator
                  : pages.listSeparator}
              <Link className="underline underline-offset-4" href={link.href as Route}>
                {link.label}
              </Link>
            </Fragment>
          ))}
          {pages.end}
        </p>
      </section>
    </main>
  );
}
