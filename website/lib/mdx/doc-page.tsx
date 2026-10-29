import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isTranslatedPath } from "@/lib/i18n";
import { buildMetadata } from "@/lib/seo";

import { getMdxDoc, getMdxDocs, getSpanishMdxDoc, getSpanishMdxDocs } from "./content";
import { MdxContent } from "./render";

/**
 * Static params for the MDX docs pages that live `depth` segments below
 * `/docs` (1 for `/docs/routing`, 2 for `/docs/security/session`).
 *
 * @param depth - Number of route segments under `/docs`.
 * @returns One `{ slug }` / `{ slug, child }` entry per page at that depth.
 */
export async function mdxDocParams(depth: 1 | 2): Promise<Array<{ slug: string; child?: string }>> {
  const docs = await getMdxDocs();
  return docs
    .filter((doc) => doc.segments.length === depth)
    .map((doc) => (depth === 1 ? { slug: doc.segments[0]! } : { slug: doc.segments[0]!, child: doc.segments[1]! }));
}

/**
 * `generateMetadata` for an MDX docs page: frontmatter through `buildMetadata`
 * (canonical URL, OpenGraph image, markdown alternate, and `hreflang`
 * alternates when the page has a Spanish translation).
 *
 * @param segments - Route segments under `/docs` (empty for `/docs`).
 * @returns Page metadata, or `{}` when no page exists (the page then 404s).
 */
export async function mdxDocMetadata(segments: string[]): Promise<Metadata> {
  const doc = await getMdxDoc(segments);
  if (!doc) return {};
  return buildMetadata({
    ...doc.frontmatter,
    path: doc.route,
    type: "article",
    ...(isTranslatedPath(doc.route) ? { translatedPath: doc.route } : {}),
  });
}

/**
 * Render an MDX docs page, or a real 404 when there is none. Callers await
 * `params` before calling this and export `instant = false`, so an unknown
 * path is refused before anything streams (see app/docs/[slug]/[child]/page.tsx).
 *
 * @param segments - Route segments under `/docs` (empty for `/docs`).
 * @returns The rendered page body.
 */
export async function MdxDocPage({ segments }: { segments: string[] }) {
  const doc = await getMdxDoc(segments);
  if (!doc) notFound();
  return <MdxContent source={doc.body} file={doc.file} />;
}

/**
 * English route a Spanish docs page translates: `/es/docs/a/b` → `/docs/a/b`.
 *
 * @param segments - Route segments under `/es/docs`.
 * @returns The English docs route.
 */
export function englishDocRoute(segments: string[]): string {
  return segments.length ? `/docs/${segments.join("/")}` : "/docs";
}

/**
 * Static params for the Spanish docs pages `depth` segments below `/es/docs`.
 *
 * @param depth - Number of route segments under `/es/docs`.
 * @returns One `{ slug }` / `{ slug, child }` entry per translated page.
 */
export async function spanishDocParams(depth: 1 | 2): Promise<Array<{ slug: string; child?: string }>> {
  const docs = await getSpanishMdxDocs();
  return docs
    .filter((doc) => doc.segments.length === depth)
    .map((doc) => (depth === 1 ? { slug: doc.segments[0]! } : { slug: doc.segments[0]!, child: doc.segments[1]! }));
}

/**
 * `generateMetadata` for a Spanish docs page: `es_ES` OpenGraph, `hreflang`
 * pairing with the English original, and the page's own OG image.
 *
 * @param segments - Route segments under `/es/docs`.
 * @returns Page metadata, or `{}` when the page does not exist (it then 404s).
 */
export async function spanishDocMetadata(segments: string[]): Promise<Metadata> {
  const doc = await getSpanishMdxDoc(segments);
  const english = englishDocRoute(segments);
  if (!doc || !isTranslatedPath(english)) return {};
  return buildMetadata({
    ...doc.frontmatter,
    path: doc.route,
    type: "article",
    locale: "es",
    translatedPath: english,
    image: `${doc.route}/opengraph-image`,
  });
}

/**
 * Render a Spanish docs page with a link back to the English original, or a
 * real 404 for an untranslated path. Same `instant = false` contract as
 * {@link MdxDocPage}.
 *
 * @param segments - Route segments under `/es/docs`.
 * @returns The rendered page body.
 */
export async function SpanishMdxDocPage({ segments }: { segments: string[] }) {
  const doc = await getSpanishMdxDoc(segments);
  if (!doc) notFound();
  const english = englishDocRoute(segments);
  return (
    <>
      <p className="not-prose mb-6 rounded-lg border bg-muted/40 px-4 py-3 text-sm leading-6 text-muted-foreground">
        Traducción de la página original en inglés. Si algo no cuadra, prevalece la{" "}
        {/* Cross-locale: a full document load (see lib/i18n.ts). */}
        <a className="underline underline-offset-4" href={english} hrefLang="en">
          versión en inglés
        </a>
        .
      </p>
      <MdxContent source={doc.body} file={doc.file} locale="es" />
    </>
  );
}
