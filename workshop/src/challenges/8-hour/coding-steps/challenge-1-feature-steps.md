# 8-Hour · Challenge 1 (Feature) — Step-by-Step

> Goal: build a full CRUD slice using everything from exercises 1–8.

This is **a synthesis challenge**, not a new-concept exercise. The steps below are checkpoints rather than complete code.

## Step 1 — Schemas

```ts
const AuthorSchema = z.object({
  id: z.string(),
  name: z.string(),
  birthYear: z.number().int().min(1000).max(3000).optional(),
  deleted: z.boolean().default(false),
});
const CreateAuthorBody = z.object({ id, name, birthYear? }).strict();
const PatchAuthorBody  = z.object({ name?, birthYear? }).strict();
```

Reuse `AuthorSchema` for every response body. Make the create/patch bodies separate so you can apply `.strict()` (server validation) without `deleted` leaking into client requests.

## Step 2 — State + auth helper

```ts
const authors = new Map<string, z.infer<typeof AuthorSchema>>([/* seed */]);

const auth = bearerAuth({ validate: async (t) => eq(t, BEARER) }); // eq uses timingSafeEqual
```

## Step 3 — Five routes

Pattern is the same as exercises 1, 2, 3, and 5. Things to remember:

- `GET /authors` — `request.query.limit` with `z.coerce.number()` and `.default(20)`.
- `GET /authors/:id` — `examples` map with two named entries; throw `NotFoundError` if missing or soft-deleted.
- `POST /authors` — `auth: { scheme: "bearer" }`, `hooks: auth`, 201 status, throw `HttpError(409, ...)` on duplicate.
- `PATCH /authors/:id` — `auth + hooks`, partial body, merge with `{ ...existing, ...body }`.
- `DELETE /authors/:id` — `auth + hooks`, returns `{ status: 204, body: undefined }`.

## Step 4 — Verify the OpenAPI spec

```bash
curl -s http://localhost:3000/openapi.json | jq '.paths | keys'
# ["/authors","/authors/{id}"]
curl -s http://localhost:3000/openapi.json | jq '.paths."/authors".post.security'
# [{"bearer":[]}]
```

Open `/docs` and check that:

- The "Authors" tag has all five operations.
- The write operations show a 🔒 indicator.
- The example dropdown works on `GET /authors/{id}`.

## Common mistakes

- **Forgetting `.default(false)` on `deleted`.** Without it, the schema rejects authors that don't have the field — but new authors are created without `deleted`, so the seed data fails to validate.
- **Returning `{ body: {} }` on DELETE.** A 204 response has no body. Return `{ status: 204, body: undefined }`.
- **Reusing `AuthorSchema` for the create body.** Then consumers could send `deleted: true` to create pre-deleted authors. Separate request schemas are not duplication; they're enforcement.
- **Skipping `eq`/`timingSafeEqual` for the bearer token.** Production-grade code doesn't compare tokens with `===`.
