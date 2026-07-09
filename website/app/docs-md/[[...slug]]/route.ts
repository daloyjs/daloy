import { parseHTML } from "linkedom";

import { getDocPage } from "@/lib/docs-content";
import { buildPageMarkdown } from "@/lib/page-markdown";
import { SITE_URL } from "@/lib/seo";

/**
 * Markdown endpoint for the documentation.
 *
 * Appending `.md` to any docs URL (e.g. `/docs/routing.md`, `/docs.md`) serves
 * the page as `text/markdown` for LLMs, agents, and curl users — the same
 * pattern nextjs.org uses for its docs. The public `.md` URLs are mapped onto
 * this handler by the rewrites in [next.config.ts](../../../next.config.ts).
 *
 * The requested path is validated against the docs pages discovered on disk
 * (`getDocPage`), then the handler fetches the page's prerendered HTML from
 * this deployment and converts the `[data-docs-content]` article to markdown
 * with the same shared converter that powers the docs "Copy page" button, so
 * both surfaces emit identical markdown.
 */

/**
 * Process-lifetime memo of successfully rendered markdown keyed by
 * `origin\0route`. The docs are static at runtime, so each page's markdown is
 * built at most once per deployment. Failures are intentionally not cached so a
 * transient self-fetch error does not stick for the life of the process.
 *
 * Replaces a `"use cache"` directive: nonce-based CSP requires dropping the
 * `cacheComponents`/PPR flag that `"use cache"` depends on.
 */
const markdownCache = new Map<string, string>();

/**
 * Fetch a docs page's rendered HTML and convert it to markdown. Memoized for
 * the lifetime of the deployment since the docs are static at runtime.
 *
 * @param origin - Origin of the current deployment, used for the self-fetch.
 * @param route - Canonical docs route, e.g. `/docs/routing`.
 * @returns The markdown document, or `null` when rendering fails.
 */
async function renderDocMarkdown(origin: string, route: string): Promise<string | null> {
  const key = `${origin} ${route}`;
  const cached = markdownCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const response = await fetch(`${origin}${route}`);

  if (!response.ok) {
    return null;
  }

  const { document } = parseHTML(await response.text());
  const article = document.querySelector("[data-docs-content]");

  if (!article) {
    return null;
  }

  const markdown =
    buildPageMarkdown(article as unknown as Element, `${SITE_URL}${route}`) || null;

  if (markdown !== null) {
    markdownCache.set(key, markdown);
  }

  return markdown;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug?: string[] }> },
) {
  const { slug } = await params;
  // `getDocPage` resolves the slug against the docs pages that exist on disk,
  // so only canonical, allowlisted routes are ever fetched below.
  const page = await getDocPage(slug?.length ? slug.join("/") : "/docs");

  if (!page) {
    return new Response("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const markdown = await renderDocMarkdown(new URL(request.url).origin, page.href);

  if (!markdown) {
    return new Response("Failed to render markdown for this page.", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
