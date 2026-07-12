# 8-Hour · Exercise 3 — Step-by-Step

> Goal: throw a custom `HttpError` with a stable `type` URI, and verify that internal 5xx details are redacted in production.

## Step 1 — Throw `HttpError` in the checkout handler

In the `POST /books/:id/checkout` handler, add the already-checked-out guard:

```ts
if (b.status === "checked-out") {
  throw new HttpError(422, {
    type: "https://daloyjs.dev/errors/already-checked-out",
    title: "Already checked out",
    detail: `Book ${params.id} is already checked out`,
  });
}
```

**Why `HttpError` and not a custom response body:** the framework already has the rendering pipeline. You just need to supply the status and RFC 9457 fields.

**Why a real-looking `type` URI:** the URI is the stable identifier clients pattern-match on. Make it look like a docs URL even if the page doesn't exist yet — you'll publish it later, and clients written today won't break.

## Step 2 — Add `POST /books` with `HttpError(409, ...)`

Below the checkout route:

```ts
app.post(
  "/books",
  {
    operationId: "createBook",
    ...
  },
  async ({ body }) => {
    if (books.has(body.id)) {
      throw new HttpError(409, { title: "Conflict", detail: `Book ${body.id} already exists` });
    }
    const created = { ...body, status: "available" as const };
    books.set(body.id, created);
    return { status: 201 as const, body: created };
  },
);
```

## Step 3 — Verify 4xx detail and 5xx redaction

```bash
# Dev
curl -s -X POST http://localhost:3000/books/1/checkout | jq
# {"type":"https://daloyjs.dev/errors/already-checked-out","title":"Already checked out","status":422,"detail":"Book 1 is already checked out","requestId":"…"}

# Expected 4xx detail remains client-readable, including in production
NODE_ENV=production node src/challenges/8-hour/exercise-3.ts &
curl -s -X POST http://localhost:3000/books/1/checkout | jq
# {"type":"https://daloyjs.dev/errors/already-checked-out","title":"Already checked out","status":422,"detail":"Book 1 is already checked out","requestId":"…"}

# Internal 5xx detail is redacted in production
curl -s http://localhost:3000/explode | jq
# {"type":"about:blank","title":"Internal Server Error","status":500,"requestId":"…"}
```

`requestId` is preserved in both — that's the field your support team correlates against logs.

## Step 4 — Validation errors are free

`POST /books` with a missing `title` returns a 400 problem+json automatically. You did not write a single line of validation-error rendering code.

```bash
curl -s -X POST http://localhost:3000/books -H 'content-type: application/json' -d '{"id":"3"}'
# {"type":"about:blank","title":"Validation Error","status":400,"errors":[{"path":"title",...}]}
```

## Common mistakes

- **Inventing a fake `type` URI like `urn:my-app:errors:foo`.** It's spec-compliant but offers consumers nowhere to read about the error. Use an `https://` URL pointing at real or about-to-be-real docs.
- **Putting secrets in 4xx `detail`.** 4xx details are for clients, so treat them as public. 5xx redaction is a backstop for internal failures, not a license to leak.
- **Matching on `title` from the client side.** Titles are human-readable and localizable. Match on `type` and `status`.
