import { z } from "zod";
import {
  App,
  NotFoundError,
  rateLimit,
  requestId,
  secureHeaders,
} from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { generateOpenAPI } from "@daloyjs/core/openapi";
import { htmlResponse, swaggerUiHtml } from "@daloyjs/core/docs";

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

// --- API documentation -----------------------------------------------------
// `/openapi.json` returns the live OpenAPI 3.1 spec generated from the routes
// defined above. `/docs` serves a Swagger UI page that loads that spec.

app.route({
  method: "GET",
  path: "/openapi.json",
  operationId: "getOpenAPI",
  tags: ["Docs"],
  responses: { 200: { description: "OpenAPI 3.1 document" } },
  handler: async () => ({
    status: 200 as const,
    body: generateOpenAPI(app, {
      info: { title: "My Daloy API", version: "0.0.1" },
      servers: [{ url: `http://localhost:${port}` }],
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
    const html = swaggerUiHtml({ specUrl: "/openapi.json", title: "My Daloy API" });
    const res = htmlResponse(html);
    return {
      status: 200 as const,
      body: html,
      headers: Object.fromEntries(res.headers),
    };
  },
});

serve(app, { port });
console.log(`DaloyJS listening on http://localhost:${port}`);
console.log(`  Swagger UI:  http://localhost:${port}/docs`);
console.log(`  OpenAPI JSON: http://localhost:${port}/openapi.json`);
console.log(`  Health:       http://localhost:${port}/healthz`);
