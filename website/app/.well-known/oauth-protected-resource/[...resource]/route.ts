import { notFoundProblem, problemResponse } from "@/lib/problem-json";
import { buildProtectedResourceMetadata } from "@/lib/site-oauth";
import { consumeSiteApiQuota } from "@/lib/site-api-response";
import { siteApiHeaders } from "@/lib/site-rate-limit";

/**
 * Per-resource RFC 9728 protected-resource metadata.
 *
 * RFC 9728 §3.1 locates a resource's metadata by inserting the resource's path
 * components between `/.well-known/oauth-protected-resource` and nothing else,
 * so `https://daloyjs.dev/mcp` is described at
 * `/.well-known/oauth-protected-resource/mcp`. The MCP authorization spec
 * requires clients to resolve exactly that URL, so publishing only the
 * origin-wide document leaves an MCP client with no machine-readable scope
 * list for the endpoint it is actually calling.
 *
 * Unregistered paths are a 404 problem+json rather than a fabricated document:
 * an agent must not be told that a resource exists here when it does not.
 *
 * @param request - Incoming request.
 * @param context - Route params carrying the resource path segments.
 * @returns The metadata document, or 404 / 429 problem+json.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9728#section-3.1
 * @see https://modelcontextprotocol.io/specification/basic/authorization
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ resource: string[] }> },
): Promise<Response> {
  const quota = consumeSiteApiQuota(request);
  if (quota.limited) {
    return quota.response;
  }

  const { resource } = await params;
  const headers = siteApiHeaders(quota.snapshot);
  const metadata = buildProtectedResourceMetadata(`/${resource.join("/")}`);

  if (!metadata) {
    return problemResponse(
      notFoundProblem(new URL(request.url).pathname),
      headers,
    );
  }

  return Response.json(metadata, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=3600",
      ...headers,
    },
  });
}
