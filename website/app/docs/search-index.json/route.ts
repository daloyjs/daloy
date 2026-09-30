import { getDocsSearchSections } from "@/lib/docs-search";

/**
 * `GET /docs/search-index.json`: the grouped docs search index, loaded by the
 * search dialog, the 404 suggestions and the link previews on first use
 * instead of being serialized into every docs page's payload. Static: built
 * once per deployment from the same corpus as MCP and llms.txt.
 */
export async function GET(): Promise<Response> {
  return Response.json(await getDocsSearchSections(), {
    headers: { "Cache-Control": "public, max-age=300, s-maxage=86400, stale-while-revalidate=86400" },
  });
}
