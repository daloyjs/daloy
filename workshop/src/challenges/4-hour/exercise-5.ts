// TODO:
// 1. Run `pnpm gen` against this server to produce `generated/client/`
//    (after starting the server with `pnpm dev:4:5` in another terminal).
// 2. Use the in-process `createClient(app)` to call `getBookById` from
//    a startup smoke-test. This is the same surface Hey API generates.
// 3. Observe that the TypeScript inferred return type narrows by status.
//
// Docs: https://daloyjs.dev/docs/clients

import { App, NotFoundError } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
// TODO: import { createClient } from "@daloyjs/core/client";
import { z } from "zod";

const books = new Map<string, { id: string; title: string }>([
  ["1", { id: "1", title: "Foundation" }],
]);
const BookSchema = z.object({ id: z.string(), title: z.string() });

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
      200: { description: "Found", body: BookSchema },
      404: { description: "Not found" },
    },
  },
  async ({ params }) => {
    const b = books.get(params.id);
    if (!b) throw new NotFoundError(`No book with id ${params.id}`);
    return { status: 200 as const, body: b };
  },
);

const { port, close } = serve(app, { port: 3000 });
console.log(`→ http://localhost:${port}/docs`);

// TODO: smoke-test using the in-process typed client.
//   const client = createClient(app, { baseUrl: `http://localhost:${port}` });
//   const r = await client.getBookById({ params: { id: "1" } });
//   console.log("client.getBookById ->", r.status, r.body);
//   await close();
