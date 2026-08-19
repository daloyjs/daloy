import { getDocsSearchSections } from "@/lib/docs-search";
import { CORE_PACKAGE_VERSION, SITE_URL } from "@/lib/seo";

/**
 * Serve the `/docs/` subpath llms.txt index (https://llmstxt.org, v2).
 *
 * llms.txt v2 formally defines subpath coverage: a file covers the pages under
 * its own path, and where more than one file applies an agent should use the
 * most specific one. This file therefore describes `/docs/` only, and is what
 * the `rel="describedby"` link relation on every docs page (and on every `.md`
 * sibling) points at. The site-wide index at `/llms.txt` stays the entry point
 * for agents that also want the blog, the packages, and the repository.
 *
 * Page discovery and metadata extraction are shared with the docs search index
 * via `getDocsSearchSections`, so this file cannot silently disagree with the
 * sidebar about which pages exist.
 *
 * @returns A `text/plain; charset=utf-8` markdown response.
 */
export async function GET() {
  const sections = await getDocsSearchSections();

  const lines: string[] = [
    "# DaloyJS documentation",
    "",
    "> Reference documentation for `@daloyjs/core`, a runtime-portable, contract-first TypeScript web framework with built-in OpenAPI 3.1 generation, typed client codegen (Hey API), and security-first defaults. It runs on Node.js, Bun, Deno, and Cloudflare Workers.",
    "",
    `This file covers the pages under \`${SITE_URL}/docs/\`. For the whole site, including the blog and the published packages, see ${SITE_URL}/llms.txt.`,
    "",
    `Current release: \`@daloyjs/core@${CORE_PACKAGE_VERSION}\`, with zero runtime dependencies. Start a new project with \`pnpm create daloy@latest\`.`,
    "",
    'Every link below points at the markdown version of a docs page. Each markdown file lives at the page URL with `.md` appended (`/docs/routing` becomes `/docs/routing.md`); drop the suffix for the canonical HTML. Every docs page also advertises its markdown sibling with a `rel="alternate" type="text/markdown"` link relation, and points back here with `rel="describedby"`, on both the HTML `<link>` elements and the HTTP `Link:` response header.',
    "",
    `Agents that prefer structured tools over page fetches can query these same docs over the Model Context Protocol: \`${SITE_URL}/mcp\` is a read-only MCP server with \`search_docs\`, \`get_doc\`, and \`list_docs\` tools.`,
    "",
  ];

  for (const section of sections) {
    lines.push(`## ${section.heading}`, "");

    for (const item of section.items) {
      lines.push(
        `- [${item.title}](${SITE_URL}${item.href}.md): ${item.description}`,
      );
    }

    lines.push("");
  }

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
