import type { Route } from "next";
import Link from "next/link";

import { BLOG_POSTS } from "@/lib/blog-posts";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Blog",
  description:
    "Notes, stories, and field reports from the people building DaloyJS, the runtime-portable TypeScript framework with secure-by-default supply-chain hardening.",
  path: "/blog",
  keywords: ["DaloyJS blog", "TypeScript framework blog", "Daloy updates"],
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const POST_ACCENTS = [
  "border-mauve-200/80 bg-mauve-50/45 hover:border-mauve-300 dark:border-mauve-900/70 dark:bg-mauve-950/16",
  "border-olive-200/80 bg-olive-50/40 hover:border-olive-300 dark:border-olive-900/70 dark:bg-olive-950/16",
  "border-mist-200/80 bg-mist-50/45 hover:border-mist-300 dark:border-mist-900/70 dark:bg-mist-950/16",
  "border-taupe-200/80 bg-taupe-50/40 hover:border-taupe-300 dark:border-taupe-900/70 dark:bg-taupe-950/16",
] as const;

export default function BlogIndexPage() {
  return (
    <main className="flex-1">
      <section className="mx-auto max-w-3xl px-6 py-16 lg:py-20">
        <div className="mb-6 flex flex-wrap gap-2 text-[11px] font-semibold tracking-[0.22em] uppercase">
          <span className="rounded-full border border-mauve-300/80 bg-mauve-100/80 px-3 py-1 text-mauve-950 dark:border-mauve-800/70 dark:bg-mauve-950/35 dark:text-mauve-100">
            Field notes
          </span>
          <span className="rounded-full border border-olive-300/80 bg-olive-100/80 px-3 py-1 text-olive-950 dark:border-olive-800/70 dark:bg-olive-950/35 dark:text-olive-100">
            Shipping stories
          </span>
          <span className="rounded-full border border-taupe-300/80 bg-taupe-100/80 px-3 py-1 text-taupe-950 dark:border-taupe-800/70 dark:bg-taupe-950/35 dark:text-taupe-100">
            Dry humor included
          </span>
        </div>
        <h1 className="text-4xl font-bold tracking-tight">Blog</h1>
        <p className="mt-4 text-lg leading-8 text-muted-foreground">
          Field notes from people who actually use this thing in anger. Short,
          plainspoken, and occasionally funny.
        </p>

        <ul className="mt-12 space-y-10">
          {BLOG_POSTS.map((post, index) => (
            <li key={post.slug} className="group">
              {(() => {
                const href = `/blog/${post.slug}` as Route;
                const accent = POST_ACCENTS[index % POST_ACCENTS.length];

                return (
                  <Link
                    href={href}
                    className={`-mx-4 block rounded-2xl border p-5 shadow-sm transition-[border-color,background-color,transform] hover:-translate-y-0.5 ${accent}`}
                  >
                    <div className='flex flex-wrap items-center gap-x-3 gap-y-1 font-features-["tnum"] text-xs text-muted-foreground'>
                      <time dateTime={post.date}>
                        {dateFormatter.format(new Date(post.date))}
                      </time>
                      <span aria-hidden>·</span>
                      <span>{post.readingTime}</span>
                      <span aria-hidden>·</span>
                      <span>{post.author}</span>
                    </div>
                    <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground group-hover:text-primary">
                      {post.title}
                    </h2>
                    <p className="mt-2 leading-7 text-muted-foreground">
                      {post.description}
                    </p>
                  </Link>
                );
              })()}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
