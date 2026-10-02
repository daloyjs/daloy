/**
 * Docs link / anchor + navigation parity gate for the documentation site.
 *
 * The roadmap's "Integrations & docs" standing track commits to re-running a
 * docs link/anchor check each minor so the large, hand-maintained provider
 * surface (Email, Payments, Databases, ORM, ODM, Auth, Deployment, Adapters,
 * Tutorials) does not silently rot as routes are added, renamed, or removed.
 * Before this gate that maintenance was purely manual — `website/AGENTS.md`
 * still notes that "Docs navigation, sitemap entries, and search discovery are
 * manually maintained." A renamed route would leave a dangling sidebar link, a
 * 404 from another doc page, or a stale `sitemap.ts` entry with nothing to
 * catch it short of a human clicking every link.
 *
 * This script makes the check runnable and CI-enforceable. It scans the live
 * `website/` tree and fails (exit 1) on any of:
 *
 *   1. **Broken internal link** — an `href="/docs/..."` inside a docs page
 *      that does not resolve to a real `website/app/docs/<route>/page.tsx`
 *      or `route.ts` (route handlers such as the `/docs/llms.txt` subpath
 *      index are linkable routes too, they are just not pages).
 *   2. **Dangling nav entry** — a `docsNav` `href` with no backing page.
 *   3. **Missing nav entry** — a real docs page that no `docsNav` item links
 *      to. The sitemap, search, MCP and llms.txt pick up every page from
 *      `content/docs` automatically, but the sidebar is still a curated list,
 *      so a page missing from it is reachable only by URL.
 *   4. **Hand-listed docs in the sitemap** — a `/docs` or `/blog/` path written
 *      into `app/sitemap.ts`. Those entries are generated (docs from
 *      `content/docs` frontmatter, posts from `BLOG_POSTS`), so a hand-written
 *      one would be a duplicate URL.
 *   5. (removed: nav/sitemap drift cannot happen now that the sitemap is
 *      generated from the same content tree.)
 *   6. **Broken anchor** — a link to `/docs/page#fragment` whose target page
 *      contains no element with `id="fragment"`.
 *
 * A `/docs/<route>.md` link resolves against `/docs/<route>`: those are the
 * markdown siblings the llms.txt v2 `rel="alternate"` relation points at,
 * served by `app/docs-md/[[...slug]]/route.ts` via a rewrite. Linking the
 * markdown sibling of a page that no longer exists is still a broken link.
 *
 * Pure read-only static analysis over file text (the same approach as the
 * other `verify:*` gates) — it does not import the Next app or run a build, so
 * it stays fast and dependency-free.
 *
 * Exit code:
 *   0 — every internal docs link, nav entry, sitemap entry, and anchor checks
 *       out.
 *   1 — at least one problem; offending references printed to stderr.
 *
 * @since 0.37.0
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = new URL("../", import.meta.url);
const REPO_ROOT_PATH = fileURLToPath(REPO_ROOT);
const WEBSITE_APP = new URL("website/app/", REPO_ROOT);
const DOCS_DIR = new URL("docs/", WEBSITE_APP);
const CONTENT_DOCS_DIR = new URL("website/content/docs/", REPO_ROOT);
const NAV_FILE = new URL("website/components/docs-nav.ts", REPO_ROOT);
const SITEMAP_FILE = new URL("website/lib/sitemap-entries.ts", REPO_ROOT);

/** A single problem found during the scan. */
export interface DocsLinkProblem {
  readonly kind:
    | "broken-link"
    | "dangling-nav"
    | "missing-nav"
    | "sitemap-hand-listed"
    | "broken-anchor";
  readonly source: string;
  readonly target: string;
  readonly detail: string;
}

/**
 * Recursively collect every file with the given name under a directory URL.
 *
 * @param dir - Directory to walk.
 * @param fileName - Route-defining file to match, `page.tsx` by default.
 *   Pass `route.ts` to collect route handlers instead.
 */
async function collectPageFiles(
  dir: URL,
  fileName = "page.tsx",
): Promise<URL[]> {
  const out: URL[] = [];
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const child = new URL(`${name}`, dir);
    const info = await stat(child);
    if (info.isDirectory()) {
      out.push(...(await collectPageFiles(new URL(`${name}/`, dir), fileName)));
    } else if (name === fileName) {
      out.push(child);
    }
  }
  return out;
}

/**
 * Map a `website/app/.../page.tsx` or `.../route.ts` URL to its route path,
 * e.g. `website/app/docs/email/resend/page.tsx` -> `/docs/email/resend`,
 * `website/app/docs/page.tsx` -> `/docs`, and
 * `website/app/docs/llms.txt/route.ts` -> `/docs/llms.txt`.
 */
function pageUrlToRoute(page: URL): string {
  const rel = relative(fileURLToPath(WEBSITE_APP), fileURLToPath(page));
  const noPage = rel
    .replace(/[/\\](?:page\.tsx|route\.ts)$/, "")
    .replace(/\\/g, "/");
  return `/${noPage}`;
}

/**
 * Recursively collect every `.mdx` file under a directory URL (the MDX docs
 * tree). Missing directory yields an empty list.
 */
async function collectMdxFiles(dir: URL): Promise<URL[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: URL[] = [];
  for (const name of entries) {
    const child = new URL(name, dir);
    const info = await stat(child);
    if (info.isDirectory()) out.push(...(await collectMdxFiles(new URL(`${name}/`, dir))));
    else if (name.endsWith(".mdx")) out.push(child);
  }
  return out;
}

/**
 * Map a `website/content/docs/.../x.mdx` URL to its route:
 * `tutorials/bookstore.mdx` -> `/docs/tutorials/bookstore`,
 * `tutorials/index.mdx` -> `/docs/tutorials`.
 */
function mdxUrlToRoute(file: URL): string {
  const rel = relative(fileURLToPath(CONTENT_DOCS_DIR), fileURLToPath(file))
    .replace(/\\/g, "/")
    .replace(/\.mdx$/, "")
    .replace(/(?:^|\/)index$/, "");
  return rel ? `/docs/${rel}` : "/docs";
}

/**
 * GitHub-compatible heading slug for ASCII headings, matching what
 * `github-slugger` (used by the MDX renderer) produces: lowercase, drop
 * punctuation other than `-` and `_`, spaces to hyphens.
 */
function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .replace(/ /g, "-");
}

/**
 * Anchor ids an MDX page renders: explicit `id="..."` attributes, `[#id]`
 * heading markers, and slugs of the remaining `##`-`####` headings
 * (de-duplicated with `-1`, `-2` suffixes like the renderer's slugger).
 */
function extractMdxIds(source: string): Set<string> {
  const ids = extractElementIds(source);
  const seen = new Map<string, number>();
  const reserve = (slug: string) => {
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    return count === 0 ? slug : `${slug}-${count}`;
  };
  const withoutFences = source.replace(/^(`{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, "");
  for (const match of withoutFences.matchAll(/^#{2,4}\s+(.+?)\s*$/gm)) {
    const heading = match[1]!;
    const custom = /\s*\[#([A-Za-z0-9][\w-]*)\]$/.exec(heading);
    if (custom) {
      ids.add(custom[1]!);
      reserve(custom[1]!);
      continue;
    }
    const text = heading
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\\(.)/g, "$1")
      .replace(/[`*]/g, "");
    ids.add(reserve(slugifyHeading(text)));
  }
  return ids;
}

/** Pull every markdown link target (`[text](/docs/...)`) out of an MDX file. */
function extractMarkdownLinks(source: string): string[] {
  const out: string[] = [];
  const re = /\]\((\/[^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.push(m[1]!);
  return out;
}

/** Normalize a route by trimming a trailing slash (except the bare root). */
function normalizeRoute(route: string): string {
  if (route.length > 1 && route.endsWith("/")) return route.slice(0, -1);
  return route;
}

/** Pull every distinct `href` string value out of a TS source file. */
function extractHrefStrings(source: string): string[] {
  const out: string[] = [];
  // href="/docs/..."  |  href='/docs/...'  |  href={"/docs/..."}
  const re = /href=(?:\{)?["'`]([^"'`]+)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.push(m[1]!);
  return out;
}

/** Pull every `href: "..."` object-literal value (the nav file shape). */
function extractNavHrefs(source: string): string[] {
  const out: string[] = [];
  const re = /href:\s*["'`]([^"'`]+)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.push(m[1]!);
  return out;
}

/** Collect every `id="..."` value declared in a page (anchor targets). */
function extractElementIds(source: string): Set<string> {
  const out = new Set<string>();
  const re = /\bid=(?:\{)?["'`]([^"'`]+)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.add(m[1]!);
  return out;
}

function rel(path: string): string {
  return relative(REPO_ROOT_PATH, path).replace(/\\/g, "/");
}

/** Run the full scan and return the list of problems (empty when clean). */
export async function scanDocsLinks(): Promise<DocsLinkProblem[]> {
  const problems: DocsLinkProblem[] = [];

  // 1. Every real docs route + its declared element ids.
  const pages = await collectPageFiles(DOCS_DIR);
  const routeSet = new Set<string>();
  const idsByRoute = new Map<string, Set<string>>();
  const sourceByPage = new Map<string, string>();
  for (const page of pages) {
    const route = normalizeRoute(pageUrlToRoute(page));
    // Dynamic segments (`[slug]/[child]`, the MDX renderer) are not pages of
    // their own; the MDX files they render are collected below.
    if (route.includes("[")) continue;
    routeSet.add(route);
    const source = await readFile(page, "utf8");
    idsByRoute.set(route, extractElementIds(source));
    sourceByPage.set(fileURLToPath(page), source);
  }

  // 1b. MDX docs pages under website/content/docs (rendered by the dynamic
  // app/docs/[slug]/[child] route). Same checks, markdown link syntax too.
  for (const file of await collectMdxFiles(CONTENT_DOCS_DIR)) {
    const route = normalizeRoute(mdxUrlToRoute(file));
    routeSet.add(route);
    const source = await readFile(file, "utf8");
    idsByRoute.set(route, extractMdxIds(source));
    sourceByPage.set(fileURLToPath(file), source);
  }

  // 1c. Blog posts (website/content/blog/*.mdx) are not docs routes, but their
  // links into /docs must resolve too, so scan them as link sources only.
  const CONTENT_BLOG_DIR = new URL("website/content/blog/", REPO_ROOT);
  for (const file of await collectMdxFiles(CONTENT_BLOG_DIR)) {
    sourceByPage.set(fileURLToPath(file), await readFile(file, "utf8"));
  }

  // Route handlers under `app/docs` (currently the `/docs/llms.txt` subpath
  // index) are real, linkable routes, but they are not pages: they render no
  // markup, so they declare no element ids, and they are machine files that
  // deliberately stay out of the human-facing sitemap the way `/llms.txt`
  // does. Track them separately so they satisfy link checks without tripping
  // the sitemap-completeness rule below.
  const handlerRoutes = await collectPageFiles(DOCS_DIR, "route.ts");
  const handlerRouteSet = new Set(
    handlerRoutes.map((file) => normalizeRoute(pageUrlToRoute(file))),
  );

  // 2. Internal docs links inside docs pages (+ anchor checks).
  for (const [pagePath, source] of sourceByPage) {
    for (const href of [...extractHrefStrings(source), ...extractMarkdownLinks(source)]) {
      if (!href.startsWith("/docs")) continue; // external / non-docs handled elsewhere
      const [pathPart, fragment] = href.split("#", 2);
      const target = normalizeRoute(pathPart!);
      // A .md sibling is a real URL (rewritten to the markdown route
      // handler) whose existence is determined by its base page.
      const resolved = target.endsWith(".md") ? target.slice(0, -3) : target;
      if (!routeSet.has(resolved) && !handlerRouteSet.has(target)) {
        problems.push({
          kind: "broken-link",
          source: rel(pagePath),
          target: href,
          detail: `links to "${target}" but no website/app${resolved}/page.tsx, route.ts, or website/content${resolved}.mdx exists`,
        });
        continue;
      }
      if (fragment) {
        const ids = idsByRoute.get(resolved);
        if (!ids || !ids.has(fragment)) {
          problems.push({
            kind: "broken-anchor",
            source: rel(pagePath),
            target: href,
            detail: `anchor "#${fragment}" has no matching id on "${target}"`,
          });
        }
      }
    }
  }

  // 3. Nav entries -> real pages.
  const navSource = await readFile(NAV_FILE, "utf8");
  const navHrefs = extractNavHrefs(navSource)
    .filter((h) => h.startsWith("/docs"))
    .map(normalizeRoute);
  for (const href of navHrefs) {
    if (!routeSet.has(href)) {
      problems.push({
        kind: "dangling-nav",
        source: rel(fileURLToPath(NAV_FILE)),
        target: href,
        detail: `docsNav points to "${href}" but no page exists`,
      });
    }
  }

  // 4. Every docs page is reachable from the sidebar.
  const navSet = new Set(navHrefs);
  for (const route of [...routeSet].sort()) {
    if (!navSet.has(route)) {
      problems.push({
        kind: "missing-nav",
        source: rel(fileURLToPath(NAV_FILE)),
        target: route,
        detail: `page "${route}" exists but no docsNav item links to it`,
      });
    }
  }

  // 5. The sitemap generates docs and blog entries; none may be hand-listed.
  const sitemapSource = await readFile(SITEMAP_FILE, "utf8");
  // Literal "..." paths only: the generator's own `/blog/${slug}` template is fine.
  for (const [, path] of sitemapSource.matchAll(/path:\s*"([^"]+)"/g)) {
    if (path.startsWith("/docs") || path.startsWith("/blog/")) {
      problems.push({
        kind: "sitemap-hand-listed",
        source: rel(fileURLToPath(SITEMAP_FILE)),
        target: path,
        detail: `"${path}" is hand-listed; docs and blog entries are generated in lib/sitemap-entries.ts`,
      });
    }
  }

  return problems;
}

async function main(): Promise<void> {
  const problems = await scanDocsLinks();
  if (problems.length === 0) {
    console.log(
      "verify-docs-links: all docs links, nav entries and anchors resolve, and every page is in the nav.",
    );
    return;
  }
  console.error(
    `verify-docs-links: found ${problems.length} docs link/nav/sitemap problem(s):\n`,
  );
  for (const p of problems) {
    console.error(`  [${p.kind}] ${p.source}\n    -> ${p.target}: ${p.detail}`);
  }
  process.exitCode = 1;
}

await main();
