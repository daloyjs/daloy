import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const root = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  typedRoutes: true,
  experimental: {
    cachedNavigations: true,
  },
  cacheComponents: true,
  // The /mcp documentation endpoint reads the docs `page.tsx` sources from disk
  // at runtime (via lib/docs-content). Trace those files into its serverless
  // bundle so they are present in production, not just during the build.
  outputFileTracingIncludes: {
    "/mcp": ["./app/docs/**/*.tsx"],
  },
  turbopack: {
    root,
  },
};

export default nextConfig;