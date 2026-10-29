import Link from "next/link";
import type { Route } from "next";

import { CONTACT_PARAGRAPHS_ES } from "@/lib/i18n-es";
import { ORGANIZATION_EMAIL } from "@/lib/trust-content";
import {
  buildMetadata,
  buildOrganizationJsonLd,
  serializeJsonLd,
  SITE_URL,
} from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Contactar con DaloyJS",
  description:
    "Correo electrónico, incidencias de GitHub y el canal privado para informar de vulnerabilidades en DaloyJS. Cómo ponerte en contacto con los mantenedores.",
  path: "/es/contact",
  locale: "es",
  translatedPath: "/contact",
  keywords: [
    "contacto DaloyJS",
    "correo DaloyJS",
    "contacto de seguridad DaloyJS",
    "daloyjs@gmail.com",
  ],
  type: "article",
});

export default function ContactPageEs() {
  const jsonLd = [
    buildOrganizationJsonLd(),
    {
      "@context": "https://schema.org",
      "@type": "ContactPage",
      url: `${SITE_URL}/es/contact`,
      name: "Contactar con DaloyJS",
      inLanguage: "es-ES",
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
        <h1 className="text-4xl font-bold tracking-tight">
          Contactar con DaloyJS
        </h1>
        {CONTACT_PARAGRAPHS_ES.map((paragraph) => (
          <p
            key={paragraph.slice(0, 24)}
            className="mt-6 text-lg leading-8 text-muted-foreground"
          >
            {paragraph}
          </p>
        ))}
        <p className="mt-6 text-lg leading-8 text-muted-foreground">
          Enlaces directos:{" "}
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
            incidencias de GitHub
          </a>
          {", "}
          <a
            className="underline underline-offset-4"
            href="https://github.com/daloyjs/daloy/security/advisories/new"
            target="_blank"
            rel="noreferrer"
          >
            aviso de seguridad privado
          </a>
          {". Privacidad: "}
          <Link className="underline underline-offset-4" href={"/es/privacy" as Route}>
            /es/privacy
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
