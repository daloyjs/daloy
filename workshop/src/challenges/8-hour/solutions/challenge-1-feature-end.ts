import { App, NotFoundError, HttpError, bearerAuth } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

const BEARER = "workshop-token";
function eq(a: string, b: string) {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
const auth = bearerAuth({ validate: async (t) => eq(t, BEARER) });

const AuthorSchema = z.object({
  id: z.string(),
  name: z.string(),
  birthYear: z.number().int().min(1000).max(3000).optional(),
  deleted: z.boolean().default(false),
});
const CreateAuthorBody = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(200),
    birthYear: z.number().int().min(1000).max(3000).optional(),
  })
  .strict();
const PatchAuthorBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    birthYear: z.number().int().min(1000).max(3000).optional(),
  })
  .strict();

type Author = z.infer<typeof AuthorSchema>;
const authors = new Map<string, Author>([
  ["asimov", { id: "asimov", name: "Isaac Asimov", birthYear: 1920, deleted: false }],
  ["herbert", { id: "herbert", name: "Frank Herbert", birthYear: 1920, deleted: false }],
]);

const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: {
    info: { title: "Workshop API", version: "0.1.0" },
    securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
  },
  docs: true,
});

app.get(
  "/authors",
  {
    operationId: "listAuthors",
    tags: ["Authors"],
    request: { query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).strict() },
    responses: {
      200: {
        description: "OK",
        body: z.object({ items: z.array(AuthorSchema), total: z.number() }),
      },
    },
  },
  async ({ query }) => {
    const items = [...authors.values()].filter((a) => !a.deleted).slice(0, query.limit);
    return { status: 200 as const, body: { items, total: items.length } };
  },
);

app.get(
  "/authors/:id",
  {
    operationId: "getAuthor",
    tags: ["Authors"],
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: {
      200: {
        description: "OK",
        body: AuthorSchema,
        examples: {
          asimov: { id: "asimov", name: "Isaac Asimov", birthYear: 1920, deleted: false },
          herbert: { id: "herbert", name: "Frank Herbert", birthYear: 1920, deleted: false },
        },
      },
      404: { description: "Not found" },
    },
  },
  async ({ params }) => {
    const a = authors.get(params.id);
    if (!a || a.deleted) throw new NotFoundError(`No author ${params.id}`);
    return { status: 200 as const, body: a };
  },
);

app.post(
  "/authors",
  {
    operationId: "createAuthor",
    tags: ["Authors"],
    auth: { scheme: "bearer" },
    hooks: auth,
    request: { body: CreateAuthorBody },
    responses: { 201: { description: "Created", body: AuthorSchema }, 409: { description: "Duplicate" } },
  },
  async ({ body }) => {
    if (authors.has(body.id) && !authors.get(body.id)!.deleted) {
      throw new HttpError(409, { title: "Conflict", detail: `Author ${body.id} already exists` });
    }
    const a: Author = { ...body, deleted: false };
    authors.set(body.id, a);
    return { status: 201 as const, body: a };
  },
);

app.patch(
  "/authors/:id",
  {
    operationId: "patchAuthor",
    tags: ["Authors"],
    auth: { scheme: "bearer" },
    hooks: auth,
    request: { params: z.object({ id: z.string().min(1) }), body: PatchAuthorBody },
    responses: { 200: { description: "OK", body: AuthorSchema }, 404: { description: "Not found" } },
  },
  async ({ params, body }) => {
    const a = authors.get(params.id);
    if (!a || a.deleted) throw new NotFoundError(`No author ${params.id}`);
    const updated = { ...a, ...body };
    authors.set(params.id, updated);
    return { status: 200 as const, body: updated };
  },
);

app.delete(
  "/authors/:id",
  {
    operationId: "deleteAuthor",
    tags: ["Authors"],
    auth: { scheme: "bearer" },
    hooks: auth,
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: { 204: { description: "Deleted" }, 404: { description: "Not found" } },
  },
  async ({ params }) => {
    const a = authors.get(params.id);
    if (!a || a.deleted) throw new NotFoundError(`No author ${params.id}`);
    a.deleted = true;
    return { status: 204 as const, body: undefined };
  },
);

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/docs");
