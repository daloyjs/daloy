/**
 * Shared factory for the example bookstore App.
 *
 * Consumed by `examples/basic.ts` (runnable demo + typed-client smoke),
 * `examples/dast-server.ts` (long-running DAST target), and
 * `scripts/dump-openapi.ts` (writes the spec for Hey API codegen).
 *
 * The return type is intentionally **inferred** — this function does *not*
 * annotate `: App`, and the two routes are registered by *chaining*
 * `.get(...)` / `.post(...)` shorthand calls rather than as separate
 * `app.get(...)` statements. That is what carries the accumulated per-route
 * tuple to callers, so
 * `createClient(buildExampleApp())` gets a fully typed `getBookById` /
 * `createBook` surface with **no cast**. Annotating `: App` here, or breaking
 * the chain into separate statements, would widen the type back to a plain
 * `App` and erase the inference (forcing a hand-written client cast).
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

/** Public book resource returned by the read/write routes. */
export const BookSchema = z.object({ id: z.string(), title: z.string() });

/** RFC 9457 problem+json shape used by the error responses. */
export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  detail: z.string().optional(),
});

/**
 * Build the example bookstore {@link App}: the secure-by-default middleware
 * stack plus two typed routes (`getBookById`, `createBook`).
 *
 * @returns An `App` whose route tuple is **inferred**, so a typed client built
 * from it (see `examples/basic.ts`) needs no cast.
 * @since 0.1.0
 */
export function buildExampleApp() {
  const books = new Map<string, z.infer<typeof BookSchema>>([
    ["1", { id: "1", title: "Foundation" }],
    ["2", { id: "2", title: "Dune" }],
  ]);

  // One unbroken chain: `new App(...).use(...)....get(...).post(...)`.
  // The inferred return type therefore is `App<[getBookById, createBook]>`.
  return new App({
    title: "Bookstore API",
    version: "1.0.0",
    bodyLimitBytes: 64 * 1024,
    requestTimeoutMs: 5_000,
    openapi: {
      info: { title: "Bookstore API", version: "1.0.0" },
      securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
    },
    docs: true,
  })
    .use(requestId())
    .use(secureHeaders())
    .use(cors({ origin: "*", credentials: false }))
    .use(timing())
    .use(rateLimit({ windowMs: 60_000, max: 120 }))
    .get(
      "/books/:id",
      {
        operationId: "getBookById",
        tags: ["Books"],
        summary: "Fetch a book by id",
        request: { params: z.object({ id: z.string() }) },
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
        if (!book) throw new NotFoundError(`No book with id ${params.id}`);
        return { status: 200 as const, body: book };
      },
    )
    .post(
      "/books",
      {
        operationId: "createBook",
        tags: ["Books"],
        auth: { scheme: "bearer" },
        hooks: bearerAuth({ validate: (t) => t === "demo-token" }),
        request: { body: BookSchema },
        responses: {
          201: { description: "Created", body: BookSchema },
          401: { description: "Unauthorized", body: ProblemSchema },
          422: { description: "Validation error", body: ProblemSchema },
        },
      },
      async ({ body }) => {
        books.set(body.id, body);
        return { status: 201 as const, body };
      },
    );
}
