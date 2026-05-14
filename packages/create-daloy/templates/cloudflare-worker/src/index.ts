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

export default { fetch: toFetchHandler(app) };
