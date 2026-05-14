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
        is a schema-first ORM with first-class migrations and a generated, fully typed client. It pairs well
        with DaloyJS&apos;s <Link href="/docs/routing">contract-first routes</Link>: Zod validates the wire,
        Prisma validates the database.
      </p>

      <h2>1. Install</h2>
      <CodeBlock
        code={`pnpm add @prisma/client
pnpm add -D prisma
pnpm prisma init --datasource-provider postgresql`}
      />

      <h2>2. Define your schema</h2>
      <CodeBlock
        code={`// prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id    String @id @default(uuid())
  email String @unique
  name  String?
}`}
      />
      <CodeBlock code={`pnpm prisma migrate dev --name init`} />

      <h2>3. Create a Prisma plugin</h2>
      <p>
        Instantiate one <code>PrismaClient</code> per process, decorate the app, and disconnect on shutdown.
      </p>
      <CodeBlock
        code={`// src/db/prisma.ts
import { PrismaClient } from "@prisma/client";
import type { App } from "@daloyjs/core";

export const prisma = new PrismaClient({
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
import type { PrismaClient } from "@prisma/client";

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
        Use <code>$transaction</code> for atomic units of work. Throwing inside the callback rolls back; a
        successful return commits.
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
        For Cloudflare Workers and Vercel Edge, use the appropriate{" "}
        <a
          href="https://www.prisma.io/docs/orm/overview/databases/database-drivers"
          target="_blank"
          rel="noreferrer"
        >
          Prisma Driver Adapter
        </a>{" "}
        (Neon, PlanetScale, D1, etc.) instead of the default Node binary engine.
      </p>
      <CodeBlock
        code={`import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { Pool } from "@neondatabase/serverless";

const pool = new Pool({ connectionString: env.DATABASE_URL });
const adapter = new PrismaNeon(pool);
export const prisma = new PrismaClient({ adapter });`}
      />

      <h2>Mapping errors to problem+json</h2>
      <CodeBlock
        code={`import { Prisma } from "@prisma/client";
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
        <Link href="/docs/orm/typeorm">TypeORM</Link>, or <Link href="/docs/orm/supabase">Supabase</Link>.
      </p>
    </>
  );
}
