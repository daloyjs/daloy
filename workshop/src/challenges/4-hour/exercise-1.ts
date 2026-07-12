// TODO:
// 1. Replace the placeholder route with a real GET /books/:id route.
// 2. Validate `params.id` with Zod (uuid OR a non-empty string — your call).
// 3. Type the 200 response body with a `BookSchema` (id + title).
// 4. Document a 404 response — return it manually for now (we throw in exercise 2).
//
// Docs: https://daloyjs.dev/docs/routing  ·  https://daloyjs.dev/docs/validation

import { App } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { z } from "zod";

const books = new Map<string, { id: string; title: string }>([
  ["1", { id: "1", title: "Foundation" }],
  ["2", { id: "2", title: "Dune" }],
]);

const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: { info: { title: "Workshop API", version: "0.1.0" } },
  docs: true,
});

// TODO: replace this stub with a contract-first route.
app.get(
  "/books/:id",
  {
    operationId: "getBookById",
    tags: ["Books"],
    responses: {
      200: { description: "Book found" },
    },
  },
  async () => ({ status: 200 as const, body: { id: "?", title: "?" } }),
);

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/books/1");
console.log("→ http://localhost:3000/docs");
