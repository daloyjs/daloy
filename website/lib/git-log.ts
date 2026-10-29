import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Git history → "last updated" dates for docs and blog sources.
 *
 * Plain Node (no Next.js imports, no path aliases) so `next.config.ts` can
 * run it during `next build`. That matters on Vercel: request-time functions
 * ship without `.git` or a `git` binary, so dates read at request time are
 * always empty. The build has the full clone (`VERCEL_DEEP_CLONE=true`), so
 * the config reads history once and embeds the result (see
 * {@link GIT_LASTMOD_ENV}); `lib/git-dates.ts` reads it back at runtime.
 */

/** `env` key that carries the build-time dates (JSON) into the server bundle. */
export const GIT_LASTMOD_ENV = "DALOY_GIT_LASTMOD";

/** Directories whose files have dates (relative to the website root). */
const DATED_DIRS = ["app/docs", "app/blog", "content"];

/** Outcome of reading git history. */
export type GitDatesResult = {
  /** Website-relative file path → ISO date of the last counted commit. */
  dates: Record<string, string>;
  /**
   * `ok` when history was read; `shallow` when the clone has no history (every
   * file would report the clone commit, a false freshness signal, so no dates
   * are returned); `unavailable` when git is missing or this is no checkout.
   */
  status: "ok" | "shallow" | "unavailable";
};

/**
 * Run a read-only git command. Fixed argv, no shell, so nothing from content
 * or requests can reach the command line.
 */
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 20_000,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/**
 * Commits listed in `<dir>/lastmod-ignore-revs` (one full SHA per line, `#`
 * comments). Their changes are mechanical (for example the TSX to MDX move),
 * so they must not count as a page update.
 *
 * @param dir - Website root.
 * @returns The set of ignored commit SHAs (empty when the file is absent).
 */
export function readIgnoredRevs(dir: string): Set<string> {
  try {
    return new Set(
      readFileSync(path.join(dir, "lastmod-ignore-revs"), "utf8")
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
 * Read last-commit dates for the dated directories with one `git log` pass.
 * Never throws: a shallow clone or missing git yields no dates and a status
 * the caller can report.
 *
 * @param dir - Website root (inside a git checkout).
 * @returns The dates and how they were obtained.
 */
export function readGitDates(dir: string): GitDatesResult {
  try {
    if (git(dir, ["rev-parse", "--is-shallow-repository"]).trim() !== "false") {
      return { dates: {}, status: "shallow" };
    }
    const prefix = git(dir, ["rev-parse", "--show-prefix"]).trim();
    const log = git(dir, ["log", "--format=%x00%H %cI", "--name-only", "--no-renames", "--", ...DATED_DIRS]);
    return { dates: parseGitLog(log, prefix, readIgnoredRevs(dir)), status: "ok" };
  } catch {
    return { dates: {}, status: "unavailable" };
  }
}

/** A git `%cI` timestamp, e.g. `2026-10-29T21:04:11+01:00`. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * A website-relative source path: no traversal, no absolute paths. Dynamic
 * route templates (`app/docs/[slug]/page.tsx`) are dropped too; lookups only
 * use literal page paths, so they are never read.
 */
const SOURCE_PATH = /^(?:app|content)\/[\w./-]+$/;

/**
 * Parse the dates embedded at build time. Defensive: anything that is not a
 * plain object of source path → ISO date is dropped, so a malformed value
 * can only cost dates, never inject them.
 *
 * @param raw - The embedded JSON, or `undefined` when nothing was embedded.
 * @returns The valid entries, or `null` when there are none.
 */
export function parseEmbeddedDates(raw: string | undefined): Record<string, string> | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const dates: Record<string, string> = {};
  for (const [file, date] of Object.entries(parsed)) {
    if (SOURCE_PATH.test(file) && !file.includes("..") && typeof date === "string" && ISO_DATE.test(date)) {
      dates[file] = date;
    }
  }
  return Object.keys(dates).length > 0 ? dates : null;
}
