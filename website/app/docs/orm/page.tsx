import Link from "next/link";
import { CodeBlock } from "../../../components/code-block";
import { BranchDiagram, LayerStack } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Using SQL ORMs with DaloyJS",
  description:
    "Connect DaloyJS to SQL databases with Prisma, Drizzle ORM, TypeORM, MikroORM, or Sequelize. Learn the recommended pattern for injecting clients, managing lifecycle, and keeping handlers type-safe.",
  path: "/docs/orm",
  keywords: [
    "DaloyJS ORM",
    "DaloyJS SQL ORM",
    "TypeScript ORM",
    "Prisma DaloyJS",
    "Drizzle ORM DaloyJS",
    "TypeORM DaloyJS",
    "MikroORM DaloyJS",
    "Sequelize DaloyJS",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Using SQL ORMs with DaloyJS</h1>
      <p>
        DaloyJS is database-agnostic. Any SQL client that runs on your target
        runtime works, so pick the ORM or query layer that fits your team. The
        framework gives you two primitives that make integration boring (in a
        good way):
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

      <BranchDiagram
        title="One app, your choice of data layer"
        source={{
          eyebrow: "your app",
          label: "DaloyJS app",
          detail: 'app.decorate("db", client)',
        }}
        branches={[
          {
            eyebrow: "schema-first",
            label: "Prisma",
            detail: "@prisma/client",
          },
          { eyebrow: "ts-first", label: "Drizzle ORM", detail: "drizzle-orm" },
          { eyebrow: "decorators", label: "TypeORM", detail: "DataSource" },
          {
            eyebrow: "unit of work",
            label: "MikroORM",
            detail: "EntityManager",
          },
          {
            eyebrow: "active record",
            label: "Sequelize",
            detail: "Sequelize models",
          },
          {
            eyebrow: "platform",
            label: "Supabase",
            detail: "@supabase/supabase-js",
            tone: "muted",
          },
        ]}
        caption="DaloyJS is database-agnostic. The same decorate plus onClose pattern wires any SQL client (or the Supabase platform client) onto every handler's state, so the choice of data layer stays a swappable detail."
      />

      <h2 id="the-recommended-pattern">The recommended pattern</h2>
      <p>
        Wrap the database client in a plugin and register it once at the root of
        your app. Handlers read it from <code>state</code> with full
        type-safety.
      </p>
      <LayerStack
        title="Where the client lives"
        caption="A plugin decorates one shared client onto app state at startup. Every route handler reaches the same client through state.db, and onClose ties teardown to graceful shutdown."
        layers={[
          {
            title: "Route handler",
            detail: "reads the client off state, type-safe",
            tone: "accent",
            items: ["state.db.user.findUnique(...)"],
          },
          {
            title: "App state",
            detail: 'attached once via app.decorate("db", client)',
            items: ["state.db"],
          },
          {
            title: "ORM / query client",
            detail: "one shared instance per process",
            tone: "muted",
            items: ["Prisma", "Drizzle", "TypeORM", "..."],
          },
          {
            title: "Database",
            detail: "Postgres, MySQL, SQLite, ...",
            tone: "muted",
          },
        ]}
      />
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

      <h2 id="pick-your-orm">Pick your ORM</h2>
      <ul>
        <li>
          <Link href="/docs/orm/prisma">Prisma</Link>: schema-first, mature
          migrations, great DX.
        </li>
        <li>
          <Link href="/docs/orm/drizzle">Drizzle ORM</Link>: TypeScript-first,
          edge-friendly, SQL-like API.
        </li>
        <li>
          <Link href="/docs/orm/typeorm">TypeORM</Link>: decorator-based
          entities for object-oriented teams.
        </li>
        <li>
          <Link href="/docs/orm/mikro-orm">MikroORM</Link>: Data Mapper, Unit of
          Work, and Identity Map with first-class TypeScript.
        </li>
        <li>
          <Link href="/docs/orm/sequelize">Sequelize</Link>: mature Active
          Record style models with broad SQL dialect support.
        </li>
      </ul>

      <h2 id="need-a-platform-client-instead">Need a platform client instead?</h2>
      <p>
        Supabase is not an ORM. It is a hosted Postgres platform with a
        fetch-based JavaScript client, auth, storage, realtime, and
        edge-friendly APIs. If that is the shape you need, use{" "}
        <Link href="/docs/orm/supabase">Supabase with DaloyJS</Link>.
      </p>

      <ul>
        <li>
          <Link href="/docs/orm/supabase">Supabase</Link>: platform client for
          hosted Postgres + auth via <code>@supabase/supabase-js</code>.
        </li>
      </ul>

      <h2 id="keep-orm-and-odm-separate">Keep ORM and ODM separate</h2>
      <p>
        This section is intentionally SQL-focused. If you are using MongoDB or
        Couchbase, jump to the <Link href="/docs/odm">ODM overview</Link> and
        use <Link href="/docs/odm/mongoose">Mongoose</Link>
        or <Link href="/docs/odm/ottoman">Ottoman</Link> instead of forcing
        document models into an ORM-shaped abstraction.
      </p>

      <h2 id="runtime-compatibility-cheat-sheet">Runtime compatibility cheat sheet</h2>
      <table>
        <thead>
          <tr>
            <th>Data layer</th>
            <th>Node.js</th>
            <th>Bun</th>
            <th>Deno</th>
            <th>Cloudflare Workers</th>
            <th>Vercel</th>
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
            <td>MikroORM</td>
            <td>Yes</td>
            <td>Yes</td>
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
        For edge runtimes (Cloudflare Workers, Vercel), prefer Drizzle or
        Supabase, or use Prisma with{" "}
        <a
          href="https://www.prisma.io/docs/orm/overview/databases/database-drivers"
          target="_blank"
          rel="noreferrer"
        >
          Driver Adapters
        </a>
        . TypeORM, MikroORM, and Sequelize all lean on Node-centric runtime
        assumptions and are best on the Node.js adapter.
      </p>

      <h2 id="typing-the-decorated-client">Typing the decorated client</h2>
      <p>
        Use the exported <code>AppState</code> augmentation point to make
        decorated clients available on <code>state</code> in every handler:
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

      <h2 id="transactions">Transactions</h2>
      <p>
        Don&apos;t open transactions in middleware. Open them inside the handler
        that owns the unit of work, so your contract response (success or error)
        maps cleanly onto commit / rollback.
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

      <h2 id="errors">Errors</h2>
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

      <h2 id="next-steps">Next steps</h2>
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
          <Link href="/docs/orm/mikro-orm">MikroORM guide</Link>
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
