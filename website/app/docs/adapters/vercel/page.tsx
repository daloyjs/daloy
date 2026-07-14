import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { FlowDiagram } from "@/components/diagram";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Vercel adapter",
  description:
    "Deploy a DaloyJS REST API to Vercel Functions on the Node.js runtime with Fluid compute. One app object, one standalone function.",
  path: "/docs/adapters/vercel",
  keywords: [
    "DaloyJS Vercel adapter",
    "Vercel Functions",
    "Vercel Node.js Functions",
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
        Deploy a DaloyJS REST API to Vercel as a single standalone function on
        the Node.js runtime. Node.js is the default runtime and what Vercel
        recommends, and it runs on Fluid compute with per-request billing.
      </p>

      <FlowDiagram
        title="One app, one Vercel function"
        steps={[
          {
            eyebrow: "your code",
            label: "DaloyJS App",
            detail: "import { app } from '../src/server.ts'",
          },
          {
            eyebrow: "adapter",
            label: "toFetchHandler(app)",
            detail: "export default at api/index.ts",
          },
          {
            eyebrow: "vercel.json",
            label: "/(.*) → /api rewrite",
            detail: "DaloyJS owns routing at the site root",
            tone: "accent",
          },
        ]}
        caption="The function lives at api/index.ts on the Node.js runtime. The /(.*) → /api rewrite sends every path to the function so DaloyJS owns routing at the site root."
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
        Vercel recommends for standalone functions.
      </p>
      <CodeBlock
        language="bash"
        code={`pnpm create daloy@latest my-api --template vercel
cd my-api
pnpm vercel dev`}
      />

      <h2 id="1-vercel-node-js-functions-standalone-api">Vercel Node.js Functions (standalone API)</h2>
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
          Standalone Vercel Node functions want a <strong>default</strong>{" "}
          export with <code>&#123; fetch &#125;</code>. Use{" "}
          <code>toFetchHandler</code>.
        </li>
        <li>
          Without the <code>/(.*)</code> → <code>/api</code> rewrite, Vercel
          serves the function only at <code>/api</code> and the root domain
          returns a 404. The rewrite is what lets DaloyJS own routing at the
          site root.
        </li>
        <li>
          Secrets are available on <code>process.env</code> at runtime. Add them
          with <code>vercel env add</code> rather than committing them.
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
