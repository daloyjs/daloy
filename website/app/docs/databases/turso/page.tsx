import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";
import { BranchDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Use Turso (libSQL) with DaloyJS",
  description:
    "Connect a DaloyJS API to Turso, a distributed SQLite-compatible database, using @libsql/client. Works on Node.js, Bun, Deno, and Cloudflare Workers over HTTP.",
  path: "/docs/databases/turso",
  keywords: [
    "Turso DaloyJS",
    "libSQL",
    "@libsql/client",
    "edge SQLite",
    "Turso Drizzle",
    "embedded replicas",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Use Turso (libSQL) with DaloyJS</h1>
      <p>
        <a href="https://turso.tech" target="_blank" rel="noreferrer">
          Turso
        </a>{" "}
        is a distributed database built on{" "}
        <a
          href="https://github.com/tursodatabase/libsql"
          target="_blank"
          rel="noreferrer"
        >
          libSQL
        </a>{" "}
        (a fork of SQLite). The <code>@libsql/client</code> driver speaks HTTP
        and WebSocket, so the same DaloyJS app works on Node, Bun, Deno,
        and Cloudflare Workers.
      </p>

      <BranchDiagram
        title="One client, two connection modes"
        source={{
          eyebrow: "@libsql/client",
          label: "createClient(...)",
          detail: "HTTP and WebSocket",
        }}
        branches={[
          {
            eyebrow: "node / bun",
            label: "Embedded replica",
            detail:
              "url: file:local.db + syncUrl · local reads, writes to primary",
            tone: "success",
          },
          {
            eyebrow: "workers / edge",
            label: "Remote HTTP client",
            detail: "url + authToken · no embedded replicas",
          },
        ]}
        caption="The same createClient() driver serves both modes. Use an embedded replica on Node or Bun for ultra-low-latency local reads, and the remote HTTP client on Cloudflare Workers."
      />

      <h2 id="1-provision">1. Provision</h2>
      <p>
        Create a database via the Turso CLI or dashboard, then grab the URL and
        auth token. Set them as <code>TURSO_DATABASE_URL</code> and{" "}
        <code>TURSO_AUTH_TOKEN</code>.
      </p>

      <h2 id="2-install">2. Install</h2>
      <CodeBlock code={`pnpm add @libsql/client`} />

      <h2 id="3-create-a-turso-plugin">3. Create a Turso plugin</h2>
      <CodeBlock
        code={`// src/db/turso.ts
import { createClient, type Client } from "@libsql/client";
import type { App } from "@daloyjs/core";

export const db: Client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export const tursoPlugin = {
  name: "turso",
  async register(app: App) {
    app.decorate("db", db);
    app.onClose(async () => {
      db.close();
    });
  },
};`}
      />

      <h2 id="4-augment-app-state">4. Augment app state</h2>
      <CodeBlock
        code={`// src/types/state.d.ts
import type { Client } from "@libsql/client";

declare module "@daloyjs/core" {
  interface AppState {
    db: Client;
  }
}`}
      />

      <h2 id="5-use-it-in-a-route">5. Use it in a route</h2>
      <CodeBlock
        code={`import { z } from "zod";
import { App, secureHeaders } from "@daloyjs/core";
import { tursoPlugin } from "./db/turso";

const app = new App();
app.use(secureHeaders());
app.register(tursoPlugin);

const TodoSchema = z.object({ id: z.number(), title: z.string(), done: z.boolean() });

app.route({
  method: "GET",
  path: "/todos",
  operationId: "listTodos",
  responses: { 200: { description: "ok", body: z.array(TodoSchema) } },
  handler: async ({ state }) => {
    const result = await state.db.execute("select id, title, done from todos");
    const rows = result.rows.map((r) => ({
      id: Number(r.id),
      title: String(r.title),
      done: Boolean(r.done),
    }));
    return { status: 200, body: rows };
  },
});`}
      />

      <h2 id="embedded-replicas-node-bun">Embedded replicas (Node, Bun)</h2>
      <p>
        For ultra-low-latency reads, use an embedded replica that syncs with the
        primary in the background. Writes still go to the primary; reads are
        local.
      </p>
      <CodeBlock
        code={`import { createClient } from "@libsql/client";

export const db = createClient({
  url: "file:local.db",
  syncUrl: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
  syncInterval: 60,
});`}
      />

      <h2 id="cloudflare-workers-vercel">Cloudflare Workers</h2>
      <p>
        Use the standard HTTP client (no embedded replicas in Workers). Pass{" "}
        <code>env.TURSO_DATABASE_URL</code> instead of <code>process.env</code>.
      </p>

      <h2 id="with-drizzle-orm">With Drizzle ORM</h2>
      <CodeBlock
        code={`pnpm add drizzle-orm
// src/db/drizzle.ts
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
export const db = drizzle({ client });`}
      />

      <h2 id="with-prisma">With Prisma</h2>
      <p>
        Prisma supports Turso through the{" "}
        <a
          href="https://www.prisma.io/docs/orm/overview/databases/turso"
          target="_blank"
          rel="noreferrer"
        >
          libSQL Driver Adapter
        </a>{" "}
        in preview. Use Drizzle if you want a stable, production-ready setup
        today.
      </p>

      <p>
        See also <Link href="/docs/databases/cloudflare-d1">Cloudflare D1</Link>{" "}
        for a SQLite-style option that&apos;s bundled into Workers, or the{" "}
        <Link href="/docs/databases">database hosting overview</Link>.
      </p>
    </>
  );
}
