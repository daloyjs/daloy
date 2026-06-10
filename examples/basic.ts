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

import { App } from "../src/index.ts";
import { serve } from "../src/adapters/node.ts";
import { createClient } from "../src/client.ts";
import { printStartupBanner } from "../src/banner.ts";
import { buildExampleApp } from "./build-app.ts";

// `buildExampleApp()` configures `docs: true` on the App constructor, so
// GET /docs (Scalar UI) and GET /openapi.json are auto-mounted for us.
const app: App = buildExampleApp();

app.route({
  method: "GET",
  path: "/_routes",
  operationId: "listRoutes",
  tags: ["Meta"],
  responses: { 200: { description: "Registered routes" } },
  handler: async () => ({ status: 200 as const, body: app.introspect() }),
});

const { port, close } = serve(app, { port: 3000 });
printStartupBanner({
  name: "DaloyJS Bookstore",
  url: `http://localhost:${port}`,
  runtime: "Node.js",
  links: [
    { label: "Docs", url: `http://localhost:${port}/docs` },
    { label: "Routes", url: `http://localhost:${port}/_routes` },
  ],
});

// In-process typed client smoke (no codegen step).
//
// `buildExampleApp()` returns a widened `App` (its signature is annotated
// `: App`), which erases the per-route tuple the typed client infers from.
// To get inference automatically, chain `app.route(...)` calls and let
// TypeScript infer the variable type instead of annotating it `: App`. Here we
// keep the shared factory and annotate the one call site we exercise.
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
