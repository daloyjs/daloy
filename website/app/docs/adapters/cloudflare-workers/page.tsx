import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Cloudflare Workers adapter",
  description:
    "Deploy DaloyJS to Cloudflare Workers using the modules format, wrangler.jsonc, and the nodejs_compat flag. Bindings for KV, R2, D1, Durable Objects, Queues, and Hyperdrive.",
  path: "/docs/adapters/cloudflare-workers",
  keywords: [
    "DaloyJS Cloudflare Workers",
    "wrangler.jsonc",
    "wrangler deploy",
    "nodejs_compat",
    "Workers KV binding",
    "Cloudflare D1 DaloyJS",
    "Hyperdrive Postgres",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Cloudflare Workers</h1>
      <p>
        The Cloudflare adapter exports a Workers module entrypoint &mdash; the canonical{" "}
        <code>export default &#123; fetch &#125;</code> shape. Service Worker style{" "}
        (<code>addEventListener(&quot;fetch&quot;, ...)</code>) is no longer recommended; the
        adapter does not emit it.
      </p>

      <h2>When to choose Workers</h2>
      <ul>
        <li>You want global, low-latency execution without managing regions yourself.</li>
        <li>You can live without raw TCP sockets (Workers Hyperdrive solves Postgres).</li>
        <li>You want bindings (KV, R2, D1, Durable Objects, Queues) instead of standalone services.</li>
      </ul>

      <h2>Scaffold</h2>
      <CodeBlock
        language="bash"
        code={`pnpm create daloy@latest my-api --template cloudflare-worker
cd my-api
pnpm dev   # wrangler dev under the hood`}
      />

      <h2>Worker entrypoint</h2>
      <CodeBlock
        language="ts"
        code={`// src/index.ts
import { toFetchHandler } from "@daloyjs/core/cloudflare";
import { app } from "./server.js";

export interface Env {
  CACHE: KVNamespace;
  DB: D1Database;
}

// toFetchHandler returns the { fetch } object Workers expect as the default
// export. Do NOT wrap it again — export the result directly.
export default toFetchHandler<Env>(app);`}
      />

      <h2>wrangler.jsonc</h2>
      <p>
        Cloudflare now recommends <code>wrangler.jsonc</code> over <code>wrangler.toml</code> for
        new projects; both are still supported. The single <code>nodejs_compat</code> flag is all
        you need on a recent compatibility date — there&apos;s no separate{" "}
        <code>nodejs_compat_v2</code> to add.
      </p>
      <CodeBlock
        language="jsonc"
        code={`// wrangler.jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "my-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-22",
  "compatibility_flags": ["nodejs_compat"],

  "kv_namespaces": [
    { "binding": "CACHE", "id": "<kv-id>" }
  ],
  "d1_databases": [
    { "binding": "DB", "database_name": "my-api", "database_id": "<d1-id>" }
  ],
  "placement": { "mode": "smart" }
}`}
      />

      <h2>Deploy</h2>
      <CodeBlock
        language="bash"
        code={`# local dev
pnpm wrangler dev

# secrets (not committed)
pnpm wrangler secret put SESSION_SECRET

# ship it
pnpm wrangler deploy`}
      />
      <p>
        <code>wrangler publish</code> was renamed to <code>wrangler deploy</code> in 2024.
        Don&apos;t use the old name; some CI templates still reference it.
      </p>

      <h2>Bindings</h2>
      <p>
        DaloyJS doesn&apos;t hide bindings &mdash; <code>env</code> is the second argument to your
        handler, and DaloyJS passes it through. Use them directly from inside route handlers via{" "}
        <code>context.env</code>.
      </p>
      <CodeBlock
        language="ts"
        code={`app.route({
  method: "GET",
  path: "/cached/:key",
  request: { params: z.object({ key: z.string() }) },
  responses: { 200: { body: z.object({ value: z.string().nullable() }) } },
  handler: async ({ params, context }) => {
    const value = await context.env.CACHE.get(params.key);
    return { status: 200, body: { value } };
  },
});`}
      />

      <h2>Gotchas</h2>
      <ul>
        <li>
          No raw TCP. Use <strong>Hyperdrive</strong> for Postgres/MySQL, or HTTP drivers like
          Neon&apos;s serverless driver, PlanetScale&apos;s <code>@planetscale/database</code>, or
          Turso/libSQL. See <Link href="/docs/databases">Database hosting</Link>.
        </li>
        <li>
          No filesystem &mdash; use <Link href="/docs/multipart">multipart uploads</Link> with R2,
          not <code>node:fs</code>.
        </li>
        <li>
          For background work, use <code>ctx.waitUntil</code>; the adapter forwards it from the
          handler context.
        </li>
        <li>
          Static assets: use the GA <code>assets</code> binding in <code>wrangler.jsonc</code>{" "}
          (replaces the deprecated Workers Sites).
        </li>
      </ul>

      <h2>See also</h2>
      <ul>
        <li>
          <Link href="/docs/adapters">Adapters overview</Link>
        </li>
        <li>
          <Link href="/docs/databases/neon">Neon on Workers</Link> ·{" "}
          <Link href="/docs/databases/planetscale">PlanetScale</Link> ·{" "}
          <Link href="/docs/databases/turso">Turso</Link> ·{" "}
          <Link href="/docs/databases/cloudflare-d1">Cloudflare D1</Link>
        </li>
        <li>
          <Link href="/docs/security/session">Sessions</Link> ·{" "}
          <Link href="/docs/security/rate-limit-redis">Distributed rate-limit store</Link>
        </li>
      </ul>
    </>
  );
}
