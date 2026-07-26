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
 *      that does not resolve to a real `website/app/docs/<route>/page.tsx`.
 *   2. **Dangling nav entry** — a `docsNav` `href` with no backing page.
 *   3. **Dangling sitemap entry** — a `STATIC_PATHS` `/docs/...` path with no
 *      backing page.
 *   4. **Missing sitemap entry** — a real docs page absent from `sitemap.ts`
 *      (it would be invisible to search engines, defeating the SEO intent the
 *      sitemap header documents).
 *   5. **Nav / sitemap drift** — a nav `href` that is not also in the sitemap.
 *   6. **Broken anchor** — a link to `/docs/page#fragment` whose target page
 *      contains no element with `id="fragment"`.
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
const NAV_FILE = new URL("website/components/docs-nav.ts", REPO_ROOT);
const SITEMAP_FILE = new URL("website/app/sitemap.ts", REPO_ROOT);

/** A single problem found during the scan. */
export interface DocsLinkProblem {
  readonly kind:
    | "broken-link"
    | "dangling-nav"
    | "dangling-sitemap"
    | "missing-sitemap"
    | "nav-sitemap-drift"
    | "broken-anchor";
  readonly source: string;
  readonly target: string;
  readonly detail: string;
}

/** Recursively collect every `page.tsx` under a directory URL. */
async function collectPageFiles(dir: URL): Promise<URL[]> {
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
      out.push(...(await collectPageFiles(new URL(`${name}/`, dir))));
    } else if (name === "page.tsx") {
      out.push(child);
    }
  }
  return out;
}

/**
 * Map a `website/app/.../page.tsx` URL to its route path, e.g.
 * `website/app/docs/email/resend/page.tsx` -> `/docs/email/resend` and
 * `website/app/docs/page.tsx` -> `/docs`.
 */
function pageUrlToRoute(page: URL): string {
  const rel = relative(fileURLToPath(WEBSITE_APP), fileURLToPath(page));
  const noPage = rel.replace(/[/\\]page\.tsx$/, "").replace(/\\/g, "/");
  return `/${noPage}`;
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

/** Pull every `path: "..."` value (the sitemap STATIC_PATHS shape). */
function extractSitemapPaths(source: string): string[] {
  const out: string[] = [];
  const re = /path:\s*["'`]([^"'`]+)["'`]/g;
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
    routeSet.add(route);
    const source = await readFile(page, "utf8");
    idsByRoute.set(route, extractElementIds(source));
    sourceByPage.set(fileURLToPath(page), source);
  }

  // 2. Internal docs links inside docs pages (+ anchor checks).
  for (const [pagePath, source] of sourceByPage) {
    for (const href of extractHrefStrings(source)) {
      if (!href.startsWith("/docs")) continue; // external / non-docs handled elsewhere
      const [pathPart, fragment] = href.split("#", 2);
      const target = normalizeRoute(pathPart!);
      if (!routeSet.has(target)) {
        problems.push({
          kind: "broken-link",
          source: rel(pagePath),
          target: href,
          detail: `links to "${target}" but no website/app${target}/page.tsx exists`,
        });
        continue;
      }
      if (fragment) {
        const ids = idsByRoute.get(target);
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

  // 4. Sitemap entries -> real pages; and pages -> sitemap.
  const sitemapSource = await readFile(SITEMAP_FILE, "utf8");
  const sitemapPaths = new Set(
    extractSitemapPaths(sitemapSource)
      .filter((p) => p.startsWith("/docs"))
      .map(normalizeRoute)
  );
  for (const path of sitemapPaths) {
    if (!routeSet.has(path)) {
      problems.push({
        kind: "dangling-sitemap",
        source: rel(fileURLToPath(SITEMAP_FILE)),
        target: path,
        detail: `sitemap lists "${path}" but no page exists`,
      });
    }
  }
  for (const route of routeSet) {
    if (!sitemapPaths.has(route)) {
      problems.push({
        kind: "missing-sitemap",
        source: rel(fileURLToPath(SITEMAP_FILE)),
        target: route,
        detail: `page "${route}" is missing from sitemap.ts (search engines won't see it)`,
      });
    }
  }

  // 5. Nav <-> sitemap drift (a navigable page should also be in the sitemap).
  for (const href of navHrefs) {
    if (routeSet.has(href) && !sitemapPaths.has(href)) {
      problems.push({
        kind: "nav-sitemap-drift",
        source: rel(fileURLToPath(NAV_FILE)),
        target: href,
        detail: `nav lists "${href}" but sitemap.ts does not`,
      });
    }
  }

  return problems;
}

async function main(): Promise<void> {
  const problems = await scanDocsLinks();
  if (problems.length === 0) {
    console.log(
      "verify-docs-links: all docs links, nav entries, sitemap entries, and anchors resolve."
    );
    return;
  }
  console.error(`verify-docs-links: found ${problems.length} docs link/nav/sitemap problem(s):\n`);
  for (const p of problems) {
    console.error(`  [${p.kind}] ${p.source}\n    -> ${p.target}: ${p.detail}`);
  }
  process.exitCode = 1;
}

await main();
