---
name: daloyjs-best-practices
description: >-
  Best practices for building, testing, and hardening this DaloyJS REST API on
  the Deno runtime. Use when adding or changing HTTP routes, Zod/Standard
  Schema validation schemas, middleware, route metadata, or error handling;
  regenerating the OpenAPI spec; running contract gates; managing Deno
  permissions and tasks; or working on auth, rate limits, secrets, and
  security defaults.
license: MIT
---

# SKILL.md — DaloyJS best practices (Deno)

Operational guidance and best practices for AI coding agents working in this
DaloyJS [Deno](https://deno.com) project. This is the project's **single
source of truth** for how to add routes, write tests, ship secure defaults,
and run the quality gates. Read this in full before making non-trivial
changes.

## When to use this skill

Use this skill when you need to:

- Add, modify, or remove HTTP routes in this project.
- Regenerate the OpenAPI spec.
- Wire up new middleware, validation, or error handling.
- Add or update tests, run typecheck, or build the project.
- Harden the API (auth, CORS, rate limits, permissions, secrets).

Do **not** use this skill for tasks unrelated to the API itself.

## Core principles

DaloyJS is a **contract-first** framework. Internalize these rules:

1. **The route definition is the contract.** Method, path, request schemas,
   and response schemas live in one place (`app.route({...})`).
2. **Validation schemas protect every boundary.** This template uses Zod,
   and Daloy accepts any Standard Schema-compatible library.
3. **Preserve literal types.** Return `status: 200 as const`; use
   `z.literal(...)` / `as const` on discriminator fields.
4. **`buildApp()` is pure.** Construction never opens sockets. The HTTP
   listener lives in `src/main.ts` via `@daloyjs/core/deno`.
5. **Secure by default.** `requestId()`, `secureHeaders()`, and
   `rateLimit()` are registered before route definitions.
6. **Deno permissions are part of the contract.** Tasks declare exactly
   the permissions they need (`--allow-net`, `--allow-env`, `--allow-read`).
   Do not broaden them casually.
7. **Contract gates are part of done.** Keep `operationId` values stable,
   examples schema-valid, declared error responses accurate, and generated
   OpenAPI artifacts in sync with the live route table.

## Project shape

- `src/build-app.ts` — exports `buildApp()`. All routes and middleware
  registered here. **Pure factory.**
- `src/main.ts` — calls `buildApp()` and starts the Deno HTTP listener via
  `@daloyjs/core/deno`. The only file allowed to open a port.
- `scripts/dump-openapi.ts` — imports `buildApp()` and writes
  `generated/openapi.json`.
- `deno.json` — tasks, import map, and JSR-first dependency specifiers. **There is no
  `package.json`** in this project — do not add one.
- `tests/` — Deno test files (`*.test.ts`).
- `generated/` — **machine-written**. Never edit by hand.

## Commands cheat-sheet

```bash
deno task dev           # watch-mode server on http://localhost:3000
deno task typecheck     # deno check
deno task test          # deno test
deno task contract      # run the focused contract test
deno task gen:openapi   # write generated/openapi.json
```

The typed Hey API SDK is generated outside Deno today (Hey API has no
Deno entrypoint yet). To produce the client, run:

```bash
npx @hey-api/openapi-ts -i generated/openapi.json -o generated/client
```

Always run `deno task typecheck` and `deno task test` before declaring a
task done. `deno task test` includes the contract gate; if you need a
focused contract check, run `deno task contract`.

## OpenAPI & docs routes

When `docs: true` is set on `new App({...})` (the default in this template),
three routes are auto-mounted off the spec generated from your route
definitions:

- `GET /openapi.json` — OpenAPI 3.1 spec as JSON.
- `GET /openapi.yaml` — OpenAPI 3.1 spec as YAML (served inline as
  `text/yaml; charset=utf-8`).
- `GET /docs` — Scalar API reference UI that loads the spec.

Customize via `docs: { openapiPath, openapiYamlPath, path, ui }`. Set
`openapiYamlPath: false` to disable just the YAML route, `docs: "auto"` to
mount only outside production, or `docs: false` to disable all three.
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

1. **Open `src/build-app.ts`.**
2. **Design schemas first.** Define request body/params/query/headers and a
   response body per status code. Prefer `z.object({...}).strict()` for
   inputs.
3. **Call `app.route({...})`** with `method`, `path`, `operationId`,
   `tags`, `responses`, `handler` (plus `request` when accepting input).
   Add `meta` examples / descriptions when the route is user-facing or
   consumed by agents.
4. **Return `{ status, body, headers? }` from the handler.** Always
   `status: 200 as const`.
5. **Throw typed errors** (`NotFoundError`, `BadRequestError`, etc.) from
   `@daloyjs/core`.
6. **Add a test in `tests/<route>.test.ts`** using `app.request(...)` for
   in-process tests.
7. **Run the contract gate**: `deno task contract` or `deno task test`.
8. **Regenerate the contract artifacts**: `deno task gen:openapi`.
9. **Run the quality gates**: `deno task typecheck && deno task test`.

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
- **IDs**: prefer `z.string().min(1)`; use `z.string().uuid()` or
  `z.string().regex(...)` when shape is known.
- **Numbers from query strings**: `z.coerce.number().int().min(...)`.
- **Optional vs nullable**: `.optional()` ≠ `.nullable()` in OpenAPI.
- **Pagination**: standardize on `{ items, nextCursor }` cursor
  pagination.
- **Discriminated unions**: `z.discriminatedUnion("kind", [...])`.
- Keep response examples close to the route definition and schema-valid.
  The contract test intentionally fails invalid examples.
- **Never** parse `req.body` directly — let the framework validate.

## Error handling

- Throw typed errors from `@daloyjs/core` — they serialize to RFC 9457
  problem responses.
- Add a `responses[code]` entry for every error you throw.
- Do not swallow errors. Log via `ctx.log.error(...)` and rethrow.

## Middleware

Register middleware **before** route definitions. Order matters.

Keep the secure baseline:

```ts
app.use(requestId());
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 120 }));
```

Add CORS only when needed, with an explicit `origin` allowlist.

## Testing best practices

Tests run with `deno test`. Use **in-process** `app.request()` — no port
needed.

```ts
import { assertEquals } from "jsr:@std/assert";
import { buildApp } from "../src/build-app.ts";

Deno.test("GET /healthz returns ok", async () => {
  const app = buildApp();
  const res = await app.request("/healthz");
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
});
```

Cover **happy paths and unhappy paths**: valid input, validation failures
(400), auth failures (401/403), not-found (404), conflict (409), rate
limiting (429). For external services, inject an in-memory fake via
`buildApp({ store })`.
The shipped contract test should fail invalid examples, duplicate/missing
`operationId`, or missing responses.

Aim for complete happy- and unhappy-path test coverage of the routes you add.

## Security best practices

- Keep `secureHeaders()`, `requestId()`, and `rateLimit()` enabled.
- Never make a failing test pass by deleting or weakening a security guard.
  If a guard blocks a legitimate route, add the narrowest per-route
  override or configuration knob and cover both the allowed and rejected
  paths in tests.
- Permissions for the `dev` task are intentionally narrow: `--allow-net
--allow-env --allow-read`. If a change requires more permissions, add
  them explicitly to the relevant task in `deno.json` and call it out to
  the user — never `--allow-all`.
- Never log secrets — filter `authorization`, `cookie`, etc.
- Validate env via Zod at boot (`Deno.env.toObject()`). Fail fast on
  missing config.
- For auth, verify JWT signatures against an allowlist of keys, never
  trust the `alg` header, always check `exp` / `nbf`.
- Validate redirects against an allowlist.
- Set `bodyLimitBytes` and `requestTimeoutMs` on `new App({...})` to
  mitigate DoS.
- For outbound HTTP, prefer `fetchGuard()` or a transport layered on top
  of it when URLs can be influenced by users or tenants. SSRF protections
  should fail closed for private ranges and cloud metadata endpoints.
- Pin `npm:` and `jsr:` specifiers in `deno.json` to exact or
  caret-locked versions; review changes in `deno.lock` before committing.

## Logging & observability

- Use `ctx.log` — it carries the request id.
- Avoid `console.log` in production code paths.

## Configuration & secrets

- Centralize config parsing (e.g. `src/config.ts`) validated by Zod.
- Read from `Deno.env`; do not introduce a `package.json` or dotenv
  shim.

## Pitfalls and guardrails

- Never import `@daloyjs/core/deno` from `src/build-app.ts` or any
  script under `scripts/`. That would boot a listener during codegen.
- Do not edit files under `generated/` by hand.
- Do not hand-edit OpenAPI paths or client types. Fix the route definition,
  schema, or metadata and regenerate.
- Do not weaken response literal types (`as const`).
- Do not return errors as `{ status: 4xx, body }`. Throw a typed error.
- Use `deno task ...`, not `npm`/`pnpm`. There is no `package.json`.
- If you need a new dependency, add it to `imports` in `deno.json` via
  `npm:` or `jsr:` specifiers; do not introduce a `package.json`.
- If a route intentionally returns a body the contract cannot describe (a
  raw `Response`, HTML, a proxied payload), set
  `acknowledgeNoResponseBodySchema: true` on that route — never silence the
  `security.response.bodySchemaMissing` boot warning by widening a schema
  to `z.any()`.

## Process expectations

- Every new feature ships with happy-path and unhappy-path tests.
- Bug fixes include a regression test.
- `deno task typecheck` and `deno task test` must pass before completion.
- Run `deno task gen:openapi` when route shapes change; commit the
  updated `generated/openapi.json`.
- When route metadata, examples, lifecycle flags, or operation IDs change,
  run the contract gate and inspect the relevant generated OpenAPI diff.
- Keep `README.md`, this `SKILL.md`, and `AGENTS.md` consistent with the
  code.

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
