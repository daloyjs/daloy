import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Use Supabase with DaloyJS",
  description:
    "Build a DaloyJS API on top of Supabase: hosted Postgres, row-level security, and auth via @supabase/supabase-js — works on Node.js and every edge runtime DaloyJS supports.",
  path: "/docs/orm/supabase",
  keywords: [
    "Supabase DaloyJS",
    "supabase-js",
    "Supabase TypeScript",
    "Supabase auth",
    "Supabase row-level security",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Use Supabase with DaloyJS</h1>
      <p>
        <a href="https://supabase.com" target="_blank" rel="noreferrer">
          Supabase
        </a>{" "}
        is a hosted Postgres + auth + storage platform. The official{" "}
        <a href="https://supabase.com/docs/reference/javascript" target="_blank" rel="noreferrer">
          <code>@supabase/supabase-js</code>
        </a>{" "}
        client is fetch-based, so it runs on every runtime DaloyJS supports — Node.js, Bun, Deno, Cloudflare
        Workers, and Vercel Edge.
      </p>
      <p>
        Treat Supabase as a platform client, not a traditional ORM: you are composing PostgREST, auth,
        storage, and realtime APIs rather than mapping tables through model classes.
      </p>

      <h2>1. Install</h2>
      <CodeBlock code={`pnpm add @supabase/supabase-js`} />

      <h2>2. Generate database types</h2>
      <p>Use the Supabase CLI to generate a fully typed schema:</p>
      <CodeBlock
        code={`pnpm dlx supabase login
pnpm dlx supabase gen types typescript --project-id <your-ref> --schema public > src/db/supabase.types.ts`}
      />

      <h2>3. Create a Supabase plugin</h2>
      <p>
        Create a long-lived service-role client for server-to-server calls. For per-request, user-scoped clients
        (RLS), instantiate inside the handler with the caller&apos;s JWT.
      </p>
      <CodeBlock
        code={`// src/db/supabase.ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { App } from "@daloyjs/core";
import type { Database } from "./supabase.types";

export type Db = SupabaseClient<Database>;

export const serviceClient: Db = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export const supabasePlugin = {
  name: "supabase",
  register(app: App) {
    app.decorate("supabase", serviceClient);
  },
};`}
      />

      <h2>4. Augment app state types</h2>
      <CodeBlock
        code={`// src/types/state.d.ts
import type { Db } from "../db/supabase";

declare module "@daloyjs/core" {
  interface AppState {
    supabase: Db;
  }
}`}
      />

      <h2>5. Use it in routes</h2>
      <CodeBlock
        code={`// src/server.ts
import { z } from "zod";
import { App, secureHeaders } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { supabasePlugin } from "./db/supabase";

const app = new App();
app.use(secureHeaders());
app.register(supabasePlugin);

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
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
    const { data, error } = await state.supabase
      .from("users")
      .select("id,email,name")
      .eq("id", params.id)
      .maybeSingle();

    if (error) throw error;
    return data
      ? { status: 200, body: data }
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
    const { data, error } = await state.supabase
      .from("users")
      .insert(body)
      .select("id,email,name")
      .single();
    if (error) throw error;
    return { status: 201, body: data };
  },
});

await app.ready();
serve(app, { port: 3000 });`}
      />

      <h2>Per-request, RLS-aware clients</h2>
      <p>
        For row-level security, derive a client from the caller&apos;s bearer token in a hook so each handler
        gets a Supabase client scoped to that user.
      </p>
      <CodeBlock
        code={`import { createClient } from "@supabase/supabase-js";
import type { Database } from "./db/supabase.types";

app.use({
  beforeHandle({ headers, state }) {
    const auth = headers["authorization"];
    state.supabaseUser = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: auth ?? "" } } },
    );
  },
});`}
      />

      <h2>Auth: validating Supabase JWTs</h2>
      <CodeBlock
        code={`import { HttpError } from "@daloyjs/core";

app.use({
  async beforeHandle({ headers, state }) {
    const token = headers["authorization"]?.replace(/^Bearer\\s+/i, "");
    if (!token) throw new HttpError(401, { title: "Missing token" });
    const { data, error } = await state.supabase.auth.getUser(token);
    if (error || !data.user) throw new HttpError(401, { title: "Invalid token" });
    state.user = data.user;
  },
});`}
      />

      <h2>Realtime, storage, and edge functions</h2>
      <p>
        The same <code>supabase</code> client exposes <code>storage</code>, <code>functions</code>, and{" "}
        <code>realtime</code>. Use them inside handlers exactly the same way — DaloyJS doesn&apos;t care.
      </p>

      <h2>Mapping Supabase errors</h2>
      <p>
        Translate <code>PostgrestError</code> codes into typed framework errors so they serialize as{" "}
        <Link href="/docs/errors">problem+json</Link>:
      </p>
      <CodeBlock
        code={`import { HttpError } from "@daloyjs/core";

if (error?.code === "23505") {
  throw new HttpError(409, { title: "Resource already exists" });
}
if (error) throw new HttpError(500, { title: error.message });`}
      />

      <p>
        Compare with <Link href="/docs/orm/prisma">Prisma</Link>,{" "}
        <Link href="/docs/orm/drizzle">Drizzle</Link>, <Link href="/docs/orm/sequelize">Sequelize</Link>, or the <Link href="/docs/odm">ODM overview</Link> if you are on a document database.
      </p>
    </>
  );
}
