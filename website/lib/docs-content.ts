import type { Route } from "next";
import { cacheLife } from "next/cache";

import { extractMdxBodyText, getMdxDocs } from "./mdx/content";

/**
 * A single documentation page from the `content/docs` MDX tree, with its
 * frontmatter metadata and full extracted plain-text body.
 *
 * This is the shared shape read from disk by both the cmdk docs search index
 * ([docs-search.ts](./docs-search.ts)) and the public MCP documentation
 * endpoint (`app/mcp/route.ts`), so both surfaces parse the docs the same way
 * from a single source of truth.
 */
export type DocPage = {
  /** Human-readable page title from the page's frontmatter. */
  title: string;
  /** Canonical route, e.g. `/docs/routing`. */
  href: Route;
  /** Short meta description from the frontmatter. */
  description: string;
  /** SEO keywords declared on the page (may be empty). */
  keywords: string[];
  /** Full extracted plain-text body (prose plus code samples). */
  body: string;
};

/**
 * Read every docs page, returning metadata plus the full plain-text body for
 * each, sorted by route. Every page is MDX under `content/docs`; this is the
 * one corpus search, MCP, OG images, the markdown route and llms.txt share.
 * Cached for the lifetime of the deployment (`cacheLife("max")`) because the
 * docs tree is static at runtime and only changes when a new build ships.
 *
 * @returns Every discovered {@link DocPage}.
 */
export async function getAllDocPages(): Promise<DocPage[]> {
  "use cache";
  cacheLife("max");

  return (await getMdxDocs()).map((doc) => ({
    title: doc.frontmatter.title,
    href: doc.route as Route,
    description: doc.frontmatter.description,
    keywords: doc.frontmatter.keywords,
    body: extractMdxBodyText(doc.body),
  }));
}

/**
 * Normalize an agent-supplied docs path into a canonical `/docs/...` route.
 *
 * Accepts a full URL, a `/docs/...` path, a `docs/...` path, or a bare slug
 * like `routing` / `security/csrf`. Strips any query string or hash and rejects
 * path-traversal attempts.
 *
 * @param input - The raw path or slug provided by a caller.
 * @returns The canonical route, or `null` when the input is empty or unsafe.
 */
export function normalizeDocRoute(input: string): Route | null {
  let value = input.trim();
  if (!value) return null;

  // Allow callers to paste a full URL.
  value = value.replace(/^https?:\/\/[^/]+/i, "");
  // Strip query/hash.
  value = value.split(/[?#]/, 1)[0] ?? "";
  // Collapse duplicate slashes and trim a trailing slash.
  value = value.replace(/\/+/g, "/").replace(/(.)\/$/, "$1");
  if (!value.startsWith("/")) value = `/${value}`;

  // Reject path traversal outright.
  if (value.includes("..")) return null;

  if (value === "/docs") return "/docs";
  if (!value.startsWith("/docs/")) {
    // Treat a bare slug like `/routing` as `/docs/routing`.
    value = `/docs${value}`;
  }

  return value as Route;
}

/**
 * Look up a single docs page by route or slug (e.g. `/docs/routing`, `routing`,
 * or `security/csrf`).
 *
 * @param route - The path or slug to resolve (see {@link normalizeDocRoute}).
 * @returns The matching {@link DocPage}, or `null` when no such page exists.
 */
export async function getDocPage(route: string): Promise<DocPage | null> {
  const normalized = normalizeDocRoute(route);
  if (!normalized) return null;

  const pages = await getAllDocPages();
  return pages.find((page) => page.href === normalized) ?? null;
}
