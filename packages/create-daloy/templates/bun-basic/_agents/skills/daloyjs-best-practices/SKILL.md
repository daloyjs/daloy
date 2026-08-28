---
name: daloyjs-best-practices
description: >-
  Build, test, and harden this DaloyJS REST API on Bun. Use when the user
  asks to add or change an endpoint, route, Zod/Standard Schema,
  middleware, error handling, OpenAPI spec, typed Hey API client, contract
  gate, auth, rate limit, background jobs, or security default. Also use
  for phrasing like
  "add GET /...", "new route", "regenerate the client", "bun test", or
  "fix the 401". Do not use for frontend UI, infra-only work, or unrelated
  docs.
license: MIT
---

# SKILL.md — DaloyJS best practices (Bun)

Operational guidance and best practices for AI coding agents working in this
DaloyJS [Bun](https://bun.sh) project. This is the project's **single source
of truth** for how to add routes, write tests, ship secure defaults, and run
the quality gates. Read this in full before making non-trivial changes.

## When to use this skill

Use this skill when you need to:

- Add, modify, or remove HTTP routes in this project.
- Regenerate the OpenAPI spec or the typed Hey API SDK in `generated/`.
- Wire up new middleware, validation, or error handling.
- Add or update tests, run typecheck, or build the project.
- Harden the API (auth, CORS, rate limits, secrets, dependency hygiene).
- User phrasing such as "add GET /books", "new endpoint", "regenerate the
  client", or "fix the 401".

Do **not** use this skill for frontend UI, infra-only work, or unrelated
docs. Rare topics live under `references/`: **read**
[references/mcp.md](references/mcp.md) only when adding an MCP endpoint,
and **read** [references/ci-workflows.md](references/ci-workflows.md) only
when editing `.github/` or a `--with-ci` workflow. Do not load those files
up front.

## Core principles

DaloyJS is a **contract-first** framework. Internalize these rules — every
recommendation below follows from them:

1. **The route definition is the contract.** Method, path, request schemas,
   and response schemas live in one place — `app.get(path, contract, handler)`
   (and the matching `app.post`/`put`/`patch`/`delete`/`head` shorthands), or
   `app.route({...})` when you need a reusable `defineRoute()` contract or a
   metadata-heavy route. Both forms produce identical runtime behavior,
   validation, security, and OpenAPI output. The OpenAPI spec, the typed
   client, and the runtime validation are all derived from the route
   definition.
2. **Validation schemas protect every boundary.** This template uses Zod,
   and Daloy accepts any Standard Schema-compatible library. Body, params,
   query, and headers go through the declared schema.
3. **Preserve literal types.** Return `status: 200 as const` and use
   `z.literal(...)` / `as const` on discriminator fields so the typed
   client can narrow responses.
4. **`buildApp()` is pure.** Construction never opens sockets. The HTTP
   listener lives in `src/index.ts` via `@daloyjs/core/bun`. This lets
   codegen and tests import `buildApp()` without side effects.
5. **Secure by default.** `requestId()`, `secureHeaders()`, and
   `rateLimit()` are registered before route definitions.
6. **Contract gates are part of done.** Keep `operationId` values stable,
   examples schema-valid, declared error responses accurate, and generated
   OpenAPI / client artifacts in sync with the live route table.

## Project shape

- `src/build-app.ts` — exports `buildApp()`. All routes and middleware
  registered here. **Pure factory.**
- `src/index.ts` — calls `buildApp()` and starts the Bun HTTP listener via
  `@daloyjs/core/bun`. The only file allowed to open a port.
- `scripts/dump-openapi.ts` — imports `buildApp()` and writes
  `generated/openapi.json`.
- `openapi-ts.config.ts` — Hey API config; reads `generated/openapi.json`
  and writes `generated/client/`.
- `tests/` — Bun test files (`*.test.ts`).
- `generated/` — **machine-written**. Never edit by hand.

## Commands cheat-sheet

```bash
bun run dev           # hot-reload server on http://localhost:3000
bun run typecheck     # tsc --noEmit
bun test              # Bun's native test runner
bun run gen:openapi   # write generated/openapi.json
bun run gen:client    # write generated/client/
bun run gen           # gen:openapi + gen:client
bun run contract      # run the focused contract test
```

Always run `bun run typecheck` and `bun test` before declaring a task done.
`bun test` includes the contract gate; if you need a focused contract check,
run `bun run contract`. If a change touches route shapes, also rerun
`bun run gen:openapi && bun run gen:client` so the OpenAPI spec and client
stay in sync.

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
   inputs so unknown keys are rejected at the boundary.
3. **Call the method shorthand: `app.get(path, contract, handler)`** (or
   `app.post`/`put`/`patch`/`delete`/`head` for other methods). The contract
   object's required keys are `operationId`, `tags`, `responses`. Add
   `request` when the route accepts input, and add `meta` examples /
   descriptions when the route is user-facing or consumed by agents. Reach
   for the full `app.route({ method, path, ...contract, handler })` form
   instead when the route is built from a reusable `defineRoute()` contract,
   or when composing many routes at once via `registerRoutes()`.
4. **Return `{ status, body, headers? }` from the handler.** Always use
   `status: 200 as const` so the typed client can narrow.
5. **Throw typed errors**, do not return raw error responses. Use
   `NotFoundError`, `BadRequestError`, `UnauthorizedError`,
   `ForbiddenError`, `ConflictError`, etc.
6. **Add a test in `tests/<route>.test.ts`** using `app.request(...)` for
   in-process testing — no port needed.
7. **Run the contract gate**: `bun run contract` or `bun test`.
8. **Regenerate the contract artifacts**: `bun run gen:openapi && bun run gen:client`.
   Inspect `generated/openapi.json` to confirm the operation shows up.
9. **Run the quality gates**: `bun run typecheck && bun test`.

### Example: a typed route

```ts
import { z } from "zod";
import { NotFoundError } from "@daloyjs/core";

const Book = z.object({ id: z.string(), title: z.string() }).strict();
const BookParams = z.object({ id: z.string().min(1) }).strict();

app.get(
  "/books/:id",
  {
    operationId: "getBookById",
    tags: ["Books"],
    request: { params: BookParams },
    responses: {
      200: { description: "Found", body: Book },
      404: { description: "Not found" },
    },
  },
  async ({ params }) => {
    const book = await store.find(params.id);
    if (!book) throw new NotFoundError(`Book ${params.id} not found`);
    return { status: 200 as const, body: book };
  }
);
```

## Validation & schema conventions

- **Inputs**: use `.strict()` on top-level object schemas to reject unknown
  keys at the API boundary.
- **IDs**: prefer `z.string().min(1)`; use `z.string().uuid()` or
  `z.string().regex(...)` when the shape is known.
- **Numbers from query strings**: use `z.coerce.number().int().min(...)`.
- **Optional vs nullable**: `.optional()` for "may be absent",
  `.nullable()` for "explicitly null". They differ in OpenAPI output.
- **Pagination**: standardize on `{ items, nextCursor }` cursor pagination.
- **Discriminated unions**: use `z.discriminatedUnion("kind", [...])`.
- Keep response examples close to the route definition and schema-valid.
  The contract test intentionally fails invalid examples.
- **Never** call `JSON.parse` or read `req.body` directly. Let the
  framework validate and pass the typed object to your handler.

## Error handling

- Throw typed errors from `@daloyjs/core` — they serialize to RFC 9457
  problem responses.
- Add a `responses[code]` entry for every error you throw.
- Do not swallow errors. Log via `ctx.log.error(err, "context")` and
  rethrow if recovery is impossible.

## Middleware

Register middleware **before** route definitions. Order matters.

Keep the secure baseline:

```ts
app.use(requestId()); // x-request-id for log correlation
app.use(secureHeaders()); // strict security headers
app.use(rateLimit({ windowMs: 60_000, max: 120 }));
```

Add CORS only when needed, with an explicit `origin` allowlist.

## Background jobs

Side effects that must outlive the HTTP request (welcome emails, webhook
fan-out, thumbnails, nightly reconciliation) belong in a **job**, not
inline in the handler and not in a fire-and-forget promise.

- `app.useJobs({ store, handlers, startWorker })` wires a queue (and an
  optional in-process worker) into the app lifecycle, including the
  graceful-shutdown drain.
- Enqueue **after** the DB commit, always with an idempotency key:

```ts
import { jobIdempotencyKey } from "@daloyjs/core";

await app.jobs!.enqueue({
  name: "email.welcome",
  payload: { userId: user.id, to: user.email }, // ids, never file bytes
  idempotencyKey: jobIdempotencyKey({ name: "email.welcome", key: user.id }),
});
```

- Delivery is **at-least-once**: handlers must be idempotent. Pass a key
  through to downstream APIs (e.g. Stripe's `Idempotency-Key`) when a
  duplicate run would move money or send email.
- Throw `JobFatalError` for permanent failures (no retry); any other throw
  retries with full-jitter backoff, then dead-letters.
- `app.cronEnqueue(def, { name, payload })` turns a cron tick into an
  idempotent enqueue. Use it for side effects that must run once
  cluster-wide; keep plain `app.cron()` for process-local maintenance
  (other replicas have their own memory to sweep).
- Payloads are plain JSON capped at 64 KiB: enqueue ids and blob URLs,
  never file contents.
- `MemoryJobStore` is for tests (`worker.runOnce()`) and single-process
  dev. Production needs a shared `JobStore` adapter (Redis/Postgres/SQS)
  in app code; `useJobs` warns on Memory in production, and
  `strictProduction: true` refuses to boot.
- `startWorker: true` in the same process is fine for small deployments;
  split a dedicated worker process (same app, `useJobs` with
  `startWorker`, no public ingress) as you grow.

Full reference: <https://daloyjs.dev/docs/jobs>

## Testing best practices

Tests run with `bun test`. Use **in-process** requests through
`app.request()` — no HTTP server, no port flakiness.

```ts
import { test, expect } from "bun:test";
import { buildApp } from "../src/build-app";

test("GET /healthz returns ok", async () => {
  const app = buildApp();
  const res = await app.request("/healthz");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(typeof body.uptime).toBe("number");
});
```

Cover both **happy paths and unhappy paths** for every route: valid input,
validation failures (400), auth failures (401/403), not-found (404),
conflicts (409), rate limiting (429). For external services, inject an
in-memory fake via `buildApp({ store })` rather than mocking `fetch`.
For user-owned or tenant-owned resources, use at least two principals and
prove that Alice's valid token cannot list, read, update, or delete Bob's
record.
The shipped contract test should fail invalid examples, duplicate/missing
`operationId`, or missing responses.

Aim for complete happy- and unhappy-path test coverage of the routes you add.

## Security best practices

- Keep `secureHeaders()`, `requestId()`, and `rateLimit()` enabled.
- Never make a failing test pass by deleting or weakening a security guard.
  If a guard blocks a legitimate route, add the narrowest per-route
  override or configuration knob and cover both the allowed and rejected
  paths in tests.
- Never log secrets — filter `authorization`, `cookie`, and any
  token-bearing fields.
- Validate secrets from `process.env` (or `Bun.env`) through a Zod schema
  at boot. Fail fast on missing config.
- For auth, verify JWT signatures against an allowlist of keys, never
  trust the `alg` header, always check `exp` / `nbf`.
- Authentication and scopes are not resource authorization. For every route
  that accepts a resource id, classify the resource as public, user-owned,
  tenant-owned, shared, or administrator-only.
- Scope user-owned and tenant-owned database reads and writes with both the
  caller-controlled id and the trusted owner / tenant from the verified
  principal. Do not fetch by id alone and rely on the UI or a later caller to
  remember the ownership check.
- Never accept `ownerId`, `userId`, `tenantId`, `role`, or another privileged
  ownership field from an ordinary request body. Derive it from the verified
  principal and reject the field with a strict request schema.
- Use an explicit, permissioned, audited path for administrator bypasses.
- Validate redirects against an allowlist.
- Set `bodyLimitBytes` and `requestTimeoutMs` on `new App({...})` to
  mitigate DoS.
- Use parameterized queries for database access — never interpolate user
  input into SQL.
- For outbound HTTP, prefer `fetchGuard()` or a transport layered on top
  of it when URLs can be influenced by users or tenants. SSRF protections
  should fail closed for private ranges and cloud metadata endpoints.
- Bun ships its own audit story; check `bun pm audit` periodically and
  pin versions in `bun.lockb`.

## CI and workflows (`--with-ci` scaffolds)

Only when editing `.github/`, Dependabot, or a `--with-ci` workflow:
**read** [references/ci-workflows.md](references/ci-workflows.md) as
reference. Skip that file for ordinary route work.

## Logging & observability

- Use the framework logger via `ctx.log` — it carries the request id
  automatically.
- Avoid `console.log` in production code paths; the structured logger
  emits JSON for log aggregators.

## Configuration & secrets

- Centralize config parsing in `src/config.ts`, validated by Zod.
- `.env.example` documents required variables; `.env` is gitignored.
- Treat config as immutable at runtime.

## Pitfalls and guardrails

- Never import `@daloyjs/core/bun` from `src/build-app.ts` or any script
  under `scripts/`. That would boot an HTTP listener during codegen.
- Do not edit files under `generated/` by hand — they are overwritten.
- Do not hand-edit OpenAPI paths or client types. Fix the route definition,
  schema, or metadata and regenerate.
- Do not weaken response literal types (`as const`); the typed client
  depends on them.
- Do not return errors as `{ status: 4xx, body: {...} }`. Throw a typed
  error.
- Do not add runtime dependencies without checking the hardened `.npmrc` (installs wait 24h after publish by default).
- Avoid Node-only APIs in code that may also run on the Cloudflare/Vercel
  templates; the Bun runtime is web-standard friendly but check before
  reaching for `node:fs` etc.
- If a route intentionally returns a body the contract cannot describe (a
  raw `Response`, HTML, a proxied payload), set
  `acknowledgeNoResponseBodySchema: true` on that route — never silence the
  `security.response.bodySchemaMissing` boot warning by widening a schema
  to `z.any()`.

## Process expectations

- Every new feature ships with happy-path and unhappy-path tests.
- Bug fixes include a regression test.
- `bun run typecheck` and `bun test` must pass before completion.
- Run `bun run gen:openapi && bun run gen:client` when route shapes
  change; commit the updated artifacts.
- When route metadata, examples, lifecycle flags, or operation IDs change,
  run the contract gate and inspect the relevant generated OpenAPI diff.
- Keep `README.md`, this `SKILL.md`, and `AGENTS.md` consistent with the
  code.

## Exposing this API over MCP

Only when adding or changing an MCP endpoint: **read**
[references/mcp.md](references/mcp.md) as reference (do not treat it as a
script to run). Skip that file for ordinary HTTP route work.

## More

- Framework docs: <https://daloyjs.dev/docs>
- Issues: <https://github.com/daloyjs/daloy/issues>
