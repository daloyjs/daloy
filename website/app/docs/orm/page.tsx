import Link from "next/link";
import { CodeBlock } from "../../../components/code-block";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Using SQL ORMs with DaloyJS",
  description:
    "Connect DaloyJS to SQL databases with Prisma, Drizzle ORM, TypeORM, or Sequelize. Learn the recommended pattern for injecting clients, managing lifecycle, and keeping handlers type-safe.",
  path: "/docs/orm",
  keywords: [
    "DaloyJS ORM",
    "DaloyJS SQL ORM",
    "TypeScript ORM",
    "Prisma DaloyJS",
    "Drizzle ORM DaloyJS",
    "TypeORM DaloyJS",
    "Sequelize DaloyJS",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Using SQL ORMs with DaloyJS</h1>
      <p>
        DaloyJS is database-agnostic. Any SQL client that runs on your target runtime works, so pick the ORM
        or query layer that fits your team. The framework gives you two primitives that make integration
        boring (in a good way):
      </p>
      <ul>
        <li>
          <strong>
            <code>app.decorate(&quot;db&quot;, client)</code>
          </strong>{" "}
          attaches a shared client to every handler&apos;s <code>state</code>.
        </li>
        <li>
          <strong>
            <code>app.onClose(async () =&gt; client.disconnect())</code>
          </strong>{" "}
          ties cleanup to graceful shutdown.
        </li>
      </ul>

      <h2>The recommended pattern</h2>
      <p>
        Wrap the database client in a plugin and register it once at the root of your app. Handlers read it
        from <code>state</code> with full type-safety.
      </p>
      <CodeBlock
        code={`// src/db/plugin.ts
import type { App } from "@daloyjs/core";

export function databasePlugin(client: DbClient) {
  return {
    name: "database",
    async register(app: App) {
      app.decorate("db", client);
      app.onClose(async () => {
        await client.$disconnect?.();
      });
    },
  };
}

// src/server.ts
const app = new App();
app.register(databasePlugin(await createClient()));

app.route({
  method: "GET",
  path: "/users/:id",
  operationId: "getUser",
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "ok", body: UserSchema } },
  handler: async ({ params, state }) => {
    const user = await state.db.user.findUnique({ where: { id: params.id } });
    return user
      ? { status: 200, body: user }
      : { status: 404, body: { type: "about:blank", title: "Not found", status: 404 } };
  },
});`}
      />

      <h2>Pick your ORM</h2>
      <ul>
        <li>
          <Link href="/docs/orm/prisma">Prisma</Link> — schema-first, mature migrations, great DX.
        </li>
        <li>
          <Link href="/docs/orm/drizzle">Drizzle ORM</Link> — TypeScript-first, edge-friendly, SQL-like API.
        </li>
        <li>
          <Link href="/docs/orm/typeorm">TypeORM</Link> — decorator-based entities for object-oriented teams.
        </li>
        <li>
          <Link href="/docs/orm/sequelize">Sequelize</Link> — mature Active Record style models with broad SQL dialect support.
        </li>
      </ul>

      <h2>Need a platform client instead?</h2>
      <p>
        Supabase is not an ORM. It is a hosted Postgres platform with a fetch-based JavaScript client, auth,
        storage, realtime, and edge-friendly APIs. If that is the shape you need, use{" "}
        <Link href="/docs/orm/supabase">Supabase with DaloyJS</Link>.
      </p>

      <ul>
        <li>
          <Link href="/docs/orm/supabase">Supabase</Link> — platform client for hosted Postgres + auth via{" "}
          <code>@supabase/supabase-js</code>.
        </li>
      </ul>

      <h2>Keep ORM and ODM separate</h2>
      <p>
        This section is intentionally SQL-focused. If you are using MongoDB or Couchbase, jump to the{" "}
        <Link href="/docs/odm">ODM overview</Link> and use <Link href="/docs/odm/mongoose">Mongoose</Link>
        or <Link href="/docs/odm/ottoman">Ottoman</Link> instead of forcing document models into an ORM-shaped abstraction.
      </p>

      <h2>Runtime compatibility cheat sheet</h2>
      <table>
        <thead>
          <tr>
            <th>Data layer</th>
            <th>Node.js</th>
            <th>Bun</th>
            <th>Deno</th>
            <th>Cloudflare Workers</th>
            <th>Vercel Edge</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Prisma</td>
            <td>Yes</td>
            <td>Yes</td>
            <td>Yes</td>
            <td>Yes, with Driver Adapters</td>
            <td>Yes, with Driver Adapters</td>
          </tr>
          <tr>
            <td>Drizzle ORM</td>
            <td>Yes</td>
            <td>Yes</td>
            <td>Yes</td>
            <td>Yes</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td>TypeORM</td>
            <td>Yes</td>
            <td>Partial</td>
            <td>Partial</td>
            <td>No</td>
            <td>No</td>
          </tr>
          <tr>
            <td>Sequelize</td>
            <td>Yes</td>
            <td>Partial</td>
            <td>No</td>
            <td>No</td>
            <td>No</td>
          </tr>
          <tr>
            <td>Supabase JS</td>
            <td>Yes</td>
            <td>Yes</td>
            <td>Yes</td>
            <td>Yes</td>
            <td>Yes</td>
          </tr>
        </tbody>
      </table>
      <p>
        For edge runtimes (Cloudflare Workers, Vercel Edge), prefer Drizzle or Supabase, or use Prisma with{" "}
        <a href="https://www.prisma.io/docs/orm/overview/databases/database-drivers" target="_blank" rel="noreferrer">
          Driver Adapters
        </a>
        . TypeORM and Sequelize both rely on Node-centric drivers and are best on the Node.js adapter.
      </p>

      <h2>Typing the decorated client</h2>
      <p>
        Use the exported <code>AppState</code> augmentation point to make decorated clients available on{" "}
        <code>state</code> in every handler:
      </p>
      <CodeBlock
        code={`// src/types/state.d.ts
import type { PrismaClient } from "@prisma/client";

declare module "@daloyjs/core" {
  interface AppState {
    db: PrismaClient;
  }
}`}
      />

      <h2>Transactions</h2>
      <p>
        Don&apos;t open transactions in middleware. Open them inside the handler that owns the unit of work, so
        your contract response (success or error) maps cleanly onto commit / rollback.
      </p>
      <CodeBlock
        code={`handler: async ({ body, state }) => {
  return state.db.$transaction(async (tx) => {
    const order = await tx.order.create({ data: body });
    await tx.inventory.update({
      where: { sku: body.sku },
      data: { stock: { decrement: body.qty } },
    });
    return { status: 201, body: order };
  });
}`}
      />

      <h2>Errors</h2>
      <p>
        Translate database errors into framework errors so they serialize as{" "}
        <Link href="/docs/errors">problem+json</Link> automatically:
      </p>
      <CodeBlock
        code={`import { HttpError } from "@daloyjs/core";

try {
  return await state.db.user.create({ data: body });
} catch (err) {
  if (isUniqueViolation(err)) {
    throw new HttpError(409, {
      title: "User already exists",
      type: "https://daloyjs.dev/errors/duplicate",
    });
  }
  throw err;
}`}
      />

      <h2>Next steps</h2>
      <ul>
        <li>
          <Link href="/docs/orm/prisma">Prisma guide</Link>
        </li>
        <li>
          <Link href="/docs/orm/drizzle">Drizzle guide</Link>
        </li>
        <li>
          <Link href="/docs/orm/typeorm">TypeORM guide</Link>
        </li>
        <li>
          <Link href="/docs/orm/sequelize">Sequelize guide</Link>
        </li>
        <li>
          <Link href="/docs/orm/supabase">Supabase platform guide</Link>
        </li>
        <li>
          <Link href="/docs/odm">ODM overview</Link>
        </li>
      </ul>
    </>
  );
}
