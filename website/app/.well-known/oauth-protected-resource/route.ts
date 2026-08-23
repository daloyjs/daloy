import { buildProtectedResourceMetadata } from "@/lib/site-oauth";
import { consumeSiteApiQuota } from "@/lib/site-api-response";
import { siteApiHeaders } from "@/lib/site-rate-limit";

/**
 * RFC 9728 OAuth 2.0 Protected Resource Metadata, including
 * `scopes_supported`.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9728
 */
export function GET(request: Request): Response {
  const quota = consumeSiteApiQuota(request);
  if (quota.limited) {
    return quota.response;
  }

  return Response.json(buildProtectedResourceMetadata(), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=3600",
      ...siteApiHeaders(quota.snapshot),
    },
  });
}
