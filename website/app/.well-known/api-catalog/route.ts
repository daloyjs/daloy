import {
  OAUTH_AS_METADATA_PATH,
  OAUTH_INTROSPECTION_ENDPOINT,
  OAUTH_PROTECTED_RESOURCE_PATH,
  OAUTH_TOKEN_ENDPOINT,
  SITE_API_V1_PATH,
} from "@/lib/site-api";
import { consumeSiteApiQuota } from "@/lib/site-api-response";
import { PROTECTED_RESOURCE_PATHS } from "@/lib/site-oauth";
import { siteApiHeaders } from "@/lib/site-rate-limit";
import { SITE_URL } from "@/lib/seo";

/**
 * RFC 9727 API catalog linkset. Agents that look up `rel="api-catalog"`
 * (or `/.well-known/api-catalog`) find the OpenAPI document, the docs MCP, and
 * the OAuth metadata without scraping HTML.
 *
 * The OAuth documents are listed with `rel="describedby"` so an agent can read
 * `scopes_supported` straight from the catalog instead of guessing well-known
 * paths, including the RFC 9728 §3.1 per-resource documents.
 *
 * @param request - Incoming request, used for the rate-limit key.
 * @returns `application/linkset+json`, or 429 problem+json.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9727
 */
export function GET(request: Request): Response {
  const quota = consumeSiteApiQuota(request);
  if (quota.limited) {
    return quota.response;
  }

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
        "latest-version": [
          {
            href: `${SITE_URL}${SITE_API_V1_PATH}`,
            type: "application/json",
          },
        ],
        describedby: [
          {
            href: `${SITE_URL}${OAUTH_AS_METADATA_PATH}`,
            type: "application/json",
            title: "OAuth 2.0 authorization server metadata (RFC 8414)",
          },
          {
            href: `${SITE_URL}${OAUTH_PROTECTED_RESOURCE_PATH}`,
            type: "application/json",
            title: "OAuth 2.0 protected resource metadata (RFC 9728)",
          },
          ...PROTECTED_RESOURCE_PATHS.map((path) => ({
            href: `${SITE_URL}${OAUTH_PROTECTED_RESOURCE_PATH}${path}`,
            type: "application/json",
            title: `OAuth 2.0 protected resource metadata for ${path} (RFC 9728)`,
          })),
          {
            href: `${SITE_URL}/llms.txt`,
            type: "text/plain",
            title: "llms.txt index",
          },
        ],
        item: [
          {
            href: `${SITE_URL}/mcp`,
            type: "application/json",
          },
          {
            href: `${SITE_URL}${SITE_API_V1_PATH}`,
            type: "application/json",
          },
          {
            href: OAUTH_TOKEN_ENDPOINT,
            type: "application/json",
          },
          {
            href: OAUTH_INTROSPECTION_ENDPOINT,
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
      ...siteApiHeaders(quota.snapshot),
    },
  });
}
