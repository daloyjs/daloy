import { z } from "zod";
import { App, NotFoundError, requestId, secureHeaders } from "@daloyjs/core";
import { toWebHandler } from "@daloyjs/core/vercel";

// This template defaults to Vercel's Edge runtime for compatibility with the
// existing `vercel-edge` starter. For Vercel's recommended Node.js runtime,
// remove this config and export `toFetchHandler(app)` from @daloyjs/core/vercel.
export const config = { runtime: "edge" };

const app = new App({
  bodyLimitBytes: 256 * 1024,
  requestTimeoutMs: 5_000,
  production: process.env.NODE_ENV === "production",
  // daloy-minimal:strip-start docs
  // Auto-mounted docs (when `docs: true`):
  //   GET /openapi.json — OpenAPI 3.1 spec (JSON)
  //   GET /openapi.yaml — OpenAPI 3.1 spec (YAML, served inline as text/yaml)
  //   GET /docs         — Scalar API reference UI that loads the spec
  openapi: {
    info: { title: "My Daloy Edge API", version: "0.0.1" },
  },
  docs: true,
  // daloy-minimal:strip-end docs
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
      body: z.object({ ok: z.literal(true), runtime: z.literal("vercel-edge") }),
    },
  },
  handler: async () => ({
    status: 200,
    body: { ok: true as const, runtime: "vercel-edge" as const },
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

export default toWebHandler(app);
