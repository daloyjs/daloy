import type { Metadata } from "next";

import { MdxDocPage, mdxDocMetadata, mdxDocParams } from "@/lib/mdx/doc-page";

type Params = { slug: string; child: string };

// instant = false: this page awaits `params` at the top so an unknown path
// hits notFound() before anything streams, which keeps it a real HTTP 404
// instead of a soft 404 inside a Suspense boundary. It costs nothing extra:
// the root layout is already blocking (nonce CSP, see app/layout.tsx), and
// every MDX page is still prerendered via generateStaticParams.
export const instant = false;

/** Two-segment MDX docs pages: `content/docs/<slug>/<child>.mdx`. */
export async function generateStaticParams() {
  return (await mdxDocParams(2)) as Params[];
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug, child } = await params;
  return mdxDocMetadata([slug, child]);
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const { slug, child } = await params;
  return <MdxDocPage segments={[slug, child]} />;
}
