import type { Route } from "next";
import { CodeBlock } from "../../../../components/code-block";
import { FlowDiagram } from "../../../../components/diagram";
import Link from "next/link";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Tutorial: build a Bookstore API",
  description:
    "Step-by-step DaloyJS tutorial: build a typed Bookstore REST API with contract-first routes, Zod validation, OpenAPI docs, and a generated TypeScript client.",
  path: "/docs/tutorials/bookstore",
  keywords: [
    "DaloyJS tutorial",
    "Bookstore API tutorial",
    "TypeScript REST API tutorial",
    "OpenAPI tutorial",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Tutorial: build a bookstore API</h1>
      <p>
        We&apos;ll build a tiny bookstore service end-to-end: routes,
        validation, security, OpenAPI, a Hey API typed SDK, and contract tests.
        By the end you&apos;ll have a production-shaped DaloyJS app.
      </p>

      <FlowDiagram
        title="What you'll build"
        numbered
        steps={[
          { label: "Scaffold", detail: "pnpm add @daloyjs/core zod" },
          {
            label: "buildApp factory",
            detail: "routes · Zod · security hooks",
            tone: "accent",
          },
          { label: "Serve", detail: "serve(app) on Node" },
          { label: "OpenAPI spec", detail: "generateOpenAPI(app)" },
          { label: "Typed SDK", detail: "Hey API openapi-ts" },
          {
            label: "Contract tests",
            detail: "runContractTests(app)",
            tone: "success",
          },
        ]}
        caption="A single buildApp factory is shared by the server, the OpenAPI dump, and the tests, so the spec, the typed client, and the contract tests can never drift apart."
      />

      <h2 id="1-scaffold">1. Scaffold</h2>
      <CodeBlock
        language="bash"
        code={`mkdir bookstore && cd bookstore
pnpm init
pnpm add @daloyjs/core zod
pnpm add -D typescript @types/node @hey-api/openapi-ts prettier`}
      />

      <CodeBlock
        language="json"
        code={`// package.json, replace with this
{
  "name": "bookstore",
  "type": "module",
  "scripts": {
    "dev":         "node --watch src/server.ts",
    "test":        "node --test tests/**/*.test.ts",
    "typecheck":   "tsc --noEmit",
    "gen:openapi": "node scripts/dump-openapi.ts",
    "gen:client":  "openapi-ts",
    "gen":         "pnpm gen:openapi && pnpm gen:client"
  }
}`}
      />

      <CodeBlock
        language="json"
        code={`// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "types": ["node"],
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "scripts/**/*.ts", "tests/**/*.ts", "openapi-ts.config.ts"]
}`}
      />

      <CodeBlock
        language="ini"
        code={`# .npmrc
auto-install-peers=true
strict-peer-dependencies=true
prefer-frozen-lockfile=true
verify-store-integrity=true`}
      />

      <h2 id="2-build-a-shared-buildapp-factory">
        2. Build a shared <code>buildApp</code> factory
      </h2>
      <p>
        Sharing the App between server, codegen, and tests is the secret to
        never having spec drift:
      </p>
      <CodeBlock
        code={`// src/build-app.ts
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
  app.use(rateLimit({ windowMs: 60_000, max: 120 })); // global unless you configure keyGenerator or trustProxyHeaders

  app.get(
    "/books/:id",
    {
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
    },
    async ({ params }) => {
      const book = books.get(params.id);
      if (!book) throw new NotFoundError(\`book \${params.id} not found\`);
      return { status: 200, body: book };
    },
  );

  app.post(
    "/books",
    {
      operationId: "createBook",
      tags: ["Books"],
      hooks: bearerAuth({ validate: (t) => t === "demo-token" }),
      request: { body: BookSchema.omit({ id: true }) },
      responses: {
        201: { description: "Created", body: BookSchema },
        401: { description: "Unauthorized" },
        422: { description: "Validation error" },
      },
    },
    async ({ body }) => {
      const id = String(books.size + 1);
      const book = { id, ...body };
      books.set(id, book);
      return { status: 201, body: book };
    },
  );

  return app;
}`}
      />

      <h2 id="3-start-the-server">3. Start the server</h2>
      <CodeBlock
        code={`// src/server.ts
import { buildApp } from "./build-app.js";
import { serve }    from "@daloyjs/core/node";

const app = buildApp();
const { port } = serve(app, { port: 3000 });
console.log(\`bookstore listening on http://localhost:\${port}\`);`}
      />

      <CodeBlock
        language="bash"
        code={`pnpm dev
curl http://localhost:3000/books/1
# {"id":"1","title":"Foundation","year":1951}

curl -X POST http://localhost:3000/books \\
  -H "authorization: Bearer demo-token" \\
  -H "content-type: application/json" \\
  -d '{"title":"Hyperion","year":1989}'
# {"id":"3","title":"Hyperion","year":1989}`}
      />

      <h2 id="4-generate-the-openapi-spec">4. Generate the OpenAPI spec</h2>
      <CodeBlock
        code={`// scripts/dump-openapi.ts
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
console.log(\`wrote \${out}\`);`}
      />

      <CodeBlock language="bash" code={`pnpm gen:openapi`} />

      <h2 id="5-generate-a-typed-hey-api-sdk">
        5. Generate a typed Hey API SDK
      </h2>
      <CodeBlock
        code={`// openapi-ts.config.ts
import { defineConfig } from "@hey-api/openapi-ts";
export default defineConfig({
  input: "./generated/openapi.json",
  output: { path: "./generated/client", postProcess: ["prettier"] },
  plugins: ["@hey-api/client-fetch", "@hey-api/typescript", "@hey-api/sdk"],
});`}
      />

      <CodeBlock
        language="bash"
        code={`pnpm gen
# generated/client/{client.gen.ts, sdk.gen.ts, types.gen.ts, index.ts}`}
      />

      <h2 id="6-use-the-sdk-from-any-ts-consumer">
        6. Use the SDK from any TS consumer
      </h2>
      <CodeBlock
        code={`import { client } from "../generated/client/client.gen.js";
import { getBookById } from "../generated/client/sdk.gen.js";

client.setConfig({ baseUrl: "http://localhost:3000" });

const { data } = await getBookById({ path: { id: "1" } });
console.log(data?.title); // string | undefined - fully typed`}
      />

      <h2 id="7-add-tests">7. Add tests</h2>
      <CodeBlock
        code={`// tests/books.test.ts
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
});`}
      />

      <CodeBlock language="bash" code={`pnpm test`} />

      <h2 id="what-you-built">What you built</h2>
      <ul>
        <li>A typed, validated, secured HTTP API.</li>
        <li>
          A real OpenAPI 3.1 document and a generated typed SDK, both staying in
          sync forever.
        </li>
        <li>Contract tests guarding against drift in CI.</li>
        <li>
          A hardened install pipeline using pnpm plus a locked-down{" "}
          <code>.npmrc</code>.
        </li>
      </ul>

      <p>
        Continue with the{" "}
        <Link href={"/docs/tutorials/multi-user-api" as Route}>
          multi-user authorization tutorial</Link>
        {", "}<Link href="/docs/security">Security</Link>
        {", "}
        <Link href="/docs/adapters">Adapters</Link>
        {", "}or the <Link href="/docs/api-reference">API reference</Link>.
      </p>
    </>
  );
}
