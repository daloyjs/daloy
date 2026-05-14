import { CodeBlock } from "@/components/code-block";
import Link from "next/link";

export const metadata = { title: "Getting started" };

export default function Page() {
  return (
    <>
      <h1>Getting started</h1>
      <p>Build a tiny DaloyJS server, hit it with the typed client, and inspect the OpenAPI spec — in five minutes.</p>

      <h2>1. Scaffold</h2>
      <CodeBlock language="bash" code={`mkdir hello-daloy && cd hello-daloy
pnpm init
pnpm add daloy zod
pnpm add -D typescript tsx @types/node`} />

      <CodeBlock language="json" code={`// package.json — add these
{
  "type": "module",
  "scripts": {
    "dev": "node --import tsx src/server.ts"
  }
}`} />

      <h2>2. Write your first route</h2>
      <CodeBlock code={`// src/server.ts
import { z } from "zod";
import { App, requestId, secureHeaders } from "daloy";
import { serve } from "daloy/node";

const app = new App({
  bodyLimitBytes: 64 * 1024,
  requestTimeoutMs: 5_000,
});

app.use(requestId());
app.use(secureHeaders());

app.route({
  method: "GET",
  path: "/greet/:name",
  operationId: "greet",
  tags: ["Demo"],
  request: { params: z.object({ name: z.string().min(1) }) },
  responses: {
    200: { description: "Greeting", body: z.object({ msg: z.string() }) },
  },
  handler: async ({ params }) => ({
    status: 200,
    body: { msg: \`Hello, \${params.name}!\` },
  }),
});

const { port } = serve(app, { port: 3000 });
console.log(\`listening on http://localhost:\${port}\`);`} />

      <CodeBlock language="bash" code={`pnpm dev
# in another shell
curl http://localhost:3000/greet/world
# → {"msg":"Hello, world!"}`} />

      <h2>3. Add OpenAPI &amp; docs UI</h2>
      <CodeBlock code={`import { generateOpenAPI } from "daloy/openapi";
import { scalarHtml, htmlResponse } from "daloy/docs";

app.route({
  method: "GET",
  path: "/openapi.json",
  operationId: "openapi",
  responses: { 200: { description: "OpenAPI doc" } },
  handler: async () => ({
    status: 200,
    body: generateOpenAPI(app, { info: { title: "Hello", version: "1.0.0" } }),
  }),
});

app.route({
  method: "GET",
  path: "/docs",
  operationId: "docs",
  responses: { 200: { description: "API reference" } },
  handler: async () => {
    const res = htmlResponse(scalarHtml({ specUrl: "/openapi.json", title: "Hello API" }));
    return { status: 200, body: await res.text(), headers: Object.fromEntries(res.headers) };
  },
});`} />

      <p>Open <code>http://localhost:3000/docs</code> for an interactive Scalar UI.</p>

      <h2>4. Use the typed in-process client</h2>
      <CodeBlock code={`import { createClient } from "daloy/client";

const client = createClient(app, { baseUrl: "http://localhost:3000" });
const r = await client.greet({ params: { name: "DaloyJS" } });
//    ^? { status: 200; body: { msg: string } }
console.log(r.status, r.body);`} />

      <h2>5. Generate a Hey API SDK</h2>
      <p>For consumers outside the monorepo, generate a fully typed fetch SDK:</p>
      <CodeBlock language="bash" code={`pnpm add -D @hey-api/openapi-ts`} />

      <CodeBlock code={`// openapi-ts.config.ts
import { defineConfig } from "@hey-api/openapi-ts";
export default defineConfig({
  input: "./generated/openapi.json",
  output: { path: "./generated/client", format: "prettier" },
  plugins: ["@hey-api/client-fetch", "@hey-api/typescript", "@hey-api/sdk"],
});`} />

      <CodeBlock language="bash" code={`pnpm exec openapi-ts`} />

      <h2>Next steps</h2>
      <ul>
        <li><Link href="/docs/routing">Routing</Link></li>
        <li><Link href="/docs/validation">Validation with Standard Schema</Link></li>
        <li><Link href="/docs/security">Security defaults</Link></li>
        <li><Link href="/docs/tutorials/bookstore">Tutorial: bookstore API</Link></li>
      </ul>
    </>
  );
}
