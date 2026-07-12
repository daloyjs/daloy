import { App, bearerAuth, UnauthorizedError, ForbiddenError, type Hooks } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

const VALID_ADMIN_TOKEN = "admin-token";
const VALID_API_KEYS = new Map([["partner-a", "team-blue"], ["partner-b", "team-red"]]);

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const apiKeyAuth: Hooks = {
  beforeHandle(ctx) {
    const key = ctx.request.headers.get("x-api-key");
    if (!key) throw new UnauthorizedError("Missing X-API-Key header");
    if (!VALID_API_KEYS.has(key)) throw new ForbiddenError("Invalid API key");
  },
};

const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: {
    info: { title: "Workshop API", version: "0.1.0" },
    securitySchemes: {
      bearer: { type: "http", scheme: "bearer" },
      apiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
    },
  },
  docs: true,
});

const BookSchema = z.object({ id: z.string(), title: z.string() });
const books = new Map<string, { id: string; title: string }>();

app.post(
  "/admin/books",
  {
    operationId: "createBookAsAdmin",
    tags: ["Admin"],
    auth: { scheme: "bearer" },
    hooks: bearerAuth({ validate: async (token) => constantTimeEqual(token, VALID_ADMIN_TOKEN) }),
    request: { body: z.object({ id: z.string().min(1), title: z.string().min(1) }).strict() },
    responses: { 201: { description: "Created", body: BookSchema }, 401: { description: "Missing token" }, 403: { description: "Bad token" } },
  },
  async ({ body }) => {
    books.set(body.id, body);
    return { status: 201 as const, body };
  },
);

app.get(
  "/partner/books",
  {
    operationId: "listBooksAsPartner",
    tags: ["Partner"],
    auth: { scheme: "apiKey" },
    hooks: apiKeyAuth,
    responses: {
      200: { description: "OK", body: z.object({ items: z.array(BookSchema) }) },
      401: { description: "Missing key" },
      403: { description: "Bad key" },
    },
  },
  async () => ({ status: 200 as const, body: { items: [...books.values()] } }),
);

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/docs");
