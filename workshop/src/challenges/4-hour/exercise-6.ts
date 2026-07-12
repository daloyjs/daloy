// TODO:
// 1. Move the App + routes into a `buildApp()` factory so it can be served
//    by any runtime adapter.
// 2. Pick a non-Node adapter to demonstrate portability:
//      - If you have Bun installed, swap to `@daloyjs/core/bun`.
//      - Otherwise, just import the Bun adapter and conditionally serve.
// 3. Confirm the same `App` boots under both adapters with no code change
//    inside `buildApp()` itself.
//
// Docs: https://daloyjs.dev/docs/adapters

import { App, NotFoundError } from "@daloyjs/core";
import { serve as serveNode } from "@daloyjs/core/node";
import { z } from "zod";

// TODO: extract everything below into `function buildApp(): App { ... }`.
const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: { info: { title: "Workshop API", version: "0.1.0" } },
  docs: true,
});

app.get(
  "/health",
  {
    operationId: "getHealth",
    tags: ["Meta"],
    responses: { 200: { description: "OK", body: z.object({ runtime: z.string() }) } },
  },
  async () => ({
    status: 200 as const,
    body: { runtime: process.versions.bun ? "Bun" : "Node.js" },
  }),
);

serveNode(app, { port: 3000 });
console.log("→ http://localhost:3000/health");
