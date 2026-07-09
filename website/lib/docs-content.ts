import type { Route } from "next";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * A single documentation page discovered from the `app/docs` tree, with its
 * metadata and full extracted plain-text body.
 *
 * This is the shared shape read from disk by both the cmdk docs search index
 * ([docs-search.ts](./docs-search.ts)) and the public MCP documentation
 * endpoint (`app/mcp/route.ts`), so both surfaces parse the docs the same way
 * from a single source of truth.
 */
export type DocPage = {
  /** Human-readable page title from the page's `buildMetadata` call. */
  title: string;
  /** Canonical route, e.g. `/docs/routing`. */
  href: Route;
  /** Short meta description from `buildMetadata`. */
  description: string;
  /** SEO keywords declared on the page (may be empty). */
  keywords: string[];
  /** Full extracted plain-text body (prose plus code samples). */
  body: string;
};

/** Absolute path to the `app/docs` directory. */
export const docsDir = path.join(process.cwd(), "app", "docs");

const HTML_ENTITIES: Record<string, string> = {
  "&apos;": "'",
  "&quot;": '"',
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
};

function decodeEntities(value: string): string {
  return value.replace(/&(apos|quot|amp|lt|gt|nbsp);/g, (match) => HTML_ENTITIES[match] ?? match);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Extract searchable / readable plain text from a docs `page.tsx` source. Strips
 * imports and the metadata block, keeps the contents of any `code={` ... `}`
 * template literals so things mentioned only in code samples (e.g.
 * `ui: "swagger"`) survive, then removes the remaining JSX tags and expression
 * containers.
 *
 * @param source - Raw `page.tsx` file contents.
 * @param limit - Optional max character count for the returned text. Omit to get
 *   the full body (used by the MCP `get_doc` tool); the cmdk search index passes
 *   a small cap to keep the client payload light.
 * @returns The normalized, entity-decoded plain text body.
 */
export function extractBodyText(source: string, limit?: number): string {
  let working = source;

  // Drop imports and the metadata block — they are indexed via metadata fields.
  working = working.replace(/^\s*import[\s\S]*?;\s*$/gm, "");
  working = working.replace(/export\s+const\s+metadata\s*=\s*buildMetadata\(\{[\s\S]*?\}\);?/, "");

  const collected: string[] = [];

  // Pull CodeBlock template-literal payloads first so they survive tag stripping.
  for (const match of working.matchAll(/code=\{`([\s\S]*?)`\}/g)) {
    collected.push(match[1] ?? "");
  }
  working = working.replace(/code=\{`[\s\S]*?`\}/g, " ");

  // Drop JSX expression containers (className strings, hrefs, callbacks) then tags.
  working = working.replace(/\{[^{}]*\}/g, " ");
  working = working.replace(/<\/?[A-Za-z][^>]*>/g, " ");

  collected.push(working);

  const text = decodeEntities(collected.join(" ")).replace(/\s+/g, " ").trim();
  return typeof limit === "number" ? text.slice(0, limit) : text;
}

/** Recursively collect every `page.tsx` path under `dir`. */
export async function walkDocsPages(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => walkDocsPages(path.join(dir, entry.name))),
  );

  const pageFile = entries.some((entry) => entry.isFile() && entry.name === "page.tsx")
    ? [path.join(dir, "page.tsx")]
    : [];

  return [...pageFile, ...nestedFiles.flat()];
}

/** Derive a `/docs/...` route from a `page.tsx` absolute path. */
export function getRouteFromFile(filePath: string): Route {
  const relativeDir = path.relative(docsDir, path.dirname(filePath));

  if (!relativeDir || relativeDir === ".") {
    return "/docs";
  }

  return `/docs/${relativeDir.split(path.sep).join("/")}` as Route;
}

/**
 * Parse the `buildMetadata({...})` frontmatter (title, description, path,
 * keywords) out of a docs `page.tsx` source. Falls back to a route derived from
 * the file path when no explicit `path` is present.
 *
 * @param source - Raw `page.tsx` file contents.
 * @param filePath - Absolute path to the page, used for the route fallback.
 * @returns The page's parsed metadata (without the body).
 */
export function parseDocFrontmatter(
  source: string,
  filePath: string,
): { title: string; href: Route; description: string; keywords: string[] } {
  const title = source.match(/title:\s*"([^"]+)"/)?.[1] ?? "Untitled";
  const description =
    source.match(/description:\s*(?:\n\s*)?"([\s\S]*?)",\s*path:/)?.[1] ?? "Documentation page";
  const href =
    (source.match(/path:\s*"([^"]+)"/)?.[1] as Route | undefined) ?? getRouteFromFile(filePath);
  const keywordsBlock = source.match(/keywords:\s*\[([\s\S]*?)\]/)?.[1] ?? "";
  const keywords = [...keywordsBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");

  return {
    title: normalizeText(title),
    href,
    description: normalizeText(description),
    keywords,
  };
}

/**
 * Process-lifetime memo for {@link getAllDocPages}. The docs tree is static at
 * runtime, so the disk walk + parse runs at most once per server process.
 */
let allDocPagesPromise: Promise<DocPage[]> | undefined;

/**
 * Read and parse every docs page from disk, returning metadata plus the full
 * plain-text body for each, sorted by route. Memoized for the lifetime of the
 * deployment since the docs tree is static at runtime.
 *
 * The memoization replaces a `"use cache"` directive: nonce-based CSP requires
 * dropping the `cacheComponents`/PPR flag that `"use cache"` depends on, and a
 * module-level promise gives the same once-per-deployment caching for this
 * build-invariant computation.
 *
 * @returns Every discovered {@link DocPage}.
 */
export async function getAllDocPages(): Promise<DocPage[]> {
  allDocPagesPromise ??= (async () => {
    const pageFiles = await walkDocsPages(docsDir);
    const pages = await Promise.all(
      pageFiles.map(async (filePath) => {
        const source = await readFile(filePath, "utf8");
        const frontmatter = parseDocFrontmatter(source, filePath);
        return { ...frontmatter, body: extractBodyText(source) } satisfies DocPage;
      }),
    );

    return pages.sort((left, right) => left.href.localeCompare(right.href));
  })();

  return allDocPagesPromise;
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
