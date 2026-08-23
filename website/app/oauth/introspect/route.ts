import { introspectToken } from "@/lib/site-oauth";
import { consumeSiteApiQuota } from "@/lib/site-api-response";
import { siteApiHeaders } from "@/lib/site-rate-limit";

const ALLOW = "POST, OPTIONS";

/**
 * OAuth 2.0 Token Introspection (RFC 7662).
 *
 * Lets an agent confirm that a token it holds is still active and which scope
 * it carries, without decoding the JWT itself. The endpoint takes no client
 * authentication because this authorization server is public and issues one
 * scope over already-public documentation; an invalid token is reported as
 * `{ "active": false }` with no other detail, so the endpoint reveals nothing
 * about tokens the caller does not already have.
 *
 * @param request - `application/x-www-form-urlencoded` POST with `token`.
 * @returns The RFC 7662 introspection response, or an OAuth error.
 *
 * @see https://www.rfc-editor.org/rfc/rfc7662
 */
export async function POST(request: Request): Promise<Response> {
  const quota = consumeSiteApiQuota(request);
  if (quota.limited) {
    return quota.response;
  }

  const headers = siteApiHeaders(quota.snapshot, {
    allow: ALLOW,
    "cache-control": "no-store",
  });
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return Response.json(
      {
        error: "invalid_request",
        error_description:
          "Send token=<access token> as application/x-www-form-urlencoded.",
      },
      { status: 400, headers },
    );
  }

  const result = introspectToken(new URLSearchParams(await request.text()));
  if (!result.ok) {
    return Response.json(result.body, { status: result.status, headers });
  }

  return Response.json(result.body, { headers });
}

/**
 * Introspection is POST-only (RFC 7662 §2.1). GET answers with an OAuth error
 * so a probe gets JSON rather than an HTML 404.
 *
 * @param request - Incoming request.
 * @returns HTTP 405 with an OAuth error body.
 */
export function GET(request: Request): Response {
  const quota = consumeSiteApiQuota(request);
  if (quota.limited) {
    return quota.response;
  }

  return Response.json(
    {
      error: "invalid_request",
      error_description:
        "The introspection endpoint accepts POST with token=<access token>.",
    },
    {
      status: 405,
      headers: siteApiHeaders(quota.snapshot, {
        allow: ALLOW,
        "cache-control": "no-store",
      }),
    },
  );
}

/**
 * CORS preflight for browser-based agents.
 *
 * @returns HTTP 204 carrying the CORS headers.
 */
export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      allow: ALLOW,
      "access-control-allow-origin": "*",
      "access-control-allow-methods": ALLOW,
      "access-control-allow-headers": "Content-Type, Accept, Authorization",
    },
  });
}
