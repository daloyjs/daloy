# Exercise 1 — Step-by-Step

> Goal: turn the stub `/books/:id` into a fully typed contract with a validated path parameter, a typed 200 body, and a documented 404 problem+json.

You are editing [`exercise-1.ts`](../exercise-1.ts). Reference: [`solutions/exercise-1-end.ts`](../solutions/exercise-1-end.ts).

---

## Mental model first

`app.get(path, {...}, handler)` (and its sibling shorthands `app.post`, `app.put`, `app.patch`, `app.delete`, `app.head`) has four contract slots that map 1:1 to OpenAPI:

| Slot                  | What it does at runtime                                          | What it does in the spec               |
| --------------------- | ---------------------------------------------------------------- | -------------------------------------- |
| `request.params`      | Validates the path parameters before your handler runs.          | Path parameters with schema.           |
| `request.query`       | Validates the query string.                                      | Query parameters with schema.          |
| `request.body`        | Validates the parsed body.                                       | Request body with schema.              |
| `responses[code].body` | Narrows the return type, validates the response on the way out. | Response body with schema + examples.  |

You will fill in **`request.params`**, **`responses[200].body`**, and **`responses[404].body`** in this exercise. Order matters because the response narrowing depends on the param being typed first.

---

## Step 1 — Add the schemas at the top of the file

**Why first:** they're reused by the route. Define once, reference twice.

Above the `const app = ...` line, add:

```ts
const BookSchema = z.object({ id: z.string(), title: z.string() });
const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  detail: z.string().optional(),
});
```

**Why `ProblemSchema` exists:** RFC 9457 is the IETF standard for HTTP error bodies. DaloyJS uses it by default for thrown framework errors (you'll see this in exercise 2). When _you_ return an error body manually, match the shape so clients can parse one error type.

---

## Step 2 — Validate the path param

Inside the `app.get(...)` contract options object, add a `request` slot:

```ts
request: { params: z.object({ id: z.string().min(1) }) },
```

**Why `.min(1)` and not `.uuid()`:** the seeded books map uses `"1"` and `"2"` as keys, so a strict uuid validator would reject every legitimate request. Use the loosest constraint that still rejects garbage. (In production, if your IDs _are_ uuids, switch to `z.string().uuid()` — it's a one-character change.)

**Why this matters:** once `request.params` is a schema, your handler's first argument is typed as `{ params: { id: string } }` instead of `{ params: Record<string, string> }`. No more `params.id ?? ""` defensive guards.

---

## Step 3 — Type the 200 response

Replace:

```ts
responses: {
  200: { description: "Book found" },
},
```

with:

```ts
responses: {
  200: {
    description: "Book found",
    body: BookSchema,
    examples: { default: { id: "1", title: "Foundation" } },
  },
  404: { description: "Book not found", body: ProblemSchema },
},
```

**Why add `examples`:** the example shows up in Scalar (so the docs look like a real API, not a placeholder) and is also used by the contract-test runner in exercise 7.

**Why add `404` here instead of "later":** once you declare a status code in `responses`, the handler return type is narrowed to a discriminated union (`{ status: 200, body: Book } | { status: 404, body: Problem }`). If you forget to handle the not-found path, TypeScript catches it at the handler. Add it now, write the handler once.

---

## Step 4 — Rewrite the handler

Replace the stub handler with:

```ts
handler: async ({ params }) => {
  const book = books.get(params.id);
  if (!book) {
    return {
      status: 404 as const,
      body: {
        type: "about:blank",
        title: "Book not found",
        status: 404,
        detail: `No book with id ${params.id}`,
      },
    };
  }
  return { status: 200 as const, body: book };
},
```

**Why `as const` on each `status`:** without it, TypeScript widens to `number` and you lose the discrimination — the compiler will let you return a `BookSchema` body with status `404`, which is a real-world bug.

**Why `type: "about:blank"`:** RFC 9457 says the `type` member should be a URI dereferencing to documentation about the error. `about:blank` is the spec's permitted fallback when you don't have a stable docs URL yet. (Exercise 2 swaps this whole block for `throw new NotFoundError(...)`, which fills `type` in for you.)

---

## Step 5 — Verify

```bash
curl -s http://localhost:3000/books/1 | jq
# { "id": "1", "title": "Foundation" }

curl -s -i http://localhost:3000/books/missing | head -n 5
# HTTP/1.1 404 Not Found
# content-type: application/problem+json
# …
# {"type":"about:blank","title":"Book not found","status":404,"detail":"No book with id missing"}

curl -s http://localhost:3000/openapi.json | jq '.paths."/books/{id}".get'
```

The OpenAPI op should now have a `parameters` array (your path param), a `200` response with `application/json` and a schema reference, and a `404` response with `application/problem+json`.

---

## Code-change cheat sheet

| Step | Where             | Change                                                                       |
| ---- | ----------------- | ---------------------------------------------------------------------------- |
| 1    | Top of file        | Add `BookSchema` and `ProblemSchema`                                         |
| 2    | `app.get(...)`   | Add `request: { params: z.object({ id: z.string().min(1) }) }`               |
| 3    | `responses`        | Add `body: BookSchema, examples: { default }` to 200, add full 404 entry      |
| 4    | `handler`          | Look up the book, return 404 problem body if missing, else 200 with the book |

---

## Common mistakes

- **Using `interface Book {...}` instead of `z.object({...})`.** Interfaces vanish at runtime. The OpenAPI spec and validator both need a schema.
- **Returning `body: { id: "?", title: "?" }` to satisfy the type-checker.** That ships placeholder data on every request. Always fetch from the store, then return either the real body or a 404.
- **Skipping `as const`.** The code compiles, but you lose the per-status contract narrowing — and that's the whole point.
- **Setting `type: "https://example.com/..."` to a fake URL.** Either point at real docs you own, or use `about:blank`. Never invent a docs URL.
