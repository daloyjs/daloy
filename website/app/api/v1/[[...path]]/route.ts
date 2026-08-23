import {
  methodNotAllowedProblem,
  notFoundProblem,
  problemResponse,
} from "@/lib/problem-json";
import {
  DOCS_READ_SCOPE,
  OAUTH_AS_METADATA_PATH,
  OAUTH_PROTECTED_RESOURCE_PATH,
  OAUTH_TOKEN_ENDPOINT,
  SITE_API_VERSION,
  SITE_API_VERSIONING_POLICY,
} from "@/lib/site-api";
import {
  checkRequestedApiVersion,
  consumeSiteApiQuota,
} from "@/lib/site-api-response";
import {
  apiLifecycleSummary,
  findApiSurface,
  surfaceLinkRelations,
} from "@/lib/site-deprecation";
import { siteApiHeaders } from "@/lib/site-rate-limit";
import { SITE_URL } from "@/lib/seo";

/**
 * Versioned JSON catalog of the HTTP APIs hosted on daloyjs.dev (`/api/v1`).
 *
 * Unknown subpaths are a real 404 with RFC 9457 problem+json. Responses carry
 * API-Version and RFC RateLimit headers.
 */

function pathnameOf(request: Request): string {
  const pathname = new URL(request.url).pathname;
  return pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
}

function apiIndex(): Record<string, unknown> {
  return {
    name: "DaloyJS website APIs",
    description:
      "Agent-facing HTTP APIs on daloyjs.dev. Errors are RFC 9457 problem+json with `code` and `hint` fields. Page URLs also negotiate Accept: text/markdown.",
    version: SITE_API_VERSION,
    versioning: {
      ...apiLifecycleSummary(),
      policy: SITE_API_VERSIONING_POLICY,
    },
    oauth: {
      authorization_server: `${SITE_URL}${OAUTH_AS_METADATA_PATH}`,
      protected_resource: `${SITE_URL}${OAUTH_PROTECTED_RESOURCE_PATH}`,
      token: OAUTH_TOKEN_ENDPOINT,
      scopes: [DOCS_READ_SCOPE],
    },
    links: {
      openapi: `${SITE_URL}/openapi.json`,
      catalog: `${SITE_URL}/.well-known/api-catalog`,
      mcp: `${SITE_URL}/mcp`,
      llms: `${SITE_URL}/llms.txt`,
      docs: `${SITE_URL}/docs`,
      apiDocs: `${SITE_URL}/docs/api-reference`,
      openApiDocs: `${SITE_URL}/docs/openapi`,
      lifecycle: `${SITE_URL}/docs/api-lifecycle`,
      authDocs: `${SITE_URL}/docs/auth`,
      webhooks: `${SITE_URL}/docs/webhook-delivery`,
      mcpDocs: `${SITE_URL}/docs/mcp`,
      oauthAuthorizationServer: `${SITE_URL}${OAUTH_AS_METADATA_PATH}`,
      oauthProtectedResource: `${SITE_URL}${OAUTH_PROTECTED_RESOURCE_PATH}`,
    },
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  const quota = consumeSiteApiQuota(request);
  if (quota.limited) {
    return quota.response;
  }

  const { path } = await params;
  const pathname = pathnameOf(request);
  const surface = findApiSurface(pathname);
  const headers = siteApiHeaders(quota.snapshot, {
    link: [
      ...(surface ? surfaceLinkRelations(surface) : []),
      `<${SITE_URL}/openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json;version=3.1"`,
      `<${SITE_URL}/docs/api-lifecycle>; rel="describedby"; type="text/html"`,
    ].join(", "),
  });

  const versionMismatch = checkRequestedApiVersion(request, headers);
  if (versionMismatch) {
    return versionMismatch;
  }

  if (path && path.length > 0) {
    return problemResponse(notFoundProblem(pathname), headers);
  }

  return Response.json(apiIndex(), {
    headers: {
      "cache-control": "public, max-age=3600",
      vary: "Accept, Accept-Encoding, API-Version",
      ...headers,
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
      pathnameOf(request),
      "GET, OPTIONS",
      "This resource is the v1 JSON catalog. Send GET, or GET /openapi.json for the OpenAPI 3.1 document.",
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

export function PATCH(request: Request): Response {
  return methodNotAllowed(request);
}

export function DELETE(request: Request): Response {
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
      "API-Version": SITE_API_VERSION,
    },
  });
}
