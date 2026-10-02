import type { Metadata } from "next";

import { MdxDocPage, mdxDocMetadata, mdxDocParams } from "@/lib/mdx/doc-page";

type Params = { slug: string };

// instant = false: same reasoning as app/docs/[slug]/[child]/page.tsx. An
// unknown slug must 404 before anything streams, and the root layout is
// already blocking for the nonce CSP.
export const instant = false;

/**
 * One-segment MDX docs pages: `content/docs/<slug>.mdx` (a section index like
 * `content/docs/security.mdx` sits next to its `content/docs/security/` folder).
 */
export async function generateStaticParams() {
  return (await mdxDocParams(1)) as Params[];
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  return mdxDocMetadata([slug]);
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  return <MdxDocPage segments={[slug]} />;
}
