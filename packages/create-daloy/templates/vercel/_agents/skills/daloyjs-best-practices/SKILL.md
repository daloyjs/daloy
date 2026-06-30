---
name: daloyjs-best-practices
description: >-
  Best practices for building, testing, and hardening this DaloyJS REST API on
  Vercel (Node.js runtime). Use when adding or changing HTTP routes,
  Zod/Standard Schema validation schemas, middleware, route metadata, or error
  handling; regenerating the OpenAPI spec or typed Hey API client; keeping the
  single Vercel Functions entrypoint and Web-Standard handler; running contract
  gates; or working on auth, rate limits, secrets, and security defaults.
license: MIT
---

# SKILL.md — DaloyJS best practices (Vercel, Node.js runtime)

Operational guidance and best practices for AI coding agents working in this
DaloyJS **Vercel** project on the **Node.js runtime** (Fluid Compute). This is
the project's **single source of truth** for how to add routes, write tests,
ship secure defaults, and run the quality gates. Read this in full before
making non-trivial changes.

## When to use this skill

Use this skill when you need to:

- Add, modify, or remove HTTP routes in this project.
- Adjust middleware, validation, or error handling.
- Run tests or typecheck the project.
- Deploy or troubleshoot the Vercel Functions entrypoint.
- Harden the API (auth, CORS, rate limits, secrets, dependency hygiene).

Do **not** use this skill for tasks unrelated to the API itself.

## Core principles

DaloyJS is a **contract-first** framework. On Vercel, additionally:

1. **Node.js runtime by default.** The full Node API is available
   (`node:*`, `Buffer`, `fs`), but prefer Web Standards (`Request` /
   `Response`, `fetch`, Web Crypto) so the same app can also run on the
   Edge runtime or another adapter unchanged. Opt into Edge only when you
   need it (`export const runtime = "edge"` + `toWebHandler(app)`), and
   then drop `node:` modules.
2. **The route definition is the contract.** Method, path, request
   schemas, and response schemas live in one place (`app.route({...})`).
3. **Validation schemas protect every boundary.** This template uses Zod,
   and Daloy accepts any Standard Schema-compatible library.
4. **Preserve literal types.** Return `status: 200 as const`.
5. **Secure by default.** `requestId()`, `secureHeaders()`, and
   `rateLimit()` are registered before route definitions. Note the
   in-memory rate limiter resets per instance — for high-traffic
   deployments, back it with an external shared store (e.g. Upstash
   Redis).
6. **One entrypoint + a rewrite.** `api/index.ts` is the only function,
   and `vercel.json` rewrites every path (`/(.*)` → `/api`) to it, so
   DaloyJS owns all routing at the site root and generates a unified
   OpenAPI spec. Removing the rewrite makes the root domain 404.
7. **Contract gates are part of done.** Keep `operationId` values stable,
   examples schema-valid, declared error responses accurate, and the
   generated OpenAPI contract in sync with the live route table.

## Project shape

- `api/index.ts` — the Vercel Functions entrypoint. Builds the `App`,
  registers routes/middleware, and exports `default toFetchHandler(app)`
  (Node.js Functions expect a default export with a `fetch` method; Node.js
  is the default runtime, so no `runtime` export is needed).
- `vercel.json` — Vercel config. The `rewrites` rule (`/(.*)` → `/api`) is
  required so DaloyJS routes at the site root; do not remove it.
- `src/dev.ts` — local Node dev server (`pnpm dev`). Serves the `app`
  exported from `api/index.ts` via `@daloyjs/core/node`; dev-only, never
  deployed (it lives outside `api/`).
- `tests/` — test files (`*.test.ts`).

## Commands cheat-sheet

```bash
pnpm dev          # local Node dev server (src/dev.ts) on http://localhost:3000
pnpm typecheck    # tsc --noEmit
pnpm test         # run test suite
pnpm contract     # daloy inspect --check api/index.ts
pnpm deploy       # deploy to Vercel
pnpm audit        # supply-chain audit
```

Always run `pnpm typecheck` and `pnpm test` before declaring a task done.
`pnpm test` includes the contract gate; if you need a focused contract
check, run `pnpm contract`.

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
On Vercel the YAML serializer is pure-string (no extra deps) and adds
<1KB to the bundle. For hand-rolled mounting, `openapiToYAML` is exported
from `@daloyjs/core/openapi`.

## AI-ready contract metadata

Daloy can expose route metadata to OpenAPI and agent tooling. Add metadata
when it helps consumers understand or safely automate the route:

- Use `summary`, `description`, and `tags` for concise human-facing docs.
- Use `meta.examples` for realistic happy-path and unhappy-path examples.
  Examples must match the declared schemas; the contract gate rejects drift.
- Use `meta.extensions` for stable `x-*` fields consumed by internal tools.
- Use `deprecated` and `sunset` when changing API lifecycle. Do not remove
  a route or response shape silently if generated clients may depend on it.

## Workflow: add a new route

1. **Open `api/index.ts`.**
2. **Design schemas first.** Use `z.object({...}).strict()` for inputs.
3. **Call `app.route({...})`** with `method`, `path`, `operationId`,
   `tags`, `responses`, `handler` (plus `request` when accepting input).
   Add `meta` examples / descriptions when the route is user-facing or
   consumed by agents.
4. **Return `{ status, body, headers? }`** with `status: 200 as const`.
5. **Throw typed errors** (`NotFoundError`, `BadRequestError`, etc.)
   from `@daloyjs/core`.
6. **Add a test** under `tests/` using in-process `app.request(...)`.
7. **Run the contract gate**: `pnpm contract` or `pnpm test`.
8. **Run the quality gates**: `pnpm typecheck && pnpm test`.

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
- Keep response examples close to the route definition and schema-valid.
  The contract test intentionally fails invalid examples.

## Error handling

- Throw typed errors from `@daloyjs/core` — they serialize to RFC 7807
  problem responses.
- Add a `responses[code]` entry for every error you throw.

## Middleware

Register middleware **before** route definitions. Order matters.

Keep the secure baseline (`requestId`, `secureHeaders`, `rateLimit`).
Add CORS only when needed, with an explicit `origin` allowlist.

## Testing best practices

Tests use in-process `app.request(...)` — no port, no Vercel runtime
needed for unit tests.

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import handler from "../api/index.ts";

// Either import the underlying app, or test via the handler's fetch
// method (the default export is the Vercel `{ fetch }` object) by
// passing a Web Request.
test("GET /healthz returns ok", async () => {
  const res = await handler.fetch(new Request("http://local/healthz"));
  assert.equal(res.status, 200);
});
```

Cover **happy paths and unhappy paths** for every route: valid input,
validation failures (400), auth failures (401/403), not-found (404),
conflict (409), rate limiting (429). For external services, inject an
in-memory fake during tests.
The shipped contract test should fail invalid examples, duplicate/missing
`operationId`, or missing responses.

Aim for **100% line and function coverage** on the routes you add.

## Security best practices

- Keep `secureHeaders()`, `requestId()`, and `rateLimit()` enabled. For
  production traffic, back rate-limiting with Vercel KV or another
  shared store so limits apply across instances.
- Never make a failing test pass by deleting or weakening a security guard.
  If a guard blocks a legitimate route, add the narrowest per-route
  override or configuration knob and cover both the allowed and rejected
  paths in tests.
- Never log secrets — filter `authorization`, `cookie`, etc.
- Read secrets from `process.env` (available on Node.js Functions).
  Validate via Zod at module load.
- For auth, verify JWT signatures with the Web Crypto API
  (`crypto.subtle`, available on both Node.js and Edge). Never trust the
  `alg` header from the token.
- Validate redirects against an allowlist.
- Set `bodyLimitBytes` and `requestTimeoutMs` on `new App({...})` to
  mitigate DoS.
- For outbound HTTP, prefer `fetchGuard()` or a transport layered on top
  of it when URLs can be influenced by users or tenants. SSRF protections
  should fail closed for private ranges and cloud metadata endpoints.
- Serverless functions still have bundle-size and cold-start costs; be
  cautious about adding heavy dependencies. Inspect bundle size during
  deploy.
- Pin Vercel project settings (regions, memory, maxDuration) explicitly
  in `vercel.json` rather than relying on dashboard defaults.

## Logging & observability

- Use `ctx.log` — it carries the request id.
- `console.log` shows up in Vercel's runtime logs; the framework logger
  emits structured JSON for log aggregators.

## Configuration & secrets

- Use Vercel project env vars; mirror required names in `.env.example`.
- Validate `process.env` via a Zod schema at module load.

## Pitfalls and guardrails

- Keep the single `api/index.ts` entry and the `vercel.json` `/(.*)` →
  `/api` rewrite so DaloyJS handles routing at the site root. Do not
  remove the rewrite (the root domain would 404) and do not split routes
  into multiple Vercel API files unless the user explicitly asks (it
  disables shared middleware and a unified OpenAPI).
- Use `toFetchHandler(app)` from `@daloyjs/core/vercel` for Node.js
  Functions — never hand-roll a `fetch(req)` adapter. If you opt into the
  Edge runtime, use `toWebHandler(app)` with `export const runtime = "edge"`.
- Do not import `@daloyjs/core/node`, `@daloyjs/core/bun`, etc. — only
  `@daloyjs/core` and `@daloyjs/core/vercel`.
- Do not hand-edit OpenAPI paths or client types. Fix the route definition,
  schema, or metadata and regenerate.
- Node APIs (`Buffer`, `fs`, full `process`) are available on the Node.js
  runtime, but keep handlers Web-Standard where practical so the app can
  also run on the Edge runtime unchanged.
- Do not weaken response literal types (`as const`).
- Do not return errors as `{ status: 4xx, body }`. Throw a typed error.
- Do not add runtime dependencies without checking the hardened `.npmrc` (installs wait 24h after publish by default).

## Process expectations

- Every new feature ships with happy-path and unhappy-path tests.
- Bug fixes include a regression test.
- `pnpm typecheck` and `pnpm test` must pass before completion.
- When route metadata, examples, lifecycle flags, or operation IDs change,
  run the contract gate and inspect the relevant generated OpenAPI diff.
- For deploys, ensure the user is logged in via `vercel login`; do not
  authenticate on their behalf.
- Keep `README.md`, this `SKILL.md`, and `AGENTS.md` consistent.

## More

- Framework docs: <https://daloyjs.dev/docs>
- Issues: <https://github.com/daloyjs/daloy/issues>
