import { z } from "zod";
import {
  App,
  NotFoundError,
  rateLimit,
  requestId,
  secureHeaders,
} from "@daloyjs/core";

/**
 * Build the application as a pure factory so the same `App` is reused by
 * `bun --hot src/index.ts`, `scripts/dump-openapi.ts`, and `bun test`
 * without importing the `serve()` adapter (and accidentally booting the
 * HTTP listener as a side effect).
 */
export function buildApp(): App {
  const app = new App({
    bodyLimitBytes: 1024 * 1024,
    requestTimeoutMs: 5_000,
    production: process.env.NODE_ENV === "production",
    // Reverse-proxy posture. When the app runs behind a trusted edge proxy
    // (Railway, Render, Fly, Heroku, a single nginx / load balancer), set the
    // TRUST_PROXY_HOPS env var to the number of proxy hops in front of it — a
    // single PaaS edge is 1. DaloyJS then reads the real client IP from the
    // matching X-Forwarded-For slot (used by rateLimit, requestId, and audit
    // logs). Leave it unset when the app is exposed directly to the public
    // internet: DaloyJS refuses to honor spoofable X-Forwarded-* headers
    // (returning 500 on the first forwarded request) rather than trust a
    // header an attacker can set. See the DaloyJS deployment guide for the
    // per-platform hop counts.
    ...(process.env.TRUST_PROXY_HOPS
      ? { behindProxy: { hops: Number(process.env.TRUST_PROXY_HOPS) } }
      : {}),
    // daloy-minimal:strip-start docs
    // Auto-mounted docs (when `docs: true`):
    //   GET /openapi.json — OpenAPI 3.1 spec (JSON)
    //   GET /openapi.yaml — OpenAPI 3.1 spec (YAML, served inline as text/yaml)
    //   GET /docs         — Scalar API reference UI that loads the spec
    // Customize via `docs: { openapiYamlPath: false }` to disable the YAML route.
    // `info.title` / `info.version` are pulled from package.json by default;
    // set `openapi.info` here to override them.
    openapi: {
      // Leave `servers` unset so the Scalar "Try it" panel and the generated
      // client target the origin the docs are served from — the deployed
      // domain in production, localhost in dev — which keeps "Try it" within
      // the connect-src 'self' CSP on every platform. Never hardcode a URL
      // here: a localhost default breaks "Try it" once deployed. Set PUBLIC_URL
      // to pin an absolute base URL (e.g. for client codegen).
      ...(process.env.PUBLIC_URL
        ? { servers: [{ url: process.env.PUBLIC_URL }] }
        : {}),
    },
    docs: true,
    // daloy-minimal:strip-end docs
  });

  app.use(requestId());
  app.use(secureHeaders());
  app.use(rateLimit({ windowMs: 60_000, max: 120 }));

  app.get(
    "/healthz",
    {
      operationId: "healthz",
      tags: ["Ops"],
      responses: {
        200: {
          description: "Service is healthy",
          body: z.object({ ok: z.literal(true), runtime: z.literal("bun") }),
        },
      },
    },
    async () => ({
      status: 200 as const,
      body: { ok: true as const, runtime: "bun" as const },
    }),
  );

  // daloy-minimal:strip-start books
  const Book = z.object({ id: z.string(), title: z.string() }).strict();
  const books = new Map<string, z.infer<typeof Book>>([
    ["1", { id: "1", title: "Noli Me Tangere" }],
    ["2", { id: "2", title: "El Filibusterismo" }],
  ]);

  app.get(
    "/books/:id",
    {
      operationId: "getBookById",
      tags: ["Books"],
      request: { params: z.object({ id: z.string().min(1) }).strict() },
      responses: {
        200: { description: "Found", body: Book },
        404: { description: "Not found" },
      },
    },
    async ({ params }) => {
      const book = books.get(params.id);
      if (!book) throw new NotFoundError(`Book ${params.id} not found`);
      return { status: 200 as const, body: book };
    },
  );
  // daloy-minimal:strip-end books

  return app;
}

export default buildApp;
