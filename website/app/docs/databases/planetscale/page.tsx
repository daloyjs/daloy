import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";
import { LayerStack } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Use PlanetScale with DaloyJS",
  description:
    "Connect a DaloyJS API to PlanetScale MySQL using @planetscale/database, an HTTP driver that works on Cloudflare Workers, Node.js, Bun, and Deno.",
  path: "/docs/databases/planetscale",
  keywords: [
    "PlanetScale DaloyJS",
    "@planetscale/database",
    "PlanetScale Cloudflare Workers",
    "PlanetScale Vercel",
    "PlanetScale Drizzle",
    "PlanetScale branching",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Use PlanetScale with DaloyJS</h1>
      <p>
        <a href="https://planetscale.com" target="_blank" rel="noreferrer">
          PlanetScale
        </a>{" "}
        is a managed MySQL host built around Vitess, branching, deploy requests,
        and a fetch-based HTTP driver. Because{" "}
        <code>@planetscale/database</code> uses plain <code>fetch</code>, it
        runs on every runtime DaloyJS supports, including Cloudflare Workers and
        Vercel. If you are using PlanetScale Postgres, follow the{" "}
        <Link href="/docs/databases/neon">Neon</Link> driver pattern instead.
      </p>

      <LayerStack
        title="One HTTP driver, every runtime"
        caption="Because @planetscale/database speaks plain fetch instead of a raw TCP socket, the same data-access code runs on every runtime DaloyJS targets, including Cloudflare Workers."
        layers={[
          {
            title: "DaloyJS route",
            detail: "handler reads state.db",
            tone: "accent",
            items: ['app.decorate("db", db)', "db.execute(sql, params)"],
          },
          {
            title: "@planetscale/database",
            detail: "fetch-based HTTP driver",
            items: ["Node", "Bun", "Deno", "Workers"],
          },
          {
            title: "PlanetScale",
            detail: "managed MySQL on Vitess",
            tone: "muted",
            items: ["branches", "deploy requests"],
          },
        ]}
      />

      <h2 id="1-provision-and-grab-credentials">1. Provision and grab credentials</h2>
      <p>
        Create a database at{" "}
        <a href="https://app.planetscale.com" target="_blank" rel="noreferrer">
          app.planetscale.com
        </a>
        , generate a password, and copy the host plus credentials. Set them as{" "}
        <code>DATABASE_HOST</code>, <code>DATABASE_USERNAME</code>, and{" "}
        <code>DATABASE_PASSWORD</code>.
      </p>

      <h2 id="2-install">2. Install</h2>
      <CodeBlock code={`pnpm add @planetscale/database`} />

      <h2 id="3-create-a-planetscale-plugin">3. Create a PlanetScale plugin</h2>
      <CodeBlock
        code={`// src/db/planetscale.ts
    import { connect } from "@planetscale/database";
import type { App } from "@daloyjs/core";

    export const db = connect({
  host: process.env.DATABASE_HOST!,
  username: process.env.DATABASE_USERNAME!,
  password: process.env.DATABASE_PASSWORD!,
});
    export type Db = typeof db;

export const planetscalePlugin = {
  name: "planetscale",
  register(app: App) {
    app.decorate("db", db);
  },
};`}
      />

      <h2 id="4-augment-app-state">4. Augment app state</h2>
      <CodeBlock
        code={`// src/types/state.d.ts
import type { Db } from "../db/planetscale";

declare module "@daloyjs/core" {
  interface AppState {
    db: Db;
  }
}`}
      />

      <h2 id="5-use-it-in-a-route">5. Use it in a route</h2>
      <CodeBlock
        code={`import { z } from "zod";
import { App, secureHeaders } from "@daloyjs/core";
import { planetscalePlugin } from "./db/planetscale";

const app = new App();
app.use(secureHeaders());
app.register(planetscalePlugin);

const UserSchema = z.object({ id: z.string(), email: z.email() });

app.route({
  method: "GET",
  path: "/users/:id",
  operationId: "getUser",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: "Found", body: UserSchema },
    404: { description: "Not found" },
  },
  handler: async ({ params, state }) => {
    const result = await state.db.execute(
      "select id, email from users where id = ? limit 1",
      [params.id],
    );
    const row = result.rows[0] as { id: string; email: string } | undefined;
    return row
      ? { status: 200, body: row }
      : { status: 404, body: { type: "about:blank", title: "Not found", status: 404 } };
  },
});`}
      />

      <h2 id="cloudflare-workers">Cloudflare Workers</h2>
      <p>
        Construct the connection inside the worker handler so it picks up the
        binding from <code>env</code>, then call <code>app.fetch(req)</code>. If
        your app does not need worker bindings, you can export the standard{" "}
        <Link href="/docs/adapters">Cloudflare adapter</Link>
        directly.
      </p>
      <CodeBlock
        code={`import { connect } from "@planetscale/database";

export default {
  async fetch(
    req: Request,
    env: { DATABASE_HOST: string; DATABASE_USERNAME: string; DATABASE_PASSWORD: string },
  ) {
    const db = connect({
      host: env.DATABASE_HOST,
      username: env.DATABASE_USERNAME,
      password: env.DATABASE_PASSWORD,
    });
    app.decorate("db", db);
    return app.fetch(req);
  },
};`}
      />

      <h2 id="with-drizzle-orm">With Drizzle ORM</h2>
      <CodeBlock
        code={`pnpm add drizzle-orm
// src/db/drizzle.ts
import { drizzle } from "drizzle-orm/planetscale-serverless";

export const db = drizzle({
  connection: {
    host: process.env.DATABASE_HOST!,
    username: process.env.DATABASE_USERNAME!,
    password: process.env.DATABASE_PASSWORD!,
  },
});
`}
      />

      <h2 id="with-prisma">With Prisma</h2>
      <p>
        Use the{" "}
        <a
          href="https://www.prisma.io/docs/orm/overview/databases/planetscale"
          target="_blank"
          rel="noreferrer"
        >
          PlanetScale Driver Adapter
        </a>{" "}
        (GA since Prisma <code>6.16.0</code>). PlanetScale disables foreign-key
        constraints by default on MySQL unless you enable them in database
        settings, so set <code>relationMode = &quot;prisma&quot;</code>
        in your <code>schema.prisma</code> when you are using the default no-FK
        mode, and point <code>DATABASE_URL</code> at the serverless host (
        <code>aws.connect.psdb.cloud</code>).
      </p>
      <CodeBlock
        code={`pnpm add @prisma/adapter-planetscale
// src/db/prisma.ts
import { PrismaClient } from "@prisma/client";
import { PrismaPlanetScale } from "@prisma/adapter-planetscale";

const adapter = new PrismaPlanetScale({ url: process.env.DATABASE_URL! });
export const prisma = new PrismaClient({ adapter });`}
      />
      <p>
        On Node.js versions older than 18 (no global <code>fetch</code>),
        install <code>undici</code> and pass{" "}
        <code>{`{ fetch: undiciFetch }`}</code> as a second option.
      </p>

      <h2 id="branching-and-deploy-requests">Branching &amp; deploy requests</h2>
      <p>
        PlanetScale&apos;s schema workflow uses branches and deploy requests
        rather than ad-hoc <code>ALTER TABLE</code>. Pair this with your CI: run
        migrations against a development branch, open a deploy request, and
        merge to <code>main</code>. The same Daloy app code works against any
        branch, just swap the host.
      </p>

      <p>
        See also <Link href="/docs/databases/neon">Neon</Link>,{" "}
        <Link href="/docs/orm/supabase">Supabase</Link>, and the{" "}
        <Link href="/docs/databases">database hosting overview</Link>.
      </p>
    </>
  );
}
