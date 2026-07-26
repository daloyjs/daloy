# 8-Hour · Exercise 1 — Step-by-Step

> Goal: write the canonical `/books/:id` operation with full metadata and two named examples.

You are editing [`exercise-1.ts`](../exercise-1.ts). Reference: [`solutions/exercise-1-end.ts`](../solutions/exercise-1-end.ts).

The base content of this exercise is the same as the [4-hour exercise 1 walkthrough](../../4-hour/coding-steps/exercise-1-steps.md). The new material is in **Step 2** below.

## Step 1 — Register the basic route

Use the shape from 4-hour exercise 1: `request.params`, `responses[200].body`, `responses[404]`, `throw new NotFoundError(...)` in the handler. Refer back if you need a refresher.

## Step 2 — Rich operation metadata

Add three new fields above `request`:

```ts
summary: "Fetch a book by id",
description: "Returns the book record. Throws `NotFoundError` if no book with that id exists.",
```

(`tags: ["Books"]` is already on the starter.)

**Why both `summary` and `description`:** Scalar uses `summary` as the sidebar label (short, one line) and `description` as the operation body (long, markdown). If you only set `summary`, consumers see a tiny sidebar but no body documentation.

## Step 3 — Named examples

Replace the single example with multiple named entries:

```ts
responses: {
  200: {
    description: "Book found",
    body: BookSchema,
    examples: {
      foundation: { id: "1", title: "Foundation" },
      dune:       { id: "2", title: "Dune" },
    },
  },
  ...
},
```

**Why two examples and not one:** named examples flow into `/openapi.json` as a map of `name → { value }`. Scalar renders a dropdown so consumers can preview both. Hey API can pick the first example for its generated tests. One example is a placeholder; two examples is documentation.

## Step 4 — Verify

```bash
curl -s http://localhost:3000/openapi.json \
  | jq '.paths."/books/{id}".get.responses."200".content."application/json".examples'
# {"foundation":{"value":{"id":"1","title":"Foundation"}},"dune":{"value":{"id":"2","title":"Dune"}}}
```

Open `/docs`. The 200 response section now has an "Example" dropdown.

## Code-change cheat sheet

| Step | Where           | Change                                                            |
| ---- | --------------- | ----------------------------------------------------------------- |
| 1    | Body of file    | Register `GET /books/:id` per 4-hour exercise 1                   |
| 2    | Above `request` | Add `summary` and `description`                                   |
| 3    | `responses.200` | Replace single example with `{ foundation, dune }` named examples |

## Common mistakes

- **Returning `examples: { default: { ... } }` everywhere.** The key `default` is a real OpenAPI convention, but it's also useless for consumers who want to see how the API behaves with different inputs. Use meaningful names.
- **Embedding example data inside the `body` schema (`z.object({}).default(...)`)** — that affects validation, not documentation. Keep examples in the `examples` slot.
