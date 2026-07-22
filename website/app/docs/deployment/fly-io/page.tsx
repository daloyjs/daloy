import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { FlowDiagram } from "@/components/diagram";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Deploy to Fly.io",
  description:
    "Deploy DaloyJS to Fly.io as a long-lived Node service. Current fly.toml schema with [http_service], string-valued auto_stop_machines, health checks, and concurrency limits.",
  path: "/docs/deployment/fly-io",
  keywords: [
    "Deploy DaloyJS to Fly.io",
    "fly.toml http_service",
    "auto_stop_machines",
    "fly deploy",
    "flyctl",
    "Fly health checks",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Fly.io</h1>
      <p>
        Fly runs your container as one or more <strong>Machines</strong>
        {". "}Use the <Link href="/docs/adapters/node">Node adapter</Link>
        {", "}ship a Dockerfile, and let <code>auto_stop_machines</code> scale
        you to zero when idle.
      </p>

      <FlowDiagram
        title="fly deploy pipeline"
        numbered
        steps={[
          {
            label: "Dockerfile build",
            detail: "distroless node:24 image",
            eyebrow: "image",
          },
          {
            label: "fly deploy",
            detail: "ship image to Fly",
          },
          {
            label: "Machines + health checks",
            detail: "GET /healthz",
            tone: "accent",
          },
          {
            label: "auto_stop_machines",
            detail: "scale to zero when idle",
            tone: "success",
          },
        ]}
        caption="Fly runs the container as one or more Machines. Health checks against /healthz gate routing, and auto_stop_machines = stop scales you to zero when traffic drops."
      />

      <h2 id="when-to-choose-fly">When to choose Fly</h2>
      <ul>
        <li>
          You want multiple regions cheaply, with anycast routing for free.
        </li>
        <li>
          You want a single image that also runs on ECS or Kubernetes elsewhere.
        </li>
        <li>You want raw TCP without a serverless workaround.</li>
      </ul>

      <h2 id="server-entrypoint">Server entrypoint</h2>
      <p>
        Use the Node adapter and bind to the Fly-provided <code>PORT</code>
        {": "}
      </p>
      <CodeBlock
        language="ts"
        code={`// src/server.ts
import { serve } from "@daloyjs/core/node";
import { app } from "./app.js";

serve(app, {
  port: Number(process.env.PORT ?? 3000),
  hostname: "0.0.0.0",
});`}
      />

      <h2 id="fly-toml">fly.toml</h2>
      <p>
        <code>auto_stop_machines</code> takes a <strong>string</strong> (
        <code>&quot;off&quot;</code>
        {", "}
        <code>&quot;stop&quot;</code>
        {", "}or <code>&quot;suspend&quot;</code>) and not a boolean.
      </p>
      <CodeBlock
        language="toml"
        code={`# fly.toml
app = "my-daloy-api"
primary_region = "fra"

[build]

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

  [http_service.concurrency]
    type = "requests"
    soft_limit = 200
    hard_limit = 250

[[http_service.checks]]
  interval = "10s"
  timeout = "2s"
  grace_period = "5s"
  method = "GET"
  path = "/healthz"

[[vm]]
  size = "shared-cpu-1x"
  memory = "256mb"`}
      />

      <h2 id="dockerfile">Dockerfile</h2>
      <CodeBlock
        language="docker"
        code={`FROM node:24-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM gcr.io/distroless/nodejs24-debian12
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER nonroot
EXPOSE 3000
CMD ["dist/server.js"]`}
      />

      <h2 id="deploy">Deploy</h2>
      <CodeBlock
        language="bash"
        code={`brew install flyctl
fly launch --no-deploy
fly secrets set SESSION_SECRET=...
fly deploy`}
      />

      <h2 id="gotchas">Gotchas</h2>
      <ul>
        <li>
          Set <code>shutdownTimeoutMs</code> on the Node adapter to a value
          smaller than Fly&apos;s grace period so in-flight requests drain
          before the machine is killed.
        </li>
        <li>
          Make sure <code>/healthz</code> is cheap. The{" "}
          <Link href="/docs/security/lifecycle-health">lifecycle plugin</Link>{" "}
          ships a ready-made one.
        </li>
      </ul>

      <h2 id="see-also">See also</h2>
      <ul>
        <li>
          <Link href="/docs/deployment">Deployment overview</Link>
        </li>
        <li>
          <Link href="/docs/adapters/node">Node adapter</Link>
        </li>
      </ul>
    </>
  );
}
