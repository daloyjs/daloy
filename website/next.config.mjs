import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root to this site so Next.js doesn't walk up into the
  // framework's `src/` (which has a `middleware.ts` that is NOT a Next.js
  // edge middleware).
  turbopack: { root: __dirname },
  outputFileTracingRoot: __dirname,
  async redirects() {
    return [
      // The sidebar labels the docs landing page "Introduction" but it lives at
      // /docs. External links and bookmarks pointing at /docs/introduction
      // should land on the same page instead of 404ing.
      { source: "/docs/introduction", destination: "/docs", permanent: true },
    ];
  },
};

export default nextConfig;
