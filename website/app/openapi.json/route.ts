import {
  methodNotAllowedProblem,
  problemResponse,
} from "@/lib/problem-json";
import { buildSiteOpenApiDocument } from "@/lib/site-openapi";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "Content-Type, Accept",
} as const;

/**
 * Machine-readable OpenAPI 3.1 document for the HTTP APIs on daloyjs.dev
 * (docs MCP, agent discovery). Framework users generating a spec from their
 * own routes should follow `/docs/openapi`.
 */
export function GET(): Response {
  return Response.json(buildSiteOpenApiDocument(), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=3600",
      vary: "Accept, Accept-Encoding",
      ...CORS,
    },
  });
}

function methodNotAllowed(request: Request): Response {
  return problemResponse(
    methodNotAllowedProblem(
      new URL(request.url).pathname,
      "GET, OPTIONS",
      "GET /openapi.json returns the OpenAPI 3.1 document. Other methods are not defined.",
    ),
    { ...CORS, allow: "GET, OPTIONS" },
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
    headers: { ...CORS, allow: "GET, OPTIONS" },
  });
}
