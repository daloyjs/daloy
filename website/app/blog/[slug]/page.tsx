import type { MDXComponents } from "mdx/types";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BLOG_POST_SCOPES } from "@/components/blog";
import { BlogPostLayout } from "@/components/blog-post-layout";
import { BLOG_POSTS, getBlogPost } from "@/lib/blog-posts";
import { MdxContent } from "@/lib/mdx/render";
import { buildMetadata } from "@/lib/seo";

type Params = { slug: string };

// instant = false: awaits `params` at the top so an unknown slug is a real
// 404 before anything streams. The root layout is already blocking (nonce CSP).
export const instant = false;

/** Every post in `content/blog`. */
export function generateStaticParams(): Params[] {
  return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const post = getBlogPost((await params).slug);
  if (!post) return {};
  return buildMetadata({
    title: post.title,
    description: post.description,
    path: `/blog/${post.slug}`,
    keywords: post.keywords,
    type: "article",
  });
}

export default async function BlogPostPage({ params }: { params: Promise<Params> }) {
  const post = getBlogPost((await params).slug);
  if (!post) notFound();
  // A post's own helpers (components/blog/<slug>.tsx): PascalCase exports are
  // components, everything else is reached from the MDX as props.scope.<name>.
  const scope = BLOG_POST_SCOPES[post.slug] ?? {};
  const components = Object.fromEntries(Object.entries(scope).filter(([name]) => /^[A-Z]/.test(name))) as MDXComponents;
  return (
    <BlogPostLayout post={post}>
      <MdxContent source={post.body} file={post.file} components={components} scope={scope} />
    </BlogPostLayout>
  );
}
