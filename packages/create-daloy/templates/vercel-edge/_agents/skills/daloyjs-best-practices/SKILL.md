# SKILL.md — DaloyJS best practices (Vercel Edge)

Operational guidance and best practices for AI coding agents working in this
DaloyJS **Vercel Edge** project. This is the project's **single source of
truth** for how to add routes, write tests, ship secure defaults, and run
the quality gates. Read this in full before making non-trivial changes.

## When to use this skill

Use this skill when you need to:

- Add, modify, or remove HTTP routes in this project.
- Adjust middleware, validation, or error handling.
- Run tests or typecheck the project.
- Deploy or troubleshoot the Edge runtime entrypoint.
- Harden the API (auth, CORS, rate limits, secrets, dependency hygiene).

Do **not** use this skill for tasks unrelated to the API itself.

## Core principles

DaloyJS is a **contract-first** framework. On Vercel Edge, additionally:

1. **Stay on the Edge runtime.** Only Web Standards APIs (no `node:`
   modules, no `fs`, no `Buffer`). If a feature requires Node APIs, the
   user must switch to a Node template.
2. **The route definition is the contract.** Method, path, request
   schemas, and response schemas live in one place (`app.route({...})`).
3. **Zod schemas validate at every boundary.**
4. **Preserve literal types.** Return `status: 200 as const`.
5. **Secure by default.** `requestId()`, `secureHeaders()`, and
   `rateLimit()` are registered before route definitions. Note the
   in-memory rate limiter resets per instance — for high-traffic
   deployments, prefer Vercel's native rate-limiting (e.g.
   `@vercel/edge` + KV) or an external store.
6. **One catch-all entrypoint.** `api/[...path].ts` owns all routing so
   DaloyJS can generate a unified OpenAPI spec.

## Project shape

- `api/[...path].ts` — the Edge entrypoint. Builds the `App`, registers
  routes/middleware, and exports `default toWebHandler(app)` plus
  `export const config = { runtime: "edge" }`.
- `vercel.json` — Vercel build/runtime configuration.
- `tests/` — test files (`*.test.ts`).

## Commands cheat-sheet

```bash
pnpm dev          # local Vercel dev server on http://localhost:3000
pnpm typecheck    # tsc --noEmit
pnpm test         # run test suite
pnpm deploy       # deploy to Vercel
pnpm audit        # supply-chain audit
```

Always run `pnpm typecheck` and `pnpm test` before declaring a task done.

## OpenAPI & docs routes

When `docs: true` is set on `new App({...})` (the default in this template),
three routes are auto-mounted off the spec generated from your route
definitions:

- `GET /openapi.json` — OpenAPI 3.1 spec as JSON.
- `GET /openapi.yaml` — OpenAPI 3.1 spec as YAML (served inline as
  `text/yaml; charset=utf-8`, since `@daloyjs/core` 0.13.1).
- `GET /docs` — Scalar API reference UI that loads the spec.

Customize via `docs: { openapiPath, openapiYamlPath, path, ui }`. Set
`openapiYamlPath: false` to disable just the YAML route, `docs: "auto"` to
mount only outside production, or `docs: false` to disable all three.
On Vercel Edge the YAML serializer is pure-string (no Node deps) and
adds <1KB to the bundle. For hand-rolled mounting, `openapiToYAML` is
exported from `@daloyjs/core/openapi`.

## Workflow: add a new route

1. **Open `api/[...path].ts`.**
2. **Design schemas first.** Use `z.object({...}).strict()` for inputs.
3. **Call `app.route({...})`** with `method`, `path`, `operationId`,
   `tags`, `responses`, `handler` (plus `request` when accepting input).
4. **Return `{ status, body, headers? }`** with `status: 200 as const`.
5. **Throw typed errors** (`NotFoundError`, `BadRequestError`, etc.)
   from `@daloyjs/core`.
6. **Add a test** under `tests/` using in-process `app.request(...)`.
7. **Run the quality gates**: `pnpm typecheck && pnpm test`.

### Example: a typed route

```ts
import { z } from "zod";
import { NotFoundError } from "@daloyjs/core";

const Book = z.object({ id: z.string(), title: z.string() }).strict();
const BookParams = z.object({ id: z.string().min(1) }).strict();

app.route({
  method: "GET",
  path: "/books/:id",
  operationId: "getBookById",
  tags: ["Books"],
  request: { params: BookParams },
  responses: {
    200: { description: "Found", body: Book },
    404: { description: "Not found" },
  },
  handler: async ({ params }) => {
    const book = await store.find(params.id);
    if (!book) throw new NotFoundError(`Book ${params.id} not found`);
    return { status: 200 as const, body: book };
  },
});
```

## Validation & schema conventions

- **Inputs**: use `.strict()` on top-level object schemas.
- **IDs**: prefer `z.string().min(1)`; use `z.string().uuid()` when
  applicable.
- **Numbers from query strings**: `z.coerce.number().int().min(...)`.
- **Optional vs nullable**: differ in OpenAPI output.
- **Pagination**: standardize on `{ items, nextCursor }` cursor
  pagination.
- **Discriminated unions**: `z.discriminatedUnion("kind", [...])`.

## Error handling

- Throw typed errors from `@daloyjs/core` — they serialize to RFC 7807
  problem responses.
- Add a `responses[code]` entry for every error you throw.

## Middleware

Register middleware **before** route definitions. Order matters.

Keep the secure baseline (`requestId`, `secureHeaders`, `rateLimit`).
Add CORS only when needed, with an explicit `origin` allowlist.

## Testing best practices

Tests use in-process `app.request(...)` — no port, no Edge runtime
needed for unit tests.

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import handler from "../api/[...path].ts";

// Either import the underlying app, or test via the Edge handler's
// fetch interface by passing a Web Request.
test("GET /healthz returns ok", async () => {
  const res = await handler(new Request("http://local/healthz"));
  assert.equal(res.status, 200);
});
```

Cover **happy paths and unhappy paths** for every route: valid input,
validation failures (400), auth failures (401/403), not-found (404),
conflict (409), rate limiting (429). For external services, inject an
in-memory fake during tests.

Aim for **100% line and function coverage** on the routes you add.

## Security best practices

- Keep `secureHeaders()`, `requestId()`, and `rateLimit()` enabled. For
  production traffic, back rate-limiting with Vercel KV or another
  shared store so limits apply across instances.
- Never log secrets — filter `authorization`, `cookie`, etc.
- Read secrets from `process.env` (available on Edge). Validate via Zod
  at module load.
- For auth, verify JWT signatures with the Web Crypto API
  (`crypto.subtle`). Never trust the `alg` header from the token.
- Validate redirects against an allowlist.
- Set `bodyLimitBytes` and `requestTimeoutMs` on `new App({...})` to
  mitigate DoS.
- Edge functions have small bundle and CPU limits; be cautious about
  adding heavy dependencies. Inspect bundle size during deploy.
- Pin Vercel project settings (regions, runtime version) explicitly in
  `vercel.json` rather than relying on dashboard defaults.

## Logging & observability

- Use `ctx.log` — it carries the request id.
- `console.log` on Edge shows up in Vercel's runtime logs; the framework
  logger emits structured JSON for log aggregators.

## Configuration & secrets

- Use Vercel project env vars; mirror required names in `.env.example`.
- Validate `process.env` via a Zod schema at module load.

## Pitfalls and guardrails

- The catch-all `api/[...path].ts` must remain a catch-all so DaloyJS
  handles routing. Do not split routes into multiple Vercel API files
  unless the user explicitly asks (it disables shared middleware and a
  unified OpenAPI).
- Use `toWebHandler(app)` from `@daloyjs/core/vercel` for Edge — never
  hand-roll a `fetch(req)` adapter. For Vercel's recommended Node.js
  runtime, remove the Edge config and export `default toFetchHandler(app)`.
- Do not import `@daloyjs/core/node`, `@daloyjs/core/bun`, etc. — only
  `@daloyjs/core` and `@daloyjs/core/vercel`.
- Avoid Node-only APIs (`Buffer`, `fs`, full `process` API). If a
  feature needs Node, switch to a Node-runtime template.
- Do not weaken response literal types (`as const`).
- Do not return errors as `{ status: 4xx, body }`. Throw a typed error.
- Do not add runtime dependencies without checking the hardened `.npmrc` (installs wait 24h after publish by default).

## Process expectations

- Every new feature ships with happy-path and unhappy-path tests.
- Bug fixes include a regression test.
- `pnpm typecheck` and `pnpm test` must pass before completion.
- For deploys, ensure the user is logged in via `vercel login`; do not
  authenticate on their behalf.
- Keep `README.md`, this `SKILL.md`, and `AGENTS.md` consistent.

## More

- Framework docs: <https://daloyjs.dev/docs>
- Issues: <https://github.com/daloyjs/daloy/issues>
