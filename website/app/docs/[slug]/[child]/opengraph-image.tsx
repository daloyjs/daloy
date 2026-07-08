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
    .filter((slug) => slug.length === 2)
    .map(([slug, child]) => ({ slug, child }));
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string; child: string }>;
}) {
  const { slug, child } = await params;
  const page = await getDocOgContent(docPathFromSlug([slug, child]));

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
