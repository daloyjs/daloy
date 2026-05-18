import Link from "next/link";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Blog",
  description:
    "Notes, stories, and field reports from the people building DaloyJS — a runtime-portable TypeScript web framework.",
  path: "/blog",
  keywords: ["DaloyJS blog", "TypeScript framework blog", "Daloy updates"],
});

const POSTS = [
  {
    slug: "the-flow-i-wished-i-had",
    title: "The flow I wished I had: why we built DaloyJS",
    description:
      "Ten years of shipping fullstack apps, one Filipino dev in Norway, and the framework I kept wishing existed at 2am.",
    date: "2026-05-18",
    readingTime: "9 min read",
    author: "Devlin Duldulao",
  },
];

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

export default function BlogIndexPage() {
  return (
    <main className="flex-1">
      <section className="mx-auto max-w-3xl px-6 py-16 lg:py-20">
        <h1 className="text-4xl font-bold tracking-tight">Blog</h1>
        <p className="mt-4 text-lg leading-8 text-muted-foreground">
          Field notes from people who actually use this thing in anger. Short, honest, and
          occasionally funny.
        </p>

        <ul className="mt-12 space-y-10">
          {POSTS.map((post) => (
            <li key={post.slug} className="group">
              <Link
                href={`/blog/${post.slug}`}
                className="block rounded-lg border border-transparent p-4 -mx-4 transition-colors hover:border-border hover:bg-muted/40"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <time dateTime={post.date}>{dateFormatter.format(new Date(post.date))}</time>
                  <span aria-hidden>·</span>
                  <span>{post.readingTime}</span>
                  <span aria-hidden>·</span>
                  <span>{post.author}</span>
                </div>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground group-hover:text-primary">
                  {post.title}
                </h2>
                <p className="mt-2 leading-7 text-muted-foreground">{post.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
