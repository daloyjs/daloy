import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";

import { localizedPath } from "@/lib/i18n";
import { PAGES_COPY } from "@/lib/i18n-pages";
import { resolveLocale } from "@/lib/i18n-route";
import { ORGANIZATION_EMAIL } from "@/lib/trust-content";
import { buildMetadata, SITE_URL } from "@/lib/seo";

export const instant = false;

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { title, description, keywords } = PAGES_COPY[locale].privacy;
  return buildMetadata({
    title,
    description,
    keywords,
    path: localizedPath("/privacy", locale),
    locale,
    translatedPath: "/privacy",
    type: "article",
  });
}

export default async function PrivacyPage({ params }: Props) {
  const locale = await resolveLocale(params);
  const pages = PAGES_COPY[locale];
  const copy = pages.privacy;
  const contact = localizedPath("/contact", locale);

  return (
    <main className="flex-1">
      <section className="mx-auto max-w-3xl px-6 py-16 lg:py-20">
        <p className="text-sm text-muted-foreground">
          {copy.updated} · {copy.appliesTo} {SITE_URL}
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">{copy.heading}</h1>
        <p className="mt-6 rounded-lg border bg-muted/40 p-4 text-sm leading-6 text-muted-foreground">
          {copy.courtesy.before}
          {/* Cross-locale: a full document load (see lib/i18n.ts). */}
          <a className="underline underline-offset-4" href="/privacy" hrefLang="en">
            {copy.courtesy.link}
          </a>
          {copy.courtesy.after}
        </p>
        {copy.paragraphs.map((paragraph) => (
          <p
            key={paragraph.slice(0, 24)}
            className="mt-6 text-lg leading-8 text-muted-foreground"
          >
            {paragraph}
          </p>
        ))}
        <p className="mt-6 text-lg leading-8 text-muted-foreground">
          {copy.questions}{" "}
          <a className="underline underline-offset-4" href={`mailto:${ORGANIZATION_EMAIL}`}>
            {ORGANIZATION_EMAIL}
          </a>
          {copy.otherContact}
          <Link className="underline underline-offset-4" href={contact as Route}>
            {contact}
          </Link>
          {pages.end}
        </p>
      </section>
    </main>
  );
}
