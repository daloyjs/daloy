/**
 * Convert a rendered HTML page on this deployment into Markdown.
 *
 * Docs pages prefer `[data-docs-content]` so the sidebar is dropped. Other
 * pages use `<main>` (the header and footer live outside it in the root
 * layout). Used by the `/md/*` handler and the `/docs-md/*` compatibility
 * handler so `.md` URLs and `Accept: text/markdown` emit the same body.
 */

import { parseHTML } from "linkedom";

import { getDocPage } from "@/lib/docs-content";
import { notFoundMarkdown } from "@/lib/not-found-body";
import { buildPageMarkdown } from "@/lib/page-markdown";
import { SITE_URL } from "@/lib/seo";

const markdownCache = new Map<string, string>();

/** Header the Markdown handler sends on the HTML self-fetch. */
const HTML_ACCEPT = "text/html";

function cacheKey(origin: string, path: string): string {
  return `${origin}\0${path}`;
}

function isDocsPath(path: string): boolean {
  return (
    (path === "/docs" || path.startsWith("/docs/")) &&
    !path.endsWith(".md") &&
    !path.endsWith("/llms.txt")
  );
}

/**
 * Normalize a request path for Markdown rendering: strip a trailing slash
 * (except `/`) and a trailing `.md` so `/docs/routing.md` and `/docs/routing`
 * share a cache entry.
 *
 * @param pathname - Raw pathname from the request URL.
 */
export function canonicalMarkdownPath(pathname: string): string {
  let path = pathname.trim() || "/";
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  if (path.length > 3 && path.endsWith(".md")) {
    path = path.slice(0, -3) || "/";
  }
  return path === "" ? "/" : path;
}

function pickContentRoot(document: Document): Element | null {
  return (
    document.querySelector("[data-docs-content]") ??
    document.querySelector("main") ??
    document.querySelector("#main-content")
  );
}

/**
 * Fetch a path's HTML from this deployment and convert the content root to
 * Markdown. Memoized for the life of the process: pages are static at runtime.
 *
 * @param origin - Origin of the current deployment (self-fetch target).
 * @param path - Canonical site path, e.g. `/docs/routing` or `/about`.
 * @returns Markdown, or `null` when the HTML is missing a convertible root.
 */
async function renderHtmlAsMarkdown(
  origin: string,
  path: string,
): Promise<string | null> {
  const key = cacheKey(origin, path);
  const cached = markdownCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const response = await fetch(`${origin}${path === "/" ? "/" : path}`, {
    headers: { accept: HTML_ACCEPT },
    redirect: "follow",
  });

  if (!response.ok) {
    return null;
  }

  const { document } = parseHTML(await response.text());
  const root = pickContentRoot(document);
  if (!root) {
    return null;
  }

  const markdown =
    buildPageMarkdown(root as unknown as Element, `${SITE_URL}${path}`) || null;

  if (markdown !== null) {
    markdownCache.set(key, markdown);
  }

  return markdown;
}

export type MarkdownRenderResult = {
  markdown: string;
  status: number;
};

/**
 * Render the Markdown representation of a site path.
 *
 * Unknown docs slugs and unknown marketing paths both become a 404 with the
 * agent-recovery body from {@link notFoundMarkdown}. A known path whose HTML
 * cannot be converted is a 500 so we do not cache a hollow success.
 *
 * @param origin - Origin of the current deployment.
 * @param pathname - Request pathname (`.md` suffix optional).
 */
export async function renderPathMarkdown(
  origin: string,
  pathname: string,
): Promise<MarkdownRenderResult> {
  const path = canonicalMarkdownPath(pathname);

  if (isDocsPath(path)) {
    const page = await getDocPage(path === "/docs" ? "/docs" : path);
    if (!page) {
      return { markdown: notFoundMarkdown(path), status: 404 };
    }

    const markdown = await renderHtmlAsMarkdown(origin, page.href);
    if (!markdown) {
      return {
        markdown: "Failed to render markdown for this page.\n",
        status: 500,
      };
    }
    return { markdown, status: 200 };
  }

  const markdown = await renderHtmlAsMarkdown(origin, path);
  if (!markdown) {
    return { markdown: notFoundMarkdown(path), status: 404 };
  }
  return { markdown, status: 200 };
}
