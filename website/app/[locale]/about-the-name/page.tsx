import type { Metadata } from "next";

import { localizedPath } from "@/lib/i18n";
import { PAGES_COPY } from "@/lib/i18n-pages";
import { resolveLocale } from "@/lib/i18n-route";
import { buildMetadata } from "@/lib/seo";

export const instant = false;

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { title, description, keywords } = PAGES_COPY[locale].aboutTheName;
  return buildMetadata({
    title,
    description,
    keywords,
    path: localizedPath("/about-the-name", locale),
    locale,
    translatedPath: "/about-the-name",
    type: "article",
  });
}

export default async function AboutTheNamePage({ params }: Props) {
  const copy = PAGES_COPY[await resolveLocale(params)].aboutTheName;
  return (
    <main className="flex-1">
      <section className="mx-auto max-w-3xl px-6 py-16 lg:py-20">
        <h1 className="text-4xl font-bold tracking-tight">{copy.heading}</h1>
        {copy.body}
      </section>
    </main>
  );
}
