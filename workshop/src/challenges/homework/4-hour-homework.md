# 4-Hour Workshop — Capstone Homework

> Goal: take the highest-impact patterns from the compressed track and ship one production-shaped slice of an API on your own.

You have already practiced each pattern in isolation across exercises 0–7. The homework is the same patterns _composed_ into one cohesive feature — without a step-by-step walkthrough.

## The Brief

Build a single resource API: **`/orders`**. Use whatever validator you like (Zod 4 recommended — same as the workshop).

### Routes

| Method | Path           | Purpose                                              | Auth     | Notes                                              |
| ------ | -------------- | ---------------------------------------------------- | -------- | -------------------------------------------------- |
| GET    | `/orders`      | List orders. Supports `?status=pending\|paid\|cancelled` and `?limit=` (1–100, default 20) | None     | Returns `{ items: Order[], total: number }`        |
| GET    | `/orders/:id`  | Fetch one order                                      | None     | 404 problem+json on miss                           |
| POST   | `/orders`      | Create a new order                                   | Bearer   | `.strict()` body, 201 returns the created order    |
| PATCH  | `/orders/:id/cancel` | Cancel an order                                | Bearer   | 409 if already paid                                |

### Schema

```ts
type Order = {
  id: string;              // uuid
  customerEmail: string;   // email
  amountCents: number;     // ≥ 1, integer
  currency: "USD" | "EUR" | "GBP";
  status: "pending" | "paid" | "cancelled";
  createdAt: string;       // ISO 8601
};
```

The `POST /orders` body accepts only `customerEmail`, `amountCents`, `currency`. Everything else is server-assigned.

### Requirements

- **Contract-first.** Every route is fully typed: `request.params`, `request.query`, `request.body`, and every documented response code carries a `body` schema.
- **`.strict()` on every request body and every query schema.**
- **Throw, don't return** for every error path. Use `NotFoundError`, `HttpError(409, ...)`, `BadRequestError`, `UnauthorizedError`.
- **Standard middleware stack** from exercise 3: `requestId`, `secureHeaders`, `cors` (real origin), `rateLimit`, `bodyLimitBytes: 64 * 1024`, `requestTimeoutMs: 5_000`.
- **Bearer auth** declared in `securitySchemes`, attached to the two write routes via `auth` + `hooks`.
- **OpenAPI examples** on every 2xx response. Real-looking data, not `"string"` placeholders.
- **Contract tests** (`node:test`) for:
  - Happy path of each route (200, 201).
  - 401 on protected routes when the token is missing or wrong.
  - 400 mass-assignment rejection on `POST /orders` (send an extra `isPaid` field — DaloyJS returns 422 for schema validation failures).
  - 409 on the second `PATCH /orders/:id/cancel` for an already-cancelled order.
  - `app.introspect()` returns exactly the four operationIds.

### Optional Stretch Goals

- Run `pnpm gen` against your server and import the generated client into a test that exercises every route.
- Boot the same `buildApp()` under both the Node and Bun adapters and verify your test suite passes on both.
- Add a `GET /orders/recent?limit=N` route that re-uses the list logic via a query schema and a `select`-style transform in the handler.

## Submitting

This is self-paced — there is no submission. Push the result to your own fork and use it as a reference template the next time you bootstrap an API. The point of the homework is muscle memory, not a graded artifact.

## When to Reach for Documentation

| If you're stuck on…       | Read                                                       |
| -------------------------- | ---------------------------------------------------------- |
| Schema design              | <https://daloyjs.dev/docs/validation>                      |
| Error types and shape      | <https://daloyjs.dev/docs/errors>                          |
| Middleware order           | <https://daloyjs.dev/docs/security>                        |
| Auth wiring                | <https://daloyjs.dev/docs/auth>                            |
| OpenAPI examples           | <https://daloyjs.dev/docs/openapi>                         |
| Hey API codegen            | <https://daloyjs.dev/docs/clients>                         |
| Adapter swap               | <https://daloyjs.dev/docs/adapters>                        |
| Testing patterns           | <https://daloyjs.dev/docs/testing>                         |
| Full reference example     | <https://daloyjs.dev/docs/tutorials/bookstore>             |
