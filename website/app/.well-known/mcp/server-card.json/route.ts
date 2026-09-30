import { consumeSiteApiQuota } from "@/lib/site-api-response";
import { buildServerCard } from "@/lib/site-mcp";
import { siteApiHeaders } from "@/lib/site-rate-limit";

/**
 * CORS for the Server Card, as the MCP Server Cards draft recommends: the
 * card is public, credential-free metadata, so any origin may read it.
 */
const CARD_CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "Content-Type",
} as const;

/**
 * `GET /.well-known/mcp/server-card.json`: the MCP Server Card for the docs
 * MCP server at `/mcp`, so clients can discover its transport, tools and auth
 * without connecting first.
 *
 * Implements the **draft** MCP Server Cards proposal (SEP-1649); the format
 * may change before it lands in a released MCP specification. The body is
 * built from the same definitions `/mcp` serves (`lib/site-mcp.ts`). Shares
 * the site API rate limit like the other `/.well-known` documents.
 *
 * @param request - Incoming request, used for the rate-limit key.
 * @returns The card as `application/json`, or 429 problem+json.
 */
export function GET(request: Request): Response {
  const quota = consumeSiteApiQuota(request);
  if (quota.limited) {
    return quota.response;
  }

  return Response.json(buildServerCard(), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=3600",
      ...CARD_CORS_HEADERS,
      ...siteApiHeaders(quota.snapshot),
    },
  });
}

/** CORS preflight for browser-based clients. */
export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: { ...CARD_CORS_HEADERS, "access-control-max-age": "86400" } });
}
