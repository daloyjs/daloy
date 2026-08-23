import {
  methodNotAllowedProblem,
  problemResponse,
} from "@/lib/problem-json";
import { consumeSiteApiQuota } from "@/lib/site-api-response";
import { buildSiteOpenApiDocument } from "@/lib/site-openapi";
import { siteApiHeaders } from "@/lib/site-rate-limit";

/**
 * Machine-readable OpenAPI 3.1 document for the HTTP APIs on daloyjs.dev
 * (docs MCP, agent discovery). Framework users generating a spec from their
 * own routes should follow `/docs/openapi`.
 */
export function GET(request: Request): Response {
  const quota = consumeSiteApiQuota(request);
  if (quota.limited) {
    return quota.response;
  }

  return Response.json(buildSiteOpenApiDocument(), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=3600",
      vary: "Accept, Accept-Encoding",
      ...siteApiHeaders(quota.snapshot),
    },
  });
}

function methodNotAllowed(request: Request): Response {
  const quota = consumeSiteApiQuota(request);
  if (quota.limited) {
    return quota.response;
  }

  return problemResponse(
    methodNotAllowedProblem(
      new URL(request.url).pathname,
      "GET, OPTIONS",
      "GET /openapi.json returns the OpenAPI 3.1 document. Other methods are not defined.",
    ),
    { ...siteApiHeaders(quota.snapshot), allow: "GET, OPTIONS" },
  );
}

export function POST(request: Request): Response {
  return methodNotAllowed(request);
}

export function PUT(request: Request): Response {
  return methodNotAllowed(request);
}

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      allow: "GET, OPTIONS",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "Content-Type, Accept, Authorization",
    },
  });
}
