import { z } from "zod";
import { App, NotFoundError, requestId, secureHeaders } from "@daloyjs/core";
import { toFetchHandler } from "@daloyjs/core/cloudflare";

const app = new App({
  bodyLimitBytes: 256 * 1024,
  requestTimeoutMs: 5_000,
  production: true,
});

app.use(requestId());
app.use(secureHeaders());

app.route({
  method: "GET",
  path: "/healthz",
  operationId: "healthz",
  tags: ["Ops"],
  responses: {
    200: {
      description: "Service is healthy",
      body: z.object({ ok: z.literal(true), runtime: z.literal("cloudflare-worker") }),
    },
  },
  handler: async () => ({
    status: 200,
    body: { ok: true as const, runtime: "cloudflare-worker" as const },
  }),
});

// daloy-minimal:strip-start books
const Book = z.object({ id: z.string(), title: z.string() });
const books = new Map<string, z.infer<typeof Book>>([
  ["1", { id: "1", title: "Noli Me Tangere" }],
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
// daloy-minimal:strip-end books

export default toFetchHandler(app);
