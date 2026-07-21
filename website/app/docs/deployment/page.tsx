import Link from "next/link";
import type { Route } from "next";

import { CodeBlock } from "@/components/code-block";
import { FlowDiagram } from "@/components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Deployment",
  description:
    "Deploy DaloyJS REST APIs to containers, Node PaaS platforms, and edge or serverless providers. Production-ready guides for Docker, Fly.io, Render, Railway, Heroku, Replit, Vercel, Cloudflare Workers, Bun, and Deno.",
  path: "/docs/deployment",
  keywords: [
    "deploy DaloyJS",
    "DaloyJS Docker deployment",
    "Fly.io deployment",
    "Render deployment",
    "Railway deployment",
    "Heroku deployment",
    "Replit deployment",
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
  {
    name: "Replit",
    href: "/docs/deployment/replit" as Route,
    blurb:
      "Node web server on Autoscale or Reserved VM with Publishing commands, Secrets, and port checks.",
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
        Deployment answers a different question from adapters. The adapter docs
        explain which runtime contract DaloyJS plugs into. This page helps you
        choose where to run a DaloyJS REST API and shows the packaging and
        platform config that matter in production.
      </p>

      <FlowDiagram
        title="Build to run"
        numbered
        steps={[
          {
            label: "Build",
            detail: "pnpm install --frozen-lockfile, pnpm build",
            eyebrow: "ci",
          },
          {
            label: "Package",
            detail: "distroless image or dist/",
          },
          {
            label: "Release",
            detail: "signed image + SBOM attestation",
            tone: "accent",
          },
          {
            label: "Run",
            detail: "Node adapter, graceful shutdown",
            tone: "success",
          },
        ]}
        caption="The same pipeline underpins every Node platform below. Only the packaging and platform config differ; the build, release, and run stages stay the same."
      />

      <h2 id="node-platforms">Node platforms</h2>
      <p>
        These providers all run the{" "}
        <Link href="/docs/adapters/node">Node adapter</Link>
        {". "}What changes is the platform config, health checks, and rollout
        mechanics.
      </p>
      <Grid items={NODE_PLATFORMS} />

      <h2 id="production-checklist">Production checklist</h2>
      <ul>
        <li>
          Set <code>NODE_ENV=production</code> so 5xx <code>detail</code> is
          redacted.
        </li>
        <li>
          Set a sane <code>bodyLimitBytes</code> per route group (don&apos;t
          default to 1 MiB everywhere).
        </li>
        <li>
          Set <code>requestTimeoutMs</code> to less than your load
          balancer&apos;s idle timeout.
        </li>
        <li>
          Mount <code>secureHeaders()</code>
          {", "}<code>requestId()</code>
          {", "}and <code>rateLimit()</code> globally.
        </li>
        <li>
          Wire your structured logger and propagate <code>request-id</code> to
          downstream calls.
        </li>
        <li>Run contract tests in CI, fail the build if the spec drifts.</li>
        <li>
          Use <code>pnpm install --frozen-lockfile</code> in CI; never{" "}
          <code>pnpm install</code>.
        </li>
      </ul>

      <h2 id="docker-node-distroless">Docker (Node, distroless)</h2>
      <CodeBlock
        language="dockerfile"
        code={`# syntax=docker/dockerfile:1
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
CMD ["dist/server.js"]`}
      />

      <h3 id="signed-images-sbom-attestation">
        Signed images + SBOM attestation
      </h3>
      <p>
        <code>create-daloy --with-ci</code> ships a <code>deploy.yml</code>{" "}
        that, after every successful push to GHCR, resolves the immutable{" "}
        <code>@sha256:&lt;digest&gt;</code>
        {", "}signs the image with{" "}
        <a
          href="https://docs.sigstore.dev/cosign/signing/signing_with_blobs/"
          target="_blank"
          rel="noreferrer"
        >
          Sigstore Cosign
        </a>{" "}
        (keyless / OIDC, no long-lived signing key), generates an SPDX SBOM for
        the image, and uploads it as a Cosign attestation (<code>--type spdxjson</code>). The job grants{" "}
        <code>id-token: write</code> alongside <code>packages: write</code>; the
        top-level workflow keeps <code>permissions: {`{}`}</code>
        {". "}This closes the Aikido{" "}
        <a
          href="https://www.aikido.dev/blog/container-security-best-practices"
          target="_blank"
          rel="noreferrer"
        >
          container-security checklist
        </a>{" "}
        items for &quot;Use Signed Images&quot; and &quot;Generate an
        SBOM.&quot; Verify any pulled image with:
      </p>
      <CodeBlock
        language="bash"
        code={`# Replace owner/repo and the digest with your values.
cosign verify ghcr.io/<owner>/<repo>@sha256:<digest> \\
  --certificate-identity-regexp 'https://github\\.com/<owner>/<repo>/\\.github/workflows/deploy\\.yml@.*' \\
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

cosign verify-attestation \\
  --type spdxjson \\
  --certificate-identity-regexp 'https://github\\.com/<owner>/<repo>/\\.github/workflows/deploy\\.yml@.*' \\
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \\
  ghcr.io/<owner>/<repo>@sha256:<digest>`}
      />

      <h2 id="graceful-shutdown">Graceful shutdown</h2>
      <p>
        The Node adapter installs SIGTERM/SIGINT handlers by default. DaloyJS
        stops accepting new requests (returning 503) and waits up to{" "}
        <code>shutdownTimeoutMs</code> for in-flight requests to drain.
      </p>
      <CodeBlock
        code={`const { close } = serve(app, {
  shutdownTimeoutMs: 15_000,
  handleSignals: true,
});

// or trigger manually:
await app.shutdown(15_000);`}
      />

      <h2 id="reverse-proxy">Reverse proxy</h2>
      <p>
        If you sit behind nginx / Caddy / a load balancer / a PaaS edge
        (Railway, Render, Fly, Heroku), declare the proxy posture so DaloyJS
        resolves the real client IP and stops refusing forwarded requests:
      </p>
      <ul>
        <li>
          Set <code>behindProxy: {"{ hops: N }"}</code> on{" "}
          <code>new App({"{ ... }"})</code>
          {", "}where <code>N</code> is the number of trusted proxy hops in
          front of the app (a single edge proxy is <code>1</code>; Cloudflare in
          front of one PaaS edge is <code>2</code>). In production an <strong>unconfigured</strong> posture makes
          DaloyJS return <code>500</code> on the first request carrying an{" "}
          <code>X-Forwarded-*</code> header, so a misconfigured chain cannot
          feed spoofable client IPs to <code>rateLimit()</code>
          {", "}request-id propagation, or audit logs. Use{" "}
          <code>behindProxy: &quot;none&quot;</code> when the app faces the
          public internet directly.
        </li>
        <li>
          Once the posture is declared, <code>rateLimit()</code> keys on the
          resolved client IP automatically, no custom <code>keyGenerator</code>{" "}
          required.
        </li>
        <li>
          Make the LB&apos;s idle timeout <strong>greater</strong> than
          DaloyJS&apos;s <code>requestTimeoutMs</code>.
        </li>
        <li>
          Make DaloyJS&apos;s <code>keepAliveTimeout</code>{" "}
          <strong>greater</strong> than the LB&apos;s, Node adapter does this
          for you.
        </li>
      </ul>

      <h2 id="edge-serverless-rest-apis">Edge / serverless REST APIs</h2>
      <p>
        DaloyJS can run on Vercel Functions, Cloudflare Workers, Netlify
        Functions, AWS Lambda, Fastly Compute, and Deno Deploy because the core
        is Web-standard <code>Request → Response</code>
        {". "}Use these targets when you want per-request billing or a managed
        edge/serverless runtime instead of a long-lived Node process.
      </p>
      <p>
        For a standalone Vercel REST API, create a single{" "}
        <code>api/index.ts</code> function and export the web-standard fetch
        handler, plus a <code>vercel.json</code> rewrite so DaloyJS routes at
        the site root (without it the root domain 404s):
      </p>
      <CodeBlock
        language="ts"
        code={`// api/index.ts
import { toFetchHandler } from "@daloyjs/core/vercel";
import { app } from "../src/server.js";

export default toFetchHandler(app);

// vercel.json
// { "rewrites": [{ "source": "/(.*)", "destination": "/api" }] }`}
      />
      <p>
        See <Link href="/docs/adapters/vercel">Vercel</Link>
        {", "}
        <Link href="/docs/adapters/cloudflare-workers">Cloudflare Workers</Link>
        {", "}<Link href="/docs/adapters/netlify">Netlify</Link>
        {", "}
        <Link href="/docs/adapters/aws-lambda">AWS Lambda</Link>
        {", "}and <Link href="/docs/adapters/fastly">Fastly Compute</Link> for
        platform-specific entry files.
      </p>
    </>
  );
}
