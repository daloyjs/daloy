import { CodeBlock } from "../../../../components/code-block";
import Link from "next/link";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Tutorial: build a Bookstore API",
  description:
    "Step-by-step DaloyJS tutorial: build a typed Bookstore REST API with contract-first routes, Zod validation, OpenAPI docs, and a generated TypeScript client.",
  path: "/docs/tutorials/bookstore",
  keywords: ["DaloyJS tutorial", "Bookstore API tutorial", "TypeScript REST API tutorial", "OpenAPI tutorial"],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Tutorial: build a bookstore API</h1>
      <p>
        We&apos;ll build a tiny bookstore service end-to-end: routes, validation, security, OpenAPI, a Hey
        API typed SDK, and contract tests. By the end you&apos;ll have a production-shaped DaloyJS app.
      </p>

      <h2>1. Scaffold</h2>
      <CodeBlock language="bash" code={`mkdir bookstore && cd bookstore
pnpm init
pnpm add @daloyjs/core zod
pnpm add -D typescript tsx @types/node @hey-api/openapi-ts`} />

      <CodeBlock language="json" code={`// package.json — replace with this
{
  "name": "bookstore",
  "type": "module",
  "scripts": {
    "dev":         "node --import tsx src/server.ts",
    "test":        "node --import tsx --test tests/**/*.test.ts",
    "gen:openapi": "node --import tsx scripts/dump-openapi.ts",
    "gen:client":  "openapi-ts",
    "gen":         "pnpm gen:openapi && pnpm gen:client"
  }
}`} />

      <CodeBlock language="ini" code={`# .npmrc
auto-install-peers=true
strict-peer-dependencies=true
prefer-frozen-lockfile=true
verify-store-integrity=true`} />

      <h2>2. Build a shared <code>buildApp</code> factory</h2>
      <p>Sharing the App between server, codegen, and tests is the secret to never having spec drift:</p>
      <CodeBlock code={`// src/build-app.ts
import { z } from "zod";
import { App, requestId, secureHeaders, cors, rateLimit, bearerAuth, NotFoundError } from "@daloyjs/core";

export const BookSchema = z.object({
  id:    z.string(),
  title: z.string(),
  year:  z.number().int().optional(),
});

export function buildApp() {
  const books = new Map<string, z.infer<typeof BookSchema>>([
    ["1", { id: "1", title: "Foundation", year: 1951 }],
    ["2", { id: "2", title: "Dune",       year: 1965 }],
  ]);

  const app = new App({ bodyLimitBytes: 64 * 1024, requestTimeoutMs: 5_000 });

  app.use(requestId());
  app.use(secureHeaders());
  app.use(cors({ origin: ["http://localhost:5173"] }));
  app.use(rateLimit({ windowMs: 60_000, max: 120 }));

  app.route({
    method: "GET",
    path: "/books/:id",
    operationId: "getBookById",
    tags: ["Books"],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: {
        description: "Found",
        body: BookSchema,
        examples: { default: { id: "1", title: "Foundation", year: 1951 } },
      },
      404: { description: "Not found" },
    },
    handler: async ({ params }) => {
      const book = books.get(params.id);
      if (!book) throw new NotFoundError(\`book \${params.id} not found\`);
      return { status: 200, body: book };
    },
  });

  app.route({
    method: "POST",
    path: "/books",
    operationId: "createBook",
    tags: ["Books"],
    hooks: bearerAuth({ validate: (t) => t === "demo-token" }),
    request: { body: BookSchema.omit({ id: true }) },
    responses: {
      201: { description: "Created", body: BookSchema },
      401: { description: "Unauthorized" },
      422: { description: "Validation error" },
    },
    handler: async ({ body }) => {
      const id = String(books.size + 1);
      const book = { id, ...body };
      books.set(id, book);
      return { status: 201, body: book };
    },
  });

  return app;
}`} />

      <h2>3. Start the server</h2>
      <CodeBlock code={`// src/server.ts
import { buildApp } from "./build-app.js";
import { serve }    from "@daloyjs/core/node";

const app = buildApp();
const { port } = serve(app, { port: 3000 });
console.log(\`bookstore listening on http://localhost:\${port}\`);`} />

      <CodeBlock language="bash" code={`pnpm dev
curl http://localhost:3000/books/1
# {"id":"1","title":"Foundation","year":1951}

curl -X POST http://localhost:3000/books \\
  -H "authorization: Bearer demo-token" \\
  -H "content-type: application/json" \\
  -d '{"title":"Hyperion","year":1989}'
# {"id":"3","title":"Hyperion","year":1989}`} />

      <h2>4. Generate the OpenAPI spec</h2>
      <CodeBlock code={`// scripts/dump-openapi.ts
import { mkdir, writeFile } from "node:fs/promises";
import { dirname }          from "node:path";
import { generateOpenAPI }  from "@daloyjs/core/openapi";
import { buildApp }         from "../src/build-app.js";

const app  = buildApp();
const out  = "./generated/openapi.json";
const doc  = generateOpenAPI(app, {
  info: { title: "Bookstore API", version: "1.0.0" },
  securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
});

await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(doc, null, 2));
console.log(\`wrote \${out}\`);`} />

      <CodeBlock language="bash" code={`pnpm gen:openapi`} />

      <h2>5. Generate a typed Hey API SDK</h2>
      <CodeBlock code={`// openapi-ts.config.ts
import { defineConfig } from "@hey-api/openapi-ts";
export default defineConfig({
  input: "./generated/openapi.json",
  output: { path: "./generated/client", format: "prettier" },
  plugins: ["@hey-api/client-fetch", "@hey-api/typescript", "@hey-api/sdk"],
});`} />

      <CodeBlock language="bash" code={`pnpm gen
# generated/client/{client.gen.ts, sdk.gen.ts, types.gen.ts, index.ts}`} />

      <h2>6. Use the SDK from any TS consumer</h2>
      <CodeBlock code={`import { client } from "../generated/client";
import { getBookById, createBook } from "../generated/client/sdk.gen";

client.setConfig({ baseUrl: "http://localhost:3000" });

const { data } = await getBookById({ path: { id: "1" } });
console.log(data?.title); // string | undefined — fully typed`} />

      <h2>7. Add tests</h2>
      <CodeBlock code={`// tests/books.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/build-app.js";
import { runContractTests } from "@daloyjs/core/contract";

test("contract is clean", async () => {
  const report = await runContractTests(buildApp());
  assert.equal(report.ok, true, JSON.stringify(report.issues, null, 2));
});

test("GET /books/:id returns 200", async () => {
  const res = await buildApp().request("/books/1");
  assert.equal(res.status, 200);
});

test("POST /books rejects without token", async () => {
  const res = await buildApp().request("/books", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Hyperion" }),
  });
  assert.equal(res.status, 401);
});`} />

      <CodeBlock language="bash" code={`pnpm test`} />

      <h2>What you built</h2>
      <ul>
        <li>A typed, validated, secured HTTP API.</li>
        <li>A real OpenAPI 3.1 document and a generated typed SDK — both staying in sync forever.</li>
        <li>Contract tests guarding against drift in CI.</li>
        <li>A pnpm install pipeline with strict isolation and frozen lockfile.</li>
      </ul>

      <p>
        Continue with <Link href="/docs/security">Security</Link>,{" "}
        <Link href="/docs/adapters">Adapters</Link>, or the{" "}
        <Link href="/docs/api-reference">API reference</Link>.
      </p>
    </>
  );
}
