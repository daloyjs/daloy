import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getMdxDoc, getMdxDocs } from "@/lib/mdx/content";
import { MdxContent } from "@/lib/mdx/render";
import { buildMetadata } from "@/lib/seo";

type Params = { slug: string; child: string };

// instant = false: this page awaits `params` at the top so an unknown path
// hits notFound() before anything streams, which keeps it a real HTTP 404
// instead of a soft 404 inside a Suspense boundary. It costs nothing extra:
// the root layout is already blocking (nonce CSP, see app/layout.tsx), and
// every MDX page is still prerendered via generateStaticParams.
export const instant = false;

/**
 * Two-segment docs pages authored in MDX (`content/docs/<slug>/<child>.mdx`).
 * Folders that still have a static `app/docs/<slug>/<child>/page.tsx` take
 * precedence; only MDX pages are generated here, and any other path under
 * this pattern hits `notFound()`.
 */
export async function generateStaticParams(): Promise<Params[]> {
  const docs = await getMdxDocs();
  return docs
    .filter((doc) => doc.segments.length === 2)
    .map((doc) => ({ slug: doc.segments[0]!, child: doc.segments[1]! }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug, child } = await params;
  const doc = await getMdxDoc([slug, child]);
  if (!doc) return {};
  return buildMetadata({ ...doc.frontmatter, path: doc.route, type: "article" });
}

export default async function MdxDocPage({ params }: { params: Promise<Params> }) {
  const { slug, child } = await params;
  const doc = await getMdxDoc([slug, child]);
  if (!doc) notFound();
  return <MdxContent source={doc.body} file={doc.file} />;
}
