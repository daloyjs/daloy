import Link from "next/link";
import type { Route } from "next";

import { CONTACT_PARAGRAPHS, ORGANIZATION_EMAIL } from "@/lib/trust-content";
import {
  buildMetadata,
  buildOrganizationJsonLd,
  serializeJsonLd,
  SITE_URL,
} from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Contact DaloyJS",
  description:
    "Email, GitHub issues, and private security reporting for DaloyJS. How to reach the maintainers.",
  path: "/contact",
  keywords: [
    "contact DaloyJS",
    "DaloyJS email",
    "DaloyJS security contact",
    "daloyjs@gmail.com",
  ],
  type: "article",
});

export default function ContactPage() {
  const jsonLd = [
    buildOrganizationJsonLd(),
    {
      "@context": "https://schema.org",
      "@type": "ContactPage",
      url: `${SITE_URL}/contact`,
      name: "Contact DaloyJS",
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
        <h1 className="text-4xl font-bold tracking-tight">Contact DaloyJS</h1>
        {CONTACT_PARAGRAPHS.map((paragraph) => (
          <p
            key={paragraph.slice(0, 24)}
            className="mt-6 text-lg leading-8 text-muted-foreground"
          >
            {paragraph}
          </p>
        ))}
        <p className="mt-6 text-lg leading-8 text-muted-foreground">
          Direct links:{" "}
          <a className="underline underline-offset-4" href={`mailto:${ORGANIZATION_EMAIL}`}>
            {ORGANIZATION_EMAIL}
          </a>
          {", "}
          <a
            className="underline underline-offset-4"
            href="https://github.com/daloyjs/daloy/issues"
            target="_blank"
            rel="noreferrer"
          >
            GitHub issues
          </a>
          {", "}
          <a
            className="underline underline-offset-4"
            href="https://github.com/daloyjs/daloy/security/advisories/new"
            target="_blank"
            rel="noreferrer"
          >
            private security advisory
          </a>
          {". Privacy: "}
          <Link className="underline underline-offset-4" href={"/privacy" as Route}>
            /privacy
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
