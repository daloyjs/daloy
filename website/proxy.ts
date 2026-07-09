import { type NextRequest, NextResponse } from "next/server";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Build the per-request Content-Security-Policy for the marketing/docs site.
 *
 * `script-src` is nonce-based with `'strict-dynamic'` and carries **no**
 * `'unsafe-inline'`: only scripts tagged with the request's fresh nonce (and
 * scripts they subsequently load — Google Analytics, Vercel Analytics) may run,
 * which blocks the injected-inline-script class of XSS. Because a nonce must be
 * unique per request, using it forces every page into dynamic rendering (see
 * {@link https://nextjs.org/docs/app/guides/content-security-policy}); that is
 * why the site no longer enables `cacheComponents`/PPR.
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
 * Next.js Proxy that attaches a fresh CSP nonce to every HTML navigation.
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
 * @param request - The incoming request.
 * @returns The response with the nonce and (in production) the CSP applied.
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

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  if (isProduction) {
    response.headers.set(
      "content-security-policy",
      buildContentSecurityPolicy(nonce),
    );
  }

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
