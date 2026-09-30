import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
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
 * Map of website-relative file path (e.g. `app/docs/routing/page.tsx`) to the
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
      "--format=%x00%cI",
      "--name-only",
      "--no-renames",
      "--",
      "app/docs",
      "app/blog",
      "content",
    ]);

    let current = "";
    for (const line of log.split("\n")) {
      if (line.startsWith("\0")) {
        current = line.slice(1).trim();
      } else if (line && current) {
        const file = prefix && line.startsWith(prefix) ? line.slice(prefix.length) : line;
        // `git log` is newest-first, so the first date seen per file wins.
        dates[file] ??= current;
      }
    }
  } catch {
    // git missing (e.g. a serverless runtime) or not a checkout: no dates.
  }

  return dates;
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
  const file = sourceFileForRoute(route);
  if (!file) return undefined;
  const iso = (await getLastModifiedMap())[file];
  return iso ? new Date(iso) : undefined;
}
