# 8-Hour Workshop — Capstone Homework

> Goal: compose every pattern from the full track into one production-shaped service — a **Books / Admin API** — without a step-by-step walkthrough.

You have practiced each pattern in isolation across exercises 0–11 plus the feature and bug challenges. The homework is the same patterns _composed_ into one cohesive service: contract-first routing, RFC 9457 errors, the security middleware stack, JWT/JWK auth, signed-cookie sessions, CSRF/CORS, SSRF-guarded outbound fetches, a WebSocket channel, observability, and a typed client.

## The Brief

Build a two-surface API:

- **Public Books API** — read-heavy, anonymous, rate-limited.
- **Admin API** — write surface behind JWT bearer auth, plus a browser-facing session + CSRF flow.

Use Zod 4 (same as the workshop).

### Public routes

| Method | Path             | Purpose                                                                 | Auth | Notes                                              |
| ------ | ---------------- | ----------------------------------------------------------------------- | ---- | -------------------------------------------------- |
| GET    | `/books`         | List books. `?q=`, `?tag=`, `?limit=` (1–100, default 20), `?cursor=`   | None | Returns `{ items: Book[], nextCursor: string \| null }` |
| GET    | `/books/:id`     | Fetch one book                                                          | None | 404 problem+json on miss                           |
| GET    | `/books/:id/cover` | Proxy a cover image from an allowlisted upstream                      | None | Outbound fetch MUST go through `fetchGuard()`      |

### Admin routes (JWT bearer)

| Method | Path           | Purpose                       | Auth          | Notes                                          |
| ------ | -------------- | ----------------------------- | ------------- | ---------------------------------------------- |
| POST   | `/admin/books` | Create a book                 | Bearer (JWT)  | `.strict()` body, 201 returns the created book |
| PATCH  | `/admin/books/:id` | Partial update            | Bearer (JWT)  | 404 on miss, 409 on stale `version`            |
| DELETE | `/admin/books/:id` | Delete a book             | Bearer (JWT)  | 204, idempotent                                |

### Session + CSRF surface (browser flow)

| Method | Path            | Purpose                                  | Auth            | Notes                                        |
| ------ | --------------- | ---------------------------------------- | --------------- | -------------------------------------------- |
| POST   | `/auth/login`   | Issue a signed-cookie session            | None            | Sets `Set-Cookie` session + CSRF token       |
| POST   | `/auth/logout`  | Destroy the session                      | Session + CSRF  | 204                                          |
| GET    | `/me`           | Current session principal                | Session         | 401 if no valid session                      |

### WebSocket

| Path        | Purpose                                   | Auth                        | Notes                                       |
| ----------- | ----------------------------------------- | --------------------------- | ------------------------------------------- |
| `/ws/feed`  | Live feed of book create/update/delete    | JWT in query or `Sec-WebSocket-Protocol` | Reject the upgrade on missing/invalid token |

### Schema

```ts
type Book = {
  id: string;            // uuid
  title: string;         // 1–200 chars
  author: string;        // 1–120 chars
  tags: string[];        // each 1–30 chars, max 10
  priceCents: number;    // ≥ 0, integer
  version: number;       // optimistic-concurrency counter, starts at 1
  createdAt: string;     // ISO 8601
  updatedAt: string;     // ISO 8601
};
```

The `POST /admin/books` body accepts only `title`, `author`, `tags`, `priceCents`. Everything else is server-assigned. `PATCH` accepts the same fields (all optional) plus a required `version` for optimistic concurrency.

## Requirements

- **Contract-first.** Every route is fully typed: `request.params`, `request.query`, `request.body`, and every documented response code carries a `body` schema with an OpenAPI example.
- **`.strict()`** on every request body and every query schema.
- **Throw, don't return** for every error path: `NotFoundError`, `UnauthorizedError`, `ForbiddenError`, `HttpError(409, ...)`, `BadRequestError`.
- **Full security middleware stack** (exercises 9–10): `requestId`, `secureHeaders` with a CSP, `cors` (explicit allowed origin — never `*` on the admin/session surface), `rateLimit`, `bodyLimitBytes: 64 * 1024`, `requestTimeoutMs: 5_000`.
- **JWT auth** (exercise 6): sign admin tokens with `createJwtSigner`, verify with `createJwtVerifier` using an **explicit algorithm allowlist** (no `none`, no alg confusion). Wire a JWKS endpoint and verify against it.
- **Sessions + CSRF** (exercise 11): signed-cookie sessions for the browser flow, double-submit CSRF token required on `POST /auth/logout`.
- **SSRF guard** (exercise 11): `/books/:id/cover` performs its outbound fetch via `fetchGuard()` with an upstream allowlist — a user-supplied cover URL must never reach an internal address.
- **WebSocket auth** (exercise 11): reject the upgrade when the token is missing or invalid; only authenticated clients receive feed events.
- **Observability** (exercises 4, 7): structured logger, request ids on every log line, and at least one custom log field (e.g. `bookId`) on write routes.
- **OpenAPI** (exercises 1, 7): `securitySchemes` declared for bearer + session, real-looking response examples, branded `/docs`, both `/openapi.json` and `/openapi.yaml` reachable.

## Contract tests (`node:test`)

Export a `buildApp()` factory and test via `app.fetch(new Request(...))`:

- Happy path of each public + admin route (200 / 201 / 204).
- 401 on every admin route when the JWT is missing, expired, or signed with a disallowed algorithm.
- 403 on `POST /auth/logout` when the CSRF token is missing or mismatched.
- 400 mass-assignment rejection on `POST /admin/books` (send an extra `version` or `isFeatured` field — DaloyJS returns 422 for schema validation failures).
- 409 on `PATCH /admin/books/:id` with a stale `version`.
- `/books/:id/cover` rejects an upstream that resolves to a private/loopback address (fetchGuard).
- WebSocket upgrade is rejected without a valid token.
- `app.introspect()` returns exactly the expected operationIds.

## Optional stretch goals

- Run `pnpm gen` against your server and import the generated client into a test that exercises every public route.
- Boot the same `buildApp()` under Node, Bun, and Deno adapters and verify the suite passes on each.
- Add cursor-based pagination correctness tests (stable ordering, no duplicates across pages).
- Rotate the JWKS signing key and prove old tokens still verify until expiry while new tokens use the new key.

## Submitting

This is self-paced — there is no submission. Push the result to your own fork and use it as a reference template the next time you bootstrap a production API. The point of the homework is muscle memory, not a graded artifact.

## When to reach for documentation

| If you're stuck on…    | Read                                            |
| ----------------------- | ----------------------------------------------- |
| Schema design           | <https://daloyjs.dev/docs/validation>           |
| Error types and shape   | <https://daloyjs.dev/docs/errors>               |
| Middleware order        | <https://daloyjs.dev/docs/security>             |
| Bearer + JWT/JWK auth   | <https://daloyjs.dev/docs/auth>                 |
| OpenAPI examples        | <https://daloyjs.dev/docs/openapi>              |
| Hey API codegen         | <https://daloyjs.dev/docs/clients>              |
| Adapter swap            | <https://daloyjs.dev/docs/adapters>             |
| WebSocket upgrades      | <https://daloyjs.dev/docs/websockets>           |
| Testing patterns        | <https://daloyjs.dev/docs/testing>              |
| Full reference example  | <https://daloyjs.dev/docs/tutorials/bookstore>  |
