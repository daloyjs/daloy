# my-daloy-bun-app

A [DaloyJS](https://daloyjs.dev) starter for the [Bun](https://bun.sh) runtime.

## Develop

```bash
bun install
bun run dev          # http://localhost:3000
```

Try it:

```bash
curl http://localhost:3000/healthz
<!-- daloy-minimal:strip-start books -->
curl http://localhost:3000/books/1
<!-- daloy-minimal:strip-end books -->
```

<!-- daloy-minimal:strip-start docs -->
## API documentation

- Swagger UI: <http://localhost:3000/docs>
- OpenAPI 3.1 JSON: <http://localhost:3000/openapi.json>
<!-- daloy-minimal:strip-end docs -->

## Generate OpenAPI + typed client

```bash
bun run gen:openapi
bun run gen:client
```

## Test

```bash
bun test
```

## What's included

- `@daloyjs/core` with starter security middleware: `secureHeaders`, `requestId`, and `rateLimit`.
<!-- daloy-minimal:strip-start books -->
- A health route and contract-first `/books/:id` route with Zod validation.
<!-- daloy-minimal:strip-end books -->
- Hot reload via `bun --hot`.
- Hey API codegen wired to `bun run gen:openapi` + `bun run gen:client`.

Read the docs at <https://daloyjs.dev/docs>.
