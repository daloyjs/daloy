import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Deploy to Railway",
  description:
    "Deploy DaloyJS to Railway. Railway auto-detects from package.json; add an optional railway.json or railway.toml to pin the start command, health check, and pre-deploy migrations.",
  path: "/docs/deployment/railway",
  keywords: [
    "Deploy DaloyJS to Railway",
    "railway.json",
    "railway.toml",
    "Railpack builder",
    "Railway healthcheckPath",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Railway</h1>
      <p>
        Railway auto-detects Node projects from <code>package.json</code>. A config file is{" "}
        <strong>optional</strong>; add one only when you want to pin the start command, set a
        health check, run pre-deploy migrations, or switch to a Dockerfile-based build.
      </p>

      <h2>When to choose Railway</h2>
      <ul>
        <li>You want the lowest-config push-and-it-runs experience on Node.</li>
        <li>You want managed Postgres, Redis, or MySQL in the same project.</li>
        <li>You like environment-per-PR with usage-based billing.</li>
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

      <h2>railway.json</h2>
      <CodeBlock
        language="json"
        code={`{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "RAILPACK"
  },
  "deploy": {
    "startCommand": "node dist/server.js",
    "preDeployCommand": ["pnpm run migrate"],
    "healthcheckPath": "/healthz",
    "healthcheckTimeout": 300,
    "restartPolicyType": "ON_FAILURE"
  }
}`}
      />
      <p>Or, equivalently, <code>railway.toml</code>:</p>
      <CodeBlock
        language="toml"
        code={`[build]
builder = "RAILPACK"

[deploy]
startCommand = "node dist/server.js"
healthcheckPath = "/healthz"
healthcheckTimeout = 300`}
      />

      <h2>Deploy</h2>
      <CodeBlock
        language="bash"
        code={`pnpm dlx @railway/cli login
pnpm dlx @railway/cli link
pnpm dlx @railway/cli up`}
      />

      <h2>Gotchas</h2>
      <ul>
        <li>
          Don&apos;t override <code>PORT</code>. Railway injects it and the load balancer targets that
          port.
        </li>
        <li>
          <code>healthcheckTimeout</code> is in seconds. Make it longer than your slowest
          legitimate startup.
        </li>
        <li>
          Use <code>preDeployCommand</code> for migrations so schema changes run before traffic
          shifts.
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