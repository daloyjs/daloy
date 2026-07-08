import { notFound } from "next/navigation";

import {
  getAllBlogPostOgContent,
  getBlogPostOgContent,
} from "@/lib/og-content";
import {
  ogImageContentType,
  ogImageSize,
  renderPageOgImage,
} from "@/lib/og-image";

export const alt = "DaloyJS blog post";
export const size = ogImageSize;
export const contentType = ogImageContentType;

export async function generateStaticParams() {
  const posts = await getAllBlogPostOgContent();

  return posts.map((post) => ({
    slug: post.path.replace(/^\/blog\//, ""),
  }));
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getBlogPostOgContent(slug);

  if (!post) {
    notFound();
  }

  return renderPageOgImage({
    label: "Blog",
    title: post.title,
    description: post.description,
    path: post.path,
  });
}
