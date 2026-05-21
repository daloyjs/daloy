import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Use Prisma with DaloyJS",
  description:
    "Connect DaloyJS to PostgreSQL, MySQL, or SQLite using Prisma. Schema-first models, migrations, and a typed client wired into your contract-first routes.",
  path: "/docs/orm/prisma",
  keywords: [
    "Prisma DaloyJS",
    "Prisma TypeScript framework",
    "Prisma plugin",
    "Prisma transactions",
    "Prisma edge",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Use Prisma with DaloyJS</h1>
      <p>
        <a href="https://www.prisma.io" target="_blank" rel="noreferrer">
          Prisma
        </a>{" "}
        is a schema-first ORM with first-class migrations and a generated, fully
        typed client. It pairs well with DaloyJS&apos;s{" "}
        <Link href="/docs/routing">contract-first routes</Link>: Zod validates
        the wire, Prisma validates the database.
      </p>

      <h2>1. Install</h2>
      <CodeBlock
        code={`pnpm add @prisma/client @prisma/adapter-pg dotenv
pnpm add -D prisma
pnpm prisma init --datasource-provider postgresql`}
      />

      <h2>2. Define your schema</h2>
      <CodeBlock
        code={`// prisma/schema.prisma
datasource db {
  provider = "postgresql"
}

generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

model User {
  id    String @id @default(uuid())
  email String @unique
  name  String?
}`}
      />
      <CodeBlock
        code={`// prisma.config.ts
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: env("DATABASE_URL"),
  },
});`}
      />
      <p>
        Prisma&apos;s current{" "}
        <a
          href="https://www.prisma.io/docs/orm/prisma-schema/overview/generators#prisma-client"
          target="_blank"
          rel="noreferrer"
        >
          <code>prisma-client</code>
        </a>{" "}
        generator writes the client to the configured output path. Connection
        URLs live in <code>prisma.config.ts</code>, and application code imports{" "}
        <code>PrismaClient</code> from the generated path instead of{" "}
        <code>@prisma/client</code>.
      </p>
      <CodeBlock
        code={`pnpm prisma migrate dev --name init
pnpm prisma generate`}
      />

      <h2>3. Create a Prisma plugin</h2>
      <p>
        Instantiate one <code>PrismaClient</code> per process, decorate the app,
        and disconnect on shutdown.
      </p>
      <CodeBlock
        code={`// src/db/prisma.ts
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import type { App } from "@daloyjs/core";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
export const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === "production" ? ["error"] : ["query", "error"],
});

export const prismaPlugin = {
  name: "prisma",
  async register(app: App) {
    await prisma.$connect();
    app.decorate("db", prisma);
    app.onClose(async () => {
      await prisma.$disconnect();
    });
  },
};`}
      />

      <h2>4. Augment app state types</h2>
      <CodeBlock
        code={`// src/types/state.d.ts
import type { PrismaClient } from "../generated/prisma/client";

declare module "@daloyjs/core" {
  interface AppState {
    db: PrismaClient;
  }
}`}
      />

      <h2>5. Wire the plugin and route</h2>
      <CodeBlock
        code={`// src/server.ts
import { z } from "zod";
import { App, secureHeaders, requestId } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { prismaPlugin } from "./db/prisma";

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
});

const app = new App();
app.use(requestId());
app.use(secureHeaders());
app.register(prismaPlugin);

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
    const user = await state.db.user.findUnique({ where: { id: params.id } });
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
  handler: async ({ body, state }) => ({
    status: 201,
    body: await state.db.user.create({ data: body }),
  }),
});

await app.ready();
serve(app, { port: 3000 });`}
      />

      <h2>Transactions</h2>
      <p>
        Use <code>$transaction</code> for atomic units of work. Throwing inside
        the callback rolls back; a successful return commits.
      </p>
      <CodeBlock
        code={`handler: async ({ body, state }) => {
  const order = await state.db.$transaction(async (tx) => {
    const created = await tx.order.create({ data: { sku: body.sku, qty: body.qty } });
    await tx.inventory.update({
      where: { sku: body.sku },
      data: { stock: { decrement: body.qty } },
    });
    return created;
  });
  return { status: 201, body: order };
}`}
      />

      <h2>Edge runtimes</h2>
      <p>
        For Cloudflare Workers and Vercel Edge, set the generated client runtime
        for your target and use the appropriate{" "}
        <a
          href="https://www.prisma.io/docs/orm/overview/databases/database-drivers"
          target="_blank"
          rel="noreferrer"
        >
          Prisma Driver Adapter
        </a>{" "}
        (Neon, PlanetScale, D1, etc.).
      </p>
      <CodeBlock
        code={`// prisma/schema.prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
  runtime  = "vercel-edge" // use "workerd" for Cloudflare Workers
}

// src/db/prisma-edge.ts
import { PrismaClient } from "../generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: env.DATABASE_URL });
export const prisma = new PrismaClient({ adapter });`}
      />

      <h2>Mapping errors to problem+json</h2>
      <CodeBlock
        code={`import { Prisma } from "../generated/prisma/client";
import { HttpError } from "@daloyjs/core";

try {
  return await state.db.user.create({ data: body });
} catch (err) {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw new HttpError(409, { title: "Email already in use" });
  }
  throw err;
}`}
      />

      <p>
        Continue with <Link href="/docs/orm/drizzle">Drizzle</Link>,{" "}
        <Link href="/docs/orm/typeorm">TypeORM</Link>,{" "}
        <Link href="/docs/orm/mikro-orm">MikroORM</Link>,{" "}
        <Link href="/docs/orm/sequelize">Sequelize</Link>, or the{" "}
        <Link href="/docs/odm">ODM overview</Link> for document databases.
      </p>
      <p>
        For serverless or edge deployments, see the{" "}
        <Link href="/docs/databases">database hosting overview</Link> — Prisma
        supports <Link href="/docs/databases/neon">Neon</Link>,{" "}
        <Link href="/docs/databases/planetscale">PlanetScale</Link>, and{" "}
        <Link href="/docs/databases/cloudflare-d1">Cloudflare D1</Link> through
        Driver Adapters.
      </p>
    </>
  );
}
