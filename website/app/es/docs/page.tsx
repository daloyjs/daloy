import { Card, Cards } from "@/components/cards";
import { spanishDocsIndex } from "@/components/spanish-docs-nav";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Documentación en español",
  description:
    "Primeros pasos con DaloyJS en castellano: instalación, tu primera ruta basada en contratos y un tutorial completo. El resto de la documentación está en inglés.",
  path: "/es/docs",
  locale: "es",
  image: "/es/opengraph-image",
  keywords: [
    "documentación DaloyJS",
    "DaloyJS en español",
    "tutorial TypeScript API",
    "primeros pasos DaloyJS",
  ],
});

/**
 * `/es/docs`: index of the translated docs pages. It has no English twin
 * (the English `/docs` index covers every page), so it declares no
 * `hreflang` alternates.
 */
export default async function SpanishDocsIndexPage() {
  const pages = await spanishDocsIndex();

  return (
    <>
      <h1>Documentación en español</h1>
      <p>
        Estas páginas te llevan de una carpeta vacía a una API tipada y probada.
        Son traducciones de la documentación original en inglés; el resto de
        la documentación técnica (seguridad, adaptadores, referencia de la API
        y demás) está, de momento, solo en inglés.
      </p>
      <Cards>
        {pages.map((page) => (
          <Card key={page.href} title={page.title} href={page.href} locale="es">
            {page.description}
          </Card>
        ))}
        <Card title="Toda la documentación (en inglés)" href="/docs" locale="es">
          Seguridad, adaptadores, bases de datos, autenticación y la referencia
          completa de la API.
        </Card>
      </Cards>
    </>
  );
}
