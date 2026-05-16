# SKILL.md — DaloyJS best practices (Node)

Operational guidance and best practices for AI coding agents working in this
DaloyJS Node.js project. This is the project's **single source of truth** for
how to add routes, write tests, ship secure defaults, and run the quality
gates. Read this in full before making non-trivial changes.

## When to use this skill

Use this skill when you need to:

- Add, modify, or remove HTTP routes in this project.
- Regenerate the OpenAPI spec or the typed Hey API SDK in `generated/`.
- Wire up new middleware, validation, or error handling.
- Add or update tests, run typecheck, or build the project.
- Harden the API (auth, CORS, rate limits, secrets, dependency hygiene).

Do **not** use this skill for tasks unrelated to the API itself (infra-only
changes, unrelated docs sites, etc.).

## Core principles

DaloyJS is a **contract-first** framework. Internalize these rules — every
recommendation below follows from them:

1. **The route definition is the contract.** Method, path, request schemas,
   and response schemas live in one place (`app.route({...})`). The OpenAPI
   spec, the typed client, and the runtime validation are all derived from
   it. Never duplicate that information by hand-writing fetch calls, types,
   or `openapi.json` entries.
2. **Zod schemas validate at every boundary.** Body, params, query, and
   headers go through Zod. If a field is not in the schema, it is not part
   of the contract.
3. **Preserve literal types.** Return `status: 200 as const` and use
   `z.literal(...)` / `as const` on discriminator fields. The typed client
   needs narrow types to do useful response narrowing.
4. **`buildApp()` is pure.** Construction never opens sockets or reads
   stateful resources. The HTTP listener lives in a separate file. This
   lets codegen, tests, and tooling import `buildApp()` without side
   effects.
5. **Secure by default.** `requestId()`, `secureHeaders()`, and
   `rateLimit()` are registered before route definitions. Do not remove
   them unless the user explicitly asks.

## Project shape

- `src/build-app.ts` — exports `buildApp()`. All routes and middleware are
  registered here. **Pure function, no side effects.**
- `src/index.ts` — calls `buildApp()` and starts the Node HTTP listener via
  `@daloyjs/core/node`. This is the only file allowed to open a port.
- `scripts/dump-openapi.ts` — imports `buildApp()` and writes
  `generated/openapi.json`. Imports nothing that boots a server.
- `openapi-ts.config.ts` — Hey API config; reads `generated/openapi.json`
  and writes `generated/client/`.
- `tests/` — Node test runner files (`*.test.ts`).
- `generated/` — **machine-written**. Never edit by hand; rerun `pnpm gen`.

## Commands cheat-sheet

```bash
pnpm dev          # watch-mode dev server on http://localhost:3000
pnpm typecheck    # tsc --noEmit
pnpm test         # Node built-in test runner
pnpm gen          # gen:openapi + gen:client
pnpm gen:openapi  # write generated/openapi.json
pnpm gen:client   # write generated/client/
pnpm build        # emit dist/
pnpm audit        # supply-chain audit
```

Always run `pnpm typecheck` and `pnpm test` before declaring a task done.
If a change touches route shapes, also run `pnpm gen` so the client stays
in sync.

## Workflow: add a new route

Follow these steps in order. Skipping any of them is a common source of
bugs (drifted client SDK, missing test, broken codegen).

1. **Open `src/build-app.ts`.** Routes are registered on the `app`
   instance returned by `new App({...})`.
2. **Design the schemas first.** Define request body / params / query /
   headers and a response body per status code. Reuse schemas — co-locate
   them in `src/build-app.ts` or extract a `src/schemas/*.ts` module if
   they grow. Prefer `z.object({...}).strict()` for inputs so unknown
   keys are rejected at the boundary.
3. **Call `app.route({...})`.** Required keys: `method`, `path`,
   `operationId`, `tags`, `responses`, `handler`. Add `request` when the
   route accepts input.
4. **Return `{ status, body, headers? }` from the handler.** Always use
   `status: 200 as const` (or whatever code) so the typed client can
   narrow. For literal discriminators in `body`, use `as const` or
   `z.literal(...)` in the schema.
5. **Throw typed errors, do not return raw error responses.** Use
   `NotFoundError`, `BadRequestError`, `UnauthorizedError`,
   `ForbiddenError`, `ConflictError`, etc. from `@daloyjs/core`. The
   framework maps them to RFC 7807 problem responses.
6. **Add a test in `tests/<route>.test.ts`.** Use `app.request(...)` for
   in-process tests — no port needed (see "Testing best practices").
7. **Regenerate the contract.** Run `pnpm gen`. Inspect
   `generated/openapi.json` to confirm the operation shows up with the
   expected schemas and status codes.
8. **Run the quality gates.** `pnpm typecheck && pnpm test`.

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

- **Inputs**: use `.strict()` on top-level object schemas to reject unknown
  keys at the API boundary. This blocks mass-assignment-style attacks and
  catches typos in clients early.
- **IDs**: prefer `z.string().min(1)` over `z.string()`. Use
  `z.string().uuid()` / `z.string().regex(...)` when the shape is known.
- **Numbers from query strings**: use `z.coerce.number().int().min(...)`
  because query params arrive as strings.
- **Optional vs nullable**: `.optional()` for "may be absent",
  `.nullable()` for "explicitly null". They are not interchangeable in
  OpenAPI.
- **Pagination**: standardize on `{ items, nextCursor }` cursor pagination
  unless the user asks otherwise. Offset pagination invites large skips.
- **Discriminated unions** (e.g. for response variants): use
  `z.discriminatedUnion("kind", [...])` and tag each branch with
  `z.literal("...")` so codegen produces a narrow TypeScript union.
- **Never** call `JSON.parse` or `req.body` directly in a handler. Let the
  framework validate via the schema and read the typed object passed to
  the handler.

## Error handling

- Throw typed errors from `@daloyjs/core` — they carry status codes and
  serialize to RFC 7807 problem responses (`application/problem+json`).
- Add a `responses[code]` entry for every error you throw, so the OpenAPI
  spec and the typed client know it can happen.
- Do not swallow errors in handlers. If you need to log and rethrow, use
  `ctx.log.error(err, "context")` and rethrow.
- For unexpected errors, let them bubble. The framework's error middleware
  will convert them into a generic 500 problem response and log them with
  the request ID for correlation.

## Middleware

Register middleware **before** route definitions inside `buildApp()`.
Order matters — earlier middleware wraps later middleware and routes.

Keep these as the secure baseline:

```ts
app.use(requestId());      // x-request-id for log correlation
app.use(secureHeaders());  // strict security headers
app.use(rateLimit({ windowMs: 60_000, max: 120 }));
```

Add CORS only when the API is consumed by browsers from a different
origin, and always pin `origin` to an allowlist — never `*` for an API
that accepts credentials.

Custom middleware should be small, well-typed, and call `await next()`
exactly once. Wrap it in `try { await next() } finally { ... }` if it
needs to run code after the handler.

## Testing best practices

Tests live under `tests/` and run with `node --test` (Node's built-in
runner via `tsx`). Use **in-process** requests through `app.request()` —
no HTTP server, no port flakiness, no teardown.

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/build-app.ts";

test("GET /healthz returns ok", async () => {
  const app = buildApp();
  const res = await app.request("/healthz");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(typeof body.uptime === "number");
});
```

Cover both **happy paths** and **unhappy paths** for every route:

- Happy path: valid input → expected `status` and `body`.
- Validation failure: missing/invalid fields → `400` with problem details.
- Auth failure (when applicable): unauthenticated → `401`; wrong scope →
  `403`.
- Not found: unknown id → `404`.
- Conflict: duplicate create → `409`.
- Rate limit: hammer the route → `429` after the configured threshold.

For routes that touch external services, write a thin in-memory fake
inside the test and inject it via the factory pattern (`buildApp({ store })`).
Do not mock global `fetch` unless there is no alternative.

Aim for **100% line and function coverage** on routes you add. If a
branch is impractical to test (e.g. defensive `never` arms), refactor it
out rather than adding ignore comments — agent coverage tools may not
honor them.

## Security best practices

- Keep `secureHeaders()`, `requestId()`, and `rateLimit()` enabled. They
  ship the OWASP-recommended baseline.
- Never log secrets. Filter `authorization`, `cookie`, and any header /
  body field that may contain tokens before logging.
- Read secrets from `process.env`, validated through a Zod schema at
  boot. Fail fast on missing config rather than at request time.
- For auth, prefer a small JWT or session middleware over rolling your
  own. Verify signatures against an allowlist of keys, never trust the
  `alg` header from the token, and always check `exp` / `nbf`.
- Validate redirects against an allowlist. Open redirects are an OWASP
  Top-10 issue.
- Limit body sizes via `bodyLimitBytes` on `new App({...})` — large
  payloads are a cheap denial-of-service vector.
- Set `requestTimeoutMs` so slow clients cannot tie up workers.
- For database access, use parameterized queries / a query builder. Never
  interpolate user input into SQL strings.
- Review `pnpm audit` output before releases. Avoid lowering the
  install cooldown without reason; new package versions can be malicious.

## Logging & observability

- The default logger emits structured JSON in production and pretty logs
  in development. Use it via the handler context: `await handler(ctx)` →
  `ctx.log.info({ userId }, "message")`.
- Always include the request id in log lines automatically emitted by
  the framework. When you add your own logs, the request id is on
  `ctx.requestId` and on the bound child logger.
- For tracing, the `tracing()` middleware (from `@daloyjs/core`) emits
  OpenTelemetry-compatible spans. Enable it once the user wires up an
  exporter.

## Configuration & secrets

- Centralize config parsing in one module (e.g. `src/config.ts`) that
  validates `process.env` via a Zod schema and exports a typed `config`
  object.
- `.env.example` documents required variables; `.env` is gitignored.
- Treat config as immutable at runtime — read it once at startup.

## Pitfalls and guardrails

- Never import `@daloyjs/core/node` (or any adapter that boots a server)
  from `src/build-app.ts` or any script under `scripts/`. That would
  start an HTTP listener as a side effect of codegen.
- Do not edit files under `generated/` by hand — they are overwritten by
  `pnpm gen`.
- Do not weaken response literal types (`as const`); the typed client
  depends on them.
- Do not return errors as `{ status: 4xx, body: {...} }`. Throw a typed
  error so the framework can format the problem response consistently.
- Do not add runtime dependencies without checking the hardened `.npmrc` (installs wait 24h after publish by default).
- Do not bypass safety checks like `--no-verify` on commit or
  `--ignore-scripts=false` on install without a clear reason.
- Avoid global mutable state in `buildApp()`. If you need shared state,
  pass it in as a parameter (`buildApp({ store })`).

## Process expectations

- Every new feature must include happy-path **and** unhappy-path tests.
- Bug fixes include a regression test.
- Quality gates (`pnpm typecheck`, `pnpm test`) must pass before
  declaring the task complete.
- When route shapes change, also run `pnpm gen` and commit the updated
  `generated/openapi.json` + client.
- Keep `README.md`, this `SKILL.md`, and `AGENTS.md` consistent with the
  code. If you add a workflow, document it here.

## More

- Framework docs: <https://daloyjs.dev/docs>
- Issues: <https://github.com/daloyjs/daloy/issues>
