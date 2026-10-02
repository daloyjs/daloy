import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { cacheLife } from "next/cache";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/** Root of the MDX content tree (`website/content`). */
export const contentDir = path.join(process.cwd(), "content");

/**
 * Frontmatter every MDX docs page must declare. Validated strictly so a typo
 * (`descripton:`) fails the build instead of shipping an empty meta tag.
 */
export const docFrontmatterSchema = z
  .object({
    /** Page title, templated as `%s · DaloyJS`. */
    title: z.string().min(1),
    /** 140–160 character meta description. */
    description: z.string().min(1),
    /** SEO keywords merged with the site defaults. */
    keywords: z.array(z.string()).default([]),
    /**
     * Sitemap hints for this page. Omit for the defaults (`priority: 0.7`,
     * `changeFrequency: monthly`); raise priority for entry points.
     */
    sitemap: z
      .object({
        priority: z.number().min(0).max(1).optional(),
        changeFrequency: z.enum(["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** Parsed, validated docs frontmatter. */
export type DocFrontmatter = z.infer<typeof docFrontmatterSchema>;

/** One MDX docs page on disk. */
export type MdxDoc = {
  /** Canonical route, e.g. `/docs/tutorials/bookstore`. */
  route: string;
  /** Route segments under `/docs`, e.g. `["tutorials", "bookstore"]`. */
  segments: string[];
  /** Path relative to the website root, e.g. `content/docs/tutorials/bookstore.mdx`. */
  file: string;
  frontmatter: DocFrontmatter;
  /**
   * The MDX body with the frontmatter block replaced by blank lines, so
   * compiler line numbers still match the file.
   */
  body: string;
};

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Split an MDX source into validated frontmatter and body.
 *
 * @param source - Raw file contents.
 * @param file - File path, used in error messages.
 * @param schema - Frontmatter schema; defaults to the docs schema.
 * @returns The frontmatter and the body (frontmatter lines blanked).
 * @throws {Error} When the frontmatter is missing or fails validation.
 */
export function parseMdxSource<T = DocFrontmatter>(
  source: string,
  file: string,
  schema: z.ZodType<T> = docFrontmatterSchema as unknown as z.ZodType<T>,
): { frontmatter: T; body: string } {
  const match = FRONTMATTER.exec(source);
  if (!match) {
    throw new Error(`${file}: missing YAML frontmatter (--- title / description ---)`);
  }

  const result = schema.safeParse(parseYaml(match[1] ?? "") ?? {});
  if (!result.success) {
    throw new Error(`${file}: invalid frontmatter: ${z.prettifyError(result.error)}`);
  }

  const blank = "\n".repeat(match[0].split("\n").length - 1);
  return { frontmatter: result.data, body: blank + source.slice(match[0].length) };
}

async function walk(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(
    entries.filter((entry) => entry.isDirectory()).map((entry) => walk(path.join(dir, entry.name))),
  );
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mdx"))
    .map((entry) => path.join(dir, entry.name));
  return [...files, ...nested.flat()];
}

/**
 * Map a content file to its docs route: `content/docs/a/b.mdx` → `/docs/a/b`
 * and `content/docs/a/index.mdx` → `/docs/a`.
 */
function routeSegments(file: string): string[] {
  const relative = path.relative(path.join(contentDir, "docs"), file).split(path.sep).join("/");
  const segments = relative.replace(/\.mdx$/, "").split("/");
  if (segments.at(-1) === "index") segments.pop();
  return segments;
}

/**
 * Read every MDX docs page under `content/docs`, sorted by route. Cached for
 * the deployment; content only changes when a new build ships.
 *
 * @returns All MDX docs pages.
 * @throws {Error} When any page has invalid frontmatter.
 */
export async function getMdxDocs(): Promise<MdxDoc[]> {
  "use cache";
  cacheLife("max");

  const files = await walk(path.join(contentDir, "docs"));
  const docs = await Promise.all(
    files.map(async (file) => {
      const relative = path.relative(process.cwd(), file).split(path.sep).join("/");
      const { frontmatter, body } = parseMdxSource(await readFile(file, "utf8"), relative);
      const segments = routeSegments(file);
      return {
        route: segments.length ? `/docs/${segments.join("/")}` : "/docs",
        segments,
        file: relative,
        frontmatter,
        body,
      } satisfies MdxDoc;
    }),
  );

  return docs.sort((left, right) => left.route.localeCompare(right.route));
}

/**
 * Look up one MDX docs page by its segments under `/docs`.
 *
 * @param segments - e.g. `["tutorials", "bookstore"]`.
 * @returns The page, or `null` when there is no such MDX page.
 */
export async function getMdxDoc(segments: string[]): Promise<MdxDoc | null> {
  const route = segments.length ? `/docs/${segments.join("/")}` : "/docs";
  return (await getMdxDocs()).find((doc) => doc.route === route) ?? null;
}

/**
 * Plain-text body of an MDX page for search, MCP and llms.txt: keeps prose and
 * code-fence contents, drops frontmatter, import/export lines, JSX tags, and
 * JS expression containers.
 *
 * @param body - MDX body (frontmatter already removed).
 * @param limit - Optional character cap.
 * @returns Normalized plain text.
 */
export function extractMdxBodyText(body: string, limit?: number): string {
  const text = body
    .replace(/^(?:import|export)\s.*$/gm, " ")
    .replace(/^```[^\n]*$/gm, " ")
    .replace(/\[#[\w-]+\]/g, " ")
    .replace(/\{[^{}]*\}/g, " ")
    .replace(/<\/?[A-Za-z][^>]*>/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return typeof limit === "number" ? text.slice(0, limit) : text;
}
