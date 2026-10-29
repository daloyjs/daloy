import { notFound } from "next/navigation";

import { getSpanishMdxDoc } from "@/lib/mdx/content";
import { spanishDocParams } from "@/lib/mdx/doc-page";
import {
  ogImageContentType,
  ogImageSize,
  renderPageOgImage,
} from "@/lib/og-image";

export const alt = "Documentación de DaloyJS";
export const size = ogImageSize;
export const contentType = ogImageContentType;

export async function generateStaticParams() {
  return spanishDocParams(1);
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const doc = await getSpanishMdxDoc([slug]);

  if (!doc) {
    notFound();
  }

  return renderPageOgImage({
    label: "Documentación",
    title: doc.frontmatter.title,
    path: doc.route,
  });
}
