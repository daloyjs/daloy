import { buildBlogRss } from "@/lib/blog-rss";

/** `GET /blog/rss.xml`: the blog RSS feed, fully static. */
export function GET(): Response {
  return new Response(buildBlogRss(), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
