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
  // Content negotiation (Accept: text/markdown vs text/html). Applied here as
  // well as in proxy.ts because Next.js overwrites Vary on HTML renders with
  // its RSC tokens; a second Vary field is combined by RFC 9110 §12.5.5.
  { key: "Vary", value: "Accept, Accept-Encoding" },
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
  cacheComponents: true,
  typedRoutes: true,
  // The docs are MDX files under `content/`, read from disk at runtime by the
  // /mcp endpoint, the markdown route (/docs/*.md), and the MDX page routes
  // when a prerendered page is re-rendered on demand. Trace them into those
  // serverless bundles so they exist in production, not just at build time.
  // The blog list (BLOG_POSTS) is read from content/blog the same way, by the
  // blog pages, RSS, llms.txt and the sitemap.
  outputFileTracingIncludes: {
    "/mcp": ["./content/**/*.mdx"],
    "/docs-md/[[...slug]]": ["./content/**/*.mdx"],
    "/md/[[...slug]]": ["./content/**/*.mdx"],
    "/docs": ["./content/**/*.mdx"],
    "/docs/[slug]": ["./content/**/*.mdx"],
    "/docs/[slug]/[child]": ["./content/**/*.mdx"],
    "/blog": ["./content/blog/*.mdx"],
    "/blog/[slug]": ["./content/blog/*.mdx"],
    "/blog/rss.xml": ["./content/blog/*.mdx"],
    "/llms.txt": ["./content/**/*.mdx"],
    "/sitemap.xml": ["./content/**/*.mdx"],
  },
  turbopack: {
    root,
  },
  async redirects() {
    return [
      {
        source: "/docs/api",
        destination: "/docs/api-reference",
        permanent: true,
      },
      {
        source: "/api-docs",
        destination: "/docs/api-reference",
        permanent: true,
      },
      {
        source: "/docs/webhooks",
        destination: "/docs/webhook-delivery",
        permanent: true,
      },
      {
        source: "/webhooks",
        destination: "/docs/webhook-delivery",
        permanent: true,
      },
      {
        source: "/blog/background-jobs-that-outlive-the-request",
        destination: "/blog/background-jobs-after-the-http-response",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
      // Appending `.md` to a URL serves the page as markdown via
      // app/md/[[...slug]]/route.ts. The same representation is also selected
      // when the request sends `Accept: text/markdown` (see proxy.ts).
      // The dot is escaped because `.` is a regex-special character in path
      // matching. Docs keep a dedicated rewrite so `/docs.md` still resolves.
      { source: "/docs\\.md", destination: "/md/docs" },
      { source: "/docs/:path*\\.md", destination: "/md/docs/:path*" },
      { source: "/:path*\\.md", destination: "/md/:path*" },
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
