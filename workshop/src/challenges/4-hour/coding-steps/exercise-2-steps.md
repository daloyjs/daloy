# Exercise 2 — Step-by-Step

> Goal: stop hand-rolling error bodies. Throw framework errors and let DaloyJS render RFC 9457 problem+json with the right status, headers, and consistent shape.

You are editing [`exercise-2.ts`](../exercise-2.ts). Reference: [`solutions/exercise-2-end.ts`](../solutions/exercise-2-end.ts).

---

## Mental model first

DaloyJS exports specific error classes for common statuses (`NotFoundError`, `ValidationError`, `UnauthorizedError`, `ForbiddenError`, `TooManyRequestsError`, etc.) and the general `HttpError` for statuses like 409. Each one:

1. Maps to a specific HTTP status code.
2. Is rendered as `application/problem+json` (RFC 9457) on the way out.
3. Keeps expected 4xx errors client-readable and redacts internal 5xx details in production.
4. Composes cleanly with structured logging — every error keeps its `requestId` (see exercise 3).

You **do not return** these errors. You **throw** them. The framework's outer middleware catches them and renders the response.

The order of work:

1. Swap the manual 404 for `throw new NotFoundError(...)`.
2. Add `POST /books` with a `.strict()` request body schema.
3. Throw `HttpError(409, ...)` on duplicate id.
4. Verify the three failure modes (not found, missing field, unknown key) all return well-formed problem+json.

---

## Step 1 — Throw `NotFoundError` instead of returning a 404 body

**Why first:** the existing handler already has the not-found branch. You're collapsing six lines of hand-rolled problem+json into one `throw`.

Add `NotFoundError` to the import:

```ts
import { App, NotFoundError, HttpError } from "@daloyjs/core";
```

Replace the if-block in the `GET` handler:

```ts
const book = books.get(params.id);
if (!book) throw new NotFoundError(`No book with id ${params.id}`);
return { status: 200 as const, body: book };
```

**Why this is better than the manual body:** the framework now picks the right `type` URI, sets `content-type: application/problem+json`, sets `status: 404` on the response, and copies the `requestId` into the body for correlation. None of that is your handler's responsibility anymore.

---

## Step 2 — Add a `.strict()` create-book schema

**Why a separate schema from `BookSchema`:** the response body and the request body are not the same. A server-generated `id` (when you have one) shouldn't be in the request shape; a `createdAt` shouldn't be in the request shape either. Even if they look identical today, separate them so they can drift independently.

Above `const app = ...`:

```ts
const CreateBookSchema = z
  .object({ id: z.string().min(1), title: z.string().min(1).max(200) })
  .strict();
```

**Why `.strict()` is non-negotiable:** without it, Zod silently accepts and discards unknown keys. That's the door through which mass-assignment bugs walk in (`POST /users { name, email, isAdmin: true }`). `.strict()` rejects unknown keys with a 400 — every workshop-shipped schema in DaloyJS uses it by convention.

---

## Step 3 — Register `POST /books`

Below the existing `GET /books/:id` route:

```ts
app.post(
  "/books",
  {
    operationId: "createBook",
    tags: ["Books"],
    request: { body: CreateBookSchema },
    responses: {
      201: { description: "Created", body: BookSchema },
      409: { description: "Already exists" },
    },
  },
  async ({ body }) => {
    if (books.has(body.id)) {
      throw new HttpError(409, { title: "Conflict", detail: `Book ${body.id} already exists` });
    }
    books.set(body.id, body);
    return { status: 201 as const, body };
  },
);
```

**Why `body` is destructured but not validated again:** by the time the handler runs, the framework has already parsed and validated the body against `CreateBookSchema`. The `body` inside the handler is typed as `z.infer<typeof CreateBookSchema>`. You're guaranteed both fields exist and have the right types.

**Why throw `HttpError` instead of returning a 409:** same reason as step 1 — uniform error rendering, status handling, and no chance of forgetting the problem+json content type.

---

## Step 4 — Verify the three failure modes

Save the file. Then:

```bash
# (a) Not found
curl -s -i http://localhost:3000/books/missing | head -n 4
# HTTP/1.1 404 Not Found
# content-type: application/problem+json; charset=utf-8
# {"type":"about:blank","title":"Not Found","status":404,"detail":"No book with id missing","requestId":"…"}

# (b) Missing required field → ValidationError → 400
curl -s -X POST http://localhost:3000/books \
  -H 'content-type: application/json' -d '{"id":"3"}'
# {"type":"about:blank","title":"Validation Error","status":400,"detail":"…title…","errors":[{"path":"title","message":"…"}]}

# (c) Unknown key (mass-assignment attempt) → .strict() → 400
curl -s -X POST http://localhost:3000/books \
  -H 'content-type: application/json' -d '{"id":"3","title":"Hyperion","isAdmin":true}'
# {"type":"about:blank","title":"Validation Error","status":400,"detail":"Unrecognized key: \"isAdmin\""}
```

All three responses share a single problem+json shape. Your handler did not touch any of them.

---

## Step 5 — Talk about redaction boundaries (optional, instructive)

Expected 4xx errors can carry useful client-facing `detail` in production. Internal 5xx errors are the ones DaloyJS redacts by default, because they often contain stack, database, or integration details. The rule of thumb: put only safe, user-actionable text in 4xx `detail` and never put secrets there.

---

## Code-change cheat sheet

| Step | Where               | Change                                                            |
| ---- | ------------------- | ----------------------------------------------------------------- |
| 1    | Top imports         | Add `NotFoundError`, `HttpError`                                  |
| 1    | `GET` handler       | `throw new NotFoundError(...)` instead of manual 404 body         |
| 2    | Top of file         | Add `CreateBookSchema` with `.strict()`                           |
| 3    | New `app.post(...)` | Register `POST /books` with the schema and `HttpError(409, ...)`  |

---

## Common mistakes

- **Returning the error object instead of throwing it.** The framework only catches thrown errors. `return new NotFoundError(...)` will serialize as JSON and respond with 200.
- **Skipping `.strict()`.** Your tests pass. Production accepts `{ id, title, isAdmin: true }`. You file a CVE three months later.
- **Re-validating `body` inside the handler.** It was already validated. Re-running the schema is dead code that hides real bugs (e.g. you might validate a _different_ schema by accident).
- **Inventing a `type` URI for problem+json.** Don't. Let the framework default to `about:blank` — or point at real docs you own (configure once globally, not per-throw).
