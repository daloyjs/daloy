import { existsSync } from "node:fs";
import path from "node:path";
import { cacheLife } from "next/cache";

import { parseEmbeddedDates, readGitDates } from "./git-log";

export { parseGitLog } from "./git-log";

/** Website root (the Next.js project directory). */
const WEBSITE_DIR = process.cwd();

/**
 * Map of website-relative file path (e.g. `content/docs/routing.mdx`) to the
 * ISO timestamp of the last commit that touched it.
 *
 * Production reads the dates `next.config.ts` embedded during `next build`
 * (`DALOY_GIT_LASTMOD`, see `lib/git-log.ts`): Vercel functions have no
 * `.git` or `git` binary, so history is only readable at build time. Without
 * embedded dates (tests, tools that skip the config) it falls back to a live
 * `git log`. Either way the result is empty, never wrong, when history is
 * unavailable, so callers simply omit dates.
 *
 * @returns File path to ISO date string.
 */
export async function getLastModifiedMap(): Promise<Record<string, string>> {
  "use cache";
  cacheLife("max");

  // Read as a literal `process.env.X` so Next inlines the build-time value.
  const embedded = parseEmbeddedDates(process.env.DALOY_GIT_LASTMOD);
  if (embedded) return embedded;

  const live = readGitDates(WEBSITE_DIR);
  if (live.status !== "ok" && process.env.VERCEL_ENV === "production") {
    // Should not happen once the build embeds dates; say so in the logs
    // instead of silently dropping every date.
    console.warn(
      `[git-dates] No build-time dates and git is ${live.status}: docs "Last updated" dates and sitemap <lastmod> are omitted.`,
    );
  }
  return live.dates;
}

/**
 * The `page.tsx` a docs route lived in before the MDX migration, e.g.
 * `/docs/security/csrf` → `app/docs/security/csrf/page.tsx`.
 */
function legacyPageFile(route: string): string {
  const segments = route.split("/").filter(Boolean);
  return path.join("app", ...segments, "page.tsx").split(path.sep).join("/");
}

/**
 * Last content-update date for a route: its current source file, or, when
 * that file only has ignored (mechanical) commits, the legacy `page.tsx` it
 * was migrated from.
 *
 * @param route - A docs or blog route.
 * @param dates - Map from {@link getLastModifiedMap}.
 * @returns ISO date, or `undefined` when unknown.
 */
export function lastModifiedIso(route: string, dates: Record<string, string>): string | undefined {
  const file = sourceFileForRoute(route);
  return (file ? dates[file] : undefined) ?? dates[legacyPageFile(route)];
}

/**
 * Resolve the source file that renders a docs or blog route, relative to the
 * website root. MDX content under `content/` wins over a `page.tsx` route.
 *
 * @param route - A path such as `/docs/routing` or `/blog/some-post`.
 * @returns The relative source path, or `null` when none exists on disk.
 */
export function sourceFileForRoute(route: string): string | null {
  const clean = route.replace(/\/+$/, "") || "/";
  const segments = clean.split("/").filter(Boolean);
  const candidates = [
    path.join("content", ...segments) + ".mdx",
    path.join("content", ...segments, "index.mdx"),
    path.join("app", ...segments, "page.tsx"),
  ];

  for (const candidate of candidates) {
    if (existsSync(path.join(WEBSITE_DIR, candidate))) {
      return candidate.split(path.sep).join("/");
    }
  }

  return null;
}

/**
 * Last-commit date for the source of `route`, if git history knows it.
 *
 * @param route - A docs or blog route.
 * @returns A `Date`, or `undefined` when unknown.
 */
export async function lastModifiedForRoute(route: string): Promise<Date | undefined> {
  const iso = lastModifiedIso(route, await getLastModifiedMap());
  return iso ? new Date(iso) : undefined;
}
