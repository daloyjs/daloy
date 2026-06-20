import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { FlowDiagram } from "@/components/diagram";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Deploy to Render",
  description:
    "Deploy DaloyJS to Render as a Node web service. Current render.yaml Blueprint with runtime: node, healthCheckPath, and scaling.",
  path: "/docs/deployment/render",
  keywords: [
    "Deploy DaloyJS to Render",
    "render.yaml Blueprint",
    "Render Node service",
    "healthCheckPath",
    "Render autoscaling",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Render</h1>
      <p>
        Render runs your Node REST API as a long-lived web service with
        platform-managed TLS, autoscaling, and PR previews. Use the{" "}
        <Link href="/docs/adapters/node">Node adapter</Link> and let Render
        inject <code>PORT</code>.
      </p>

      <FlowDiagram
        title="Blueprint deploy pipeline"
        numbered
        steps={[
          {
            label: "Push to repo",
            detail: "render.yaml detected",
            eyebrow: "git",
          },
          {
            label: "buildCommand",
            detail: "pnpm install && pnpm build",
          },
          {
            label: "startCommand",
            detail: "node dist/server.js",
            tone: "accent",
          },
          {
            label: "healthCheckPath + scaling",
            detail: "/healthz, min/max instances",
            tone: "success",
          },
        ]}
        caption="Render picks up render.yaml on every push, builds and starts the Node web service, then gates routing on a 2xx from healthCheckPath while autoscaling between your min and max instances."
      />

      <h2>When to choose Render</h2>
      <ul>
        <li>
          You want a Heroku-like UX with modern autoscaling and per-second
          billing.
        </li>
        <li>
          You want PR previews wired to your repo without extra CI config.
        </li>
        <li>You want managed Postgres or Redis from the same dashboard.</li>
      </ul>

      <h2>Server entrypoint</h2>
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

      <h2>render.yaml</h2>
      <p>
        Use <code>runtime: node</code>. The older <code>env: node</code> field
        is deprecated.
      </p>
      <CodeBlock
        language="yaml"
        code={`services:
  - name: my-api
    type: web
    runtime: node
    plan: starter
    buildCommand: pnpm install && pnpm build
    startCommand: node dist/server.js
    healthCheckPath: /healthz
    autoDeploy: true

    scaling:
      minInstances: 1
      maxInstances: 3
      targetCPUPercent: 60

    envVars:
      - key: NODE_ENV
        value: production
      - key: SESSION_SECRET
        sync: false`}
      />

      <h2>Deploy</h2>
      <p>
        Push to your repo. Render picks up <code>render.yaml</code>{" "}
        automatically. For the first deploy, create a Blueprint service from the
        dashboard.
      </p>

      <h2>Gotchas</h2>
      <ul>
        <li>
          Bind to <code>0.0.0.0</code>, not <code>localhost</code>, or Render
          can&apos;t route traffic to the container.
        </li>
        <li>
          <code>healthCheckPath</code> must return 2xx within the timeout. Use
          the{" "}
          <Link href="/docs/security/lifecycle-health">lifecycle plugin</Link>
          &apos;s health endpoint.
        </li>
      </ul>

      <h2>See also</h2>
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
