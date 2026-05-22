import Link from "next/link";
import type { Route } from "next";

import { CodeBlock } from "@/components/code-block";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Deployment",
  description:
    "Deploy DaloyJS apps to containers, Node PaaS platforms, and edge or serverless providers. Production-ready guides for Docker, Fly.io, Render, Railway, Heroku, Vercel, Cloudflare Workers, Bun, and Deno.",
  path: "/docs/deployment",
  keywords: [
    "deploy DaloyJS",
    "DaloyJS Docker deployment",
    "Fly.io deployment",
    "Render deployment",
    "Railway deployment",
    "Heroku deployment",
    "Cloudflare Workers deployment",
    "Vercel deployment",
  ],
  type: "article",
});

type Target = {
  name: string;
  href: Route;
  blurb: string;
};

const NODE_PLATFORMS: Target[] = [
  {
    name: "Fly.io",
    href: "/docs/deployment/fly-io" as Route,
    blurb:
      "Containerized Node service with fly.toml, health checks, and scale-to-zero machines.",
  },
  {
    name: "Render",
    href: "/docs/deployment/render" as Route,
    blurb:
      "Blueprint-based Node web service with healthCheckPath and autoscaling.",
  },
  {
    name: "Railway",
    href: "/docs/deployment/railway" as Route,
    blurb:
      "Auto-detected Node app with optional railway.json or railway.toml for start, health, and migrations.",
  },
  {
    name: "Heroku",
    href: "/docs/deployment/heroku" as Route,
    blurb:
      "Procfile-based Node dyno on heroku-24 or heroku-26 with the heroku/nodejs buildpack.",
  },
];

function Grid({ items }: { items: Target[] }) {
  return (
    <div className="not-prose my-6 grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="rounded-lg border bg-card p-4 transition-colors hover:border-foreground/40 hover:bg-muted/40"
        >
          <div className="font-medium text-foreground">{item.name}</div>
          <p className="mt-1 text-sm text-muted-foreground">{item.blurb}</p>
        </Link>
      ))}
    </div>
  );
}

export default function Page() {
  return (
    <>
      <h1>Deployment</h1>

      <p>
        Deployment answers a different question from adapters. The adapter docs explain which
        runtime contract DaloyJS plugs into. This page explains how to package, configure, and run
        that app on a platform you&apos;re shipping to.
      </p>

      <h2>Node platforms</h2>
      <p>
        These providers all run the <Link href="/docs/adapters/node">Node adapter</Link>. What
        changes is the platform config, health checks, and rollout mechanics.
      </p>
      <Grid items={NODE_PLATFORMS} />

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
    FROM node:24-bookworm AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \\
    pnpm install --frozen-lockfile --prod

    FROM node:24-bookworm AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \\
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

    FROM gcr.io/distroless/nodejs24-debian12 AS runtime
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
        The Vercel template creates a catch-all route and uses the current Edge export shape from{" "}
        <code>@daloyjs/core/vercel</code>. See <Link href="/docs/adapters/vercel">Vercel</Link>,{" "}
        <Link href="/docs/adapters/cloudflare-workers">Cloudflare Workers</Link>, and{" "}
        <Link href="/docs/adapters/deno">Deno</Link> for runtime-specific handler variants.
      </p>
      <CodeBlock language="ts" code={`import { toWebHandler } from "@daloyjs/core/vercel";

export const runtime = "edge";
export default toWebHandler(app);`} />
    </>
  );
}
