import { dirname } from "node:path"
import { execSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))

const FALLBACK_CORE_PACKAGE_VERSION = "0.11.0"

function getPublishedCorePackageVersion() {
  if (process.env.NEXT_PUBLIC_CORE_PACKAGE_VERSION) {
    return process.env.NEXT_PUBLIC_CORE_PACKAGE_VERSION
  }

  try {
    return execSync("npm view @daloyjs/core version", {
      cwd: __dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return FALLBACK_CORE_PACKAGE_VERSION
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    viewTransition: true,
  },
  // Pin the workspace root to this site so Next.js doesn't walk up into the
  // framework's `src/` (which has a `middleware.ts` that is NOT a Next.js
  // edge middleware).
  turbopack: { root: __dirname },
  outputFileTracingRoot: __dirname,
  env: {
    NEXT_PUBLIC_CORE_PACKAGE_VERSION: getPublishedCorePackageVersion(),
  },
  async redirects() {
    return [
      // The sidebar labels the docs landing page "Introduction" but it lives at
      // /docs. External links and bookmarks pointing at /docs/introduction
      // should land on the same page instead of 404ing.
      { source: "/docs/introduction", destination: "/docs", permanent: true },
    ]
  },
}

export default nextConfig
