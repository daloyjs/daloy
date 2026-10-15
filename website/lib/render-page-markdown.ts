/**
 * Convert a rendered HTML page on this deployment into Markdown.
 *
 * Docs pages prefer `[data-docs-content]` so the sidebar is dropped. Other
 * pages use `<main>` (the header and footer live outside it in the root
 * layout). Used by the `/md/*` handler and the `/docs-md/*` compatibility
 * handler so `.md` URLs and `Accept: text/markdown` emit the same body.
 */

import { parseHTML } from "linkedom";

import { BLOG_POSTS } from "@/lib/blog-posts";
import { getDocPage } from "@/lib/docs-content";
import { notFoundMarkdown } from "@/lib/not-found-body";
import { buildPageMarkdown } from "@/lib/page-markdown";
import { SITE_URL } from "@/lib/seo";

const markdownCache = new Map<string, string>();

/** Header the Markdown handler sends on the HTML self-fetch. */
const HTML_ACCEPT = "text/html";

/** Known non-docs marketing paths on the site. */
const MARKETING_PATHS: ReadonlySet<string> = new Set([
  "/",
  "/blog",
  "/about",
  "/contact",
  "/privacy",
  "/about-the-name",
]);

function isKnownSitePath(path: string): boolean {
  if (MARKETING_PATHS.has(path)) {
    return true;
  }
  if (path.startsWith("/blog/")) {
    const slug = path.slice("/blog/".length);
    return BLOG_POSTS.some((post) => post.slug === slug);
  }
  return false;
}

/**
 * Resolve a safe self-fetch origin. Outside production a loopback origin
 * (`localhost`, `127.0.0.1`, `[::1]`) is honored so `next dev` and the tests
 * render their own server; everything else, and every origin in production,
 * is pinned to the canonical `SITE_URL` so a forged `Host` header cannot steer
 * the server-side `fetch()` to an attacker-chosen host or loopback port (SSRF).
 *
 * @param origin - Origin derived from the inbound request URL.
 * @returns The origin the HTML self-fetch may target.
 */
export function resolveSafeOrigin(origin: string): string {
  if (process.env.NODE_ENV !== "production") {
    try {
      const parsed = new URL(origin);
      if (
        (parsed.protocol === "http:" || parsed.protocol === "https:") &&
        (parsed.hostname === "localhost" ||
          parsed.hostname === "127.0.0.1" ||
          parsed.hostname === "[::1]")
      ) {
        return parsed.origin;
      }
    } catch {
      // Fall back to SITE_URL below.
    }
  }
  return SITE_URL;
}

/** Redirect hops the HTML self-fetch follows, all within the pinned origin. */
const MAX_SELF_FETCH_REDIRECTS = 3;

/**
 * Fetch `url` as HTML, following redirects only while they stay on `origin`.
 * A redirect to any other origin ends the fetch (`null`) before a request is
 * sent there, so a self-fetch can never be bounced to a third-party host.
 *
 * @param origin - The pinned origin from {@link resolveSafeOrigin}.
 * @param url - Absolute URL on `origin`.
 * @returns The final non-redirect response, or `null` on an off-origin or
 *   excessive redirect chain.
 */
async function fetchSameOrigin(
  origin: string,
  url: string,
): Promise<Response | null> {
  let target = url;
  for (let hop = 0; hop <= MAX_SELF_FETCH_REDIRECTS; hop++) {
    const response = await fetch(target, {
      headers: { accept: HTML_ACCEPT },
      redirect: "manual",
    });
    if (response.status < 300 || response.status > 399) {
      return response;
    }
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (!location) return null;
    const next = new URL(location, target);
    if (next.origin !== origin) return null;
    target = next.href;
  }
  return null;
}

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

  const response = await fetchSameOrigin(
    origin,
    `${origin}${path === "/" ? "/" : path}`,
  );

  if (!response || !response.ok) {
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
  const safeOrigin = resolveSafeOrigin(origin);

  if (isDocsPath(path)) {
    const page = await getDocPage(path === "/docs" ? "/docs" : path);
    if (!page) {
      return { markdown: notFoundMarkdown(path), status: 404 };
    }

    const markdown = await renderHtmlAsMarkdown(safeOrigin, page.href);
    if (!markdown) {
      return {
        markdown: "Failed to render markdown for this page.\n",
        status: 500,
      };
    }
    return { markdown, status: 200 };
  }

  if (!isKnownSitePath(path)) {
    return { markdown: notFoundMarkdown(path), status: 404 };
  }

  const markdown = await renderHtmlAsMarkdown(safeOrigin, path);
  if (!markdown) {
    return { markdown: notFoundMarkdown(path), status: 404 };
  }
  return { markdown, status: 200 };
}
