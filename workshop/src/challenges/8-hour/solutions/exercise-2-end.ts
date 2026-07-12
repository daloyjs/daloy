import { App, HttpError } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { z } from "zod";

const books = new Map<string, { id: string; title: string; status: "available" | "checked-out" }>([
  ["1", { id: "1", title: "Foundation", status: "available" }],
  ["2", { id: "2", title: "Dune", status: "checked-out" }],
]);
const seenIdempotencyKeys = new Set<string>();

const BookSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["available", "checked-out"]),
});
const ListBooksQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(["available", "checked-out"]).optional(),
  })
  .strict();
const CreateBookBody = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1).max(200),
    status: z.enum(["available", "checked-out"]).default("available"),
  })
  .strict();
const IdempotencyHeaders = z.object({ "idempotency-key": z.string().uuid() });

const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: { info: { title: "Workshop API", version: "0.1.0" } },
  docs: true,
});

app.get(
  "/books",
  {
    operationId: "listBooks",
    tags: ["Books"],
    request: { query: ListBooksQuery },
    responses: {
      200: {
        description: "List of books",
        body: z.object({ items: z.array(BookSchema), total: z.number() }),
      },
    },
  },
  async ({ query }) => {
    const filtered = [...books.values()].filter((b) => !query.status || b.status === query.status);
    return {
      status: 200 as const,
      body: { items: filtered.slice(0, query.limit), total: filtered.length },
    };
  },
);

app.post(
  "/books",
  {
    operationId: "createBook",
    tags: ["Books"],
    request: { headers: IdempotencyHeaders, body: CreateBookBody },
    responses: {
      201: { description: "Created", body: BookSchema },
      409: { description: "Replay or duplicate id" },
    },
  },
  async ({ headers, body }) => {
    const key = headers["idempotency-key"];
    if (seenIdempotencyKeys.has(key)) {
      throw new HttpError(409, { title: "Conflict", detail: "This idempotency-key was already used" });
    }
    if (books.has(body.id)) {
      throw new HttpError(409, { title: "Conflict", detail: `Book ${body.id} already exists` });
    }
    seenIdempotencyKeys.add(key);
    books.set(body.id, body);
    return { status: 201 as const, body };
  },
);

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/docs");
