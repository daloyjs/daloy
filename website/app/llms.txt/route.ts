import { getDocsSearchSections } from "@/lib/docs-search";
import { SITE_URL } from "@/lib/seo";

/**
 * Serve an llms.txt index (https://llmstxt.org) of the documentation.
 *
 * Lists every docs page with its title and description, grouped by the same
 * sections as the sidebar, so LLMs and agents can discover and cite the
 * docs without crawling the HTML. The heavy lifting (page discovery and
 * metadata extraction) is cached via `getDocsSearchSections`.
 *
 * @returns A `text/plain; charset=utf-8` markdown response.
 */
export async function GET() {
  const sections = await getDocsSearchSections();

  const lines: string[] = [
    "# DaloyJS",
    "",
    "> DaloyJS is a runtime-portable, contract-first TypeScript web framework with built-in OpenAPI 3.1 generation, typed client codegen (Hey API), and security-first defaults. It runs on Node.js, Bun, Deno, and Cloudflare Workers.",
    "",
    "Every docs page is also available as markdown: append `.md` to its URL (the links below point at the markdown versions; drop the `.md` suffix for the canonical HTML).",
    "",
  ];

  for (const section of sections) {
    lines.push(`## ${section.heading}`, "");

    for (const item of section.items) {
      lines.push(`- [${item.title}](${SITE_URL}${item.href}.md): ${item.description}`);
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
