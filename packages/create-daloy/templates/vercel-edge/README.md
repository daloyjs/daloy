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

- API docs (Scalar): <http://localhost:3000/docs>
- OpenAPI 3.1 JSON: <http://localhost:3000/openapi.json>
- OpenAPI 3.1 YAML: <http://localhost:3000/openapi.yaml>
- OpenAPI 3.1 YAML: <http://localhost:3000/openapi.yaml>

After deploying, the same routes serve `/docs`, `/openapi.json`, and `/openapi.yaml` from your Vercel Edge URL.
<!-- daloy-minimal:strip-end docs -->

## Deploy

```bash
pnpm deploy
```

The API entry lives at `api/[...path].ts` and uses `@daloyjs/core/vercel`:

```ts
export const config = { runtime: "edge" };
export default toWebHandler(app);
```

This starter defaults to Vercel's Edge runtime for compatibility with the
`vercel-edge` template name. Vercel now recommends Node.js for new projects;
for Node.js Functions, remove the `config` export and use the official default
`{ fetch }` shape instead:

```ts
import { toFetchHandler } from "@daloyjs/core/vercel";

export default toFetchHandler(app);
```

That catch-all API route lets DaloyJS own routing while Vercel handles the runtime.

## What's included

- `@daloyjs/core/vercel` with starter security middleware: `secureHeaders` and `requestId`.
- Smaller edge-friendly body and timeout limits in the generated app.
<!-- daloy-minimal:strip-start books -->
- A health route and a contract-first `/books/:id` route with Zod validation.
<!-- daloy-minimal:strip-end books -->
<!-- daloy-minimal:strip-start docs -->
- A Scalar API reference UI at `/docs`, plus live OpenAPI 3.1 specs at `/openapi.json` and `/openapi.yaml`.
<!-- daloy-minimal:strip-end docs -->
