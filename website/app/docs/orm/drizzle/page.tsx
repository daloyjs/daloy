import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";
import { FlowDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Use Drizzle ORM with DaloyJS",
  description:
    "Pair DaloyJS with Drizzle ORM for a TypeScript-first, edge-friendly database layer. Schema in code, SQL-like queries, and full type inference into your handlers.",
  path: "/docs/orm/drizzle",
  keywords: [
    "Drizzle ORM DaloyJS",
    "Drizzle TypeScript",
    "Drizzle edge",
    "Drizzle Cloudflare Workers",
    "Drizzle plugin",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Use Drizzle ORM with DaloyJS</h1>
      <p>
        <a href="https://orm.drizzle.team" target="_blank" rel="noreferrer">
          Drizzle ORM
        </a>{" "}
        is a lightweight, TypeScript-native ORM with a SQL-like API. It runs
        everywhere DaloyJS does, including Cloudflare Workers, and
        infers result types directly from your schema.
      </p>

      <FlowDiagram
        numbered
        title="One request through Drizzle"
        caption="Zod validates the request before your handler runs, Drizzle runs a SQL-like query off state.db with result types inferred from your schema, then the response schema checks the body on the way out."
        steps={[
          {
            eyebrow: "client",
            label: "HTTP request",
            detail: "GET /users/:id",
          },
          {
            eyebrow: "zod",
            label: "Validated input",
            detail: "params.id is a uuid",
            tone: "accent",
          },
          {
            eyebrow: "drizzle",
            label: "Typed query",
            detail: "select().from(users).where(eq(...))",
          },
          {
            eyebrow: "response",
            label: "Typed body",
            detail: "200 UserSchema | 404",
            tone: "success",
          },
        ]}
      />

      <h2 id="1-install">1. Install</h2>
      <CodeBlock
        code={`pnpm add drizzle-orm postgres
pnpm add -D drizzle-kit`}
      />

      <h2 id="2-define-your-schema">2. Define your schema</h2>
      <CodeBlock
        code={`// src/db/schema.ts
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});`}
      />
      <CodeBlock
        code={`// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});`}
      />
      <CodeBlock
        code={`pnpm drizzle-kit generate
pnpm drizzle-kit migrate`}
      />

      <h2 id="3-create-a-drizzle-plugin">3. Create a Drizzle plugin</h2>
      <CodeBlock
        code={`// src/db/drizzle.ts
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import type { App } from "@daloyjs/core";
import * as schema from "./schema";

const client = postgres(process.env.DATABASE_URL!, { max: 10, prepare: false });
export const db = drizzle(client, { schema });

export const drizzlePlugin = {
  name: "drizzle",
  async register(app: App) {
    app.decorate("db", db);
    app.onClose(async () => {
      await client.end({ timeout: 5 });
    });
  },
};`}
      />

      <h2 id="4-augment-app-state-types">4. Augment app state types</h2>
      <CodeBlock
        code={`// src/types/state.d.ts
import type { db } from "../db/drizzle";

declare module "@daloyjs/core" {
  interface AppState {
    db: typeof db;
  }
}`}
      />

      <h2 id="5-use-it-in-routes">5. Use it in routes</h2>
      <CodeBlock
        code={`// src/server.ts
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { App } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { drizzlePlugin } from "./db/drizzle";
import { users } from "./db/schema";

const app = new App();
app.register(drizzlePlugin);

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  createdAt: z.coerce.date(),
});

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
    const [user] = await state.db.select().from(users).where(eq(users.id, params.id)).limit(1);
    return user
      ? { status: 200, body: user }
      : { status: 404, body: { type: "about:blank", title: "Not found", status: 404 } };
  },
});

app.route({
  method: "POST",
  path: "/users",
  operationId: "createUser",
  request: { body: z.object({ email: z.string().email(), name: z.string().optional() }) },
  responses: { 201: { description: "Created", body: UserSchema } },
  handler: async ({ body, state }) => {
    const [created] = await state.db.insert(users).values(body).returning();
    return { status: 201, body: created };
  },
});

await app.ready();
serve(app, { port: 3000 });`}
      />

      <h2 id="transactions">Transactions</h2>
      <CodeBlock
        code={`handler: async ({ body, state }) => {
  const order = await state.db.transaction(async (tx) => {
    const [created] = await tx.insert(orders).values(body).returning();
    await tx
      .update(inventory)
      .set({ stock: sql\`\${inventory.stock} - \${body.qty}\` })
      .where(eq(inventory.sku, body.sku));
    return created;
  });
  return { status: 201, body: order };
}`}
      />

      <h2 id="edge-runtimes">Edge runtimes</h2>
      <p>
        Drizzle is the easiest path to running DaloyJS against a real database
        on the edge. Pick a driver:
      </p>
      <ul>
        <li>
          <strong>Cloudflare Workers + D1:</strong> <code>drizzle-orm/d1</code>
        </li>
        <li>
          <strong>Neon (Postgres) on any edge:</strong>{" "}
          <code>drizzle-orm/neon-http</code>
        </li>
        <li>
          <strong>PlanetScale (MySQL):</strong>{" "}
          <code>drizzle-orm/planetscale-serverless</code>
        </li>
      </ul>
      <CodeBlock
        code={`// Cloudflare Workers + D1
import { drizzle } from "drizzle-orm/d1";

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const db = drizzle(env.DB);
    // app.decorate("db", db) per request, or build the App per-request.
    return app.fetch(req, env, ctx);
  },
};`}
      />

      <p>
        Compare with <Link href="/docs/orm/prisma">Prisma</Link>,{" "}
        <Link href="/docs/orm/typeorm">TypeORM</Link>,{" "}
        <Link href="/docs/orm/mikro-orm">MikroORM</Link>,{" "}
        <Link href="/docs/orm/sequelize">Sequelize</Link>, or the{" "}
        <Link href="/docs/odm">ODM overview</Link> if you are working with
        document databases.
      </p>
      <p>
        Drizzle pairs cleanly with every host in the{" "}
        <Link href="/docs/databases">database hosting overview</Link>, including{" "}
        <Link href="/docs/databases/neon">Neon</Link>,{" "}
        <Link href="/docs/databases/planetscale">PlanetScale</Link>,{" "}
        <Link href="/docs/databases/turso">Turso</Link>, and{" "}
        <Link href="/docs/databases/cloudflare-d1">Cloudflare D1</Link>.
      </p>
    </>
  );
}
