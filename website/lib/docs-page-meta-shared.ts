/**
 * Client-safe constants and types for the docs page chrome. Kept apart from
 * `docs-page-meta.ts`, which reads git history and must stay server-only.
 */

/** GitHub repository that hosts the website source. */
export const REPO_URL = "https://github.com/daloyjs/daloy";
/** Branch the edit and source links point at. */
export const REPO_BRANCH = "main";

/** Per-route facts for the docs page chrome (edit link, last updated). */
export type DocsPageMeta = {
  /** Repo-relative source path, e.g. `website/content/docs/routing.mdx`. */
  source: string | null;
  /** ISO date of the last commit that touched the source, when known. */
  lastModified?: string;
};
