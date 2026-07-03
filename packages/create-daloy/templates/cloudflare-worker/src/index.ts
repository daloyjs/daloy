import { z } from "zod";
import { App, NotFoundError, rateLimit, requestId, secureHeaders } from "@daloyjs/core";
import { toFetchHandler } from "@daloyjs/core/cloudflare";

const app = new App({
  bodyLimitBytes: 256 * 1024,
  requestTimeoutMs: 5_000,
  production: true,
  // Cloudflare Workers always run behind Cloudflare's edge, which sets
  // X-Forwarded-For. Declare that single trusted hop so DaloyJS reads the real
  // client IP instead of refusing the (otherwise spoofable) header and
  // returning 500 in production. Increase the hop count if you put an
  // additional proxy in front of the Worker.
  behindProxy: { hops: 1 },
  // daloy-minimal:strip-start docs
  // Auto-mounted docs (since `docs: true`): GET /openapi.json, /openapi.yaml,
  // and /docs (Scalar UI). DaloyJS is dependency-free and the Scalar UI loads
  // from a CDN, so this adds negligible Worker bundle size. Drop `docs` (and
  // this `openapi` block) if you want the smallest possible bundle.
  openapi: {
    info: { title: "My Daloy Cloudflare API", version: "0.0.1" },
  },
  docs: true,
  // daloy-minimal:strip-end docs
});

app.use(requestId());
app.use(secureHeaders());
// The in-memory limiter resets per Worker isolate, so treat it as a
// per-isolate abuse brake, not a global quota. For high-traffic routes, attach
// Cloudflare's native rate-limit binding in addition to — not instead of —
// this baseline. Do not remove it to make a test pass; raise `max` per route.
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

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
    status: 200 as const,
    body: { ok: true as const, runtime: "cloudflare-worker" as const },
  }),
});

// daloy-minimal:strip-start books
const Book = z.object({ id: z.string(), title: z.string() }).strict();
const books = new Map<string, z.infer<typeof Book>>([
  ["1", { id: "1", title: "Noli Me Tangere" }],
]);

app.route({
  method: "GET",
  path: "/books/:id",
  operationId: "getBookById",
  tags: ["Books"],
  request: { params: z.object({ id: z.string().min(1) }).strict() },
  responses: {
    200: { description: "Found", body: Book },
    404: { description: "Not found" },
  },
  handler: async ({ params }) => {
    const book = books.get(params.id);
    if (!book) throw new NotFoundError(`Book ${params.id} not found`);
    return { status: 200 as const, body: book };
  },
});
// daloy-minimal:strip-end books

// Cloudflare invokes the default export's `fetch`. The `app` instance is also
// exported (a no-op for the Worker runtime) so `tests/contract.test.ts` can
// contract-check the route table in-process without booting the handler.
export { app };

export default toFetchHandler(app);
