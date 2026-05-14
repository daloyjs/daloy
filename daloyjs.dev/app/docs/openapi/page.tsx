import { CodeBlock } from "../../../components/code-block";

export const metadata = { title: "OpenAPI generation" };

export default function Page() {
  return (
    <>
      <h1>OpenAPI generation</h1>
      <p>
        DaloyJS emits a clean <strong>OpenAPI 3.1</strong> document straight from your route definitions —
        no plugins, no separate decorators. Validation, types, and the spec all share one source of truth.
      </p>

      <h2>Generate a spec</h2>
      <CodeBlock code={`import { generateOpenAPI } from "@daloyjs/core/openapi";

const doc = generateOpenAPI(app, {
  info: { title: "My API", version: "1.0.0" },
  servers: [{ url: "https://api.example.com" }],
  securitySchemes: {
    bearer: { type: "http", scheme: "bearer" },
  },
});

console.log(JSON.stringify(doc, null, 2));`} />

      <h2>Serve the spec from your app</h2>
      <CodeBlock code={`app.route({
  method: "GET",
  path: "/openapi.json",
  operationId: "getOpenAPI",
  tags: ["Meta"],
  responses: { 200: { description: "OpenAPI 3.1 doc" } },
  handler: async () => ({ status: 200, body: generateOpenAPI(app, { info: { title: "My API", version: "1.0.0" } }) }),
});`} />

      <h2>Built-in docs UIs</h2>
      <CodeBlock code={`import { scalarHtml, swaggerUiHtml, htmlResponse } from "@daloyjs/core/docs";

app.route({
  method: "GET",
  path: "/docs",
  operationId: "docs",
  responses: { 200: { description: "API reference" } },
  handler: async () => {
    const res = htmlResponse(scalarHtml({ specUrl: "/openapi.json", title: "My API" }));
    return { status: 200, body: await res.text(), headers: Object.fromEntries(res.headers) };
  },
});`} />

      <p>
        Both <code>scalarHtml</code> and <code>swaggerUiHtml</code> return self-contained HTML pages that load
        their assets from jsDelivr with a strict CSP allowing only that origin.
      </p>

      <h2>Dump to disk for codegen</h2>
      <CodeBlock language="ts" code={`// scripts/dump-openapi.ts
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { generateOpenAPI } from "@daloyjs/core/openapi";
import { buildApp } from "../src/build-app.js";

const app = buildApp();
const out = "./generated/openapi.json";
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(generateOpenAPI(app, {
  info: { title: "My API", version: "1.0.0" },
}), null, 2));
console.log(\`wrote \${out}\`);`} />

      <CodeBlock language="json" code={`// package.json
"scripts": {
  "gen:openapi": "node --import tsx scripts/dump-openapi.ts"
}`} />

      <h2>What gets emitted</h2>
      <ul>
        <li>One <code>operationId</code> per route — duplicates throw at registration.</li>
        <li>Path params <code>:id</code> normalized to <code>{`{id}`}</code>.</li>
        <li>Schema bodies converted via <code>schema.toJSONSchema?.()</code> when supported, or a structural fallback.</li>
        <li>Reusable <code>components.schemas.Problem</code> for RFC 9457 errors.</li>
        <li><code>tags</code>, <code>summary</code>, <code>description</code>, and per-status <code>description</code>.</li>
      </ul>
    </>
  );
}
