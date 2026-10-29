import type { Metadata } from "next";

import { SpanishMdxDocPage, spanishDocMetadata, spanishDocParams } from "@/lib/mdx/doc-page";

type Params = { slug: string };

// instant = false: same contract as app/docs/[slug]/page.tsx. An untranslated
// slug must 404 before anything streams.
export const instant = false;

/** One-segment Spanish docs pages: `content/es/docs/<slug>.mdx`. */
export async function generateStaticParams() {
  return (await spanishDocParams(1)) as Params[];
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  return spanishDocMetadata([slug]);
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  return <SpanishMdxDocPage segments={[slug]} />;
}
