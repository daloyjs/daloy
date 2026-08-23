import { SITE_URL } from "@/lib/seo";

/**
 * RFC 9727 API catalog linkset. Agents that look up `rel="api-catalog"`
 * (or `/.well-known/api-catalog`) find the OpenAPI document and the docs MCP
 * without scraping HTML.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9727
 */
export function GET(): Response {
  const body = {
    linkset: [
      {
        anchor: `${SITE_URL}/`,
        "service-desc": [
          {
            href: `${SITE_URL}/openapi.json`,
            type: "application/vnd.oai.openapi+json;version=3.1",
          },
        ],
        item: [
          {
            href: `${SITE_URL}/mcp`,
            type: "application/json",
          },
          {
            href: `${SITE_URL}/api/v1`,
            type: "application/json",
          },
          {
            href: `${SITE_URL}/oauth/token`,
            type: "application/json",
          },
          {
            href: `${SITE_URL}/llms.txt`,
            type: "text/plain",
          },
        ],
      },
    ],
  };

  return Response.json(body, {
    headers: {
      "content-type": "application/linkset+json; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
