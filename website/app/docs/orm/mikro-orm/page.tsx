import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";
import { FlowDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Use MikroORM with DaloyJS",
  description:
    "Integrate MikroORM v7 with DaloyJS using the modern defineEntity helper, defineConfig, request-scoped EntityManagers, the unit-of-work, and migrations wired into your contract-first routes.",
  path: "/docs/orm/mikro-orm",
  keywords: [
    "MikroORM DaloyJS",
    "MikroORM v7",
    "MikroORM plugin",
    "MikroORM defineEntity",
    "MikroORM defineConfig",
    "MikroORM EntityManager",
    "MikroORM RequestContext",
    "MikroORM unit of work",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Use MikroORM with DaloyJS</h1>
      <p>
        <a href="https://mikro-orm.io" target="_blank" rel="noreferrer">
          MikroORM
        </a>{" "}
        is a TypeScript ORM built around a Data Mapper, Unit of Work, and
        Identity Map. It supports PostgreSQL, MySQL/MariaDB, SQLite,
        libSQL/Turso, PGlite, MSSQL, Oracle, and MongoDB. This SQL-focused guide
        targets MikroORM v7, PostgreSQL, and the{" "}
        <Link href="/docs/adapters">Node.js adapter</Link>.
      </p>

      <h2 id="1-install">1. Install</h2>
      <p>
        Install <code>@mikro-orm/core</code> together with the driver package
        for your database. The version of every <code>@mikro-orm/*</code>{" "}
        package must match.
      </p>
      <CodeBlock
        code={`# PostgreSQL (also CockroachDB)
pnpm add @mikro-orm/core @mikro-orm/postgresql
# or MySQL / MariaDB
pnpm add @mikro-orm/core @mikro-orm/mysql
# or SQLite
pnpm add @mikro-orm/core @mikro-orm/sqlite
# or libSQL / Turso
pnpm add @mikro-orm/core @mikro-orm/libsql
# or PGlite (embedded PostgreSQL in WASM)
pnpm add @mikro-orm/core @mikro-orm/pglite

# CLI + migrations (optional, dev-only)
pnpm add -D @mikro-orm/cli @mikro-orm/migrations`}
      />
      <p>
        MikroORM v7 supports both ES-spec decorators and the legacy{" "}
        <code>experimentalDecorators</code> flag. The examples below use the{" "}
        <code>defineEntity</code> helper, which is decorator-free and gives you
        full TypeScript inference without any compiler flags.
      </p>

      <h2 id="2-define-an-entity">2. Define an entity</h2>
      <p>
        <code>defineEntity</code> returns a schema object you can attach to a
        real class. The class gives you a named type for your handlers; the
        schema gives MikroORM its metadata.
      </p>
      <CodeBlock
        code={`// src/db/entities/User.ts
import { defineEntity, p } from "@mikro-orm/core";

const UserSchema = defineEntity({
  name: "User",
  properties: {
    id: p.uuid().primary().defaultRaw("gen_random_uuid()"),
    email: p.string().unique(),
    name: p.string().nullable(),
    createdAt: p.datetime().onCreate(() => new Date()),
  },
});

export class User extends UserSchema.class {}
UserSchema.setClass(User);`}
      />

      <h2 id="3-configure-the-orm">3. Configure the ORM</h2>
      <p>
        Import <code>defineConfig</code> from your driver package, it infers the
        driver and gives you IntelliSense without extra type hints.
      </p>
      <CodeBlock
        code={`// src/mikro-orm.config.ts
import { defineConfig } from "@mikro-orm/postgresql";
import { Migrator } from "@mikro-orm/migrations";
      import { User } from "./db/entities/User";

export default defineConfig({
  entities: [User],
  clientUrl: process.env.DATABASE_URL,
  // production-friendly defaults
  debug: process.env.NODE_ENV !== "production",
  extensions: [Migrator],
  migrations: {
    path: "./dist/db/migrations",
    pathTs: "./src/db/migrations",
  },
});`}
      />

      <h2 id="4-create-a-mikroorm-plugin">4. Create a MikroORM plugin</h2>
      <p>
        Initialize the ORM once at startup, decorate the app with the root ORM
        instance, and close it on shutdown. Handlers get their own forked{" "}
        <code>EntityManager</code> in step 5.
      </p>
      <CodeBlock
        code={`// src/db/plugin.ts
import type { App } from "@daloyjs/core";
import { MikroORM } from "@mikro-orm/postgresql";
import config from "../mikro-orm.config";

export const mikroOrmPlugin = {
  name: "mikro-orm",
  async register(app: App) {
    const orm = await MikroORM.init(config);
    app.decorate("orm", orm);
    app.onClose(async () => {
      await orm.close(true);
    });
  },
};`}
      />

      <h2 id="5-fork-an-entitymanager-per-request">5. Fork an EntityManager per request</h2>
      <p>
        MikroORM relies on an <strong>Identity Map</strong> that is bound to an{" "}
        <code>EntityManager</code>. You must <em>fork</em> the root EM for every
        request so identity maps and unit-of-work state do not leak between
        concurrent handlers. Do it in middleware and expose the forked EM on{" "}
        <code>state</code>.
      </p>
      <FlowDiagram
        numbered
        title="A forked EntityManager per request"
        caption="The plugin decorates one root ORM at startup. A beforeHandle hook forks a fresh EntityManager for each request onto state.em, so the identity map and unit-of-work state stay isolated, then a single flush() (or transactional()) persists the changes."
        steps={[
          {
            eyebrow: "startup",
            label: "Root ORM",
            detail: "state.orm = await MikroORM.init(...)",
            tone: "muted",
          },
          {
            eyebrow: "beforeHandle",
            label: "Fork per request",
            detail: "state.em = state.orm.em.fork()",
            tone: "accent",
          },
          {
            eyebrow: "handler",
            label: "Scoped queries",
            detail: "state.em.create / findOne",
          },
          {
            eyebrow: "unit of work",
            label: "Persist on flush",
            detail: "await state.em.flush()",
            tone: "success",
          },
        ]}
      />
      <CodeBlock
        code={`// src/db/middleware.ts
import type { Hooks } from "@daloyjs/core";

export function requestEntityManager(): Hooks {
  return {
    beforeHandle(ctx) {
      ctx.state.em = ctx.state.orm.em.fork();
    },
  };
}`}
      />
      <p>
        In Express-style middleware you will often see{" "}
        <code>RequestContext.create(orm.em, next)</code>. Daloy hooks pass typed
        request state directly, so the simplest pattern is to use the forked{" "}
        <code>state.em</code> inside handlers.
      </p>

      <h2 id="6-augment-app-state-types">6. Augment app state types</h2>
      <CodeBlock
        code={`// src/types/state.d.ts
import type { MikroORM, EntityManager } from "@mikro-orm/postgresql";

declare module "@daloyjs/core" {
  interface AppState {
    orm: MikroORM;
    em: EntityManager;
  }
}`}
      />

      <h2 id="7-use-the-entitymanager-in-routes">7. Use the EntityManager in routes</h2>
      <CodeBlock
        code={`// src/server.ts
import { z } from "zod";
import { App } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { mikroOrmPlugin } from "./db/plugin";
import { requestEntityManager } from "./db/middleware";
import { User } from "./db/entities/User";

const app = new App();
app.register(mikroOrmPlugin);
app.use(requestEntityManager());

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
    const user = await state.em.findOne(User, { id: params.id });
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
    const user = state.em.create(User, { email: body.email, name: body.name ?? null });
    await state.em.flush();
    return { status: 201, body: user };
  },
});

await app.ready();
serve(app, { port: 3000 });`}
      />
      <p>
        MikroORM batches every change in the forked EM into a single{" "}
        <code>flush()</code>. You almost never need to call{" "}
        <code>persist()</code> manually when using <code>em.create()</code>,
        which auto-persists in v6+. Entities created with{" "}
        <code>new User()</code> still need <code>em.persist()</code>.
      </p>

      <h2 id="transactions">Transactions</h2>
      <p>
        Use <code>em.transactional()</code> inside the handler that owns the
        unit of work. The callback receives a transactional EM that commits on
        success and rolls back if you throw.
      </p>
      <CodeBlock
        code={`handler: async ({ body, state }) => {
  const order = await state.em.transactional(async (em) => {
    const created = em.create(Order, body);
    const inventory = await em.findOneOrFail(Inventory, { sku: body.sku });
    inventory.stock -= body.qty;
    return created;
  });
  return { status: 201, body: order };
}`}
      />

      <h2 id="migrations">Migrations</h2>
      <p>
        The CLI is installed as a dev dependency and reads{" "}
        <code>src/mikro-orm.config.ts</code> by default. If you move the config
        under <code>src/db</code>, pass <code>--config</code> or configure
        <code>mikro-orm.configPaths</code> in <code>package.json</code>.
      </p>
      <CodeBlock
        code={`# generate a migration from the current entity diff
pnpm mikro-orm migration:create

# apply all pending migrations
pnpm mikro-orm migration:up

# list pending migrations
pnpm mikro-orm migration:pending

# inspect the resolved CLI config
pnpm mikro-orm debug`}
      />

      <h2 id="errors">Errors</h2>
      <p>
        Translate MikroORM errors into framework errors so they serialize as{" "}
        <Link href="/docs/errors">problem+json</Link>:
      </p>
      <CodeBlock
        code={`import { HttpError } from "@daloyjs/core";
import { UniqueConstraintViolationException, NotFoundError } from "@mikro-orm/core";

try {
  const user = state.em.create(User, { email: body.email, name: body.name ?? null });
  await state.em.flush();
  return { status: 201, body: user };
} catch (err) {
  if (err instanceof UniqueConstraintViolationException) {
    throw new HttpError(409, {
      title: "User already exists",
      type: "https://daloyjs.dev/errors/duplicate",
    });
  }
  if (err instanceof NotFoundError) {
    throw new HttpError(404, { title: "Not found" });
  }
  throw err;
}`}
      />

      <h2 id="runtime-notes">Runtime notes</h2>
      <ul>
        <li>
          MikroORM is a Node.js adapter default for Daloy apps. Edge runtimes
          require precompiled MikroORM functions plus a compatible driver, so
          most Cloudflare Workers and Vercel apps should start with{" "}
          <Link href="/docs/orm/drizzle">Drizzle</Link> or{" "}
          <Link href="/docs/orm/supabase">Supabase</Link> instead.
        </li>
        <li>
          Always fork the EM per request. Sharing the root EM across requests
          will leak the identity map and corrupt unit-of-work state.
        </li>
        <li>
          Keep <code>@mikro-orm/core</code>, your driver package, the CLI, and{" "}
          <code>@mikro-orm/migrations</code> on the same version.
        </li>
      </ul>

      <p>
        Compare with <Link href="/docs/orm/prisma">Prisma</Link>,{" "}
        <Link href="/docs/orm/drizzle">Drizzle</Link>,{" "}
        <Link href="/docs/orm/typeorm">TypeORM</Link>,{" "}
        <Link href="/docs/orm/sequelize">Sequelize</Link>, or the{" "}
        <Link href="/docs/odm">ODM overview</Link> if you need document models.
      </p>
    </>
  );
}
