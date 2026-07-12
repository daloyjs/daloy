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
    summary: "Fetch a book by id",
    description: "Returns the book record. Throws `NotFoundError` if no book with that id exists.",
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: {
      200: {
        description: "Book found",
        body: BookSchema,
        examples: {
          foundation: { id: "1", title: "Foundation" },
          dune: { id: "2", title: "Dune" },
        },
      },
      404: { description: "Book not found" },
    },
  },
  async ({ params }) => {
    const b = books.get(params.id);
    if (!b) throw new NotFoundError(`No book with id ${params.id}`);
    return { status: 200 as const, body: b };
  },
);

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/docs");
