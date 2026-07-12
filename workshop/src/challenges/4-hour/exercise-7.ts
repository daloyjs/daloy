// TODO:
// 1. Use `app.introspect()` to print every registered route + operationId.
// 2. Add a node:test contract test in `tests/` that:
//      - boots the app on an ephemeral port
//      - calls /books/1 via fetch
//      - asserts status 200, content-type application/json,
//        and that the response body matches BookSchema
//      - calls /books/missing
//      - asserts status 404 and problem+json content-type
// 3. Run `pnpm test`.
//
// Docs: https://daloyjs.dev/docs/testing

import { App, NotFoundError } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { z } from "zod";

const books = new Map<string, { id: string; title: string }>([
  ["1", { id: "1", title: "Foundation" }],
]);

export const BookSchema = z.object({ id: z.string(), title: z.string() });

export function buildApp(): App {
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

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = buildApp();
  // TODO: console.log(app.introspect()) and prove every route + operationId is listed.
  serve(app, { port: 3000 });
  console.log("→ http://localhost:3000/docs");
}
