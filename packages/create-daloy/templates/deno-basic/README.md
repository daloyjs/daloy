# my-daloy-deno-app

A [DaloyJS](https://daloyjs.dev) starter for the [Deno](https://deno.com) runtime.

## Develop

```bash
deno task dev          # http://localhost:3000
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

## Generate the OpenAPI spec

```bash
deno task gen:openapi
# → generated/openapi.json
```

To produce a typed SDK from that spec, run [@hey-api/openapi-ts](https://heyapi.dev)
through `npx` or your favorite Node package manager — it does not yet ship a
first-class Deno entry point.

## Test

```bash
deno task test
```

## What's included

- `@daloyjs/core` (loaded via `jsr:` specifiers in `deno.json`).
- Starter security middleware: `secureHeaders`, `requestId`, and `rateLimit`.
<!-- daloy-minimal:strip-start books -->
- A health route and contract-first `/books/:id` route with Zod validation.
<!-- daloy-minimal:strip-end books -->
- Minimal permissions: `--allow-net --allow-env --allow-read` for `dev`.

Read the docs at <https://daloyjs.dev/docs>.
