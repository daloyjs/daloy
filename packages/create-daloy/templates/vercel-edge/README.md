# my-daloy-vercel-api

A [DaloyJS](https://daloyjs.dev) Vercel Edge API starter.

## Develop

```bash
pnpm install
pnpm dev          # http://localhost:3000
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

After deploying, the same routes serve `/docs` and `/openapi.json` from your Vercel Edge URL.
<!-- daloy-minimal:strip-end docs -->

## Deploy

```bash
pnpm deploy
```

The API entry lives at `api/[...path].ts` and uses `@daloyjs/core/vercel`:

```ts
export const config = { runtime: "edge" };
export default toEdgeHandler(app);
```

That catch-all API route lets DaloyJS own routing while Vercel handles the Edge runtime.

## What's included

- `@daloyjs/core/vercel` with starter security middleware: `secureHeaders` and `requestId`.
- Smaller edge-friendly body and timeout limits in the generated app.
<!-- daloy-minimal:strip-start books -->
- A health route and a contract-first `/books/:id` route with Zod validation.
<!-- daloy-minimal:strip-end books -->
<!-- daloy-minimal:strip-start docs -->
- Swagger UI at `/docs` and a live OpenAPI 3.1 document at `/openapi.json`.
<!-- daloy-minimal:strip-end docs -->
