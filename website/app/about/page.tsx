import Link from "next/link";
import type { Route } from "next";

import {
  ABOUT_PARAGRAPHS,
} from "@/lib/trust-content";
import {
  buildMetadata,
  buildOrganizationJsonLd,
  serializeJsonLd,
  SITE_URL,
} from "@/lib/seo";

export const metadata = buildMetadata({
  title: "About DaloyJS",
  description:
    "What DaloyJS is, who maintains it, and how the open-source TypeScript framework is licensed and published.",
  path: "/about",
  keywords: [
    "about DaloyJS",
    "DaloyJS team",
    "DaloyJS maintainer",
    "Devlin Duldulao",
  ],
  type: "article",
});

export default function AboutPage() {
  const jsonLd = [
    buildOrganizationJsonLd(),
    {
      "@context": "https://schema.org",
      "@type": "AboutPage",
      url: `${SITE_URL}/about`,
      name: "About DaloyJS",
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
        <h1 className="text-4xl font-bold tracking-tight">About DaloyJS</h1>
        {ABOUT_PARAGRAPHS.map((paragraph) => (
          <p
            key={paragraph.slice(0, 24)}
            className="mt-6 text-lg leading-8 text-muted-foreground"
          >
            {paragraph}
          </p>
        ))}
        <p className="mt-6 text-lg leading-8 text-muted-foreground">
          More:{" "}
          <Link className="underline underline-offset-4" href={"/contact" as Route}>
            contact
          </Link>
          {", "}
          <Link className="underline underline-offset-4" href={"/privacy" as Route}>
            privacy
          </Link>
          {", "}
          <Link
            className="underline underline-offset-4"
            href={"/about-the-name" as Route}
          >
            about the name
          </Link>
          {", and the "}
          <Link className="underline underline-offset-4" href={"/docs" as Route}>
            docs
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
