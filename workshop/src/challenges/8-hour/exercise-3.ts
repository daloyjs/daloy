// 8-HOUR · Exercise 3 — RFC 9457 Errors & Redaction
//
// TODO:
// 1. Cover the four classes of error in one file: NotFound, Conflict,
//    Validation (auto from .strict()), and a custom 422 via HttpError.
// 2. Add a 500 demo route and confirm production redacts internal `detail`.
// 3. Confirm expected 4xx `detail` remains useful for clients.
//
// Docs: https://daloyjs.dev/docs/errors

import { App, NotFoundError, HttpError } from "@daloyjs/core";
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
    // TODO: when status === "checked-out", throw a 422 HttpError with
    //   a custom `type` URI such as "https://daloyjs.dev/errors/already-checked-out".
    b.status = "checked-out";
    return { status: 200 as const, body: b };
  },
);

// TODO: POST /books → already wired via 4-hour pattern, HttpError(409) on duplicate.

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/docs");
