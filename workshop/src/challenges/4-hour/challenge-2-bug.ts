// CHALLENGE 2 — BUG: a teammate "made the tests pass" by weakening secure defaults.
//
// There are FIVE intentional security regressions hidden in this file.
// Your job: find them, explain why each is dangerous, and fix them WITHOUT
// removing the test or weakening the framework's defaults.
//
// Hint: the framework's posture is "bad defaults are bugs". If a default
// is in the way, narrow the scope (per-route override) — don't disable it.
//
// Docs to skim before you start:
//   - https://daloyjs.dev/docs/security
//   - https://daloyjs.dev/docs/security/secure-defaults
//   - https://daloyjs.dev/docs/errors
//   - https://daloyjs.dev/docs/auth

import { App, NotFoundError, bearerAuth, cors, rateLimit } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { z } from "zod";

const books = new Map<string, { id: string; title: string }>([
  ["1", { id: "1", title: "Foundation" }],
]);
const BookSchema = z.object({ id: z.string(), title: z.string() });

// REGRESSION #1: body limit and request timeout disabled.
const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: {
    info: { title: "Workshop API", version: "0.1.0" },
    // REGRESSION #2: securitySchemes declares "none" — alg-confusion-style misconfig.
    securitySchemes: { bearer: { type: "http", scheme: "none" as any } },
  },
  docs: true,
  bodyLimitBytes: 0,        // ← suspicious
  requestTimeoutMs: 0,      // ← suspicious
});

// REGRESSION #3: secureHeaders removed entirely. "It was breaking the local CORS test."
app.use(cors({ origin: () => true, credentials: true })); // REGRESSION #4: predicate reflects ANY origin + credentials
app.use(rateLimit({ windowMs: 60_000, max: 1_000_000 })); // effectively disabled

app.get(
  "/books/:id",
  {
    operationId: "getBookById",
    tags: ["Books"],
    request: { params: z.object({ id: z.string() }) }, // no .min(1)
    responses: {
      200: { description: "OK", body: BookSchema },
      404: { description: "Not documented well; handler still leaks a hand-rolled body." },
    },
  },
  async ({ params }) => {
    const b = books.get(params.id);
    if (!b) {
      // REGRESSION #5: leaks server internals in the body, bypasses RFC 9457.
      return {
        status: 404 as const,
        body: {
          error: `Lookup failed in books.get() at /app/src/books.ts:42 for id=${params.id}`,
        } as any,
      };
    }
    return { status: 200 as const, body: b };
  },
);

app.post(
  "/books",
  {
    operationId: "createBook",
    tags: ["Books"],
    // REGRESSION (bonus): no `.strict()`, accepts mass-assignment.
    request: { body: z.object({ id: z.string(), title: z.string() }) },
    // REGRESSION (bonus): no `auth` field, but `hooks` enforces bearer at runtime.
    // Docs are wrong on purpose.
    hooks: bearerAuth({ validate: (token) => token === "demo-token" }),
    responses: { 201: { description: "Created", body: BookSchema } },
  },
  async ({ body }) => {
    books.set(body.id, body);
    return { status: 201 as const, body };
  },
);

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/docs");
