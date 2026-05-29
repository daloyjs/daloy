import { App, NotFoundError } from "@daloyjs/core";
import { createClient } from "@daloyjs/core/client";
import { serve } from "@daloyjs/core/node";
import { z } from "zod";

export const BookSchema = z.object({ id: z.string(), title: z.string() });

export function buildApp(): App {
  const books = new Map<string, { id: string; title: string }>([
    ["1", { id: "1", title: "Foundation" }],
  ]);

  const app = new App({
    title: "Workshop API",
    version: "0.1.0",
    openapi: { info: { title: "Workshop API", version: "0.1.0" } },
    docs: true,
  });

  app.route({
    method: "GET",
    path: "/books/:id",
    operationId: "getBookById",
    tags: ["Books"],
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: { 200: { description: "OK", body: BookSchema }, 404: { description: "Not found" } },
    handler: async ({ params }) => {
      const b = books.get(params.id);
      if (!b) throw new NotFoundError(`No book with id ${params.id}`);
      return { status: 200 as const, body: b };
    },
  });

  app.route({
    method: "POST",
    path: "/books",
    operationId: "createBook",
    tags: ["Books"],
    request: { body: z.object({ id: z.string().min(1), title: z.string().min(1) }).strict() },
    responses: { 201: { description: "Created", body: BookSchema } },
    handler: async ({ body }) => {
      books.set(body.id, body);
      return { status: 201 as const, body };
    },
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = buildApp();
  serve(app, { port: 3000 });
  console.log("→ http://localhost:3000/docs");

  // ---- in-process typed client smoke test -----------------------------------
  //
  // In a real test file you'd boot serve(app, { port: 0 }) and pass that port to
  // the generated client. Here we use the in-process client for instant iteration.
  const client = createClient(app, { baseUrl: "http://localhost:3000" }) as {
    getBookById(input: { params: { id: string } }): Promise<{ status: number; body: unknown; headers: Record<string, string> }>;
  };

  setTimeout(async () => {
    const ok = await client.getBookById({ params: { id: "1" } });
    console.log("200 path:", ok);
    const missing = await client.getBookById({ params: { id: "999" } });
    console.log("404 path:", missing);
  }, 250);

  // ---- After running `pnpm gen` --------------------------------------------
  //
  // import { getBookById, createBook } from "../../../generated/client";
  // const { data, error } = await getBookById({ path: { id: "1" } });
  // if (error) console.error(error);
  // else       console.log(data.title);   // ← fully typed!
}
