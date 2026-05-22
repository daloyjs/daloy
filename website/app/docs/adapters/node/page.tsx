import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Node.js adapter",
  description:
    "Run a DaloyJS app on Node.js 24+ as a long-lived HTTP server. Graceful SIGTERM/SIGINT shutdown, sane request/header/keep-alive timeouts, and trust-proxy controls.",
  path: "/docs/adapters/node",
  keywords: [
    "DaloyJS Node.js adapter",
    "Node 24 HTTP server",
    "graceful shutdown Node",
    "closeAllConnections",
    "keepAliveTimeout",
    "trustProxy DaloyJS",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Node.js</h1>
      <p>
        The Node adapter runs your app on the built-in <code>node:http</code> server. It&apos;s the
        default target for containers, VMs, and any Node-based PaaS (Heroku, Railway, Render,
        Fly.io). Use it when you control the process — long-lived, observable, and easy to debug.
      </p>

      <h2>When to choose Node</h2>
      <ul>
        <li>You deploy to a container, VM, or Node PaaS (no per-request billing).</li>
        <li>You need <code>node:*</code> modules (filesystem, child processes, native addons).</li>
        <li>You want the broadest npm package compatibility.</li>
      </ul>

      <h2>Install</h2>
      <p>
        Requires <strong>Node.js 24 LTS or newer</strong>. The adapter ships with{" "}
        <code>@daloyjs/core</code>; no extra dependency.
      </p>
      <CodeBlock language="bash" code={`pnpm add @daloyjs/core`} />

      <h2>Minimal server</h2>
      <CodeBlock
        language="ts"
        code={`// src/server.ts
import { serve } from "@daloyjs/core/node";
import { app } from "./app.js";

const { port, close } = serve(app, {
  port: Number(process.env.PORT ?? 3000),
  hostname: "0.0.0.0",
  connectionTimeoutMs: 30_000,
  shutdownTimeoutMs: 10_000,
  handleSignals: true,       // SIGTERM / SIGINT trigger graceful shutdown
  maxHeaderBytes: 16 * 1024, // 16 KiB cap (default)
  trustProxy: false,         // set true only behind a trusted reverse proxy
});

console.log(\`listening on :\${port}\`);

// later — drain in-flight requests, then close
await close();`}
      />

      <h2>What the adapter wires for you</h2>
      <ul>
        <li>
          <code>requestTimeout</code>, <code>headersTimeout</code>, and{" "}
          <code>keepAliveTimeout</code> set to safe production values.
        </li>
        <li>
          SIGTERM / SIGINT handlers that call <code>server.close()</code> followed by{" "}
          <code>server.closeAllConnections()</code> after <code>shutdownTimeoutMs</code> — the
          pattern that became stable in Node 18.2 and is recommended on Node 24+.
        </li>
        <li>
          When <code>trustProxy: true</code>, the adapter reads <code>x-forwarded-proto</code> and{" "}
          <code>x-forwarded-host</code> when constructing the request URL. Leave it off unless TLS
          is terminated at a known proxy you control.
        </li>
      </ul>

      <h2>Behind a load balancer</h2>
      <p>Two rules to avoid the classic 502/504 race:</p>
      <ul>
        <li>
          Make your load balancer&apos;s idle timeout <strong>greater</strong> than DaloyJS&apos;s{" "}
          <code>requestTimeoutMs</code>.
        </li>
        <li>
          Make DaloyJS&apos;s <code>keepAliveTimeout</code> <strong>greater</strong> than the load
          balancer&apos;s — the Node adapter does this for you.
        </li>
      </ul>

      <h2>Dockerfile</h2>
      <CodeBlock
        language="docker"
        code={`FROM node:24-slim AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod

FROM node:24-slim AS build
WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile && pnpm build

FROM gcr.io/distroless/nodejs24-debian12
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER nonroot
EXPOSE 3000
CMD ["dist/server.js"]`}
      />

      <h2>Gotchas</h2>
      <ul>
        <li>
          Don&apos;t put <code>process.exit()</code> in a SIGTERM handler — let{" "}
          <code>close()</code> drain. The adapter handles the hard kill after the timeout.
        </li>
        <li>
          Set <code>hostname: &quot;0.0.0.0&quot;</code> in containers; Node binds to{" "}
          <code>localhost</code> by default and that&apos;s invisible from outside the container.
        </li>
      </ul>

      <h2>See also</h2>
      <ul>
        <li>
          <Link href="/docs/adapters">Adapters overview</Link>
        </li>
        <li>
          <Link href="/docs/deployment/fly-io">Fly.io</Link> ·{" "}
          <Link href="/docs/deployment/render">Render</Link> ·{" "}
          <Link href="/docs/deployment/railway">Railway</Link> ·{" "}
          <Link href="/docs/deployment/heroku">Heroku</Link>
        </li>
        <li>
          <Link href="/docs/security/lifecycle-health">Lifecycle &amp; health</Link>
        </li>
      </ul>
    </>
  );
}
