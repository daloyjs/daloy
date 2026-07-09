import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const root = dirname(fileURLToPath(import.meta.url));

/**
 * Security response headers applied to every route.
 *
 * The Content-Security-Policy is **not** here: it is nonce-based and set
 * per-request in {@link file://./proxy.ts proxy.ts}, because a fresh nonce
 * cannot be baked into a static header. The headers below are static and safe
 * in every environment (HSTS is a no-op over plain-HTTP dev, the rest are inert
 * there).
 */
const securityHeaders = [
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
    // Turbopack's on-disk dev cache fails its atomic commit on this Windows
    // machine ("Persisting failed ... Access is denied (os error 5)" — the
    // corporate antivirus holds freshly written cache files during the
    // rename). Turbopack falls back to in-memory caching anyway, so turn the
    // dev filesystem cache off to keep the startup log clean. Build caching
    // is unaffected.
    turbopackFileSystemCacheForDev: false,
  },
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
