// 8-HOUR · Exercise 8 — Typed Client Codegen with Hey API
//
// This exercise has TWO phases — a server phase and a generation phase.
//
// PHASE A (run this file):
//   1. Start the server with a couple of routes.
//   2. Hit /openapi.json to confirm the contract is current.
//
// PHASE B (run in a separate terminal):
//   1. pnpm gen:openapi  → dumps generated/openapi.json from the live server.
//   2. pnpm gen:client   → @hey-api/openapi-ts emits ./generated/client.
//   3. Import the typed SDK in tests (see solution comment below).
//
// Docs: https://daloyjs.dev/docs/clients  ·  https://heyapi.dev

import { App, NotFoundError } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { z } from "zod";

const books = new Map<string, { id: string; title: string }>([
  ["1", { id: "1", title: "Foundation" }],
]);
const BookSchema = z.object({ id: z.string(), title: z.string() });

const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: { info: { title: "Workshop API", version: "0.1.0" } },
  docs: true,
});

app.get(
  "/books/:id",
  {
    operationId: "getBookById",
    tags: ["Books"],
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: { 200: { description: "OK", body: BookSchema }, 404: { description: "Not found" } },
  },
  async ({ params }) => {
    const b = books.get(params.id);
    if (!b) throw new NotFoundError(`No book with id ${params.id}`);
    return { status: 200 as const, body: b };
  },
);

app.post(
  "/books",
  {
    operationId: "createBook",
    tags: ["Books"],
    request: { body: z.object({ id: z.string().min(1), title: z.string().min(1) }).strict() },
    responses: { 201: { description: "Created", body: BookSchema } },
  },
  async ({ body }) => {
    books.set(body.id, body);
    return { status: 201 as const, body };
  },
);

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/openapi.json");
console.log("→ Next:  pnpm gen  (in another terminal)");
