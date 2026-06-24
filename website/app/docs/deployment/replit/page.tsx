import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { FlowDiagram } from "@/components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Deploy to Replit",
  description:
    "Deploy a DaloyJS API to Replit as a Node web server. Covers pnpm, Node 24, Autoscale and Reserved VM Publishing, Secrets, PORT binding, 0.0.0.0, health checks, and Replit Agent guidance.",
  path: "/docs/deployment/replit",
  keywords: [
    "Deploy DaloyJS to Replit",
    "Replit Node.js deployment",
    "Replit Autoscale deployment",
    "Replit Reserved VM deployment",
    "Replit PORT 0.0.0.0",
    "Replit Secrets DaloyJS",
    "replit.md DaloyJS",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Replit</h1>
      <p>
        Replit can run DaloyJS as a Node web server. Use the{" "}
        <Link href="/docs/adapters/node">Node adapter</Link>, publish as a web
        server, and make sure the process listens on <code>0.0.0.0</code> and
        the platform-provided <code>PORT</code>. For APIs with variable traffic,
        start with Autoscale. For always-on workloads or long-running background
        work, use Reserved VM.
      </p>

      <FlowDiagram
        title="Replit publish path"
        numbered
        steps={[
          {
            label: "Import or create",
            detail: "GitHub import, template, or Agent project",
            eyebrow: "replit",
          },
          {
            label: "Install",
            detail: "pnpm install, Node 24+",
          },
          {
            label: "Build",
            detail: "pnpm build",
          },
          {
            label: "Publish",
            detail: "Autoscale or Reserved VM web server",
            tone: "accent",
          },
          {
            label: "Monitor",
            detail: "Publishing logs, health, resources",
            tone: "success",
          },
        ]}
        caption="A DaloyJS API is a long-running Node web server on Replit. Preview it first in the Project Editor, then publish with production secrets and the same start command."
      />

      <h2>When to choose Replit</h2>
      <ul>
        <li>
          You want browser-based development plus deployment in one place.
        </li>
        <li>
          You want Replit Agent to help inspect, modify, and publish the app.
        </li>
        <li>
          You are deploying a small to medium Node API and want Autoscale or
          Reserved VM without writing Docker config.
        </li>
      </ul>

      <h2>1. Check Node and pnpm</h2>
      <p>
        DaloyJS requires <strong>Node.js 24 or newer</strong> and pnpm 11 or
        newer. In Replit Shell, verify the runtime before publishing:
      </p>
      <CodeBlock
        language="bash"
        code={`node --version
pnpm --version`}
      />
      <p>
        Keep the requirement visible in <code>package.json</code> so Replit
        Agent and the publishing environment do not silently drift to an older
        runtime:
      </p>
      <CodeBlock
        language="json"
        code={`{
  "engines": {
    "node": ">=24.0.0",
    "pnpm": ">=11.0.0"
  },
  "packageManager": "pnpm@11.0.0"
}`}
      />

      <h2>2. Server entrypoint</h2>
      <p>
        Bind to all interfaces and use the <code>PORT</code> value provided by
        Replit. This matters for published apps, not just local preview.
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

      <h2>3. Scripts</h2>
      <p>
        Keep development and production commands separate. Use the production
        command in the Publishing pane.
      </p>
      <CodeBlock
        language="json"
        code={`{
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/server.js"
  }
}`}
      />

      <h2>4. Replit app configuration</h2>
      <p>
        The <code>.replit</code> file controls the editor Run button. Publishing
        can also ask for build and run commands in the Publishing pane. Keep
        them aligned so Preview and the published app behave the same way.
      </p>
      <CodeBlock
        language="toml"
        code={`run = "pnpm dev"

[deployment]
build = ["sh", "-c", "pnpm install --frozen-lockfile && pnpm build"]
run = ["sh", "-c", "pnpm start"]`}
      />

      <h2>5. Publish</h2>
      <ol>
        <li>
          Run the app in the Project Editor and open Preview. Fix Preview before
          publishing.
        </li>
        <li>
          Open <strong>Publishing</strong> and choose <strong>Autoscale</strong>{" "}
          for an API that should scale down when idle, or{" "}
          <strong>Reserved VM</strong> when you need an always-on machine.
        </li>
        <li>
          Set the build command to{" "}
          <code>pnpm install --frozen-lockfile && pnpm build</code>.
        </li>
        <li>
          Set the run command to <code>pnpm start</code>.
        </li>
        <li>
          Choose <strong>Web server</strong>, not Background worker.
        </li>
        <li>Add production Secrets for every required environment variable.</li>
      </ol>

      <h2>Secrets</h2>
      <p>
        Replit Secrets are exposed to the app as environment variables. Add
        runtime values such as <code>NODE_ENV</code>, database URLs, auth
        secrets, JWT keys, and webhook secrets through Replit Secrets or
        published app secrets. Do not commit a <code>.env</code> file.
      </p>
      <CodeBlock
        language="bash"
        code={`NODE_ENV=production
SESSION_SECRET=...
DATABASE_URL=...
TRUST_PROXY_HOPS=1`}
      />

      <h2>Trust Replit&apos;s proxy</h2>
      <p>
        Published Replit web apps sit behind Replit&apos;s edge proxy. If your
        DaloyJS app enables production forwarded-header protection, declare the
        proxy posture instead of disabling the guard:
      </p>
      <CodeBlock language="bash" code={`TRUST_PROXY_HOPS=1`} />
      <p>
        If you put Cloudflare or another proxy in front of Replit, count both
        hops and use <code>TRUST_PROXY_HOPS=2</code>. See the{" "}
        <Link href="/docs/deployment">deployment overview</Link> for the proxy
        posture matrix.
      </p>

      <h2>Replit Agent guidance</h2>
      <p>
        Replit Agent reads <code>replit.md</code> when it exists in the project
        root. Add a short file that tells Agent this is a DaloyJS API and that
        it must keep pnpm, Node 24, security defaults, and the production
        commands intact:
      </p>
      <CodeBlock
        language="md"
        code={`# DaloyJS API on Replit

- Package manager: pnpm only.
- Runtime: Node.js 24 or newer.
- Build: pnpm build.
- Start: pnpm start.
- Server must bind to process.env.PORT and hostname 0.0.0.0.
- Do not remove secureHeaders(), requestId(), rateLimit(), body limits, request timeouts, or proxy posture checks.
- Store secrets in Replit Secrets, never in committed files.`}
      />

      <h2>Gotchas</h2>
      <ul>
        <li>
          Do not bind to <code>localhost</code> or <code>127.0.0.1</code> in a
          published web server. Use <code>0.0.0.0</code>.
        </li>
        <li>
          Do not hard-code <code>PORT=80</code>. Let Replit provide{" "}
          <code>PORT</code> unless you have explicitly configured port mappings.
        </li>
        <li>
          Published app secrets are part of publishing setup. Check them when
          Preview works but the published URL fails.
        </li>
        <li>
          The app must keep running. A one-shot script belongs in Scheduled
          Deployments, not a web-server deployment.
        </li>
        <li>
          Replit performs a health check before marking the published app live.
          Keep startup fast and serve a cheap <code>/healthz</code> endpoint.
        </li>
      </ul>

      <h2>See also</h2>
      <ul>
        <li>
          <a
            href="https://docs.replit.com/references/publishing/autoscale-deployments"
            target="_blank"
            rel="noreferrer"
          >
            Replit Autoscale Deployments
          </a>
        </li>
        <li>
          <a
            href="https://docs.replit.com/references/publishing/reserved-vm-deployments"
            target="_blank"
            rel="noreferrer"
          >
            Replit Reserved VM Deployments
          </a>
        </li>
        <li>
          <a
            href="https://docs.replit.com/build/troubleshooting"
            target="_blank"
            rel="noreferrer"
          >
            Replit publishing troubleshooting
          </a>
        </li>
        <li>
          <a
            href="https://docs.replit.com/references/project-setup/configuration"
            target="_blank"
            rel="noreferrer"
          >
            Replit app configuration
          </a>
        </li>
        <li>
          <a
            href="https://docs.replit.com/core-concepts/project-editor/app-setup/secrets"
            target="_blank"
            rel="noreferrer"
          >
            Replit Secrets
          </a>
        </li>
        <li>
          <a
            href="https://docs.replit.com/references/project-setup/replit-dot-md"
            target="_blank"
            rel="noreferrer"
          >
            replit.md
          </a>
        </li>
      </ul>
    </>
  );
}
