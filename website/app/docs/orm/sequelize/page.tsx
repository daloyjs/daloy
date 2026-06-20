import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";
import { FlowDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Use Sequelize with DaloyJS",
  description:
    "Connect DaloyJS to PostgreSQL, MySQL, MariaDB, MSSQL, or SQLite using Sequelize. Model-based queries, transactions, and a practical plugin setup for Node.js runtimes.",
  path: "/docs/orm/sequelize",
  keywords: [
    "Sequelize DaloyJS",
    "Sequelize TypeScript",
    "Sequelize transactions",
    "Sequelize Node.js",
    "Sequelize plugin",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Use Sequelize with DaloyJS</h1>
      <p>
        <a href="https://sequelize.org" target="_blank" rel="noreferrer">
          Sequelize
        </a>{" "}
        is a mature ORM for SQL databases with model definitions, associations,
        transactions, and broad driver support. It is a strong fit when your
        team prefers an Active Record style API and deploys DaloyJS on Node.js.
      </p>

      <FlowDiagram
        numbered
        title="One request through Sequelize"
        caption="Zod validates the request, the handler queries a Sequelize model off state.db, then the response schema checks the body on the way out (call toJSON() so the plain object matches the schema)."
        steps={[
          { eyebrow: "client", label: "HTTP request", detail: "GET /users/:id" },
          { eyebrow: "zod", label: "Validated input", detail: "params.id is a uuid", tone: "accent" },
          { eyebrow: "sequelize", label: "Model query", detail: "state.db.User.findByPk(id)" },
          { eyebrow: "response", label: "Typed body", detail: "user.toJSON() | 404", tone: "success" },
        ]}
      />

      <h2>1. Install</h2>
      <CodeBlock
        code={`pnpm add sequelize pg pg-hstore
pnpm add -D @types/validator @types/node typescript`}
      />
      <p>
        Swap the driver package if you target MySQL, MariaDB, MSSQL, or SQLite
        instead of Postgres.
      </p>

      <h2>2. Define a model</h2>
      <CodeBlock
        code={`// src/db/sequelize.ts
import { Sequelize, DataTypes, Model, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize";

export const sequelize = new Sequelize(process.env.DATABASE_URL!, {
  dialect: "postgres",
  logging: process.env.NODE_ENV === "production" ? false : console.log,
});

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare id: CreationOptional<string>;
  declare email: string;
  declare name: string | null;
}

User.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: "User",
    tableName: "users",
    underscored: true,
  }
);`}
      />

      <h2>3. Create a Sequelize plugin</h2>
      <CodeBlock
        code={`// src/db/plugin.ts
import type { App } from "@daloyjs/core";
import { sequelize, User } from "./sequelize";

export const db = { sequelize, User };

export const sequelizePlugin = {
  name: "sequelize",
  async register(app: App) {
    await sequelize.authenticate();
    app.decorate("db", db);
    app.onClose(async () => {
      await sequelize.close();
    });
  },
};`}
      />

      <h2>4. Augment app state types</h2>
      <CodeBlock
        code={`// src/types/state.d.ts
import type { db } from "../db/plugin";

declare module "@daloyjs/core" {
  interface AppState {
    db: typeof db;
  }
}`}
      />

      <h2>5. Use it in routes</h2>
      <CodeBlock
        code={`// src/server.ts
import { z } from "zod";
import { App, HttpError } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { sequelizePlugin } from "./db/plugin";

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
});

const app = new App();
app.register(sequelizePlugin);

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
    const user = await state.db.User.findByPk(params.id);
    if (!user) {
      throw new HttpError(404, { title: "User not found" });
    }
    return { status: 200, body: user.toJSON() };
  },
});

await app.ready();
serve(app, { port: 3000 });`}
      />

      <h2>Transactions</h2>
      <p>
        Use managed transactions so DaloyJS can map one handler invocation to
        one atomic unit of work.
      </p>
      <CodeBlock
        code={`handler: async ({ body, state }) => {
  const created = await state.db.sequelize.transaction(async (transaction) => {
    const order = await state.db.Order.create(body, { transaction });
    await state.db.Inventory.decrement("stock", {
      by: body.qty,
      where: { sku: body.sku },
      transaction,
    });
    return order;
  });

  return { status: 201, body: created.toJSON() };
}`}
      />

      <h2>Migrations</h2>
      <p>
        Sequelize supports migrations via the CLI, but many teams keep model
        definitions in TypeScript and run explicit migration files through{" "}
        <code>sequelize-cli</code> or Umzug. Keep that workflow outside your
        request path and initialize models before calling{" "}
        <code>app.ready()</code>.
      </p>
      <CodeBlock
        code={`pnpm add -D sequelize-cli
pnpm sequelize-cli migration:generate --name create-users
pnpm sequelize-cli db:migrate`}
      />

      <h2>Runtime constraints</h2>
      <p>
        Sequelize depends on Node-oriented drivers, so it is best on the Node.js
        adapter. For edge runtimes, prefer{" "}
        <Link href="/docs/orm/drizzle">Drizzle</Link>,{" "}
        <Link href="/docs/orm/prisma">Prisma with Driver Adapters</Link>, or{" "}
        <Link href="/docs/orm/supabase">Supabase</Link>.
      </p>

      <p>
        Compare with <Link href="/docs/orm/prisma">Prisma</Link>,{" "}
        <Link href="/docs/orm/drizzle">Drizzle</Link>,{" "}
        <Link href="/docs/orm/typeorm">TypeORM</Link>,{" "}
        <Link href="/docs/orm/mikro-orm">MikroORM</Link>, or the{" "}
        <Link href="/docs/odm">ODM overview</Link> if you are working with
        document databases.
      </p>
    </>
  );
}
