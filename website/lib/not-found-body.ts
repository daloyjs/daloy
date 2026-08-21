/**
 * Agent-recovery body for HTTP 404 responses.
 *
 * A status of 404 is necessary but not sufficient: agents still need a short
 * map of where to look next (sitemap, llms.txt, docs) instead of an empty
 * body or an app-shell HTML page.
 */

import { SITE_URL } from "@/lib/seo";

/**
 * Markdown 404 body pointing agents at the recovery surfaces on this site.
 *
 * @param pathname - The path that did not exist.
 */
export function notFoundMarkdown(pathname: string): string {
  return [
    "# 404 Not Found",
    "",
    `The path \`${pathname}\` does not exist on daloyjs.dev.`,
    "",
    "## Where to look next",
    "",
    `- [Sitemap](${SITE_URL}/sitemap.xml): every public HTML URL.`,
    `- [llms.txt](${SITE_URL}/llms.txt): curated agent index of the site.`,
    `- [Docs index](${SITE_URL}/docs): DaloyJS documentation home.`,
    `- [DaloyJS API docs](${SITE_URL}/docs/api-reference): public TypeScript surface.`,
    `- [DaloyJS OpenAPI spec](${SITE_URL}/docs/openapi): generating OpenAPI 3.1 from routes. Machine-readable catalog: ${SITE_URL}/openapi.json.`,
    `- [DaloyJS auth docs](${SITE_URL}/docs/auth): bearer auth and identity providers.`,
    `- [DaloyJS webhooks](${SITE_URL}/docs/webhook-delivery): signed outbound webhook delivery.`,
    `- [DaloyJS MCP server](${SITE_URL}/mcp): live docs tools (\`search_docs\`, \`get_doc\`, \`list_docs\`).`,
    `- [About](${SITE_URL}/about), [Contact](${SITE_URL}/contact), [Privacy](${SITE_URL}/privacy).`,
    "",
    "If you followed a stale link, start at llms.txt or the docs index rather than guessing paths.",
    "",
  ].join("\n");
}
