import { OAUTH_TOKEN_ENDPOINT } from "@/lib/site-api";
import { consumeSiteApiQuota } from "@/lib/site-api-response";
import { siteApiHeaders } from "@/lib/site-rate-limit";

/**
 * Authorization endpoint required by RFC 8414 metadata.
 *
 * This server does not implement browser redirects or authorization_code.
 * GET and POST respond with an OAuth error pointing at the token endpoint so
 * probes receive a live JSON response instead of an HTML 404.
 */
function credentialsOnly(request: Request): Response {
  const quota = consumeSiteApiQuota(request);
  if (quota.limited) {
    return quota.response;
  }

  return Response.json(
    {
      error: "unsupported_response_type",
      error_description:
        "This authorization server supports the client_credentials grant only. POST application/x-www-form-urlencoded to " +
        OAUTH_TOKEN_ENDPOINT +
        " with grant_type=client_credentials and optional scope=docs:read.",
    },
    {
      status: 400,
      headers: siteApiHeaders(quota.snapshot, { allow: "GET, POST, OPTIONS" }),
    },
  );
}

export function GET(request: Request): Response {
  return credentialsOnly(request);
}

export function POST(request: Request): Response {
  return credentialsOnly(request);
}

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      allow: "GET, POST, OPTIONS",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "Content-Type, Accept, Authorization",
    },
  });
}
