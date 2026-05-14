# my-daloy-app

A [DaloyJS](https://daloyjs.dev) starter — runtime-portable, contract-first TypeScript REST API.

## Develop

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Try it:

```bash
curl http://localhost:3000/healthz
curl http://localhost:3000/books/1
```

## API documentation

- Swagger UI: <http://localhost:3000/docs>
- OpenAPI 3.1 JSON: <http://localhost:3000/openapi.json>

The spec is generated live from your routes, so it stays in sync with what is actually deployed.

## Generate OpenAPI + typed client

```bash
pnpm gen
# → generated/openapi.json
# → generated/client/  (typed Hey API client)
```

## Build

```bash
pnpm build
node dist/index.js
```

## What's included

- `@daloyjs/core` with `secureHeaders`, `requestId`, and `rateLimit` enabled.
- A health route and a contract-first `/books/:id` route with Zod validation.
- Hardened `.npmrc` for safer installs.
- Hey API codegen wired to `pnpm gen`.

Read the docs at <https://daloyjs.dev/docs>.
