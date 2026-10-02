import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { cacheLife } from "next/cache";

const execFileAsync = promisify(execFile);

/** Website root (the Next.js project directory). */
const WEBSITE_DIR = process.cwd();

/**
 * Run a read-only git command in the website directory. Fixed argv, no shell,
 * so nothing from content or requests can reach the command line.
 */
async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: WEBSITE_DIR,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 20_000,
  });
  return stdout;
}

/**
 * Map of website-relative file path (e.g. `content/docs/routing.mdx`) to the
 * ISO timestamp of the last commit that touched it.
 *
 * Built from a single `git log` pass over the content directories and cached
 * for the deployment. Returns an empty map when git is unavailable, when the
 * checkout is shallow (every file would report the same clone commit, which
 * is a false freshness signal), or on any error, so callers simply omit dates.
 *
 * On Vercel, set `VERCEL_DEEP_CLONE=true` so the build sees full history.
 *
 * @returns File path to ISO date string.
 */
export async function getLastModifiedMap(): Promise<Record<string, string>> {
  "use cache";
  cacheLife("max");

  const dates: Record<string, string> = {};

  try {
    if ((await git(["rev-parse", "--is-shallow-repository"])).trim() !== "false") {
      return dates;
    }

    const prefix = (await git(["rev-parse", "--show-prefix"])).trim();
    const log = await git([
      "log",
      "--format=%x00%H %cI",
      "--name-only",
      "--no-renames",
      "--",
      "app/docs",
      "app/blog",
      "content",
    ]);
    Object.assign(dates, parseGitLog(log, prefix, await readIgnoredRevs()));
  } catch {
    // git missing (e.g. a serverless runtime) or not a checkout: no dates.
  }

  return dates;
}

/**
 * Commits listed in `website/lastmod-ignore-revs` (one full SHA per line, `#`
 * comments). Their changes are mechanical (for example the TSX to MDX move),
 * so they must not count as a page update.
 *
 * @returns The set of ignored commit SHAs (empty when the file is absent).
 */
async function readIgnoredRevs(): Promise<Set<string>> {
  try {
    const text = await readFile(path.join(WEBSITE_DIR, "lastmod-ignore-revs"), "utf8");
    return new Set(
      text
        .split("\n")
        .map((line) => line.replace(/#.*$/, "").trim())
        .filter((line) => /^[0-9a-f]{40}$/.test(line)),
    );
  } catch {
    return new Set();
  }
}

/**
 * Parse `git log --format=%x00%H %cI --name-only` output into file → newest
 * ISO date, skipping ignored commits. Pure, for tests.
 *
 * @param log - Raw git output, newest commit first.
 * @param prefix - `git rev-parse --show-prefix` (e.g. `website/`), stripped from paths.
 * @param ignored - Commit SHAs whose changes do not count.
 * @returns Website-relative path to ISO date.
 */
export function parseGitLog(log: string, prefix: string, ignored: ReadonlySet<string>): Record<string, string> {
  const dates: Record<string, string> = {};
  let current = "";
  for (const line of log.split("\n")) {
    if (line.startsWith("\0")) {
      const [sha = "", date = ""] = line.slice(1).trim().split(" ");
      current = ignored.has(sha) ? "" : date;
    } else if (line && current) {
      const file = prefix && line.startsWith(prefix) ? line.slice(prefix.length) : line;
      // `git log` is newest-first, so the first counted date per file wins.
      dates[file] ??= current;
    }
  }
  return dates;
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
