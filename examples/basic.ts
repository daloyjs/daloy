/**
 * Bookstore example.
 *
 * Run:
 *   pnpm install
 *   pnpm example
 *
 * Then:
 *   curl http://localhost:3000/books/1
 *   open  http://localhost:3000/docs
 *
 * To generate a Hey API typed SDK from this app's contract:
 *   pnpm gen
 */

import { App } from "../src/index.js";
import { serve } from "../src/adapters/node.js";
import { generateOpenAPI } from "../src/openapi.js";
import { createClient } from "../src/client.js";
import { scalarHtml, htmlResponse } from "../src/docs.js";
import { buildExampleApp } from "./build-app.js";

const app: App = buildExampleApp();

// OpenAPI spec endpoint — feeds Scalar UI and Hey API codegen.
app.route({
  method: "GET",
  path: "/openapi.json",
  operationId: "getOpenAPI",
  tags: ["Meta"],
  responses: { 200: { description: "OpenAPI 3.1 doc" } },
  handler: async () => ({
    status: 200 as const,
    body: generateOpenAPI(app, {
      info: { title: "Bookstore API", version: "1.0.0" },
      securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
    }),
  }),
});

app.route({
  method: "GET",
  path: "/docs",
  operationId: "docs",
  tags: ["Meta"],
  responses: { 200: { description: "Interactive API reference" } },
  handler: async () => {
    const html = scalarHtml({ specUrl: "/openapi.json", title: "Bookstore API" });
    const res = htmlResponse(html);
    return { status: 200 as const, body: html, headers: Object.fromEntries(res.headers) };
  },
});

app.route({
  method: "GET",
  path: "/_routes",
  operationId: "listRoutes",
  tags: ["Meta"],
  responses: { 200: { description: "Registered routes" } },
  handler: async () => ({ status: 200 as const, body: app.introspect() }),
});

const { port, close } = serve(app, { port: 3000 });
console.log(`DaloyJS listening on http://localhost:${port}  (docs: /docs)`);

// In-process typed client smoke (no codegen step).
const client = createClient(app, { baseUrl: `http://localhost:${port}` }) as {
  getBookById(input: { params: { id: string } }): Promise<{
    status: number;
    body: unknown;
    headers: Record<string, string>;
  }>;
};
setTimeout(async () => {
  const r = await client.getBookById({ params: { id: "1" } });
  console.log("client.getBookById ->", r.status, r.body);
  await close();
}, 250);
