import {
  methodNotAllowedProblem,
  notFoundProblem,
  problemResponse,
} from "@/lib/problem-json";
import { SITE_URL } from "@/lib/seo";

/**
 * JSON catalog of the HTTP APIs hosted on daloyjs.dev.
 *
 * `GET /api` is the human-and-agent readable index. Any other path under
 * `/api/` is a real 404 with RFC 9457 problem+json (code + hint), never an
 * HTML app shell. Other methods on `/api` are 405 with the same envelope.
 */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "Content-Type, Accept",
} as const;

function pathnameOf(request: Request): string {
  const pathname = new URL(request.url).pathname;
  return pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
}

/**
 * JSON index of machine endpoints on this origin.
 *
 * @returns Catalog payload.
 */
function apiIndex(): Record<string, unknown> {
  return {
    name: "DaloyJS website APIs",
    description:
      "Agent-facing HTTP APIs on daloyjs.dev. Errors are RFC 9457 problem+json with `code` and `hint` fields. Page URLs also negotiate Accept: text/markdown.",
    links: {
      openapi: `${SITE_URL}/openapi.json`,
      catalog: `${SITE_URL}/.well-known/api-catalog`,
      mcp: `${SITE_URL}/mcp`,
      llms: `${SITE_URL}/llms.txt`,
      docs: `${SITE_URL}/docs`,
      apiDocs: `${SITE_URL}/docs/api-reference`,
      openApiDocs: `${SITE_URL}/docs/openapi`,
      authDocs: `${SITE_URL}/docs/auth`,
      webhooks: `${SITE_URL}/docs/webhook-delivery`,
      mcpDocs: `${SITE_URL}/docs/mcp`,
    },
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  const { path } = await params;
  const pathname = pathnameOf(request);

  if (path && path.length > 0) {
    return problemResponse(notFoundProblem(pathname), CORS);
  }

  return Response.json(apiIndex(), {
    headers: {
      "cache-control": "public, max-age=3600",
      vary: "Accept, Accept-Encoding",
      ...CORS,
    },
  });
}

function methodNotAllowed(request: Request): Response {
  const pathname = pathnameOf(request);
  return problemResponse(
    methodNotAllowedProblem(
      pathname,
      "GET, OPTIONS",
      "This resource is a JSON catalog. Send GET for the list of APIs, or GET /openapi.json for the OpenAPI 3.1 document.",
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

export function PATCH(request: Request): Response {
  return methodNotAllowed(request);
}

export function DELETE(request: Request): Response {
  return methodNotAllowed(request);
}

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: { ...CORS, allow: "GET, OPTIONS" },
  });
}
