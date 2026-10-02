import type { Metadata } from "next";

import { MdxDocPage, mdxDocMetadata } from "@/lib/mdx/doc-page";

/** The docs landing page, authored in `content/docs/index.mdx`. */
export async function generateMetadata(): Promise<Metadata> {
  return mdxDocMetadata([]);
}

export default function Page() {
  return <MdxDocPage segments={[]} />;
}
