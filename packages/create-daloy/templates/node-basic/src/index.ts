import { z } from "zod";
import {
  App,
  NotFoundError,
  rateLimit,
  requestId,
  secureHeaders,
} from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const app = new App({
  bodyLimitBytes: 1024 * 1024,
  requestTimeoutMs: 5_000,
  production: process.env.NODE_ENV === "production",
});

app.use(requestId());
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

app.route({
  method: "GET",
  path: "/healthz",
  operationId: "healthz",
  tags: ["Ops"],
  responses: {
    200: {
      description: "Service is healthy",
      body: z.object({ ok: z.literal(true), uptime: z.number() }),
    },
  },
  handler: async () => ({
    status: 200,
    body: { ok: true as const, uptime: process.uptime() },
  }),
});

const Book = z.object({ id: z.string(), title: z.string() });
const books = new Map<string, z.infer<typeof Book>>([
  ["1", { id: "1", title: "Noli Me Tangere" }],
  ["2", { id: "2", title: "El Filibusterismo" }],
]);

app.route({
  method: "GET",
  path: "/books/:id",
  operationId: "getBookById",
  tags: ["Books"],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: "Found", body: Book },
    404: { description: "Not found" },
  },
  handler: async ({ params }) => {
    const book = books.get(params.id);
    if (!book) throw new NotFoundError(`Book ${params.id} not found`);
    return { status: 200, body: book };
  },
});

const port = Number(process.env.PORT ?? 3000);
serve(app, { port });
console.log(`DaloyJS listening on http://localhost:${port}`);
