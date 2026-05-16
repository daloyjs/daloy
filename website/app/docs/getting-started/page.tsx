import { CodeBlock } from "../../../components/code-block";
import Link from "next/link";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Getting started",
  description:
    "Build your first DaloyJS application: declare a contract-first route, validate with Zod, generate OpenAPI, and serve responses on any supported runtime.",
  path: "/docs/getting-started",
  keywords: ["DaloyJS quickstart", "first DaloyJS app", "TypeScript API tutorial"],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Getting started</h1>
      <p>Build a tiny DaloyJS server, hit it with the typed client, and inspect the OpenAPI spec — in five minutes.</p>

      <h2>1. Scaffold</h2>
      <CodeBlock language="bash" code={`mkdir hello-daloy && cd hello-daloy
pnpm init
pnpm add @daloyjs/core zod
pnpm add -D typescript tsx @types/node`} />

      <CodeBlock language="json" code={`// package.json — add these
{
  "type": "module",
  "scripts": {
    "dev": "node --import tsx/esm --watch src/index.ts",
    "start": "node --import tsx/esm src/index.ts"
  }
}`} />
      <p>
        We use the explicit <code>tsx/esm</code> loader subpath because the project is{" "}
        <code>&quot;type&quot;: &quot;module&quot;</code>. The bare <code>--import tsx</code> form also works on
        recent Node versions, but <code>tsx/esm</code> is the canonical entrypoint for ESM projects and avoids
        loader-resolution surprises in stricter setups.
      </p>

      <p>
        We use <code>src/index.ts</code> and <code>--watch</code> here so the layout matches
        what <Link href="/docs/scaffolder">create-daloy</Link> emits — copy/paste between this
        guide and a scaffolded project without renaming files.
      </p>

      <h2>2. Write your first route</h2>
      <CodeBlock code={`// src/index.ts
import { z } from "zod";
import { App, requestId, secureHeaders } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

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

      <p>
        Don&apos;t want to spin up a real server? Every <code>App</code> exposes{" "}
        <code>app.request(input, init?)</code>, an in-process test client that takes a URL or{" "}
        <code>Request</code> and returns a <code>Response</code> — no network stack, no port, no second
        terminal. It&apos;s the same entrypoint the typed client and{" "}
        <Link href="/docs/testing">testing guide</Link> use:
      </p>
      <CodeBlock code={`const res = await app.request("/greet/world");
console.log(res.status, await res.json());
// → 200 { msg: "Hello, world!" }`} />

      <h2>3. Add OpenAPI &amp; docs UI</h2>
      <CodeBlock code={`import { generateOpenAPI } from "@daloyjs/core/openapi";
    import { swaggerUiHtml, htmlResponse } from "@daloyjs/core/docs";

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
    const html = swaggerUiHtml({ specUrl: "/openapi.json", title: "Hello API" });
    const res = htmlResponse(html);
    return { status: 200, body: await res.text(), headers: Object.fromEntries(res.headers) };
  },
});`} />

      <p>Open <code>http://localhost:3000/docs</code> for interactive Swagger UI.</p>
      <p>
        Both <code>swaggerUiHtml()</code> and <code>scalarHtml()</code> load their default assets from
        the jsDelivr CDN, so a strict Content-Security-Policy must allow those assets or the docs UI
        can render blank. <code>htmlResponse()</code> adds a compatible CSP automatically; if you build
        your own response, import <code>docsContentSecurityPolicy</code> from{" "}
        <code>@daloyjs/core/docs</code> and pass the result as the response header:
      </p>
      <CodeBlock code={`import { docsContentSecurityPolicy } from "@daloyjs/core/docs";

headers: { "content-security-policy": docsContentSecurityPolicy() }`} />

      <h2>4. Use the typed in-process client</h2>
      <CodeBlock code={`import { createClient } from "@daloyjs/core/client";

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
        <li><Link href="/docs/security">Security guardrails and middleware</Link></li>
        <li><Link href="/docs/tutorials/bookstore">Tutorial: bookstore API</Link></li>
      </ul>
    </>
  );
}
