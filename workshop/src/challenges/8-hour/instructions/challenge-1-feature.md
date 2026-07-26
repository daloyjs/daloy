# 8-Hour · Challenge 1 (Feature): Authors CRUD

A full CRUD slice with the same conventions used everywhere else in the workshop. **No new framework features**, just consolidating the patterns from exercises 1–8 into a complete resource.

## Requirements

| Method   | Path           | Auth   | Body                                     | Status  |
| -------- | -------------- | ------ | ---------------------------------------- | ------- |
| `GET`    | `/authors`     | none   | —                                        | 200     |
| `GET`    | `/authors/:id` | none   | —                                        | 200/404 |
| `POST`   | `/authors`     | bearer | `.strict()` (`id`, `name`, `birthYear?`) | 201/409 |
| `PATCH`  | `/authors/:id` | bearer | `.strict()` (`name?`, `birthYear?`)      | 200/404 |
| `DELETE` | `/authors/:id` | bearer | —                                        | 204/404 |

- All write routes require `auth: { scheme: "bearer" }` + `hooks: bearerAuth({ validate })` with `timingSafeEqual`.
- `DELETE` is soft delete (set `deleted: true`).
- `GET /authors/:id` includes **two named examples** under `responses[200].examples`.
- `POST /authors` returns 409 on duplicate id, 201 with the created author otherwise.
- `PATCH` returns 404 if the author is missing or soft-deleted.

## Verify

```bash
curl -s http://localhost:3000/authors | jq
curl -s http://localhost:3000/authors/asimov | jq

# 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/authors
# 401

# 201
curl -s -X POST http://localhost:3000/authors \
  -H 'authorization: Bearer workshop-token' \
  -H 'content-type: application/json' \
  -d '{"id":"clarke","name":"Arthur C. Clarke","birthYear":1917}' | jq

# 204
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE http://localhost:3000/authors/clarke \
  -H 'authorization: Bearer workshop-token'
# 204
```

## Why This Matters

A real engineer's day is mostly building CRUD slices, not exotic features. The point of the workshop is that with DaloyJS, this entire file is **~120 lines** and gets you:

- A fully typed OpenAPI spec at `/openapi.json`.
- Branded docs at `/docs`.
- A generated typed client via `pnpm gen`.
- RFC 9457 problem+json on every error path.
- Bearer auth enforced + advertised.

No DTO classes, no decorators, no controllers folder, no DI container.

## Training Resources

- [DaloyJS — Routing](https://daloyjs.dev/docs/routing)
- [DaloyJS — Validation](https://daloyjs.dev/docs/validation)
- [DaloyJS — Errors](https://daloyjs.dev/docs/errors)
- [DaloyJS — Security](https://daloyjs.dev/docs/security)
