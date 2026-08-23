import { buildAuthorizationServerMetadata } from "@/lib/site-oauth";
import { consumeSiteApiQuota } from "@/lib/site-api-response";
import { siteApiHeaders } from "@/lib/site-rate-limit";

/**
 * OAuth 2.0 metadata at the OpenID Connect Discovery well-known path.
 *
 * RFC 8414 §5 notes that some OAuth deployments publish at
 * `/.well-known/openid-configuration` even when they are not an OpenID
 * Provider. This origin is an OAuth authorization server for the public
 * `docs:read` scope; it does not issue ID tokens. The document is the same
 * RFC 8414 metadata as `/.well-known/oauth-authorization-server`.
 *
 * @see https://www.rfc-editor.org/rfc/rfc8414#section-5
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
