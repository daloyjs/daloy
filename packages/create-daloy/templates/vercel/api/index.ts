import { z } from "zod";
import { App, NotFoundError, rateLimit, requestId, secureHeaders } from "@daloyjs/core";
import { toFetchHandler } from "@daloyjs/core/vercel";

// This template targets Vercel's Node.js runtime — the runtime Vercel now
// recommends for standalone functions (it runs on Fluid Compute, with the
// performance of the edge network but full Node API support). Node.js is the
// default runtime, so no `runtime` export is needed. Vercel Node.js Functions
// expect a default export with a `fetch` method, which is exactly what
// `toFetchHandler(app)` returns. If you specifically need the Edge runtime
// instead, add `export const runtime = "edge"` and switch the default export to
// `toWebHandler(app)` from "@daloyjs/core/vercel".
//
// This single function owns ALL routing: `vercel.json` rewrites every path to
// `/api`, and DaloyJS matches the original request path (`/healthz`, `/docs`,
// …). So the app's routes are served at the site root, not under `/api/*`.
// Do not split this into per-path files — keep one entry so the middleware
// chain and the generated OpenAPI spec stay unified.

// Exported so the local dev server (`src/dev.ts`, run by `pnpm dev`) can serve
// the same app over a plain Node listener. Vercel uses the default export below.
export const app = new App({
  bodyLimitBytes: 256 * 1024,
  requestTimeoutMs: 5_000,
  production: process.env.NODE_ENV === "production",
  // Reverse-proxy posture. On Vercel, every request reaches the function
  // through Vercel's edge, which sets `x-forwarded-for`. The app must declare
  // that trusted hop, otherwise DaloyJS refuses the spoofable header and
  // returns 500 in production. Vercel is exactly one edge hop, so the default
  // is 1; override TRUST_PROXY_HOPS only if you put another proxy in front
  // (e.g. set it to 2 behind Cloudflare -> Vercel).
  behindProxy: { hops: Number(process.env.TRUST_PROXY_HOPS ?? "1") },
  // daloy-minimal:strip-start docs
  // Auto-mounted docs (when `docs: true`):
  //   GET /openapi.json — OpenAPI 3.1 spec (JSON)
  //   GET /openapi.yaml — OpenAPI 3.1 spec (YAML, served inline as text/yaml)
  //   GET /docs         — Scalar API reference UI that loads the spec
  openapi: {
    info: { title: "My Daloy Vercel API", version: "0.0.1" },
  },
  docs: true,
  // daloy-minimal:strip-end docs
});

app.use(requestId());
app.use(secureHeaders());
// The in-memory limiter resets per function instance on Vercel, so treat it as
// a per-instance abuse brake, not a global quota. For production traffic, back
// it with a shared `RateLimitStore` (e.g. Upstash Redis from the Vercel
// Marketplace) — in addition to, not instead of, this baseline. Do not remove
// it to make a test pass; raise `max` per route.
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

app.get(
  "/healthz",
  {
    operationId: "healthz",
    tags: ["Ops"],
    responses: {
      200: {
        description: "Service is healthy",
        body: z.object({ ok: z.literal(true), runtime: z.literal("vercel") }),
      },
    },
  },
  async () => ({
    status: 200 as const,
    body: { ok: true as const, runtime: "vercel" as const },
  }),
);

// daloy-minimal:strip-start books
const Book = z.object({ id: z.string(), title: z.string() }).strict();
const books = new Map<string, z.infer<typeof Book>>([
  ["1", { id: "1", title: "Noli Me Tangere" }],
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

export default toFetchHandler(app);
