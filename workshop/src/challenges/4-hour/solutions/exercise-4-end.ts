import { App, NotFoundError, bearerAuth } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { z } from "zod";

const books = new Map<string, { id: string; title: string }>([
  ["1", { id: "1", title: "Foundation" }],
]);

const BookSchema = z.object({ id: z.string(), title: z.string() });
const CreateBookSchema = z.object({ id: z.string().min(1), title: z.string().min(1) }).strict();

const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: {
    info: { title: "Workshop API", version: "0.1.0" },
    securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
  },
  docs: true,
});

app.get(
  "/books/:id",
  {
    operationId: "getBookById",
    tags: ["Books"],
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: {
      200: { description: "OK", body: BookSchema },
      404: { description: "Not found" },
    },
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
    auth: { scheme: "bearer" },
    hooks: bearerAuth({ validate: (token) => token === "demo-token" }),
    request: { body: CreateBookSchema },
    responses: {
      201: { description: "Created", body: BookSchema },
      401: { description: "Unauthorized" },
    },
  },
  async ({ body }) => {
    books.set(body.id, body);
    return { status: 201 as const, body };
  },
);

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/docs");
