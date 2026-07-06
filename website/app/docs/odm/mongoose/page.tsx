import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";
import { FlowDiagram, SequenceDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Use Mongoose with DaloyJS",
  description:
    "Connect DaloyJS to MongoDB using Mongoose. Define schemas and models, inject them through a plugin, and use sessions for transactional workflows.",
  path: "/docs/odm/mongoose",
  keywords: [
    "Mongoose DaloyJS",
    "MongoDB DaloyJS",
    "Mongoose TypeScript",
    "Mongoose sessions",
    "Mongoose ODM",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Use Mongoose with DaloyJS</h1>
      <p>
        <a href="https://mongoosejs.com" target="_blank" rel="noreferrer">
          Mongoose
        </a>{" "}
        is the default ODM choice for MongoDB teams who want schemas, model middleware, casting, validation,
        and transactions through sessions. It fits naturally into DaloyJS when you register the connection once
        and expose a small model surface on <code>state</code>.
      </p>

      <FlowDiagram
        title="Mongoose setup"
        numbered
        steps={[
          { label: "Install", detail: "pnpm add mongoose" },
          { label: "Schema & model", detail: "new Schema · model('User')" },
          { label: "Plugin", detail: "connect · decorate('db') · onClose", tone: "accent" },
          { label: "Augment state", detail: "interface AppState { db }" },
          { label: "Use in routes", detail: "state.db.User.findById()", tone: "success" },
        ]}
        caption="The connection happens once inside the plugin. After you augment AppState, handlers get a fully typed state.db model surface."
      />

      <h2 id="1-install">1. Install</h2>
      <CodeBlock code={`pnpm add mongoose`} />

      <h2 id="2-define-a-schema-and-model">2. Define a schema and model</h2>
      <CodeBlock
        code={`// src/db/mongoose.ts
import mongoose, { InferSchemaType, model, Schema } from "mongoose";

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true },
    name: { type: String, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export type UserDocument = InferSchemaType<typeof userSchema> & { _id: string };
export const User = model("User", userSchema);

export const connection = mongoose;
export const db = { connection, User };`}
      />

      <h2 id="3-create-a-mongoose-plugin">3. Create a Mongoose plugin</h2>
      <CodeBlock
        code={`// src/db/plugin.ts
import type { App } from "@daloyjs/core";
import { connection, db } from "./mongoose.ts";

export const mongoosePlugin = {
  name: "mongoose",
  async register(app: App) {
    await connection.connect(process.env.MONGODB_URI!);
    app.decorate("db", db);
    app.onClose(async () => {
      await connection.disconnect();
    });
  },
};`}
      />

      <h2 id="4-augment-app-state-types">4. Augment app state types</h2>
      <p>
        Add the <code>declare module</code> block to the same module that
        exports <code>db</code>, not to a separate <code>.d.ts</code> file.
        Declaration files are exempt from type-checking when{" "}
        <code>skipLibCheck</code> is on (the scaffolded default), so a broken
        import inside a <code>.d.ts</code> fails silently and{" "}
        <code>state.db</code> quietly degrades to <code>any</code>.
      </p>
      <CodeBlock
        code={`// src/db/mongoose.ts (the module that exports db)
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
import { mongoosePlugin } from "./db/plugin.ts";

const UserSchema = z.object({
  id: z.string(),
  email: z.email(),
  name: z.string().nullable(),
});

const app = new App();
app.register(mongoosePlugin);

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
    const user = await state.db.User.findById(params.id).lean();
    if (!user) {
      throw new HttpError(404, { title: "User not found" });
    }

    return {
      status: 200,
      body: {
        id: String(user._id),
        email: user.email,
        name: user.name ?? null,
      },
    };
  },
});

await app.ready();
serve(app, { port: 3000 });`}
      />

      <h2 id="sessions-and-transactions">Sessions and transactions</h2>
      <p>
        Use MongoDB sessions for multi-document transactions. Start the session inside the handler and thread it
        through every model call in the unit of work.
      </p>

      <SequenceDiagram
        title="Session-scoped transaction"
        participants={["Handler", "Session", "Models"]}
        steps={[
          {
            from: "Handler",
            to: "Session",
            label: "Start a session",
            detail: "startSession()",
            kind: "request",
          },
          {
            from: "Handler",
            to: "Models",
            label: "Run every write inside withTransaction",
            detail: "User.create([...], { session })",
            kind: "request",
          },
          {
            from: "Session",
            to: "Handler",
            label: "Commit on success, roll back on throw",
            kind: "response",
          },
          {
            from: "Handler",
            to: "Session",
            label: "Always end the session in finally",
            detail: "endSession()",
            kind: "note",
          },
        ]}
        caption="The session is opened once, threaded through every model call, and ended in a finally block so it closes whether the transaction commits or rolls back."
      />

      <CodeBlock
        code={`handler: async ({ body, state }) => {
  const session = await state.db.connection.startSession();

  try {
    let createdUser: unknown;
    await session.withTransaction(async () => {
      const [user] = await state.db.User.create([{ email: body.email, name: body.name }], { session });
      createdUser = user.toObject();
      await state.db.AuditLog.create([{ action: "user.created", userId: user.id }], { session });
    });

    return { status: 201, body: createdUser };
  } finally {
    await session.endSession();
  }
}`}
      />

      <h2 id="validation-and-errors">Validation and errors</h2>
      <p>
        Keep transport validation in Zod and let Mongoose own document-level validation. Translate duplicate key
        or cast failures into DaloyJS errors so they serialize as problem+json.
      </p>
      <CodeBlock
        code={`import { HttpError } from "@daloyjs/core";

try {
  const created = await state.db.User.create(body);
  return { status: 201, body: created.toObject() };
} catch (err) {
  if (typeof err === "object" && err && "code" in err && err.code === 11000) {
    throw new HttpError(409, { title: "Email already in use" });
  }
  throw err;
}`}
      />

      <h2 id="runtime-constraints">Runtime constraints</h2>
      <p>
        Mongoose is a Node.js-first ODM because it depends on the MongoDB Node driver. For SQL databases or
        edge runtimes, stay in the <Link href="/docs/orm">ORM section</Link> instead.
      </p>

      <p>
        Compare with <Link href="/docs/odm/ottoman">Ottoman</Link> for Couchbase, <Link href="/docs/orm/prisma">Prisma</Link> for SQL, or return to the <Link href="/docs/odm">ODM overview</Link>.
      </p>
    </>
  );
}