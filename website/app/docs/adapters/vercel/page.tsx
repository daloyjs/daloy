import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Vercel adapter",
  description:
    "Deploy DaloyJS to Vercel — Edge Functions, Node.js Functions, and Next.js App Router route handlers. Three handler shapes from one app object.",
  path: "/docs/adapters/vercel",
  keywords: [
    "DaloyJS Vercel adapter",
    "Vercel Functions",
    "Vercel Edge Functions",
    "Next.js App Router route handler",
    "toWebHandler",
    "toFetchHandler",
    "toRouteHandlers",
    "Fluid compute",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Vercel</h1>
      <p>
        Vercel has three places you can mount an HTTP handler &mdash; Edge Functions, Node.js
        Functions, and Next.js App Router route handlers &mdash; and each expects a slightly
        different export shape. The DaloyJS adapter has one helper per shape; the underlying{" "}
        <code>app</code> object is identical across all three.
      </p>

      <h2>When to choose Vercel</h2>
      <ul>
        <li>You already deploy a Next.js frontend to Vercel and want the API in the same project.</li>
        <li>You want Fluid compute (the default since 2025) with per-request billing.</li>
        <li>You want preview deployments per PR with zero CI config.</li>
      </ul>

      <h2>Scaffold</h2>
      <CodeBlock
        language="bash"
        code={`pnpm create daloy@latest my-api --template vercel-edge
cd my-api
pnpm vercel dev`}
      />

      <h2>1. Next.js App Router (recommended)</h2>
      <p>
        If you&apos;re already using Next.js, mount the app under a catch-all route handler. This
        is the most common shape because Vercel is increasingly Next-first.
      </p>
      <CodeBlock
        language="ts"
        code={`// app/api/[[...slug]]/route.ts
import { toRouteHandlers } from "@daloyjs/core/vercel";
import { app } from "@/server";

export const runtime = "nodejs"; // or "edge"
export const dynamic = "force-dynamic";

export const { GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD } =
  toRouteHandlers(app);`}
      />
      <p>
        Use the <code>export const runtime = &quot;edge&quot;</code> form &mdash; the older{" "}
        <code>export const config = &#123; runtime: &quot;edge&quot; &#125;</code> still works in
        Next route handlers but is no longer the recommended syntax.
      </p>

      <h2>2. Vercel Node.js Functions (non-Next.js)</h2>
      <p>
        For a standalone API project (no Next.js), Vercel Node.js Functions expect a default export
        with a <code>fetch</code> method.
      </p>
      <CodeBlock
        language="ts"
        code={`// api/[...path].ts
import { toFetchHandler } from "@daloyjs/core/vercel";
import { app } from "../src/server.js";

// Node.js is the default runtime. No runtime export needed.
export default toFetchHandler(app);`}
      />

      <h2>3. Vercel Edge Functions (non-Next.js)</h2>
      <CodeBlock
        language="ts"
        code={`// api/[...path].ts
import { toWebHandler } from "@daloyjs/core/vercel";
import { app } from "../src/server.js";

export const runtime = "edge";
export default toWebHandler(app);`}
      />
      <p>
        <code>toEdgeHandler</code> is still exported as a backward-compatible alias of{" "}
        <code>toWebHandler</code>; new code should prefer <code>toWebHandler</code>.
      </p>

      <h2>vercel.json</h2>
      <p>
        Most projects don&apos;t need <code>vercel.json</code> at all. Add it for per-function
        memory/duration limits or to pin a region.
      </p>
      <CodeBlock
        language="json"
        code={`{
  "functions": {
    "api/[...path].ts": { "memory": 1024, "maxDuration": 30 }
  },
  "regions": ["fra1"]
}`}
      />
      <p>
        The legacy <code>builds</code> property is deprecated &mdash; use <code>functions</code>{" "}
        instead.
      </p>

      <h2>Deploy</h2>
      <CodeBlock
        language="bash"
        code={`# preview
pnpm vercel deploy

# production
pnpm vercel deploy --prod

# env vars (encrypted)
pnpm vercel env add SESSION_SECRET production`}
      />

      <h2>Storage</h2>
      <p>
        <strong>Vercel KV and Vercel Postgres no longer exist as Vercel-owned products.</strong>{" "}
        They were sunset in December 2024 and existing stores were migrated automatically &mdash;
        Vercel KV to Upstash Redis, Vercel Postgres to Neon. For new projects, install the
        equivalent integration from the Vercel Marketplace:
      </p>
      <CodeBlock
        language="bash"
        code={`pnpm vercel install upstash   # Redis
pnpm vercel install neon      # Postgres`}
      />
      <p>
        Vercel Blob and Edge Config are still first-party Vercel products. See{" "}
        <Link href="/docs/databases/neon">Neon</Link> for the Postgres setup and{" "}
        <Link href="/docs/security/rate-limit-redis">distributed rate-limit store</Link> for the
        Redis setup.
      </p>

      <h2>Gotchas</h2>
      <ul>
        <li>
          Edge runtime has no <code>node:*</code> &mdash; keep middleware portable, and prefer
          fetch-based drivers (Neon serverless, PlanetScale, Turso) when running on Edge.
        </li>
        <li>
          App Router <code>route.ts</code> files want <strong>named</strong> exports
          (<code>GET</code>, <code>POST</code>, …), not default. Use{" "}
          <code>toRouteHandlers</code>.
        </li>
        <li>
          Standalone Vercel Node functions want a <strong>default</strong> export with{" "}
          <code>&#123; fetch &#125;</code>. Use <code>toFetchHandler</code>.
        </li>
        <li>
          Vercel sets <code>process.env</code> on Node functions; on Edge, secrets are bundled at
          build time, so don&apos;t read them outside the handler.
        </li>
      </ul>

      <h2>See also</h2>
      <ul>
        <li>
          <Link href="/docs/adapters">Adapters overview</Link>
        </li>
        <li>
          <Link href="/docs/scaffolder">Scaffolder (vercel-edge template)</Link>
        </li>
        <li>
          <Link href="/docs/databases/neon">Neon on Vercel</Link>
        </li>
      </ul>
    </>
  );
}
