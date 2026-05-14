import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
	// Pin the workspace/tracing root to this app so Next never walks up into the
	// parent framework repo (which has its own `src/middleware.ts` that would be
	// misread as a Next.js middleware entrypoint).
	turbopack: {
		root: appDir,
	},
	outputFileTracingRoot: appDir,
};

export default nextConfig
