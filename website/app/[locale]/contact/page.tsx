import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";

import { HTML_LANG, localizedPath } from "@/lib/i18n";
import { PAGES_COPY } from "@/lib/i18n-pages";
import { resolveLocale } from "@/lib/i18n-route";
import { ORGANIZATION_EMAIL } from "@/lib/trust-content";
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
  const { title, description, keywords } = PAGES_COPY[locale].contact;
  return buildMetadata({
    title,
    description,
    keywords,
    path: localizedPath("/contact", locale),
    locale,
    translatedPath: "/contact",
    type: "article",
  });
}

export default async function ContactPage({ params }: Props) {
  const locale = await resolveLocale(params);
  const pages = PAGES_COPY[locale];
  const copy = pages.contact;
  const privacy = localizedPath("/privacy", locale);
  const jsonLd = [
    buildOrganizationJsonLd(),
    {
      "@context": "https://schema.org",
      "@type": "ContactPage",
      url: `${SITE_URL}${localizedPath("/contact", locale)}`,
      name: copy.heading,
      inLanguage: HTML_LANG[locale],
      mainEntity: { "@id": `${SITE_URL}/#organization` },
    },
  ];

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
          {copy.directLabel}{" "}
          <a className="underline underline-offset-4" href={`mailto:${ORGANIZATION_EMAIL}`}>
            {ORGANIZATION_EMAIL}
          </a>
          {pages.listSeparator}
          <a
            className="underline underline-offset-4"
            href="https://github.com/daloyjs/daloy/issues"
            target="_blank"
            rel="noreferrer"
          >
            {copy.issues}
          </a>
          {pages.listSeparator}
          <a
            className="underline underline-offset-4"
            href="https://github.com/daloyjs/daloy/security/advisories/new"
            target="_blank"
            rel="noreferrer"
          >
            {copy.advisory}
          </a>
          {copy.privacyLabel}
          <Link className="underline underline-offset-4" href={privacy as Route}>
            {privacy}
          </Link>
          {pages.end}
        </p>
      </section>
    </main>
  );
}
