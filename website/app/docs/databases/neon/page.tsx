import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";
import { BranchDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Use Neon serverless Postgres with DaloyJS",
  description:
    "Connect a DaloyJS API to Neon's serverless Postgres using the @neondatabase/serverless HTTP and WebSocket driver. Works on Node, Bun, Deno, Cloudflare Workers, and AWS Lambda.",
  path: "/docs/databases/neon",
  keywords: [
    "Neon DaloyJS",
    "@neondatabase/serverless",
    "Neon Cloudflare Workers",
    "Neon Vercel",
    "serverless Postgres",
    "Neon Drizzle",
    "Neon Prisma",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Use Neon serverless Postgres with DaloyJS</h1>
      <p>
        <a href="https://neon.com" target="_blank" rel="noreferrer">
          Neon
        </a>{" "}
        is a serverless Postgres host with database branching, scale-to-zero,
        and an HTTP/WebSocket driver that runs in <em>every</em> runtime DaloyJS
        targets, including Cloudflare Workers where raw TCP
        isn&apos;t available.
      </p>

      <BranchDiagram
        title="Two drivers, one connection string"
        source={{
          eyebrow: "@neondatabase/serverless",
          label: "DATABASE_URL",
          detail: "neon(...) or new Pool(...)",
        }}
        branches={[
          {
            eyebrow: "edge-friendly",
            label: "HTTP neon() client",
            detail: "One-shot queries · Workers",
            tone: "success",
          },
          {
            eyebrow: "node",
            label: "Pooled Pool client",
            detail: "WebSocket · reused connections · pool.end()",
          },
        ]}
        caption="Both clients ship in the same package. Use the lightweight HTTP neon() client on edge runtimes and the pooled WebSocket Pool for long-lived Node processes."
      />

      <h2 id="1-provision">1. Provision</h2>
      <p>
        Create a project at{" "}
        <a href="https://console.neon.tech" target="_blank" rel="noreferrer">
          console.neon.tech
        </a>{" "}
        and copy the connection string. Set it as <code>DATABASE_URL</code> in
        your environment.
      </p>

      <h2 id="2-install">2. Install</h2>
      <CodeBlock code={`pnpm add @neondatabase/serverless`} />
      <p>
        For a pooled connection on Node, use the <code>Pool</code> export. For
        one-shot queries on edge runtimes, use the lightweight HTTP{" "}
        <code>neon()</code> client. Neon&apos;s GA driver requires Node.js 19 or
        newer when you run it in Node.
      </p>

      <h2 id="3-http-client-edge-friendly">3. HTTP client (edge-friendly)</h2>
      <CodeBlock
        code={`// src/db/neon.ts
import { neon } from "@neondatabase/serverless";
import type { App } from "@daloyjs/core";

export const sql = neon(process.env.DATABASE_URL!);

export const neonPlugin = {
  name: "neon",
  register(app: App) {
    app.decorate("sql", sql);
  },
};`}
      />

      <h2 id="4-pooled-websocket-client-node">4. Pooled WebSocket client (Node)</h2>
      <CodeBlock
        code={`// src/db/neon-pool.ts
import { Pool } from "@neondatabase/serverless";
import type { App } from "@daloyjs/core";

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });

export const neonPoolPlugin = {
  name: "neon-pool",
  async register(app: App) {
    app.decorate("db", pool);
    app.onClose(async () => {
      await pool.end();
    });
  },
};`}
      />

      <h2 id="5-augment-app-state">5. Augment app state</h2>
      <CodeBlock
        code={`// src/types/state.d.ts
import type { Pool } from "@neondatabase/serverless";
import type { neon } from "@neondatabase/serverless";

declare module "@daloyjs/core" {
  interface AppState {
    sql: ReturnType<typeof neon>;
    db: Pool;
  }
}`}
      />

      <h2 id="6-use-it-in-a-route">6. Use it in a route</h2>
      <CodeBlock
        code={`import { z } from "zod";
import { App, secureHeaders } from "@daloyjs/core";
import { neonPlugin } from "./db/neon";

const app = new App();
app.use(secureHeaders());
app.register(neonPlugin);

const UserSchema = z.object({ id: z.string().uuid(), email: z.string().email() });

app.route({
  method: "GET",
  path: "/users/:id",
  operationId: "getUser",
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Found", body: UserSchema },
    404: { description: "Not found" },
  },
  handler: async ({ params, state }) => {
    const rows = await state.sql\`select id, email from users where id = \${params.id} limit 1\`;
    const user = rows[0];
    return user
      ? { status: 200, body: user }
      : { status: 404, body: { type: "about:blank", title: "Not found", status: 404 } };
  },
});`}
      />

      <h2 id="cloudflare-workers">Cloudflare Workers</h2>
      <p>
        Use the HTTP <code>neon()</code> client and pass the connection string
        from the worker environment instead of <code>process.env</code>. Because
        this example reads <code>env</code>, wrap the Worker
        <code>fetch</code> handler and call <code>app.fetch(req)</code> after
        decorating state:
      </p>
      <CodeBlock
        code={`import { neon } from "@neondatabase/serverless";

export default {
  async fetch(req: Request, env: { DATABASE_URL: string }) {
    const sql = neon(env.DATABASE_URL);
    app.decorate("sql", sql);
    return app.fetch(req);
  },
};`}
      />

      <h2 id="with-drizzle-orm">With Drizzle ORM</h2>
      <CodeBlock
        code={`pnpm add drizzle-orm
// src/db/drizzle.ts
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle({ client: sql });`}
      />

      <h2 id="with-prisma">With Prisma</h2>
      <p>
        Use the{" "}
        <a
          href="https://www.prisma.io/docs/orm/overview/databases/neon"
          target="_blank"
          rel="noreferrer"
        >
          Neon Driver Adapter
        </a>{" "}
        so Prisma can run on edge runtimes (GA since Prisma <code>6.16.0</code>
        ):
      </p>
      <CodeBlock
        code={`pnpm add @prisma/adapter-neon
// src/db/prisma.ts
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
export const prisma = new PrismaClient({ adapter });`}
      />
      <p>
        Use Neon&apos;s <strong>pooled</strong> connection string (host ends in{" "}
        <code>-pooler</code>) for <code>DATABASE_URL</code>, and a separate{" "}
        <code>DIRECT_URL</code> for Prisma CLI commands like{" "}
        <code>prisma migrate</code> and <code>prisma db pull</code>.
      </p>

      <h2 id="branching-for-preview-environments">Branching for preview environments</h2>
      <p>
        Pair Neon&apos;s branching with Vercel preview deployments or GitHub PR
        previews. Create a branch per PR and pass its connection string to the
        deployment&apos;s <code>DATABASE_URL</code>. This is a natural fit for
        the <Link href="/docs/adapters">Vercel adapter</Link>.
      </p>

      <p>
        See also <Link href="/docs/databases/planetscale">PlanetScale</Link>,{" "}
        <Link href="/docs/orm/supabase">Supabase</Link>, and the{" "}
        <Link href="/docs/databases">database hosting overview</Link>.
      </p>
    </>
  );
}
