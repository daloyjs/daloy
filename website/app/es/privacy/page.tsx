import Link from "next/link";
import type { Route } from "next";

import { PRIVACY_PARAGRAPHS_ES } from "@/lib/i18n-es";
import { ORGANIZATION_EMAIL } from "@/lib/trust-content";
import { buildMetadata, SITE_URL } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Política de privacidad de DaloyJS",
  description:
    "Qué datos recoge el sitio web daloyjs.dev, qué proveedores tratan el tráfico y cómo contactar con los mantenedores para cualquier consulta sobre privacidad.",
  path: "/es/privacy",
  locale: "es",
  translatedPath: "/privacy",
  keywords: [
    "privacidad DaloyJS",
    "política de privacidad daloyjs.dev",
    "analítica DaloyJS",
  ],
  type: "article",
});

export default function PrivacyPageEs() {
  return (
    <main className="flex-1">
      <section className="mx-auto max-w-3xl px-6 py-16 lg:py-20">
        <p className="text-sm text-muted-foreground">
          Última actualización: 21 de agosto de 2026 · Se aplica a {SITE_URL}
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">
          Política de privacidad de DaloyJS
        </h1>
        <p className="mt-6 rounded-lg border bg-muted/40 p-4 text-sm leading-6 text-muted-foreground">
          Esta es una traducción de cortesía. Si hay alguna discrepancia,
          prevalece la{" "}
          {/* Cross-locale: a full document load (see lib/i18n.ts). */}
          <a className="underline underline-offset-4" href="/privacy" hrefLang="en">
            versión en inglés
          </a>
          .
        </p>
        {PRIVACY_PARAGRAPHS_ES.map((paragraph) => (
          <p
            key={paragraph.slice(0, 24)}
            className="mt-6 text-lg leading-8 text-muted-foreground"
          >
            {paragraph}
          </p>
        ))}
        <p className="mt-6 text-lg leading-8 text-muted-foreground">
          Consultas de privacidad:{" "}
          <a className="underline underline-offset-4" href={`mailto:${ORGANIZATION_EMAIL}`}>
            {ORGANIZATION_EMAIL}
          </a>
          {". Otras formas de contacto: "}
          <Link className="underline underline-offset-4" href={"/es/contact" as Route}>
            /es/contact
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
