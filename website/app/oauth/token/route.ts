import { handleClientCredentialsGrant } from "@/lib/site-oauth";
import { consumeSiteApiQuota } from "@/lib/site-api-response";
import { readBodyLimited } from "@/lib/read-body-limited";
import { siteApiHeaders } from "@/lib/site-rate-limit";

const ALLOW = "POST, OPTIONS";
const MAX_FORM_BODY_BYTES = 16 * 1024;

/**
 * OAuth 2.0 token endpoint (RFC 6749). Supports `client_credentials` for the
 * public `docs:read` scope. No client secret: this origin's resources are
 * already public; the token is a least-privilege declaration for agents.
 */
export async function POST(request: Request): Promise<Response> {
  const quota = consumeSiteApiQuota(request);
  if (quota.limited) {
    return quota.response;
  }

  const headers = siteApiHeaders(quota.snapshot, { allow: ALLOW });
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return Response.json(
      {
        error: "invalid_request",
        error_description:
          "Send grant_type=client_credentials as application/x-www-form-urlencoded.",
      },
      { status: 400, headers },
    );
  }

  // Streamed under a byte cap: a chunked body with no Content-Length is
  // cancelled once it passes the limit instead of being buffered whole.
  const body = await readBodyLimited(request, MAX_FORM_BODY_BYTES);
  if (!body.ok) {
    return Response.json(
      {
        error: "invalid_request",
        error_description: "Request body too large.",
      },
      { status: 413, headers },
    );
  }

  const params = new URLSearchParams(new TextDecoder().decode(body.bytes));
  const result = handleClientCredentialsGrant(params);
  if (!result.ok) {
    return Response.json(result.body, { status: result.status, headers });
  }

  return Response.json(result.body, {
    headers: {
      ...headers,
      "cache-control": "no-store",
      pragma: "no-cache",
    },
  });
}

export function GET(request: Request): Response {
  const quota = consumeSiteApiQuota(request);
  if (quota.limited) {
    return quota.response;
  }

  return Response.json(
    {
      error: "invalid_request",
      error_description:
        "The token endpoint accepts POST with grant_type=client_credentials.",
    },
    {
      status: 405,
      headers: siteApiHeaders(quota.snapshot, { allow: ALLOW }),
    },
  );
}

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      allow: ALLOW,
      "access-control-allow-origin": "*",
      "access-control-allow-methods": ALLOW,
      "access-control-allow-headers":
        "Content-Type, Accept, Authorization",
    },
  });
}
