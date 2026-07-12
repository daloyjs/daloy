# 8-Hour · Exercise 2 — Step-by-Step

> Goal: validate each part of the request (path, query, body, headers) with its own schema slot, and use a header for idempotency.

You are editing [`exercise-2.ts`](../exercise-2.ts). Reference: [`solutions/exercise-2-end.ts`](../solutions/exercise-2-end.ts).

## Mental model

`request` is an object with four optional slots, each a Standard Schema:

```ts
request: {
  params?:  Schema;   // path params
  query?:   Schema;   // ?foo=bar
  headers?: Schema;   // case-insensitive on wire, lowercase keys in schema
  body?:    Schema;   // application/json (or multipart — see 8-hour later)
}
```

Each slot runs its own validator. Each lands in OpenAPI with the right `in:` location.

## Step 1 — Define the three schemas

Above `const app = new App({...})`:

```ts
const ListBooksQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(["available", "checked-out"]).optional(),
  })
  .strict();

const CreateBookBody = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1).max(200),
    status: z.enum(["available", "checked-out"]).default("available"),
  })
  .strict();

const IdempotencyHeaders = z.object({ "idempotency-key": z.string().uuid() });
```

**Why `z.coerce.number()` on `limit`:** the query string is always strings on the wire. `z.coerce.number()` does a one-way conversion. Without it, your validator rejects every legitimate request.

**Why no `.strict()` on `IdempotencyHeaders`:** HTTP requests always carry a forest of headers you don't care about (`accept`, `user-agent`, `content-length`, etc.). `.strict()` would reject every one. Headers are inherently open; validate _just the ones you read_.

## Step 2 — Register `GET /books` with the query schema

```ts
app.get(
  "/books",
  {
    operationId: "listBooks",
    tags: ["Books"],
    request: { query: ListBooksQuery },
    responses: {
      200: {
        description: "List of books",
        body: z.object({ items: z.array(BookSchema), total: z.number() }),
      },
    },
  },
  async ({ query }) => {
    const filtered = [...books.values()].filter((b) => !query.status || b.status === query.status);
    return {
      status: 200 as const,
      body: { items: filtered.slice(0, query.limit), total: filtered.length },
    };
  },
);
```

Inside the handler, `query.limit` is typed as `number` (already coerced) and `query.status` is typed as the enum union. You never touch a string-to-number conversion in user code.

## Step 3 — Register `POST /books` with body + headers

```ts
app.post(
  "/books",
  {
    operationId: "createBook",
    tags: ["Books"],
    request: { headers: IdempotencyHeaders, body: CreateBookBody },
    responses: {
      201: { description: "Created", body: BookSchema },
      409: { description: "Replay or duplicate id" },
    },
  },
  async ({ headers, body }) => {
    const key = headers["idempotency-key"];
    if (seenIdempotencyKeys.has(key)) {
      throw new HttpError(409, { title: "Conflict", detail: "This idempotency-key was already used" });
    }
    if (books.has(body.id)) {
      throw new HttpError(409, { title: "Conflict", detail: `Book ${body.id} already exists` });
    }
    seenIdempotencyKeys.add(key);
    books.set(body.id, body);
    return { status: 201 as const, body };
  },
);
```

**Why idempotency-key uses a header, not the body:** the body is the resource being created. The key is metadata _about_ the request — a different concern. Per industry convention (Stripe, IETF draft), it always goes in a header.

## Step 4 — Verify in OpenAPI

```bash
curl -s http://localhost:3000/openapi.json | jq '.paths."/books".post.parameters'
# [{"in":"header","name":"idempotency-key",...}]
curl -s http://localhost:3000/openapi.json | jq '.paths."/books".get.parameters'
# [{"in":"query","name":"limit",...},{"in":"query","name":"status",...}]
```

Each parameter has its `in` field set correctly. The generated typed client will know to put `limit` in the URL query and `idempotency-key` in the request headers.

## Code-change cheat sheet

| Step | Where        | Change                                                            |
| ---- | ------------ | ----------------------------------------------------------------- |
| 1    | Top          | Three schemas: `ListBooksQuery`, `CreateBookBody`, `IdempotencyHeaders` |
| 2    | New route    | `GET /books` with `request.query`                                  |
| 3    | New route    | `POST /books` with `request.headers` + `request.body`              |
| 4    | Verify       | Inspect `/openapi.json` for `in:` locations                        |

## Common mistakes

- **`.strict()` on the headers schema.** Rejects every real request — every browser sends headers you didn't validate.
- **Forgetting `z.coerce` on numeric query params.** Validation fails because `"20"` is not a `number`.
- **Reading the idempotency key from `body`.** Caches and proxies can't see body content; they _can_ see headers. Put metadata where the rest of the HTTP ecosystem expects it.
