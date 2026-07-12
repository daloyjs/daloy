import { App, NotFoundError } from "@daloyjs/core";
import { createClient } from "@daloyjs/core/client";
import { serve } from "@daloyjs/core/node";
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

const client = createClient(app, { baseUrl: `http://localhost:${port}` }) as {
  getBookById(input: { params: { id: string } }): Promise<{
    status: number;
    body: unknown;
    headers: Record<string, string>;
  }>;
};

setTimeout(async () => {
  const ok = await client.getBookById({ params: { id: "1" } });
  console.log("client.getBookById(1) ->", ok.status, ok.body);

  const miss = await client.getBookById({ params: { id: "missing" } });
  console.log("client.getBookById(missing) ->", miss.status, miss.body);

  await close();
}, 250);
