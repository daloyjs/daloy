import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";
import { FlowDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Use Cloudflare D1 with DaloyJS",
  description:
    "Run a DaloyJS API on Cloudflare Workers backed by D1, Cloudflare's built-in SQLite-compatible database. Uses Worker bindings instead of a network driver.",
  path: "/docs/databases/cloudflare-d1",
  keywords: [
    "Cloudflare D1 DaloyJS",
    "D1 Workers binding",
    "Cloudflare SQLite",
    "Wrangler D1",
    "D1 Drizzle",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Use Cloudflare D1 with DaloyJS</h1>
      <p>
        <a
          href="https://developers.cloudflare.com/d1/"
          target="_blank"
          rel="noreferrer"
        >
          Cloudflare D1
        </a>{" "}
        is a serverless SQLite-compatible database built into Cloudflare Workers. You access it through a
        Worker binding (no network driver, no auth token, no TCP), making it the lowest-friction
        database for the <Link href="/docs/adapters">Cloudflare adapter</Link>.
      </p>

      <h2 id="1-provision-via-wrangler">1. Provision via Wrangler</h2>
      <CodeBlock
        code={`pnpm add -D wrangler
pnpm dlx wrangler d1 create my-app-db`}
      />
      <p>Add the returned binding to your <code>wrangler.toml</code>:</p>
      <CodeBlock
        code={`[[d1_databases]]
binding = "DB"
database_name = "my-app-db"
database_id = "<id-from-create>"`}
      />

      <h2 id="2-type-the-binding">2. Type the binding</h2>
      <CodeBlock
        code={`// src/types/env.d.ts
export interface Env {
  DB: D1Database;
}`}
      />

      <h2 id="3-decorate-the-app-per-request">3. Decorate the app per-request</h2>
      <p>
        D1 bindings live on <code>env</code>, not <code>process.env</code>, so decorate inside the
        Worker&apos;s <code>fetch</code> handler and call <code>app.fetch(req)</code> directly:
      </p>

      <FlowDiagram
        title="Per-request binding flow"
        numbered
        steps={[
          {
            label: "Worker fetch(req, env)",
            detail: "env.DB is the D1 binding",
            tone: "accent",
          },
          {
            label: "app.decorate('db', env.DB)",
            detail: "attach the binding to app state",
          },
          {
            label: "app.fetch(req)",
            detail: "route handler reads state.db",
          },
          {
            label: "state.db.prepare(...).all()",
            detail: "query D1, no network driver",
            tone: "success",
          },
        ]}
        caption="D1 bindings live on env, not process.env, so decorate the app inside the Worker fetch handler on every request before calling app.fetch(req)."
      />

      <CodeBlock
        code={`import { z } from "zod";
import { App, secureHeaders } from "@daloyjs/core";
import type { Env } from "./types/env.ts";

const app = new App();
app.use(secureHeaders());

const TodoSchema = z.object({ id: z.number(), title: z.string(), done: z.boolean() });

app.route({
  method: "GET",
  path: "/todos",
  operationId: "listTodos",
  responses: { 200: { description: "ok", body: z.array(TodoSchema) } },
  handler: async ({ state }) => {
    const { results } = await state.db
      .prepare("select id, title, done from todos")
      .all<{ id: number; title: string; done: number }>();
    return {
      status: 200,
      body: results.map((r) => ({ ...r, done: Boolean(r.done) })),
    };
  },
});

export default {
  async fetch(req: Request, env: Env) {
    app.decorate("db", env.DB);
    return app.fetch(req);
  },
};`}
      />

      <h2 id="4-augment-app-state">4. Augment app state</h2>
      <p>
        Add the <code>declare module</code> block to the Worker module itself,
        not to a separate <code>.d.ts</code> file. Declaration files are
        exempt from type-checking when <code>skipLibCheck</code> is on (the
        scaffolded default), so a mistake inside a <code>.d.ts</code> fails
        silently and <code>state.db</code> quietly degrades to{" "}
        <code>any</code>.
      </p>
      <CodeBlock
        code={`// src/index.ts (same module as the Worker above)
declare module "@daloyjs/core" {
  interface AppState {
    db: D1Database;
  }
}`}
      />

      <h2 id="migrations">Migrations</h2>
      <CodeBlock
        code={`pnpm dlx wrangler d1 migrations create my-app-db init
pnpm dlx wrangler d1 migrations apply my-app-db --local
pnpm dlx wrangler d1 migrations apply my-app-db --remote`}
      />

      <h2 id="with-drizzle-orm">With Drizzle ORM</h2>
      <CodeBlock
        code={`pnpm add drizzle-orm
// src/db/drizzle.ts
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "../types/env.ts";

export const createDb = (env: Env) => drizzle(env.DB);`}
      />

      <h2 id="with-prisma">With Prisma</h2>
      <p>
        Prisma supports D1 via the <a href="https://www.prisma.io/docs/orm/overview/databases/cloudflare-d1" target="_blank" rel="noreferrer">D1 Driver Adapter</a>.
        Construct the adapter inside the Worker handler since it needs the runtime binding.
      </p>

      <h2 id="limitations-to-know">Limitations to know</h2>
      <ul>
        <li>D1 only runs in Cloudflare Workers, no Node.js, Lambda, or Edge runtime support.</li>
        <li>
          Local development uses <code>wrangler dev</code> with a local SQLite file; behavior is close
          but not identical to production.
        </li>
        <li>
          For multi-runtime portability, prefer{" "}
          <Link href="/docs/databases/turso">Turso</Link> (libSQL) instead.
        </li>
      </ul>

      <p>
        See also <Link href="/docs/databases/turso">Turso</Link>,{" "}
        <Link href="/docs/databases/neon">Neon</Link>, and the{" "}
        <Link href="/docs/databases">database hosting overview</Link>.
      </p>
    </>
  );
}
