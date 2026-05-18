import { z } from "zod";
import {
  App,
  NotFoundError,
  rateLimit,
  requestId,
  secureHeaders,
} from "@daloyjs/core";

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
    // daloy-minimal:strip-start docs
    // Auto-mounted docs (when `docs: true`):
    //   GET /openapi.json — OpenAPI 3.1 spec (JSON)
    //   GET /openapi.yaml — OpenAPI 3.1 spec (YAML, served inline as text/yaml)
    //   GET /docs         — Scalar API reference UI that loads the spec
    // Customize via `docs: { openapiYamlPath: false }` to disable the YAML route.
    // `info.title` / `info.version` are pulled from deno.json by default;
    // set `openapi.info` here to override them.
    openapi: {
      servers: [{ url: `http://localhost:${Deno.env.get("PORT") ?? "3000"}` }],
    },
    docs: true,
    // daloy-minimal:strip-end docs
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

  return app;
}

export default buildApp;
