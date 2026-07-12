import { App } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { z } from "zod";

const books = new Map<string, { id: string; title: string }>([
  ["1", { id: "1", title: "Foundation" }],
  ["2", { id: "2", title: "Dune" }],
]);

const BookSchema = z.object({ id: z.string(), title: z.string() });
const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  detail: z.string().optional(),
});

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
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: {
      200: {
        description: "Book found",
        body: BookSchema,
        examples: { default: { id: "1", title: "Foundation" } },
      },
      404: { description: "Book not found", body: ProblemSchema },
    },
  },
  async ({ params }) => {
    const book = books.get(params.id);
    if (!book) {
      return {
        status: 404 as const,
        body: {
          type: "about:blank",
          title: "Book not found",
          status: 404,
          detail: `No book with id ${params.id}`,
        },
      };
    }
    return { status: 200 as const, body: book };
  },
);

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/books/1");
console.log("→ http://localhost:3000/docs");
