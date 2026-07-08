import { notFound } from "next/navigation";

import {
  docPathFromSlug,
  getAllDocOgContent,
  getDocOgContent,
} from "@/lib/og-content";
import {
  ogImageContentType,
  ogImageSize,
  renderPageOgImage,
} from "@/lib/og-image";

export const alt = "DaloyJS documentation";
export const size = ogImageSize;
export const contentType = ogImageContentType;

export async function generateStaticParams() {
  const pages = await getAllDocOgContent();

  return pages
    .map((page) => page.path.replace(/^\/docs\//, "").split("/"))
    .filter((slug) => slug.length === 1 && slug[0] !== "/docs")
    .map(([slug]) => ({ slug }));
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = await getDocOgContent(docPathFromSlug([slug]));

  if (!page) {
    notFound();
  }

  return renderPageOgImage({
    label: "Docs",
    title: page.title,
    description: page.description,
    path: page.path,
  });
}
