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
<!-- daloy-minimal:strip-start books -->
curl http://localhost:3000/books/1
<!-- daloy-minimal:strip-end books -->
```

<!-- daloy-minimal:strip-start docs -->

## API documentation

- API docs (Scalar): <http://localhost:3000/docs>
- OpenAPI 3.1 JSON: <http://localhost:3000/openapi.json>
- OpenAPI 3.1 YAML: <http://localhost:3000/openapi.yaml>

The spec is generated live from your routes, so it stays in sync with what is actually deployed.
To brand Scalar, change `docs: true` in `src/build-app.ts` to `docs: { scalar: { theme, customCss } }`.

<!-- daloy-minimal:strip-end docs -->

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

## Imports

This project uses Node.js **ESM** with `"module": "NodeNext"`. Relative imports must include a `.js` extension, even when the source file is `.ts`:

```ts
import { buildApp } from "./build-app.js"; // ./build-app.ts on disk
```

TypeScript resolves the `.js` specifier to the matching `.ts` file at typecheck, and the compiled output really is `.js`. This is the official Node ESM convention — not a typo.

## What's included

- `@daloyjs/core` with starter security middleware: `secureHeaders`, `requestId`, and `rateLimit`.
<!-- daloy-minimal:strip-start books -->
- A health route and a contract-first `/books/:id` route with Zod validation.
<!-- daloy-minimal:strip-end books -->
- Hardened `.npmrc` for safer installs.
- Hey API codegen wired to `pnpm gen`.

Read the docs at <https://daloyjs.dev/docs>.
