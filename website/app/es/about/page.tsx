import Link from "next/link";
import type { Route } from "next";

import { ABOUT_PARAGRAPHS_ES } from "@/lib/i18n-es";
import {
  buildMetadata,
  buildOrganizationJsonLd,
  serializeJsonLd,
  SITE_URL,
} from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Acerca de DaloyJS",
  description:
    "Qué es DaloyJS, quién lo mantiene y cómo se licencia y se publica este framework de TypeScript de código abierto, seguro por defecto y basado en contratos.",
  path: "/es/about",
  locale: "es",
  translatedPath: "/about",
  keywords: [
    "acerca de DaloyJS",
    "equipo de DaloyJS",
    "mantenedor de DaloyJS",
    "Devlin Duldulao",
  ],
  type: "article",
});

export default function AboutPageEs() {
  const jsonLd = [
    buildOrganizationJsonLd(),
    {
      "@context": "https://schema.org",
      "@type": "AboutPage",
      url: `${SITE_URL}/es/about`,
      name: "Acerca de DaloyJS",
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
        <h1 className="text-4xl font-bold tracking-tight">Acerca de DaloyJS</h1>
        {ABOUT_PARAGRAPHS_ES.map((paragraph) => (
          <p
            key={paragraph.slice(0, 24)}
            className="mt-6 text-lg leading-8 text-muted-foreground"
          >
            {paragraph}
          </p>
        ))}
        <p className="mt-6 text-lg leading-8 text-muted-foreground">
          Más:{" "}
          <Link className="underline underline-offset-4" href={"/es/contact" as Route}>
            contacto
          </Link>
          {", "}
          <Link className="underline underline-offset-4" href={"/es/privacy" as Route}>
            privacidad
          </Link>
          {", "}
          <Link
            className="underline underline-offset-4"
            href={"/es/about-the-name" as Route}
          >
            sobre el nombre
          </Link>
          {" y la "}
          <Link className="underline underline-offset-4" href={"/es/docs" as Route}>
            documentación en español
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
