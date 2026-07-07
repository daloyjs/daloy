# 8-Hour · Exercise 3: RFC 9457 Errors & Redaction

Cover the four classes of error in one file: `NotFoundError`, `HttpError(409, ...)`, automatic validation errors from `.strict()`, and a custom 422 via `HttpError` with a stable `type` URI.

## Requirements

- `GET /books/:id` throws `NotFoundError`.
- `POST /books/:id/checkout` throws `HttpError(422, { type, title, detail })` when the book is already checked out.
- `POST /books` throws `HttpError(409, ...)` on duplicate id.
- Validation errors (`.strict()` rejection, missing required field) come back automatically as 400.
- Verify expected 4xx `detail` remains useful and internal 5xx `detail` is redacted in production.

## Verify

```bash
# Dev mode — detail is visible
pnpm dev:8:3
curl -s http://localhost:3000/books/1/checkout | jq        # works
curl -s -X POST http://localhost:3000/books/1/checkout | jq # 422, detail explains why

# Production mode — expected 4xx detail remains client-facing
NODE_ENV=production node src/challenges/8-hour/exercise-3.ts &
curl -s -X POST http://localhost:3000/books/1/checkout | jq
# {"type":"https://daloyjs.dev/errors/already-checked-out","title":"Already checked out","status":422,"detail":"Book 1 is already checked out"}

curl -s http://localhost:3000/explode | jq
# {"type":"about:blank","title":"Internal Server Error","status":500}
```

## Why This Matters

`HttpError` is the escape hatch when the built-in error classes don't quite fit. The `type` URI is the **stable identifier** — clients should match on `type`, not on `title` or `detail`, because those are localized and human-readable. The `type` URI should resolve to a real docs page that explains the error class.

## Training Resources

- [DaloyJS — Errors](https://daloyjs.dev/docs/errors)
- [RFC 9457 — Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457)
