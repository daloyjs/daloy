import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  cacheComponents: true,
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;