import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { BranchDiagram } from "@/components/diagram";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Vercel adapter",
  description:
    "Deploy a DaloyJS REST API to Vercel Node.js Functions or Edge Functions. One app object, two standalone function shapes.",
  path: "/docs/adapters/vercel",
  keywords: [
    "DaloyJS Vercel adapter",
    "Vercel Functions",
    "Vercel Functions",
    "toWebHandler",
    "toFetchHandler",
    "Fluid compute",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Vercel</h1>
      <p>
        Vercel has two standalone places you can mount a DaloyJS REST API
        handler, Node.js Functions and Edge Functions. Each target expects a
        slightly different export shape; the underlying <code>app</code> object
        is identical.
      </p>

      <BranchDiagram
        title="One app, two Vercel targets"
        source={{
          eyebrow: "identical app",
          label: "Your DaloyJS App",
          detail: "import { app } from '../src/server.ts'",
        }}
        branches={[
          {
            eyebrow: "node.js runtime",
            label: "Node.js Function",
            detail: "export default toFetchHandler(app)",
          },
          {
            eyebrow: "edge runtime",
            label: "Edge Function",
            detail: "export const runtime = 'edge' · toWebHandler(app)",
          },
        ]}
        caption="Both shapes live at api/index.ts and need the /(.*) → /api rewrite so DaloyJS owns routing at the site root. Only the export shape and runtime differ; the app object is the same."
      />

      <h2 id="when-to-choose-vercel">When to choose Vercel</h2>
      <ul>
        <li>You want a standalone DaloyJS REST API on Vercel Functions.</li>
        <li>
          You want Fluid compute (the default since 2025) with per-request
          billing.
        </li>
        <li>You want preview deployments per PR with zero CI config.</li>
      </ul>

      <h2 id="scaffold">Scaffold</h2>
      <p>
        The Vercel starter scaffolds a standalone REST API on the Node.js
        runtime (the <code>toFetchHandler</code> entrypoint shown below), which
        Vercel now recommends for standalone functions. The old{" "}
        <code>vercel</code> template name still works as a deprecated alias.
      </p>
      <CodeBlock
        language="bash"
        code={`pnpm create daloy@latest my-api --template vercel
cd my-api
pnpm vercel dev`}
      />

      <h2 id="1-vercel-node-js-functions-standalone-api">1. Vercel Node.js Functions (standalone API)</h2>
      <p>
        For a standalone DaloyJS REST API on the Node.js runtime, use a single
        function at <code>api/index.ts</code>. Vercel Node.js Functions expect a
        default export with a <code>fetch</code> method.
      </p>
      <CodeBlock
        language="ts"
        code={`// api/index.ts
import { toFetchHandler } from "@daloyjs/core/vercel";
import { app } from "../src/server.ts";

// Node.js is the default runtime. No runtime export needed.
export default toFetchHandler(app);`}
      />
      <p>
        Vercel maps <code>api/index.ts</code> to <code>/api</code>, but a
        DaloyJS app registers its routes at the <strong>root</strong> (
        <code>/healthz</code>, <code>/docs</code>, …). Add a{" "}
        <strong>rewrite</strong> so every path reaches the function and DaloyJS
        owns routing at the site root, without it the deployed root domain
        returns a Vercel 404:
      </p>
      <CodeBlock
        language="json"
        code={`// vercel.json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/api" }]
}`}
      />

      <h2 id="2-vercel-functions-standalone-api">
        2. Edge runtime opt-in (deprecated by Vercel)
      </h2>
      <CodeBlock
        language="ts"
        code={`// api/index.ts
import { toWebHandler } from "@daloyjs/core/vercel";
import { app } from "../src/server.ts";

export const runtime = "edge";
export default toWebHandler(app);`}
      />
      <p>
        The same <code>/(.*)</code> → <code>/api</code> rewrite applies. Vercel
        has <strong>deprecated standalone Edge Functions</strong>, so prefer the
        Node.js runtime in section 1; reach for this opt-in only for an existing
        Edge workload. The Edge runtime uses the web-standard{" "}
        <code>toWebHandler</code> and its code must avoid <code>node:</code>{" "}
        modules.
      </p>

      <h2 id="vercel-json">vercel.json</h2>
      <p>
        The <code>rewrites</code> rule above is required for root routing. Add{" "}
        <code>functions</code> for per-function memory/duration limits, and{" "}
        <code>regions</code> to pin a region:
      </p>
      <CodeBlock
        language="json"
        code={`{
  "rewrites": [{ "source": "/(.*)", "destination": "/api" }],
  "functions": {
    "api/index.ts": { "memory": 1024, "maxDuration": 30 }
  },
  "regions": ["fra1"]
}`}
      />
      <p>
        The legacy <code>builds</code> property is deprecated, use{" "}
        <code>functions</code> instead.
      </p>

      <h2 id="deploy">Deploy</h2>
      <CodeBlock
        language="bash"
        code={`# preview
pnpm vercel deploy

# production
pnpm vercel deploy --prod

# env vars (encrypted)
pnpm vercel env add SESSION_SECRET production`}
      />

      <h2 id="storage">Storage</h2>
      <p>
        <strong>
          Vercel KV and Vercel Postgres no longer exist as Vercel-owned
          products.
        </strong>{" "}
        They were sunset in December 2024 and existing stores were migrated
        automatically, Vercel KV to Upstash Redis, Vercel Postgres to Neon. For
        new projects, add the equivalent integration from the{" "}
        <a
          href="https://vercel.com/marketplace"
          target="_blank"
          rel="noreferrer"
        >
          Vercel Marketplace
        </a>{" "}
        (Neon for Postgres, Upstash for Redis), the integration provisions the
        store and injects the connection env vars into your project.
      </p>
      <p>
        Vercel Blob and Edge Config are still first-party Vercel products. See{" "}
        <Link href="/docs/databases/neon">Neon</Link> for the Postgres setup and{" "}
        <Link href="/docs/security/rate-limit-redis">
          distributed rate-limit store
        </Link>{" "}
        for the Redis setup.
      </p>

      <h2 id="gotchas">Gotchas</h2>
      <ul>
        <li>
          Edge runtime has no <code>node:*</code>: keep middleware portable, and
          prefer fetch-based drivers (Neon serverless, PlanetScale, Turso) when
          running on Edge.
        </li>
        <li>
          Standalone Vercel Node functions want a <strong>default</strong>{" "}
          export with <code>&#123; fetch &#125;</code>. Use{" "}
          <code>toFetchHandler</code>.
        </li>
        <li>
          Vercel sets <code>process.env</code> on Node functions; on Edge,
          secrets are bundled at build time, so don&apos;t read them outside the
          handler.
        </li>
      </ul>

      <h2 id="see-also">See also</h2>
      <ul>
        <li>
          <Link href="/docs/adapters">Adapters overview</Link>
        </li>
        <li>
          <Link href="/docs/scaffolder">Scaffolder</Link>
        </li>
        <li>
          <Link href="/docs/databases/neon">Neon on Vercel</Link>
        </li>
      </ul>
    </>
  );
}
