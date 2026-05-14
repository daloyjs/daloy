import { z } from "zod";
import { App, NotFoundError, requestId, secureHeaders } from "@daloyjs/core";
import { toEdgeHandler } from "@daloyjs/core/vercel";
import { generateOpenAPI } from "@daloyjs/core/openapi";
import { htmlResponse, swaggerUiHtml } from "@daloyjs/core/docs";

export const config = { runtime: "edge" };

const app = new App({
  bodyLimitBytes: 256 * 1024,
  requestTimeoutMs: 5_000,
  production: process.env.NODE_ENV === "production",
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

// --- API documentation -----------------------------------------------------
// `/openapi.json` returns the OpenAPI 3.1 spec generated from the routes above.
// `/docs` serves a Swagger UI page that loads that spec.

app.route({
  method: "GET",
  path: "/openapi.json",
  operationId: "getOpenAPI",
  tags: ["Docs"],
  responses: { 200: { description: "OpenAPI 3.1 document" } },
  handler: async () => ({
    status: 200 as const,
    body: generateOpenAPI(app, {
      info: { title: "My Daloy Edge API", version: "0.0.1" },
    }),
  }),
});

app.route({
  method: "GET",
  path: "/docs",
  operationId: "docs",
  tags: ["Docs"],
  responses: { 200: { description: "API reference UI" } },
  handler: async () => {
    const html = swaggerUiHtml({ specUrl: "/openapi.json", title: "My Daloy Edge API" });
    const res = htmlResponse(html);
    return {
      status: 200 as const,
      body: html,
      headers: Object.fromEntries(res.headers),
    };
  },
});

export default toEdgeHandler(app);
