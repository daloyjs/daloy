import { App, NotFoundError, HttpError, InternalError } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { z } from "zod";

const books = new Map<string, { id: string; title: string; status: "available" | "checked-out" }>([
  ["1", { id: "1", title: "Foundation", status: "available" }],
]);

const BookSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["available", "checked-out"]),
});
const CreateBookBody = z.object({ id: z.string().min(1), title: z.string().min(1) }).strict();

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
  "/books/:id/checkout",
  {
    operationId: "checkoutBook",
    tags: ["Books"],
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: {
      200: { description: "Checked out", body: BookSchema },
      404: { description: "Not found" },
      422: { description: "Cannot checkout" },
    },
  },
  async ({ params }) => {
    const b = books.get(params.id);
    if (!b) throw new NotFoundError(`No book with id ${params.id}`);
    if (b.status === "checked-out") {
      throw new HttpError(422, {
        type: "https://daloyjs.dev/errors/already-checked-out",
        title: "Already checked out",
        detail: `Book ${params.id} is already checked out`,
      });
    }
    b.status = "checked-out";
    return { status: 200 as const, body: b };
  },
);

app.post(
  "/books",
  {
    operationId: "createBook",
    tags: ["Books"],
    request: { body: CreateBookBody },
    responses: {
      201: { description: "Created", body: BookSchema },
      409: { description: "Duplicate" },
    },
  },
  async ({ body }) => {
    if (books.has(body.id)) {
      throw new HttpError(409, { title: "Conflict", detail: `Book ${body.id} already exists` });
    }
    const created = { ...body, status: "available" as const };
    books.set(body.id, created);
    return { status: 201 as const, body: created };
  },
);

app.get(
  "/explode",
  {
    operationId: "explode",
    tags: ["Demo"],
    responses: { 500: { description: "Redacted internal failure" } },
  },
  async () => {
    throw new InternalError("database DSN postgres://demo:secret@localhost/library leaked internally");
  },
);

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/docs");
