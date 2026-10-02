import type { Route } from "next";

import { BLOG_POSTS, getBlogPost } from "@/lib/blog-posts";
import { getAllDocPages, getDocPage } from "@/lib/docs-content";

export type OgPageContent = {
  title: string;
  path: string;
};

/**
 * OG content for every blog post, from the posts' frontmatter
 * (`content/blog/*.mdx` via `BLOG_POSTS`).
 *
 * @returns One entry per post.
 */
export async function getAllBlogPostOgContent(): Promise<OgPageContent[]> {
  return BLOG_POSTS.map((post) => ({ title: post.title, path: `/blog/${post.slug}` }));
}

/**
 * OG content for one blog post.
 *
 * @param slug - The post slug. Unknown or unsafe slugs return `null` (the
 *   lookup is an exact match against known posts, never a file path).
 * @returns The post's OG title and path, or `null`.
 */
export async function getBlogPostOgContent(slug: string): Promise<OgPageContent | null> {
  const post = getBlogPost(slug);
  return post ? { title: post.title, path: `/blog/${post.slug}` } : null;
}

export async function getAllDocOgContent(): Promise<OgPageContent[]> {
  const pages = await getAllDocPages();

  return pages.map((page) => ({
    title: page.title,
    path: page.href,
  }));
}

export async function getDocOgContent(route: string): Promise<OgPageContent | null> {
  const page = await getDocPage(route);
  if (!page) return null;

  return {
    title: page.title,
    path: page.href,
  };
}

export function docPathFromSlug(slug: string[]): Route {
  return slug.length === 0 ? "/docs" : (`/docs/${slug.join("/")}` as Route);
}
