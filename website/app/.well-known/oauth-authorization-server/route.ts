import { buildAuthorizationServerMetadata } from "@/lib/site-oauth";
import { consumeSiteApiQuota } from "@/lib/site-api-response";
import { siteApiHeaders } from "@/lib/site-rate-limit";

/**
 * RFC 8414 OAuth 2.0 Authorization Server Metadata.
 *
 * @see https://www.rfc-editor.org/rfc/rfc8414
 */
export function GET(request: Request): Response {
  const quota = consumeSiteApiQuota(request);
  if (quota.limited) {
    return quota.response;
  }

  return Response.json(buildAuthorizationServerMetadata(), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=3600",
      ...siteApiHeaders(quota.snapshot),
    },
  });
}
