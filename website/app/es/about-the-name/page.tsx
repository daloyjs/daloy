import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Sobre el nombre",
  description:
    "Qué significa Daloy, cómo se pronuncia y por qué el framework de TypeScript DaloyJS lleva este nombre tagalo, que quiere decir flujo, como seña de identidad.",
  path: "/es/about-the-name",
  locale: "es",
  translatedPath: "/about-the-name",
  keywords: [
    "significado de Daloy",
    "pronunciación de Daloy",
    "nombre DaloyJS",
    "flujo en tagalo",
  ],
  type: "article",
});

export default function AboutTheNamePageEs() {
  return (
    <main className="flex-1">
      <section className="mx-auto max-w-3xl px-6 py-16 lg:py-20">
        <h1 className="text-4xl font-bold tracking-tight">Sobre el nombre</h1>
        <p className="mt-6 text-lg leading-8 text-muted-foreground">
          <span className="font-medium text-foreground">Daloy</span> significa{" "}
          <strong>flujo</strong> en tagalo. Lo pronunciamos{" "}
          <strong>da-loy</strong>.
        </p>
        <p className="mt-4 leading-8 text-muted-foreground">
          La grafía en baybayin{" "}
          <span className="font-medium text-foreground">ᜇᜎᜓᜌ᜔ </span> forma
          parte de la identidad del proyecto, pero en la práctica el nombre del
          framework sigue siendo sencillo:{" "}
          <strong className="text-foreground">DaloyJS</strong>.
        </p>
        <p className="mt-4 leading-8 text-muted-foreground">
          El nombre encaja con el producto: las peticiones, las respuestas, los
          contratos, los tipos y los clientes generados avanzan por un único
          flujo basado en contratos en lugar de separarse en capas distintas.
        </p>
      </section>
    </main>
  );
}
