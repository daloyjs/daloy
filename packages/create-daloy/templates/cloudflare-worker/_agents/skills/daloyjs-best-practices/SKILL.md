---
name: daloyjs-best-practices
description: >-
  Best practices for building, testing, and hardening this DaloyJS REST API on
  Cloudflare Workers. Use when adding or changing HTTP routes, Zod/Standard
  Schema validation schemas, middleware, route metadata, or error handling;
  wiring Worker bindings (KV, D1, R2, Queues, env, secrets); running contract
  gates; or working on auth, rate limits, and security defaults.
license: MIT
---

# SKILL.md — DaloyJS best practices (Cloudflare Workers)

Operational guidance and best practices for AI coding agents working in this
DaloyJS **Cloudflare Workers** project. This is the project's **single
source of truth** for how to add routes, write tests, ship secure defaults,
and run the quality gates. Read this in full before making non-trivial
changes.

## When to use this skill

Use this skill when you need to:

- Add, modify, or remove HTTP routes in this Worker.
- Adjust middleware, validation, or error handling.
- Change Worker bindings (KV, D1, R2, Queues, env vars) in `wrangler.toml`.
- Run tests/typecheck or deploy the Worker.
- Harden the API (auth, CORS, rate limits, secrets, dependency hygiene).

Do **not** use this skill for tasks unrelated to the API itself.

## Core principles

DaloyJS is a **contract-first** framework. On Workers, additionally:

1. **Stay on the Workers runtime.** Only Web Standards APIs and
   Cloudflare-specific bindings. No `node:` modules unless the user
   explicitly adds `nodejs_compat` to `wrangler.toml` and opts in.
2. **The route definition is the contract.** Method, path, request
   schemas, and response schemas live in one place (`app.route({...})`).
3. **Validation schemas protect every boundary.** This template uses Zod,
   and Daloy accepts any Standard Schema-compatible library.
4. **Preserve literal types.** Return `status: 200 as const`.
5. **Secure by default.** `requestId()`, `secureHeaders()`, and
   `rateLimit()` are registered. Note: the in-memory rate limiter resets
   per isolate — for production traffic, prefer Cloudflare's native
   rate-limit binding.
6. **Bindings flow through `env`.** Read KV/D1/R2/secrets from the
   `env` argument to `fetch`, never from globals.
7. **Contract gates are part of done.** Keep `operationId` values stable,
   examples schema-valid, declared error responses accurate, and the
   generated OpenAPI contract in sync with the live route table.

## Project shape

- `src/index.ts` — the Worker entrypoint. Builds the `App`, registers
  routes/middleware, and exports `default toFetchHandler(app)` from
  `@daloyjs/core/cloudflare`. Do not wrap the result in another `{ fetch }`.
- `wrangler.toml` — Worker config (name, compatibility date, bindings,
  routes).
- `tests/` — test files using Workers-compatible test runners (e.g.
  `vitest` + `@cloudflare/vitest-pool-workers`) or in-process
  `app.request(...)` for pure logic.

## Commands cheat-sheet

```bash
pnpm dev          # wrangler dev on http://localhost:8787
pnpm typecheck    # tsc --noEmit
pnpm test         # run test suite
pnpm contract     # daloy inspect --check src/index.ts
pnpm deploy       # wrangler deploy
pnpm audit        # supply-chain audit
```

Always run `pnpm typecheck` and `pnpm test` before declaring a task done.
`pnpm test` includes the contract gate; if you need a focused contract
check, run `pnpm contract`.

## OpenAPI & docs routes

This Worker starter sets `docs: true` in `new App({...})`, so three routes
are auto-mounted off the spec generated from your route definitions.
DaloyJS is dependency-free and the Scalar UI loads from a CDN, so the bundle
cost is negligible; drop `docs` (and the `openapi` block) if you need the
smallest possible Worker. The routes:

- `GET /openapi.json` — OpenAPI 3.1 spec as JSON.
- `GET /openapi.yaml` — OpenAPI 3.1 spec as YAML (served inline as
  `text/yaml; charset=utf-8`).
- `GET /docs` — Scalar API reference UI that loads the spec.

On Workers the Scalar UI adds the most weight; consider
`docs: { ui: "swagger" }` or `docs: "auto"` (off in production), or pass
`docs: { openapiYamlPath: false }` to drop the YAML route only.
For hand-rolled mounting, `openapiToYAML` is exported from
`@daloyjs/core/openapi`.

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

1. **Open `src/index.ts`.**
2. **Design schemas first.** Use `z.object({...}).strict()` for inputs.
3. **Call `app.route({...})`** with `method`, `path`, `operationId`,
   `tags`, `responses`, `handler` (plus `request` when accepting input).
   Add `meta` examples / descriptions when the route is user-facing or
   consumed by agents.
4. **Return `{ status, body, headers? }`** with `status: 200 as const`.
5. **Throw typed errors** (`NotFoundError`, `BadRequestError`, etc.).
6. **Add a test** under `tests/`. Use `app.request(...)` for pure logic;
   use `unstable_dev` (Wrangler) or `@cloudflare/vitest-pool-workers`
   when you need bindings.
7. **Run the contract gate**: `pnpm contract` or `pnpm test`.
8. **Run the quality gates**: `pnpm typecheck && pnpm test`.

### Example: a typed route with bindings

```ts
import { z } from "zod";
import { App, NotFoundError, rateLimit, requestId, secureHeaders } from "@daloyjs/core";
import { toFetchHandler } from "@daloyjs/core/cloudflare";

interface Env {
  BOOKS: KVNamespace;
  JWT_SECRET: string;
}

const Book = z.object({ id: z.string(), title: z.string() }).strict();

function buildApp(env: Env) {
  const app = new App({ bodyLimitBytes: 1024 * 1024, requestTimeoutMs: 5_000 });
  app.use(requestId());
  app.use(secureHeaders());
  app.use(rateLimit({ windowMs: 60_000, max: 120 }));

  app.route({
    method: "GET",
    path: "/books/:id",
    operationId: "getBookById",
    tags: ["Books"],
    request: { params: z.object({ id: z.string().min(1) }).strict() },
    responses: {
      200: { description: "Found", body: Book },
      404: { description: "Not found" },
    },
    handler: async ({ params }) => {
      const raw = await env.BOOKS.get(params.id, "json");
      if (!raw) throw new NotFoundError(`Book ${params.id} not found`);
      return { status: 200 as const, body: Book.parse(raw) };
    },
  });

  return app;
}

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) =>
    toFetchHandler<Env>(buildApp(env)).fetch(req, env, ctx),
};
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

- Throw typed errors from `@daloyjs/core` — they serialize to RFC 9457
  problem responses.
- Add a `responses[code]` entry for every error you throw.
- For unexpected errors, let them bubble. The framework's error
  middleware converts them to a 500 problem response.

## Middleware

Register middleware **before** route definitions. Order matters.

Keep the secure baseline (`requestId`, `secureHeaders`, `rateLimit`).
Add CORS only when needed, with an explicit `origin` allowlist.

## Working with bindings

1. Add the binding (`[[kv_namespaces]]`, `[[d1_databases]]`, `[vars]`,
   etc.) to `wrangler.toml`.
2. Type the binding in the `Env` interface inside `src/index.ts`.
3. Pass `env` into `buildApp(env)` so handlers receive bindings via
   closure or factory argument. **Never read bindings via globals.**
4. Store secrets via `wrangler secret put` — they appear on `env` but
   are not committed to `wrangler.toml`.

## Testing best practices

Two patterns:

- **In-process** with `app.request(...)` for pure logic that does not
  need bindings.
- **Workers-aware** runners (`@cloudflare/vitest-pool-workers` or
  Wrangler `unstable_dev`) when KV/D1/etc. are involved.

Cover **happy paths and unhappy paths** for every route: valid input,
validation failures (400), auth failures (401/403), not-found (404),
conflict (409), rate limiting (429). For external services, inject an
in-memory fake into `buildApp(env)` during tests.
The shipped contract test should fail invalid examples, duplicate/missing
`operationId`, or missing responses.

Aim for complete happy- and unhappy-path test coverage of the routes you add.

## Security best practices

- Keep `secureHeaders()`, `requestId()`, and `rateLimit()` enabled. For
  high-traffic routes, attach Cloudflare's native rate-limit binding so
  limits are shared across isolates.
- Never make a failing test pass by deleting or weakening a security guard.
  If a guard blocks a legitimate route, add the narrowest per-route
  override or configuration knob and cover both the allowed and rejected
  paths in tests.
- Never log secrets — filter `authorization`, `cookie`, etc.
- Read secrets via `wrangler secret put`, never via plain `[vars]` in
  `wrangler.toml`.
- For auth, verify JWT signatures with the Web Crypto API
  (`crypto.subtle`). Never trust the `alg` header from the token.
- Validate redirects against an allowlist.
- Set `bodyLimitBytes` and `requestTimeoutMs` on `new App({...})` to
  mitigate DoS.
- For outbound HTTP, prefer `fetchGuard()` or a transport layered on top
  of it when URLs can be influenced by users or tenants. SSRF protections
  should fail closed for private ranges and cloud metadata endpoints.
- Workers have CPU and bundle-size limits; be cautious about adding
  heavy dependencies. Run `wrangler deploy --dry-run --outdir=dist` to
  inspect bundle size.
- Use `ctx.waitUntil(...)` for fire-and-forget work so the response
  returns promptly.
- Pin a `compatibility_date` in `wrangler.toml` and only bump it
  deliberately. New compat flags can change runtime semantics.

## Logging & observability

- Use `ctx.log` — it carries the request id.
- `console.log` in Workers shows up in `wrangler tail`. Prefer
  structured logs through the framework logger.
- For tracing, the `tracing()` middleware emits OpenTelemetry-compatible
  spans; wire up a Workers-friendly exporter when needed.

## Configuration & secrets

- Centralize env shape in an `Env` interface.
- Validate env via Zod once per request (cheap with Workers) or on first
  access via a memoized helper.
- Treat env as immutable during a request.

## Pitfalls and guardrails

- Use `toFetchHandler(app)` from `@daloyjs/core/cloudflare` — never
  hand-roll a `fetch(req, env, ctx)` adapter.
- Do not import `@daloyjs/core/node`, `@daloyjs/core/bun`, etc. — only
  `@daloyjs/core` and `@daloyjs/core/cloudflare`.
- Do not hand-edit OpenAPI paths or client types. Fix the route definition,
  schema, or metadata and regenerate.
- Avoid Node-only APIs (`Buffer`, `fs`, `process` beyond
  `process.env`) unless `nodejs_compat` is enabled and required.
- Do not weaken response literal types (`as const`).
- Do not return errors as `{ status: 4xx, body }`. Throw a typed error.
- Do not add runtime dependencies without checking the hardened `.npmrc` (installs wait 24h after publish by default).
- Long-running work belongs in `ctx.waitUntil(...)`, not blocking the
  response.
- If a route intentionally returns a body the contract cannot describe (a
  raw `Response`, HTML, a proxied payload), set
  `acknowledgeNoResponseBodySchema: true` on that route — never silence the
  `security.response.bodySchemaMissing` boot warning by widening a schema
  to `z.any()`.

## Process expectations

- Every new feature ships with happy-path and unhappy-path tests.
- Bug fixes include a regression test.
- `pnpm typecheck` and `pnpm test` must pass before completion.
- When route metadata, examples, lifecycle flags, or operation IDs change,
  run the contract gate and inspect the relevant generated OpenAPI diff.
- For deploys, ask the user to run `wrangler login` first if needed —
  do not attempt to authenticate on their behalf.
- Keep `README.md`, this `SKILL.md`, and `AGENTS.md` consistent.

## Exposing this API over MCP

`@daloyjs/core` ships a dependency-free Model Context Protocol (Streamable
HTTP) server helper — also available from the `@daloyjs/core/mcp` subpath.
To expose selected capabilities to MCP clients (AI agents), build a handler
with `createMcpHandler({ tools, resources, prompts })` and mount it with
`mcpRoutes("/mcp", handler)`. Throw `McpToolError` for caller-correctable
tool failures. The handler ships protocol-level guards (body cap, UTF-8/JSON
validation, `Origin` checks against DNS rebinding) and composes with the
existing middleware chain — put `bearerAuth()` / `rateLimit()` in front of
it like any other route. See <https://daloyjs.dev/docs> for the MCP guide.

## More

- Framework docs: <https://daloyjs.dev/docs>
- Issues: <https://github.com/daloyjs/daloy/issues>
