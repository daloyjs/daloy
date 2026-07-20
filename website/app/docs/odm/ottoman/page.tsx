import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";
import { FlowDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Use Ottoman with DaloyJS",
  description:
    "Connect DaloyJS to Couchbase using Ottoman. Define document schemas and models, inject them through a plugin, and keep Couchbase-specific work isolated from handlers.",
  path: "/docs/odm/ottoman",
  keywords: [
    "Ottoman DaloyJS",
    "Couchbase DaloyJS",
    "Ottoman TypeScript",
    "Couchbase ODM",
    "Ottoman ODM",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Use Ottoman with DaloyJS</h1>
      <p>
        <a href="https://ottomanjs.com" target="_blank" rel="noreferrer">
          Ottoman
        </a>{" "}
        is an ODM for Couchbase. Use it when your application stores JSON
        documents in Couchbase buckets, scopes, and collections and you want
        model definitions, validation, query helpers, and indexes around that
        document layer.
      </p>

      <FlowDiagram
        title="Ottoman setup"
        numbered
        steps={[
          { label: "Install", detail: "pnpm add ottoman couchbase" },
          { label: "Schema & model", detail: "new Schema · model('User')" },
          {
            label: "Plugin",
            detail: "connect · start · decorate('db')",
            tone: "accent",
          },
          { label: "Augment state", detail: "interface AppState { db }" },
          {
            label: "Use in routes",
            detail: "state.db.User.findById()",
            tone: "success",
          },
        ]}
        caption="Ottoman connects once and runs ottoman.start() to build indexes before traffic arrives. Handlers then read the decorated state.db model surface."
      />

      <h2 id="1-install">1. Install</h2>
      <CodeBlock code={`pnpm add ottoman couchbase`} />

      <h2 id="2-define-a-schema-and-model">2. Define a schema and model</h2>
      <CodeBlock
        code={`// src/db/ottoman.ts
import { Ottoman, Schema, model } from "ottoman";

export const ottoman = new Ottoman({
  collectionName: "users",
});

const userSchema = new Schema({
  email: { type: String, required: true },
  name: { type: String, required: false },
});

userSchema.index.findByEmail = {
  by: "email",
  type: "n1ql",
};

export const User = model("User", userSchema);
export const db = { ottoman, User };`}
      />

      <h2 id="3-create-an-ottoman-plugin">3. Create an Ottoman plugin</h2>
      <p>
        Connect once during app startup, build indexes with{" "}
        <code>ottoman.start()</code>
        {", "}decorate the app with the models you want handlers to use, and
        close the connection on shutdown.
      </p>
      <CodeBlock
        code={`// src/db/plugin.ts
import type { App } from "@daloyjs/core";
import { db, ottoman } from "./ottoman.ts";

export const ottomanPlugin = {
  name: "ottoman",
  async register(app: App) {
    await ottoman.connect({
      connectionString: process.env.COUCHBASE_CONNECTION_STRING!,
      bucketName: process.env.COUCHBASE_BUCKET!,
      username: process.env.COUCHBASE_USERNAME!,
      password: process.env.COUCHBASE_PASSWORD!,
    });

    await ottoman.start();
    app.decorate("db", db);

    app.onClose(async () => {
      await ottoman.close();
    });
  },
};`}
      />

      <h2 id="4-augment-app-state-types">4. Augment app state types</h2>
      <p>
        Add the <code>declare module</code> block to the same module that
        exports <code>db</code>
        {", "}not to a separate <code>.d.ts</code> file. Declaration files are
        exempt from type-checking when <code>skipLibCheck</code> is on (the
        scaffolded default), so a broken import inside a <code>.d.ts</code>{" "}
        fails silently and <code>state.db</code> quietly degrades to{" "}
        <code>any</code>.
      </p>
      <CodeBlock
        code={`// src/db/ottoman.ts (the module that exports db)
declare module "@daloyjs/core" {
  interface AppState {
    db: typeof db;
  }
}`}
      />

      <h2 id="5-use-it-in-routes">5. Use it in routes</h2>
      <CodeBlock
        code={`// src/server.ts
import { z } from "zod";
import { App, HttpError } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { ottomanPlugin } from "./db/plugin.ts";

const UserSchema = z.object({
  id: z.string(),
  email: z.email(),
  name: z.string().nullable(),
});

const app = new App();
app.register(ottomanPlugin);

app.get(
  "/users/:id",
  {
    operationId: "getUser",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: "Found", body: UserSchema },
      404: { description: "Not found" },
    },
  },
  async ({ params, state }) => {
    const user = await state.db.User.findById(params.id);
    if (!user) {
      throw new HttpError(404, { title: "User not found" });
    }

    return {
      status: 200,
      body: {
        id: user.id,
        email: user.email,
        name: user.name ?? null,
      },
    };
  },
);

await app.ready();
serve(app, { port: 3000 });`}
      />

      <h2 id="indexes-and-queries">Indexes and queries</h2>
      <p>
        Define indexes next to the schema and run <code>ottoman.start()</code>{" "}
        during startup so query helpers are ready before the server accepts
        traffic. Keep index creation out of request handlers.
      </p>
      <CodeBlock
        code={`app.get(
  "/users/by-email/:email",
  {
    operationId: "getUserByEmail",
    request: { params: z.object({ email: z.email() }) },
    responses: { 200: { description: "Found", body: UserSchema } },
  },
  async ({ params, state }) => {
    const user = await state.db.User.findOne({ email: params.email });
    if (!user) {
      throw new HttpError(404, { title: "User not found" });
    }
    return { status: 200, body: { id: user.id, email: user.email, name: user.name ?? null } };
  },
);`}
      />

      <h2 id="transactions">Transactions</h2>
      <p>
        Ottoman is best for model-centric Couchbase document access. If a
        workflow requires Couchbase distributed transactions, expose the
        Couchbase SDK objects you need through the same plugin and keep that
        transaction boundary inside the handler that owns the unit of work.
      </p>

      <h2 id="runtime-constraints">Runtime constraints</h2>
      <p>
        Ottoman depends on the Couchbase Node.js SDK, so it is a Node.js-first
        ODM. It is not a fit for Cloudflare Workers. For edge-compatible data
        access, use the <Link href="/docs/orm">SQL ORM overview</Link> and
        choose a compatible client.
      </p>

      <p>
        Compare with <Link href="/docs/odm/mongoose">Mongoose</Link> for
        MongoDB, <Link href="/docs/orm/prisma">Prisma</Link> for SQL, or return
        to the <Link href="/docs/odm">ODM overview</Link>.
      </p>
    </>
  );
}
