import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { FlowDiagram } from "@/components/diagram";
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
        The Cloudflare adapter exports a Workers module entrypoint: the
        canonical <code>export default &#123; fetch &#125;</code> shape. Service
        Worker style (<code>addEventListener(&quot;fetch&quot;, ...)</code>) is
        no longer recommended; the adapter does not emit it.
      </p>

      <FlowDiagram
        title="Workers modules-format request path"
        steps={[
          {
            eyebrow: "platform",
            label: "Worker fetch(request, env, ctx)",
            detail: "export default { fetch }",
          },
          {
            eyebrow: "adapter",
            label: "toFetchHandler(app)",
            detail: "or app.decorate(env) by hand",
            tone: "muted",
          },
          {
            eyebrow: "core",
            label: "app.fetch(Request)",
            detail: "routing · hooks · handler",
            tone: "accent",
          },
          { eyebrow: "platform", label: "Response", tone: "success" },
        ]}
        caption="toFetchHandler returns the { fetch } object Workers expect. To reach KV, R2, D1, or secrets, write the module export by hand and app.decorate(env) so bindings land on ctx.state inside every handler."
      />

      <h2 id="when-to-choose-workers">When to choose Workers</h2>
      <ul>
        <li>
          You want global, low-latency execution without managing regions
          yourself.
        </li>
        <li>
          You can live without raw TCP sockets (Workers Hyperdrive solves
          Postgres).
        </li>
        <li>
          You want bindings (KV, R2, D1, Durable Objects, Queues) instead of
          standalone services.
        </li>
      </ul>

      <h2 id="scaffold">Scaffold</h2>
      <CodeBlock
        language="bash"
        code={`pnpm create daloy@latest my-api --template cloudflare-worker
cd my-api
pnpm dev   # wrangler dev under the hood`}
      />

      <h2 id="worker-entrypoint-no-bindings">
        Worker entrypoint (no bindings)
      </h2>
      <p>
        If you don&apos;t need <code>env</code> bindings or the Worker{" "}
        <code>ExecutionContext</code>
        {", "}<code>toFetchHandler</code> is a one-liner. It returns the{" "}
        <code>&#123; fetch &#125;</code> object Workers expect as the default
        export, so do <strong>not</strong> wrap it again.
      </p>
      <CodeBlock
        language="ts"
        code={`// src/index.ts
import { toFetchHandler } from "@daloyjs/core/cloudflare";
import { app } from "./server.js";

export default toFetchHandler(app);`}
      />

      <h2 id="wrangler-jsonc">wrangler.jsonc</h2>
      <p>
        Cloudflare now recommends <code>wrangler.jsonc</code> over{" "}
        <code>wrangler.toml</code> for new projects; both are still supported.
        The single <code>nodejs_compat</code> flag is all you need on a recent
        compatibility date, there&apos;s no separate{" "}
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

      <h2 id="deploy">Deploy</h2>
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
        <code>wrangler publish</code> was renamed to{" "}
        <code>wrangler deploy</code> in 2024. Don&apos;t use the old name; some
        CI templates still reference it.
      </p>

      <h2 id="bindings-env">Bindings (env)</h2>
      <p>
        <code>toFetchHandler(app)</code> only forwards the <code>Request</code>
        {". "}
        To expose Worker bindings (KV, R2, D1, Durable Objects, Queues,
        Hyperdrive, secrets) to your handlers, write the module-format export by
        hand and inject the bindings into the app with{" "}
        <code>app.decorate(...)</code>
        {". "}That&apos;s how DaloyJS makes runtime values available on{" "}
        <code>ctx.state</code> inside every handler.
      </p>
      <CodeBlock
        language="ts"
        code={`// src/index.ts
import { app } from "./server.js";

export interface Env {
  CACHE: KVNamespace;
  DB: D1Database;
  SESSION_SECRET: string;
}

let decorated = false;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Decorate once per isolate; app.decorate() throws if called twice with
    // the same key, so guard it.
    if (!decorated) {
      app.decorate("env", env);
      app.decorate("waitUntil", (p: Promise<unknown>) => ctx.waitUntil(p));
      decorated = true;
    }
    return app.fetch(request);
  },
};`}
      />
      <p>
        Inside any route handler, read the binding from{" "}
        <code>ctx.state.env</code> (the key you passed to <code>decorate</code>
        ):
      </p>
      <CodeBlock
        language="ts"
        code={`app.get(
  "/cached/:key",
  {
    request: { params: z.object({ key: z.string() }) },
    responses: { 200: { body: z.object({ value: z.string().nullable() }) } },
  },
  async ({ params, ctx }) => {
    const value = await ctx.state.env.CACHE.get(params.key);
    return { status: 200, body: { value } };
  },
);`}
      />

      <h2 id="gotchas">Gotchas</h2>
      <ul>
        <li>
          No raw TCP. Use <strong>Hyperdrive</strong> for Postgres/MySQL, or
          HTTP drivers like Neon&apos;s serverless driver, PlanetScale&apos;s{" "}
          <code>@planetscale/database</code>
          {", "}or Turso/libSQL. See{" "}
          <Link href="/docs/databases">Database hosting</Link>.
        </li>
        <li>
          No filesystem, so use{" "}
          <Link href="/docs/multipart">multipart uploads</Link> with R2, not{" "}
          <code>node:fs</code>.
        </li>
        <li>
          For background work, decorate the app with a <code>waitUntil</code>{" "}
          wrapper (see the bindings example above): <code>toFetchHandler</code>{" "}
          alone does not forward the Worker <code>ExecutionContext</code>.
        </li>
      </ul>

      <h2 id="see-also">See also</h2>
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
          <Link href="/docs/security/rate-limit-redis">
            Distributed rate-limit store
          </Link>
        </li>
      </ul>
    </>
  );
}
