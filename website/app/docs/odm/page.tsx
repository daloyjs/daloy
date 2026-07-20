import Link from "next/link";
import { CodeBlock } from "../../../components/code-block";
import { LayerStack } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Using ODMs with DaloyJS",
  description:
    "Connect DaloyJS to document databases with ODMs such as Mongoose for MongoDB or Ottoman for Couchbase. Learn the recommended pattern for injecting connections and models into your handlers.",
  path: "/docs/odm",
  keywords: [
    "DaloyJS ODM",
    "Mongoose DaloyJS",
    "Ottoman DaloyJS",
    "MongoDB TypeScript framework",
    "Couchbase TypeScript framework",
    "MongoDB ODM",
    "Couchbase ODM",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Using ODMs with DaloyJS</h1>
      <p>
        DaloyJS works just as well with document databases as it does with SQL
        databases, but the abstractions are different. Use an ODM when your
        persistence layer is document-shaped and you want schemas, validation,
        middleware, and query helpers around collections or buckets.
      </p>

      <h2 id="orm-vs-odm">ORM vs ODM</h2>
      <ul>
        <li>
          <strong>ORM</strong> maps relational tables and joins into TypeScript
          objects. Use it for PostgreSQL, MySQL, SQLite, MariaDB, or MSSQL.
        </li>
        <li>
          <strong>ODM</strong> maps JSON-like documents and collection workflows
          into TypeScript objects. Use it for document databases such as MongoDB
          or Couchbase.
        </li>
      </ul>

      <h2 id="the-recommended-pattern">The recommended pattern</h2>
      <p>
        Just like SQL clients, ODM connections belong in a plugin. Decorate your
        app with a small database surface and close the connection on shutdown.
      </p>

      <LayerStack
        title="Where the ODM connection lives"
        flow="down"
        layers={[
          {
            title: "Route handlers",
            detail: "Read models from state, never connect directly",
            items: ["state.db.User", "state.db.Order"],
            tone: "accent",
          },
          {
            title: "Database plugin",
            detail: "app.decorate('db', db) plus app.onClose() teardown",
            items: ["register(app)", "onClose"],
          },
          {
            title: "ODM connection & models",
            detail: "Schemas, validation, query helpers",
            items: ["Mongoose", "Ottoman"],
            tone: "muted",
          },
          {
            title: "Document database",
            detail: "Collections, buckets, scopes",
            items: ["MongoDB", "Couchbase"],
            tone: "muted",
          },
        ]}
        caption="Connections are opened once in a plugin and exposed on state. Handlers read models from state.db, so the connection lifecycle stays in one place and closes cleanly on shutdown."
      />

      <CodeBlock
        code={`// src/db/plugin.ts
import type { App } from "@daloyjs/core";

export function databasePlugin(db: Database) {
  return {
    name: "database",
    async register(app: App) {
      app.decorate("db", db);
      app.onClose(async () => {
        await db.disconnect();
      });
    },
  };
}`}
      />

      <h2 id="pick-your-odm">Pick your ODM</h2>
      <ul>
        <li>
          <Link href="/docs/odm/mongoose">Mongoose</Link>
          {": "}mature schemas, middleware, validation, and session support for
          MongoDB.
        </li>
        <li>
          <Link href="/docs/odm/ottoman">Ottoman</Link>
          {": "}schema and model layer for Couchbase buckets, scopes, and
          collections.
        </li>
      </ul>

      <h2 id="runtime-compatibility-cheat-sheet">
        Runtime compatibility cheat sheet
      </h2>
      <table>
        <thead>
          <tr>
            <th>ODM</th>
            <th>Node.js</th>
            <th>Bun</th>
            <th>Deno</th>
            <th>Cloudflare Workers</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Mongoose</td>
            <td>Yes</td>
            <td>Partial</td>
            <td>No</td>
            <td>No</td>
          </tr>
          <tr>
            <td>Ottoman</td>
            <td>Yes</td>
            <td>Partial</td>
            <td>No</td>
            <td>No</td>
          </tr>
        </tbody>
      </table>
      <p>
        Mongoose and Ottoman both depend on Node.js database drivers, so they
        are primarily Node.js choices. If you need a portable edge-friendly
        database layer, stay in the SQL-oriented{" "}
        <Link href="/docs/orm">ORM section</Link> and choose a compatible client
        there.
      </p>

      <h2 id="typing-the-decorated-client">Typing the decorated client</h2>
      <p>
        Declare the augmentation in the module that exports the models (a
        regular <code>.ts</code> file the compiler always checks), not in a
        separate <code>.d.ts</code> file: declaration files are exempt from
        type-checking when <code>skipLibCheck</code> is on (the scaffolded
        default), so a broken import inside a <code>.d.ts</code> fails silently
        and <code>state.db</code> quietly degrades to <code>any</code>.
      </p>
      <CodeBlock
        code={`// src/db/mongoose.ts (the module that exports db)
declare module "@daloyjs/core" {
  interface AppState {
    db: typeof db;
  }
}`}
      />

      <h2 id="sessions-and-transactions">Sessions and transactions</h2>
      <p>
        MongoDB transactions require a replica set and a session. Start the
        session inside the handler that owns the unit of work, then pass it
        through each model operation.
      </p>
      <CodeBlock
        code={`handler: async ({ body, state }) => {
  const session = await state.db.connection.startSession();
  try {
    let createdOrder: unknown;
    await session.withTransaction(async () => {
      createdOrder = await state.db.Order.create([{ ...body }], { session });
      await state.db.Inventory.updateOne(
        { sku: body.sku },
        { $inc: { stock: -body.qty } },
        { session }
      );
    });

    return { status: 201, body: createdOrder };
  } finally {
    await session.endSession();
  }
}`}
      />

      <h2 id="next-steps">Next steps</h2>
      <ul>
        <li>
          <Link href="/docs/odm/mongoose">Mongoose guide</Link>
        </li>
        <li>
          <Link href="/docs/odm/ottoman">Ottoman guide</Link>
        </li>
        <li>
          <Link href="/docs/orm">SQL ORM overview</Link>
        </li>
      </ul>
    </>
  );
}
