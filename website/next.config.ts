import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const root = dirname(fileURLToPath(import.meta.url));

const isProduction = process.env.NODE_ENV === "production";

/**
 * Content-Security-Policy for the statically prerendered marketing/docs site.
 *
 * Per-request nonces would force every page into dynamic rendering and erase
 * the static-prerender win, so inline `script`/`style` are allowed (the only
 * inline payloads are framework/theme bootstrap and build-time, escaped
 * JSON-LD). Every *external* origin is still pinned explicitly, so the policy
 * keeps blocking injected third-party scripts, clickjacking, and `<base>`
 * hijacking. Applied in production only: `next dev` (Turbopack HMR) needs
 * `'unsafe-eval'` and websocket connections this policy would otherwise reject.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://va.vercel-scripts.com",
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

/**
 * Security response headers applied to every route. The CSP is production-only
 * (see {@link contentSecurityPolicy}); the remaining headers are safe in every
 * environment (HSTS is a no-op over plain-HTTP dev, the rest are inert there).
 */
const securityHeaders = [
  ...(isProduction
    ? [{ key: "Content-Security-Policy", value: contentSecurityPolicy }]
    : []),
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const serviceWorkerHeaders = [
  { key: "Content-Type", value: "application/javascript; charset=utf-8" },
  { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
  {
    key: "Content-Security-Policy",
    value: "default-src 'self'; script-src 'self'",
  },
];

const nextConfig: NextConfig = {
  typedRoutes: true,
  experimental: {
    cachedNavigations: true,
    // Turbopack's on-disk dev cache fails its atomic commit on this Windows
    // machine ("Persisting failed ... Access is denied (os error 5)" — the
    // corporate antivirus holds freshly written cache files during the
    // rename). Turbopack falls back to in-memory caching anyway, so turn the
    // dev filesystem cache off to keep the startup log clean. Build caching
    // is unaffected.
    turbopackFileSystemCacheForDev: false,
  },
  cacheComponents: true,
  // The /mcp documentation endpoint reads the docs `page.tsx` sources from disk
  // at runtime (via lib/docs-content). Trace those files into its serverless
  // bundle so they are present in production, not just during the build. The
  // markdown docs endpoint (/docs/*.md) validates routes the same way.
  outputFileTracingIncludes: {
    "/mcp": ["./app/docs/**/*.tsx"],
    "/docs-md/[[...slug]]": ["./app/docs/**/*.tsx"],
  },
  turbopack: {
    root,
  },
  async rewrites() {
    return [
      // Appending `.md` to a docs URL serves the page as markdown via the
      // route handler in app/docs-md/[[...slug]]/route.ts (same pattern as
      // nextjs.org). The dot is escaped because `.` is a regex-special
      // character in path matching.
      { source: "/docs\\.md", destination: "/docs-md" },
      { source: "/docs/:path*\\.md", destination: "/docs-md/:path*" },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/sw.js", headers: serviceWorkerHeaders },
    ];
  },
};

export default nextConfig;
