/**
 * Shared factory for the example bookstore App.
 *
 * Used by `examples/basic.ts` (runnable demo) and by
 * `scripts/dump-openapi.ts` (writes the spec for Hey API codegen).
 */

import { z } from "zod";
import {
  App,
  NotFoundError,
  bearerAuth,
  cors,
  rateLimit,
  requestId,
  secureHeaders,
  timing,
} from "../src/index.ts";

export const BookSchema = z.object({ id: z.string(), title: z.string() });
export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  detail: z.string().optional(),
});

export function buildExampleApp(): App {
  const books = new Map<string, { id: string; title: string }>([
    ["1", { id: "1", title: "Foundation" }],
    ["2", { id: "2", title: "Dune" }],
  ]);

  const app = new App({
    title: "Bookstore API",
    version: "1.0.0",
    bodyLimitBytes: 64 * 1024,
    requestTimeoutMs: 5_000,
    openapi: {
      info: { title: "Bookstore API", version: "1.0.0" },
      securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
    },
    docs: true,
  });

  app.use(requestId());
  app.use(secureHeaders());
  app.use(cors({ origin: "*", credentials: false }));
  app.use(timing());
  app.use(rateLimit({ windowMs: 60_000, max: 120 }));

  app.route({
    method: "GET",
    path: "/books/:id",
    operationId: "getBookById",
    tags: ["Books"],
    summary: "Fetch a book by id",
    request: { params: z.object({ id: z.string() }) as any },
    responses: {
      200: {
        description: "Book found",
        body: BookSchema as any,
        examples: { default: { id: "1", title: "Foundation" } },
      },
      404: { description: "Book not found", body: ProblemSchema as any },
    },
    handler: async ({ params }) => {
      const book = books.get(params.id);
      if (!book) throw new NotFoundError(`No book with id ${params.id}`);
      return { status: 200 as const, body: book };
    },
  });

  app.route({
    method: "POST",
    path: "/books",
    operationId: "createBook",
    tags: ["Books"],
    auth: { scheme: "bearer" },
    hooks: bearerAuth({ validate: (t) => t === "demo-token" }),
    request: { body: BookSchema as any },
    responses: {
      201: { description: "Created", body: BookSchema as any },
      401: { description: "Unauthorized", body: ProblemSchema as any },
      422: { description: "Validation error", body: ProblemSchema as any },
    },
    handler: async ({ body }) => {
      const b = body as { id: string; title: string };
      books.set(b.id, b);
      return { status: 201 as const, body: b };
    },
  });

  return app;
}
