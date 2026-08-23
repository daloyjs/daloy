import { type NextRequest, NextResponse } from "next/server";

import {
  appendVaryAccept,
  isRscNavigation,
  PAGE_PRODUCES,
  preferredType,
  shouldNegotiatePage,
} from "@/lib/accept";
import { notAcceptableProblem, problemResponse } from "@/lib/problem-json";
import { findApiSurface, surfaceLinkRelations } from "@/lib/site-deprecation";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Build the per-request Content-Security-Policy for the marketing/docs site.
 *
 * `script-src` is nonce-based with `'strict-dynamic'` and carries **no**
 * `'unsafe-inline'`: only scripts tagged with the request's fresh nonce (and
 * scripts they subsequently load — Google Analytics, Vercel Analytics) may run,
 * which blocks the injected-inline-script class of XSS. Because a nonce must be
 * unique per request, the root layout that reads it must stay dynamically
 * rendered (see {@link https://nextjs.org/docs/app/guides/content-security-policy}).
 * `cacheComponents` is on; the root layout is a documented `instant = false`
 * Block so the nonce can still be stamped onto next-themes and analytics.
 *
 * `style-src` intentionally keeps `'unsafe-inline'`: React emits inline `style`
 * attributes that a nonce cannot cover, and inline-style injection is not the
 * XSS vector this policy targets. In development `'unsafe-eval'` is added to
 * `script-src` because React's dev build uses `eval` for error overlays.
 *
 * @param nonce - The base64 nonce minted for this request.
 * @returns The serialized CSP header value.
 */
function buildContentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProduction ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://*.googletagmanager.com https://*.google-analytics.com",
    "font-src 'self' data:",
    "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://vitals.vercel-insights.com https://va.vercel-scripts.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/**
 * Paths under `/docs` that are not documentation pages and therefore have no
 * markdown sibling to advertise.
 */
const NON_PAGE_DOCS_SEGMENTS = new Set(["llms.txt", "opengraph-image"]);

/**
 * Build the RFC 8288 `Link` header value implementing llms.txt v2 discovery
 * plus RFC 9727 API catalog discovery.
 *
 * v2 added standard link relations so an agent holding a page can find that
 * page's markdown version, and the llms.txt file covering it, without guessing:
 * `rel="alternate" type="text/markdown"` points at the markdown, and
 * `rel="describedby"` points at the llms.txt. Emitting them as a response
 * header (rather than only as HTML `<link>` elements) means the relations also
 * reach non-HTML resources such as the `.md` files themselves, and that an
 * agent never has to parse HTML to follow them.
 *
 * Because an llms.txt file covers the pages under its own path and agents use
 * the most specific match, docs URLs are described by `/docs/llms.txt` and
 * everything else by the site-wide `/llms.txt`.
 *
 * `rel="api-catalog"` points at the RFC 9727 linkset so agents that never
 * parse HTML still find `/openapi.json` and `/mcp`.
 *
 * Versioned and aliased API surfaces additionally carry their lifecycle
 * relations (`deprecation`, `sunset`, `successor-version`, `latest-version`)
 * from `lib/site-deprecation.ts`. They are added here rather than only in the
 * route handler because this proxy owns the `Link` field for those paths, so a
 * handler-set value would be replaced.
 *
 * @param pathname - Request pathname, before any rewrite is applied.
 * @returns The serialized `Link` header value.
 */
function buildLlmsTxtLinkHeader(pathname: string): string {
  const path =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  const isDocs = path === "/docs" || path.startsWith("/docs/");
  const relations: string[] = [];

  // A page advertises its markdown sibling. The markdown files, the
  // llms.txt files, and the generated OG images have no sibling of their own.
  const lastSegment = path.slice(path.lastIndexOf("/") + 1);
  if (
    !path.endsWith(".md") &&
    !NON_PAGE_DOCS_SEGMENTS.has(lastSegment) &&
    shouldNegotiatePage(path)
  ) {
    relations.push(`<${path}.md>; rel="alternate"; type="text/markdown"`);
  }

  relations.push(
    `<${isDocs ? "/docs/llms.txt" : "/llms.txt"}>; rel="describedby"`,
    `</.well-known/api-catalog>; rel="api-catalog"`,
    `</openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json;version=3.1"`,
  );

  const surface = findApiSurface(path);
  if (surface) {
    relations.push(...surfaceLinkRelations(surface));
  }

  return relations.join(", ");
}

function applySecurityHeaders(response: NextResponse, nonce: string): void {
  if (isProduction) {
    response.headers.set(
      "content-security-policy",
      buildContentSecurityPolicy(nonce),
    );
  }
}

function markdownRewritePath(pathname: string): string {
  const htmlPath = pathname.endsWith(".md")
    ? pathname.slice(0, -3) || "/"
    : pathname;
  return htmlPath === "/" ? "/md" : `/md${htmlPath}`;
}

/**
 * Next.js Proxy that attaches a fresh CSP nonce to every HTML navigation,
 * negotiates `Accept: text/markdown`, and adds llms.txt v2 plus API-catalog
 * discovery relations to every response.
 *
 * A cryptographically random nonce is minted per request, forwarded to the app
 * on the `x-nonce` request header (so the root layout can stamp it onto
 * next-themes and the analytics `<Script>` tags), and echoed on the response's
 * `Content-Security-Policy`. Next.js also parses that header and applies the
 * nonce to its own framework/hydration scripts automatically.
 *
 * The enforced CSP is set in production only: `next dev` (Turbopack HMR) injects
 * scripts and websocket connections that a strict policy would reject, so dev
 * keeps the relaxed default while still receiving the `x-nonce` header.
 *
 * The `Link` header is set in every environment: it carries no secrets, and
 * agents reading a preview deployment should get the same discovery relations
 * as agents reading production. See {@link buildLlmsTxtLinkHeader}.
 *
 * Markdown negotiation follows acceptmarkdown.com: parse `Accept` by q-value
 * and specificity, rewrite the canonical URL to `/md/...` when Markdown wins,
 * return 406 problem+json when the header cannot be satisfied, and always
 * `Vary: Accept` so CDNs do not mix variants.
 *
 * @param request - The incoming request.
 * @returns The response with the nonce, the llms.txt relations, negotiation,
 *   and (in production) the CSP applied.
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  if (isProduction) {
    requestHeaders.set(
      "content-security-policy",
      buildContentSecurityPolicy(nonce),
    );
  }

  const pathname = request.nextUrl.pathname;
  const negotiate =
    shouldNegotiatePage(pathname) && !isRscNavigation(request.headers);

  if (negotiate) {
    const acceptHeader = request.headers.get("accept");
    const chosen = pathname.endsWith(".md")
      ? "text/markdown"
      : preferredType(acceptHeader);

    if (chosen === "text/markdown") {
      const url = request.nextUrl.clone();
      url.pathname = markdownRewritePath(pathname);
      const rewritten = NextResponse.rewrite(url, {
        request: { headers: requestHeaders },
      });
      applySecurityHeaders(rewritten, nonce);
      rewritten.headers.set("link", buildLlmsTxtLinkHeader(pathname));
      appendVaryAccept(rewritten.headers);
      return rewritten;
    }

    if (chosen === null && acceptHeader) {
      const problem = problemResponse(
        notAcceptableProblem(pathname, PAGE_PRODUCES),
      );
      const response = new NextResponse(problem.body, {
        status: 406,
        headers: problem.headers,
      });
      response.headers.set("link", buildLlmsTxtLinkHeader(pathname));
      return response;
    }
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  applySecurityHeaders(response, nonce);
  response.headers.set("link", buildLlmsTxtLinkHeader(pathname));
  appendVaryAccept(response.headers);
  return response;
}

export const config = {
  matcher: [
    /*
     * Run on every request except static assets and Next internals, and skip
     * `next/link` prefetches (they don't need a nonce and would waste a dynamic
     * render). Assets are served from `public/` (e.g. `/assets/*`, `/sw.js`,
     * `/manifest.webmanifest`), which has its own CSP set in next.config.ts.
     */
    {
      source:
        "/((?!api|_next/static|_next/image|assets|sw.js|manifest.webmanifest|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
