import type { Route } from "next";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { BlogPost } from "@/lib/blog-posts";
import { serializeJsonLd, SITE_URL } from "@/lib/seo";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

/**
 * schema.org `BlogPosting` JSON-LD for a post, from its frontmatter.
 *
 * @param post - The post.
 * @returns The JSON-LD object.
 */
export function blogPostJsonLd(post: BlogPost): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    author: { "@type": "Person", name: post.author },
    publisher: { "@type": "Organization", name: "DaloyJS", url: SITE_URL },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${SITE_URL}/blog/${post.slug}`,
    },
    url: `${SITE_URL}/blog/${post.slug}`,
  };
}

/**
 * The shared chrome of every blog post: JSON-LD, the "Back to blog" link,
 * badges, title, description and byline, the post body in the prose column,
 * and (when `footerLinks` is set) the closing author card. Everything outside
 * the body comes from the post's frontmatter, so posts only author their body.
 *
 * @param props.post - The post (frontmatter + slug).
 * @param props.children - The rendered MDX body.
 */
export function BlogPostLayout({ post, children }: { post: BlogPost; children: ReactNode }) {
  return (
    <main className="flex-1">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(blogPostJsonLd(post)) }} />
      <article className="mx-auto max-w-3xl px-6 py-16 lg:py-20">
        <header className="not-prose mb-10">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/blog" className="underline-offset-4 hover:underline">
              &lt;- Back to blog
            </Link>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            {post.badges.map((badge) =>
              typeof badge === "string" ? (
                <Badge key={badge} variant="outline">
                  {badge}
                </Badge>
              ) : (
                <Badge key={badge.label} variant={badge.variant}>
                  {badge.label}
                </Badge>
              )
            )}
          </div>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">{post.title}</h1>
          <p className="mt-4 text-lg leading-8 text-muted-foreground">{post.description}</p>
          <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{post.author}</span>
            <span aria-hidden>·</span>
            <span>{post.authorRole}</span>
            <span aria-hidden>·</span>
            <time dateTime={post.date}>{dateFormatter.format(new Date(post.date))}</time>
            <span aria-hidden>·</span>
            <span>{post.readingTime}</span>
          </div>
        </header>

        <Separator className="mb-10" />

        <div className="docs-prose max-w-full">{children}</div>

        {post.footerLinks?.length ? (
          <>
            <Separator className="my-12" />
            <footer className="not-prose">
              <div className="rounded-xl border bg-muted/40 p-6">
                <p className="text-sm font-medium text-foreground">{post.author}</p>
                <p className="mt-1 text-sm text-muted-foreground">{post.authorBio}</p>
                <div className="mt-4 flex flex-wrap gap-3 text-sm">
                  {post.footerLinks.map((link, index) => (
                    <Fragment key={link.href}>
                      {index > 0 ? (
                        <span aria-hidden className="text-muted-foreground">
                          ·
                        </span>
                      ) : null}
                      <Link href={link.href as Route} className="underline underline-offset-4">
                        {link.label}
                      </Link>
                    </Fragment>
                  ))}
                </div>
              </div>
            </footer>
          </>
        ) : null}
      </article>
    </main>
  );
}
