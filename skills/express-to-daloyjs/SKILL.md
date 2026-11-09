---
name: express-to-daloyjs
description: >-
  Port an existing Express.js (4 or 5) app, router, middleware, error
  handler, or Supertest suite to DaloyJS (@daloyjs/core). Use when the user
  asks to migrate, port, convert, or rewrite Express code for DaloyJS, or
  when DaloyJS code still uses req/res/next, app.listen, helmet,
  express.json, or "trust proxy". Do not use for greenfield DaloyJS work
  with no Express source, or for migrations from Fastify, Hono, or NestJS.
license: MIT
---

# Migrating an Express app to DaloyJS

Read this as reference while porting Express code. It is a playbook, not a
script to run. Your training data likely holds far more Express than
DaloyJS, so do not translate line by line from memory.

## Source of truth

Before the first port, read the full guide. Prefer it over this summary when
they differ, because the guide tracks the current release:

- MCP: the DaloyJS docs server at `https://daloyjs.dev/mcp`, tool `get_doc`
  with path `migrating/express`. Use `search_docs` for any API you are
  unsure of (for example `behindProxy`, `safeRedirect`, `multipart`).
- HTTP: <https://daloyjs.dev/docs/migrating/express.md> (plain Markdown).

If neither is reachable, say so and ask before guessing an API.

## Workflow

1. **Inventory first, write nothing yet.** List every route (method, path,
   status codes it actually returns), every `app.use` middleware, every
   error handler, every `app.set` / `app.disable` setting (especially
   `trust proxy`), session and cookie usage, static files, views, and
   uploads. Show the user the inventory and the proposed slice order.
2. **Pin current behavior.** Before porting a slice, capture what Express
   returns today (existing Supertest tests, or new ones) so the port has a
   contract to match.
3. **Bootstrap once.** `new App({ bodyLimitBytes, requestTimeoutMs, docs:
   "auto" })`, then `requestId()` and `rateLimit()`. Add `behindProxy`
   when the app runs behind a load balancer. Start the listener with the
   runtime adapter's `serve()` in a separate entry file.
4. **Port one resource at a time** (all of `/books`, then all of `/users`).
   Never split one resource across both frameworks. For a large app, run
   both behind a reverse proxy (strangler fig) and move path prefixes over.
5. **Prove it.** Port each Supertest test to `await app.request(...)` (no
   port needed) and assert the same statuses and bodies. Add an OpenAPI
   snapshot test. Run the project's typecheck and test commands.
6. **Delete the Express version** of the slice only after its tests pass on
   DaloyJS.

## Translation table

| Express | DaloyJS |
| --- | --- |
| `app.get(path, (req, res) => ...)` | `app.get(path, { operationId, request, responses }, async (ctx) => ({ status, body }))` |
| `res.json(x)` / `res.status(201).json(x)` | `return { status: 200, body: x }` / `return { status: 201, body: x }`. Every returned status must be declared in `responses`. |
| `res.send("text")` | `return { status: 200, headers: { "content-type": "text/plain" }, body: "text" }` |
| `res.redirect(req.query.next)` | `return safeRedirect(query.next, { allowedPaths: [...] })` (exact-match allowlist) |
| `req.params` / `req.query` / `req.body` | `ctx.params` / `ctx.query` / `ctx.body`, typed by `request.params` / `query` / `body` schemas. Use `z.coerce` for numeric path and query values. |
| `req.get("x")` | `ctx.request.headers.get("x")`, or a `request.headers` schema |
| `req.ip` | `resolveClientIp(ctx.request, cfg)` or `readRemoteAddress(ctx)` |
| `req.cookies` / `res.cookie` | `readRequestCookie(...)` / `ctx.set.headers.set("set-cookie", serializeCookie(...))` |
| `next(err)` + `(err, req, res, next)` | `throw new NotFoundError(...)` (or another `HttpError`) plus an optional `onError` hook |
| `app.use(mw)` | a hook object: `onRequest`, `preBody` (header-only auth), `beforeHandle`, `afterHandle`, `onError`, `onSend`, `onResponse` |
| `express.Router()` + `app.use("/p", r)` | `app.group("/p", { tags }, (g) => ...)` or an encapsulated plugin via `app.register(plugin, { prefix })` |
| `app.locals` / `res.locals` | `app.decorate(...)` on the root app / `ctx.state` per request |
| `app.listen(port)` | `serve(app, { port })` from the runtime adapter subpath (`@daloyjs/core/node`, `/bun`, `/deno`, `/cloudflare`, `/vercel`, ...) |
| `express.json()`, `body-parser`, `express.urlencoded()` | delete: parsing is built in once a `request.body` schema exists |
| `helmet`, `app.disable("x-powered-by")` | delete: `secureHeaders()` is auto-installed and no `X-Powered-By` is sent |
| `app.set("trust proxy", n)` | `new App({ behindProxy: { cidrs: [...] } })` (or `{ hops: n }`, `"loopback"`, `"none"`) |
| `cors`, `express-rate-limit`, `csurf`, `compression`, `multer` | `cors()`, `rateLimit()`, `csrf()`, `compression()`, built-in multipart |
| `express-session` | `session()` plus `csrf()` (an app with sessions and a state-changing route refuses to boot without CSRF) |
| `passport-jwt` / bearer checks | `bearerAuth({ validate })` with `timingSafeEqual`, or `jwk()` for IdP-issued JWTs; declare `auth` on the route too |
| `passport-local` (password login) | use an identity provider and verify its tokens; do not port password storage |
| regex or unnamed `/*` paths | a `:param` route with a schema (`z.string().regex(...)`), or explicit routes |
| `express.static`, `res.render` | CDN or reverse proxy; DaloyJS is API-first. Gated downloads use `assertSafeRelativePath()` + `contentDisposition()`. |

## Never strip these to make a port "work"

If a request fails after porting, satisfy the guard. Do not remove or
weaken: `requestId()`, `rateLimit()`, `bodyLimitBytes`, `requestTimeoutMs`,
auto `secureHeaders`, the cross-origin write guard, `.strict()` request
schemas, response-body schemas (never `z.any()`), `timingSafeEqual`
comparisons, JWT algorithm allowlists, `fetchGuard()`, and prod-mode error
redaction. Never set `secureDefaults: false`, `corsCrossOriginGuard: false`,
`csrf: "off"`, or `cors({ origin: "*" })` to get a test green.

| Symptom after the port | Correct fix |
| --- | --- |
| `500` on the first request with `X-Forwarded-*` | declare `behindProxy` (or `trustProxy: false` when directly exposed) |
| `403` on a cross-origin `POST` from the frontend | `cors({ origin: "https://app.example.com" })` with the real origin |
| boot error: `session()` without `csrf()` | add `csrf()` |
| boot error: route `auth` declared but not enforced | attach `bearerAuth()` / `jwk()` to the route, group, or app |
| `413` where Express accepted the body | raise `bodyLimitBytes` on that one route only (default is 1 MiB) |
| `422` where Express returned `200` | the schema caught bad input; fix the caller or widen the schema on purpose |

For a service with no browser callers, suggest
`new App({ preset: "internal-service" })` instead of disabling guards one
by one, and say what it relaxes.

## Do not

- Install or import `express`, `helmet`, `body-parser`, `cors` (the npm
  package), or `express-async-errors` in the DaloyJS app.
- Emulate `req`, `res`, or `next` with adapter shims. Port the logic.
- Return a status that is not in the route's `responses`, or hand-build an
  error body; throw a typed error instead.
- Compare secrets with `===` or `!==`.
- Hand-write OpenAPI or client types. Generate them from the routes.

## Done when

- Every inventoried route exists with a unique `operationId`, `request`
  schemas, and every status it returns declared in `responses`.
- The pinned Express behavior passes as `app.request(...)` tests, including
  unhappy paths (401/403/404/422).
- No Express package remains in the slice, and the typecheck, tests, and
  OpenAPI generation pass.
