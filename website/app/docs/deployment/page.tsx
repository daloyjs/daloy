import { CodeBlock } from "../../../components/code-block";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Deployment",
  description:
    "Deploy DaloyJS apps to Node.js servers, Cloudflare Workers, Vercel Edge, Bun, or Deno Deploy. Production-ready guides for each target platform.",
  path: "/docs/deployment",
  keywords: ["deploy DaloyJS", "Cloudflare Workers deployment", "Vercel Edge deployment", "Node.js deployment", "Bun deployment"],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Deployment</h1>

      <h2>Production checklist</h2>
      <ul>
        <li>Set <code>NODE_ENV=production</code> so 5xx <code>detail</code> is redacted.</li>
        <li>Set a sane <code>bodyLimitBytes</code> per route group (don&apos;t default to 1 MiB everywhere).</li>
        <li>Set <code>requestTimeoutMs</code> to less than your load balancer&apos;s idle timeout.</li>
        <li>Mount <code>secureHeaders()</code>, <code>requestId()</code>, and <code>rateLimit()</code> globally.</li>
        <li>Wire your structured logger and propagate <code>request-id</code> to downstream calls.</li>
        <li>Run contract tests in CI — fail the build if the spec drifts.</li>
        <li>Use <code>pnpm install --frozen-lockfile</code> in CI; never <code>pnpm install</code>.</li>
      </ul>

      <h2>Docker (Node, distroless)</h2>
      <CodeBlock language="dockerfile" code={`# syntax=docker/dockerfile:1
FROM node:20-bookworm AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \\
    pnpm install --frozen-lockfile --prod

FROM node:20-bookworm AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \\
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM gcr.io/distroless/nodejs20-debian12 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist          ./dist
COPY package.json ./
USER 1000
EXPOSE 3000
CMD ["dist/server.js"]`} />

      <h2>Graceful shutdown</h2>
      <p>
        The Node adapter installs SIGTERM/SIGINT handlers by default. DaloyJS stops accepting new requests
        (returning 503) and waits up to <code>shutdownTimeoutMs</code> for in-flight requests to drain.
      </p>
      <CodeBlock code={`const { close } = serve(app, {
  shutdownTimeoutMs: 15_000,
  handleSignals: true,
});

// or trigger manually:
await app.shutdown(15_000);`} />

      <h2>Reverse proxy</h2>
      <p>If you sit behind nginx / Caddy / an LB, set:</p>
      <ul>
        <li><code>X-Forwarded-For</code> / <code>X-Forwarded-Proto</code> propagation for accurate logs.</li>
        <li>If you use <code>rateLimit()</code>, either pass an explicit <code>keyGenerator</code> or enable <code>trustProxyHeaders: true</code> only after the proxy strips client-supplied forwarding headers.</li>
        <li>Make the LB&apos;s idle timeout <strong>greater</strong> than DaloyJS&apos;s <code>requestTimeoutMs</code>.</li>
        <li>Make DaloyJS&apos;s <code>keepAliveTimeout</code> <strong>greater</strong> than the LB&apos;s — Node adapter does this for you.</li>
      </ul>

      <h2>Edge / serverless</h2>
      <p>
        DaloyJS can run on Vercel Edge, Cloudflare Workers, and Deno Deploy because the core is
        Web-standard <code>Request → Response</code>. Vercel is a first-class target; use the
        scaffolder when starting from scratch:
      </p>
      <CodeBlock language="bash" code={`pnpm create daloy@latest my-api --template vercel-edge`} />
      <p>
        The Vercel template creates a catch-all <code>api/[...path].ts</code> route and exports
        <code>toEdgeHandler(app)</code> from <code>@daloyjs/core/vercel</code>. Cloudflare is only
        another supported runtime option; you do not need it unless you deploy to Workers.
      </p>
      <CodeBlock language="ts" code={`import { toEdgeHandler } from "@daloyjs/core/vercel";

export const config = { runtime: "edge" };
export default toEdgeHandler(app);`} />
      <p>See <a href="/docs/adapters">Adapters</a> for runtime-specific entry points.</p>
    </>
  );
}
