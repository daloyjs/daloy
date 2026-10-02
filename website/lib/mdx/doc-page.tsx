import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { buildMetadata } from "@/lib/seo";

import { getMdxDoc, getMdxDocs } from "./content";
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
 * (canonical URL, OpenGraph image, markdown alternate).
 *
 * @param segments - Route segments under `/docs` (empty for `/docs`).
 * @returns Page metadata, or `{}` when no page exists (the page then 404s).
 */
export async function mdxDocMetadata(segments: string[]): Promise<Metadata> {
  const doc = await getMdxDoc(segments);
  if (!doc) return {};
  return buildMetadata({ ...doc.frontmatter, path: doc.route, type: "article" });
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
