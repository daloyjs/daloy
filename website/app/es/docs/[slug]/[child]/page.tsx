import type { Metadata } from "next";

import { SpanishMdxDocPage, spanishDocMetadata, spanishDocParams } from "@/lib/mdx/doc-page";

type Params = { slug: string; child: string };

// instant = false: same contract as app/docs/[slug]/[child]/page.tsx. An
// untranslated path must 404 before anything streams.
export const instant = false;

/** Two-segment Spanish docs pages: `content/es/docs/<slug>/<child>.mdx`. */
export async function generateStaticParams() {
  return (await spanishDocParams(2)) as Params[];
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug, child } = await params;
  return spanishDocMetadata([slug, child]);
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const { slug, child } = await params;
  return <SpanishMdxDocPage segments={[slug, child]} />;
}
