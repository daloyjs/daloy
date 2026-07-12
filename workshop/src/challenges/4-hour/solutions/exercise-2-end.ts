import { App, NotFoundError, HttpError } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { z } from "zod";

const books = new Map<string, { id: string; title: string }>([
  ["1", { id: "1", title: "Foundation" }],
  ["2", { id: "2", title: "Dune" }],
]);

const BookSchema = z.object({ id: z.string(), title: z.string() });
const CreateBookSchema = z
  .object({ id: z.string().min(1), title: z.string().min(1).max(200) })
  .strict();

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
    if (!book) throw new NotFoundError(`No book with id ${params.id}`);
    return { status: 200 as const, body: book };
  },
);

app.post(
  "/books",
  {
    operationId: "createBook",
    tags: ["Books"],
    request: { body: CreateBookSchema },
    responses: {
      201: { description: "Created", body: BookSchema },
      409: { description: "Already exists" },
    },
  },
  async ({ body }) => {
    if (books.has(body.id)) {
      throw new HttpError(409, { title: "Conflict", detail: `Book ${body.id} already exists` });
    }
    books.set(body.id, body);
    return { status: 201 as const, body };
  },
);

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/books/1");
console.log("→ http://localhost:3000/docs");
