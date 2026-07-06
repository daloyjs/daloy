import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";
import { FlowDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Use TypeORM with DaloyJS",
  description:
    "Integrate TypeORM with DaloyJS using a DataSource plugin: decorator-based entities, repositories, migrations, and transactions wired into your contract-first routes.",
  path: "/docs/orm/typeorm",
  keywords: [
    "TypeORM DaloyJS",
    "TypeORM plugin",
    "TypeORM DataSource",
    "TypeORM repositories",
    "TypeORM transactions",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Use TypeORM with DaloyJS</h1>
      <p>
        <a href="https://typeorm.io" target="_blank" rel="noreferrer">
          TypeORM
        </a>{" "}
        gives you decorator-based entities and the active-record / data-mapper
        patterns familiar to Java and .NET teams. It runs best on the{" "}
        <Link href="/docs/adapters">Node.js adapter</Link>.
      </p>

      <FlowDiagram
        numbered
        title="One request through TypeORM"
        caption="Zod validates the request, the handler gets a repository off the DataSource on state.db, runs the entity query, then the response schema checks the body on the way out."
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
            eyebrow: "typeorm",
            label: "Repository query",
            detail: "getRepository(User).findOneBy(...)",
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
        code={`pnpm add typeorm reflect-metadata pg
pnpm add -D @types/node`}
      />
      <p>
        TypeORM relies on <code>reflect-metadata</code> and decorator metadata.
        Make sure your <code>tsconfig.json</code> enables them:
      </p>
      <CodeBlock
        code={`{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strictPropertyInitialization": false
  }
}`}
      />

      <h2 id="2-define-an-entity">2. Define an entity</h2>
      <CodeBlock
        code={`// src/db/entities/User.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from "typeorm";

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ unique: true })
  email!: string;

  @Column({ type: "text", nullable: true })
  name!: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;
}`}
      />

      <h2 id="3-configure-the-datasource">3. Configure the DataSource</h2>
      <CodeBlock
        code={`// src/db/data-source.ts
import "reflect-metadata";
import { DataSource } from "typeorm";
import { User } from "./entities/User";

export const AppDataSource = new DataSource({
  type: "postgres",
  url: process.env.DATABASE_URL,
  entities: [User],
  migrations: ["src/db/migrations/*.ts"],
  synchronize: false, // use migrations in production
  logging: process.env.NODE_ENV !== "production",
});`}
      />

      <h2 id="4-create-a-typeorm-plugin">4. Create a TypeORM plugin</h2>
      <CodeBlock
        code={`// src/db/plugin.ts
import type { App } from "@daloyjs/core";
import { AppDataSource } from "./data-source";

export const typeormPlugin = {
  name: "typeorm",
  async register(app: App) {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    app.decorate("db", AppDataSource);
    app.onClose(async () => {
      if (AppDataSource.isInitialized) await AppDataSource.destroy();
    });
  },
};`}
      />

      <h2 id="5-augment-app-state-types">5. Augment app state types</h2>
      <CodeBlock
        code={`// src/types/state.d.ts
import type { DataSource } from "typeorm";

declare module "@daloyjs/core" {
  interface AppState {
    db: DataSource;
  }
}`}
      />

      <h2 id="6-use-repositories-in-routes">6. Use repositories in routes</h2>
      <CodeBlock
        code={`// src/server.ts
import "reflect-metadata";
import { z } from "zod";
import { App } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { typeormPlugin } from "./db/plugin";
import { User } from "./db/entities/User";

const app = new App();
app.register(typeormPlugin);

const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().nullable(),
  createdAt: z.coerce.date(),
});

app.route({
  method: "GET",
  path: "/users/:id",
  operationId: "getUser",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: { description: "Found", body: UserSchema },
    404: { description: "Not found" },
  },
  handler: async ({ params, state }) => {
    const repo = state.db.getRepository(User);
    const user = await repo.findOneBy({ id: params.id });
    return user
      ? { status: 200, body: user }
      : { status: 404, body: { type: "about:blank", title: "Not found", status: 404 } };
  },
});

app.route({
  method: "POST",
  path: "/users",
  operationId: "createUser",
  request: { body: z.object({ email: z.email(), name: z.string().optional() }) },
  responses: { 201: { description: "Created", body: UserSchema } },
  handler: async ({ body, state }) => {
    const repo = state.db.getRepository(User);
    const created = await repo.save(repo.create(body));
    return { status: 201, body: created };
  },
});

await app.ready();
serve(app, { port: 3000 });`}
      />

      <h2 id="transactions">Transactions</h2>
      <CodeBlock
        code={`handler: async ({ body, state }) => {
  return state.db.transaction(async (manager) => {
    const order = await manager.save(Order, manager.create(Order, body));
    await manager.decrement(Inventory, { sku: body.sku }, "stock", body.qty);
    return { status: 201, body: order };
  });
}`}
      />

      <h2 id="migrations">Migrations</h2>
      <CodeBlock
        code={`pnpm typeorm migration:generate src/db/migrations/InitUser -d src/db/data-source.ts
pnpm typeorm migration:run -d src/db/data-source.ts`}
      />

      <h2 id="runtime-notes">Runtime notes</h2>
      <ul>
        <li>
          TypeORM uses Node-only APIs (filesystem, native drivers). It does{" "}
          <strong>not</strong> run on Cloudflare Workers, use{" "}
          <Link href="/docs/orm/drizzle">Drizzle</Link> or{" "}
          <Link href="/docs/orm/supabase">Supabase</Link> there.
        </li>
        <li>
          On Bun and Deno, prefer <code>drizzle</code>-style postgres clients
          unless you need TypeORM&apos;s decorators.
        </li>
        <li>
          Always import <code>reflect-metadata</code> once at the entrypoint,
          before anything else.
        </li>
      </ul>

      <p>
        Compare with <Link href="/docs/orm/prisma">Prisma</Link>,{" "}
        <Link href="/docs/orm/drizzle">Drizzle</Link>,{" "}
        <Link href="/docs/orm/mikro-orm">MikroORM</Link>,{" "}
        <Link href="/docs/orm/sequelize">Sequelize</Link>, or the{" "}
        <Link href="/docs/odm">ODM overview</Link> if you need document models.
      </p>
    </>
  );
}
