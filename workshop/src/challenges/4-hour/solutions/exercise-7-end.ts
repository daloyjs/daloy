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
  console.log("Registered routes:");
  for (const op of app.introspect()) {
    console.log(`  ${op.method.padEnd(6)} ${op.path}  (operationId=${op.operationId})`);
  }
  serve(app, { port: 3000 });
  console.log("→ http://localhost:3000/docs");
}
