import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import { parseMdxSource } from "./mdx/content";

/** Root of the blog posts (`website/content/blog/<slug>.mdx`). */
const BLOG_DIR = path.join(process.cwd(), "content", "blog");

/** A header badge: a label, optionally with a non-default Badge variant. */
const badgeSchema = z.union([
  z.string().min(1),
  z.object({ label: z.string().min(1), variant: z.enum(["default", "secondary", "outline", "destructive"]) }).strict(),
]);

/**
 * Frontmatter every blog post must declare. Strict, so a typo fails the build
 * instead of silently dropping a field from the index, RSS or JSON-LD.
 */
export const blogFrontmatterSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().min(1),
    /** Publication date, `YYYY-MM-DD`. Drives ordering, the byline, RSS and JSON-LD. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    readingTime: z.string().min(1),
    author: z.string().min(1),
    authorRole: z.string().min(1),
    authorBio: z.string().min(1).optional(),
    /** Header badges, in order. */
    badges: z.array(badgeSchema).default([]),
    keywords: z.array(z.string()).default([]),
    /**
     * Links in the closing author card (name, bio, then these, separated by
     * dots). Omit for posts without the card.
     */
    footerLinks: z
      .array(z.object({ label: z.string().min(1), href: z.string().startsWith("/") }).strict())
      .optional(),
  })
  .strict();

/** Parsed blog frontmatter. */
export type BlogFrontmatter = z.infer<typeof blogFrontmatterSchema>;

/** One blog post, as listed on the index, in RSS, llms.txt and the sitemap. */
export type BlogPost = BlogFrontmatter & {
  slug: string;
  /** Path relative to the website root, e.g. `content/blog/introducing-daloyjs.mdx`. */
  file: string;
  /** MDX body (frontmatter lines blanked, so compiler line numbers match the file). */
  body: string;
};

/**
 * Read and validate every post in `content/blog`, newest first (ties broken by
 * slug). Runs once at module load: the set of posts is fixed per deployment,
 * and a synchronous list keeps every caller (index, RSS, llms.txt, sitemap)
 * simple.
 *
 * @returns All posts.
 * @throws {Error} When a post has invalid frontmatter.
 */
function loadBlogPosts(): BlogPost[] {
  let names: string[];
  try {
    names = readdirSync(BLOG_DIR).filter((name) => name.endsWith(".mdx"));
  } catch {
    return [];
  }
  return names
    .map((name) => {
      const file = path.join("content", "blog", name).split(path.sep).join("/");
      const { frontmatter, body } = parseMdxSource(readFileSync(path.join(BLOG_DIR, name), "utf8"), file, blogFrontmatterSchema);
      return { ...frontmatter, slug: name.replace(/\.mdx$/, ""), file, body } satisfies BlogPost;
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

/**
 * Canonical list of published blog posts, newest first, generated from the
 * frontmatter of `content/blog/*.mdx`. Shared by the blog index, the RSS feed,
 * `llms.txt` and the sitemap, so adding a post is one `.mdx` file.
 */
export const BLOG_POSTS: readonly BlogPost[] = loadBlogPosts();

/**
 * Look up one post by slug.
 *
 * @param slug - The post slug (file name without `.mdx`).
 * @returns The post, or `undefined` when there is none.
 */
export function getBlogPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((post) => post.slug === slug);
}
