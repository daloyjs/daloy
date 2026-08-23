import { problemResponse, notFoundProblem } from "@/lib/problem-json";
import { buildProtectedResourceMetadata } from "@/lib/site-oauth";
import { consumeSiteApiQuota } from "@/lib/site-api-response";
import { siteApiHeaders } from "@/lib/site-rate-limit";

/**
 * RFC 9728 OAuth 2.0 Protected Resource Metadata for the origin as a whole,
 * including `scopes_supported`.
 *
 * Individual resources publish their own document at the path-suffixed URL
 * defined by RFC 9728 §3.1 (`/.well-known/oauth-protected-resource/mcp`), which
 * is what an MCP client looks up before it attaches a token.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9728
 */
export function GET(request: Request): Response {
  const quota = consumeSiteApiQuota(request);
  if (quota.limited) {
    return quota.response;
  }

  const metadata = buildProtectedResourceMetadata("/");
  if (!metadata) {
    return problemResponse(
      notFoundProblem(new URL(request.url).pathname),
      siteApiHeaders(quota.snapshot),
    );
  }

  return Response.json(metadata, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=3600",
      ...siteApiHeaders(quota.snapshot),
    },
  });
}
