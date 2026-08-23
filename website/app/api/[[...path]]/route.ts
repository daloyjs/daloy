import { SITE_API_V1_PATH } from "@/lib/site-api";

/**
 * Unversioned `/api` alias. GET `/api` redirects to `/api/v1` so agents that
 * look up URL-path versioning land on the current major. Other methods and
 * unknown suffixes follow the same redirect when they are just `/api`, else
 * 308 onto the versioned path so `/api/foo` becomes `/api/v1/foo` (which 404s
 * with problem+json).
 */
export function GET(request: Request): Response {
  return redirectToV1(request);
}

export function POST(request: Request): Response {
  return redirectToV1(request);
}

export function PUT(request: Request): Response {
  return redirectToV1(request);
}

export function PATCH(request: Request): Response {
  return redirectToV1(request);
}

export function DELETE(request: Request): Response {
  return redirectToV1(request);
}

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      allow: "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "access-control-allow-origin": "*",
      location: SITE_API_V1_PATH,
    },
  });
}

function redirectToV1(request: Request): Response {
  const url = new URL(request.url);
  const suffix = url.pathname.replace(/^\/api\/?/, "");
  const location = suffix ? `${SITE_API_V1_PATH}/${suffix}` : SITE_API_V1_PATH;
  return new Response(null, {
    status: 308,
    headers: {
      location,
      "API-Version": "1",
    },
  });
}
