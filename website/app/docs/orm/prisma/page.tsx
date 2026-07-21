import type { Route } from "next";
import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";
import { FlowDiagram } from "../../../../components/diagram";

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
        <Link href="/docs/routing">contract-first routes</Link>
        {": "}Zod validates the wire, Prisma validates the database.
      </p>

      <FlowDiagram
        numbered
        title="One request through Prisma"
        caption="Zod validates the request before your handler runs, Prisma runs the typed query off state.db, and the result is checked against the response schema on the way out. Two validation layers guard the wire and the database."
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
            eyebrow: "prisma",
            label: "Typed query",
            detail: "state.db.user.findUnique(...)",
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
        code={`pnpm add @prisma/client @prisma/adapter-pg dotenv
pnpm add -D prisma
pnpm prisma init --datasource-provider postgresql`}
      />

      <h2 id="2-define-your-schema">2. Define your schema</h2>
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
        URLs live in <code>prisma.config.ts</code>
        {", "}and application code imports <code>PrismaClient</code> from the
        generated path instead of <code>@prisma/client</code>.
      </p>
      <CodeBlock
        code={`pnpm prisma migrate dev --name init
pnpm prisma generate`}
      />

      <h2 id="3-create-a-prisma-plugin">3. Create a Prisma plugin</h2>
      <p>
        Instantiate one <code>PrismaClient</code> per process, decorate the app,
        and disconnect on shutdown.
      </p>
      <CodeBlock
        code={`// src/db/prisma.ts
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";
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

      <h2 id="4-augment-app-state-types">4. Augment app state types</h2>
      <p>
        Add the <code>declare module</code> block to the same module that
        creates the client, not to a separate <code>.d.ts</code> file.
        Declaration files are exempt from type-checking when{" "}
        <code>skipLibCheck</code> is on (the scaffolded default), so a broken
        import inside a <code>.d.ts</code> fails silently and{" "}
        <code>state.db</code> quietly degrades to <code>any</code>.
      </p>
      <CodeBlock
        code={`// src/db/prisma.ts (same module as the plugin above)
declare module "@daloyjs/core" {
  interface AppState {
    db: PrismaClient;
  }
}`}
      />

      <h2 id="5-wire-the-plugin-and-route">5. Wire the plugin and route</h2>
      <p>
        <strong>
          The route below demonstrates Prisma wiring, not ownership.
        </strong>{" "}
        If a record is user-owned or tenant-owned, do not query by URL ID alone.
        Constrain the same query with the trusted principal and follow the{" "}
        <Link href={"/docs/security/resource-authorization" as Route}>
          resource authorization guide</Link>
        {"."}
      </p>
      <CodeBlock
        code={`// src/server.ts
import { z } from "zod";
import { App, secureHeaders, requestId } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { prismaPlugin } from "./db/prisma.ts";

const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().nullable(),
});

const app = new App();
app.use(requestId());
app.use(secureHeaders());
app.register(prismaPlugin);

app.get(
  "/users/:id",
  {
    operationId: "getUser",
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: { description: "Found", body: UserSchema },
      404: { description: "Not found" },
    },
  },
  async ({ params, state }) => {
    const user = await state.db.user.findUnique({ where: { id: params.id } });
    return user
      ? { status: 200, body: user }
      : { status: 404, body: { type: "about:blank", title: "Not found", status: 404 } };
  },
);

app.post(
  "/users",
  {
    operationId: "createUser",
    request: { body: z.object({ email: z.email(), name: z.string().optional() }) },
    responses: { 201: { description: "Created", body: UserSchema } },
  },
  async ({ body, state }) => ({
    status: 201,
    body: await state.db.user.create({ data: body }),
  }),
);

await app.ready();
serve(app, { port: 3000 });`}
      />

      <h2 id="transactions">Transactions</h2>
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

      <h2 id="edge-runtimes">Edge runtimes</h2>
      <p>
        For Cloudflare Workers, set the generated client runtime for your target
        and use the appropriate{" "}
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
  runtime  = "deno" // use "workerd" for Cloudflare Workers
}

// src/db/prisma-edge.ts
import { PrismaClient } from "../generated/prisma/client.ts";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: env.DATABASE_URL });
export const prisma = new PrismaClient({ adapter });`}
      />

      <h2 id="operator-injection-validate-your-filter-shapes">
        Operator injection: validate your filter shapes
      </h2>
      <p>
        Prisma always emits parameterized SQL, but the <em>filter object</em>{" "}
        you pass to <code>where</code> is interpreted by Prisma. If a field
        annotated as <code>string</code> arrives at runtime as an object like{" "}
        <code>{`{ "not": "" }`}</code>
        {", "}Prisma treats it as an operator and an attacker can bypass
        equality checks, the &ldquo;NoSQL-injection-in-Prisma&rdquo; pattern{" "}
        <a
          href="https://www.aikido.dev/blog/prisma-and-postgresql-vulnerable-to-nosql-injection"
          target="_blank"
          rel="noreferrer"
        >
          documented by Aikido</a>
        {". "}Daloy&apos;s contract-first routes neutralize this when you keep
        the request body typed with primitive Zod schemas (<code>z.string()</code>
        {", "}
        <code>z.number()</code>
        {", "} &hellip;) instead of <code>z.any()</code>
        {", "}
        <code>z.unknown()</code>
        {", "}or a pass-through <code>z.record()</code>
        {". "}See{" "}
        <Link href="/docs/security/sql-injection">
          Security &rarr; SQL injection
        </Link>{" "}
        for the full pattern and review-time rules.
      </p>

      <h2 id="mapping-errors-to-problem-json">
        Mapping errors to problem+json
      </h2>
      <CodeBlock
        code={`import { Prisma } from "../generated/prisma/client.ts";
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
        Continue with <Link href="/docs/orm/drizzle">Drizzle</Link>
        {", "}
        <Link href="/docs/orm/typeorm">TypeORM</Link>
        {", "}
        <Link href="/docs/orm/mikro-orm">MikroORM</Link>
        {", "}
        <Link href="/docs/orm/sequelize">Sequelize</Link>
        {", "}or the <Link href="/docs/odm">ODM overview</Link> for document
        databases.
      </p>
      <p>
        For serverless or edge deployments, see the{" "}
        <Link href="/docs/databases">database hosting overview</Link>
        {": "}Prisma supports <Link href="/docs/databases/neon">Neon</Link>
        {", "}
        <Link href="/docs/databases/planetscale">PlanetScale</Link>
        {", "}and{" "}
        <Link href="/docs/databases/cloudflare-d1">Cloudflare D1</Link> through
        Driver Adapters.
      </p>
    </>
  );
}
