// TODO:
// 1. Add a request body schema for POST /books with `.strict()`.
// 2. Replace the manual 404 with `throw new NotFoundError(...)` and let
//    the framework render the RFC 9457 problem+json for you.
// 3. Confirm validation errors come back as 400 problem+json automatically.
// 4. Confirm `.strict()` rejects unknown keys on the request body.
//
// Docs: https://daloyjs.dev/docs/errors  ·  https://daloyjs.dev/docs/validation

import { App, NotFoundError } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { z } from "zod";

const books = new Map<string, { id: string; title: string }>([
  ["1", { id: "1", title: "Foundation" }],
  ["2", { id: "2", title: "Dune" }],
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
    responses: {
      200: { description: "Book found", body: BookSchema },
      404: { description: "Book not found" },
    },
  },
  async ({ params }) => {
    const book = books.get(params.id);
    // TODO: replace this manual 404 with `throw new NotFoundError(...)`.
    if (!book) {
      return {
        status: 404 as const,
        body: { type: "about:blank", title: "Not found", status: 404 } as any,
      };
    }
    return { status: 200 as const, body: book };
  },
);

// TODO: add POST /books with a `.strict()` request body schema.
//   - 201 returns the created book
//   - 409 if the id already exists (throw new HttpError(409, ...))
//
// app.post(path, contract, handler);

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/books/1");
console.log("→ http://localhost:3000/docs");
