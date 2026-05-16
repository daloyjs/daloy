import { z } from "zod";
import {
  App,
  NotFoundError,
  rateLimit,
  requestId,
  secureHeaders,
} from "@daloyjs/core";
// daloy-minimal:strip-start docs
import { generateOpenAPI } from "@daloyjs/core/openapi";
import { htmlResponse, swaggerUiHtml } from "@daloyjs/core/docs";
// daloy-minimal:strip-end docs

/**
 * Build the application as a pure factory.
 *
 * Keeping this separate from `serve(app, ...)` lets `deno test` and the
 * OpenAPI dump script reuse the same `App` without booting an HTTP listener
 * as a side effect.
 */
export function buildApp(): App {
  const app = new App({
    bodyLimitBytes: 1024 * 1024,
    requestTimeoutMs: 5_000,
    production: Deno.env.get("DENO_ENV") === "production",
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
        body: z.object({ ok: z.literal(true), runtime: z.literal("deno") }),
      },
    },
    handler: async () => ({
      status: 200,
      body: { ok: true as const, runtime: "deno" as const },
    }),
  });

  // daloy-minimal:strip-start books
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
  // daloy-minimal:strip-end books

  // daloy-minimal:strip-start docs
  app.route({
    method: "GET",
    path: "/openapi.json",
    operationId: "getOpenAPI",
    tags: ["Docs"],
    responses: { 200: { description: "OpenAPI 3.1 document" } },
    handler: async () => ({
      status: 200 as const,
      body: generateOpenAPI(app, {
        info: { title: "My Daloy Deno API", version: "0.0.1" },
        servers: [{ url: `http://localhost:${Deno.env.get("PORT") ?? "3000"}` }],
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
      const html = swaggerUiHtml({ specUrl: "/openapi.json", title: "My Daloy Deno API" });
      const res = htmlResponse(html);
      return {
        status: 200 as const,
        body: html,
        headers: Object.fromEntries(res.headers),
      };
    },
  });
  // daloy-minimal:strip-end docs

  return app;
}

export default buildApp;
