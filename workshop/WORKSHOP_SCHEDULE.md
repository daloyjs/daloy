# DaloyJS — Senior Backend Workshops

> Two self-paced tracks for senior Node/TypeScript developers. The 8-hour workshop is the full curriculum. The 4-hour workshop is the compressed, highest-signal version.

## Quality Bar

Both tracks are designed around production judgment:

- Where should the request schema live, and what does `app.route({...})` give you for free once it's there?
- When do you let the framework reject a request (body limit, content-type, validation, secureHeaders, rateLimit) versus reject it in the handler?
- How do you keep the OpenAPI spec, the typed client, and the runtime behavior all in sync from one definition?
- How do you build a feature so it works identically on Node, Bun, Deno, and Cloudflare Workers?
- How do you reason about supply-chain risk in a backend stack, and what defaults already protect you?

Tutorial note: the workshop exercises intentionally avoid file-based routing or magic auto-discovery so attendees see the explicit `app.route(...)` contract first. The `examples/` and `website/` apps in the parent repo still use larger composition patterns because those remain the preferred production patterns at scale.

## 4-Hour Workshop

The 4-hour track lives under [`src/challenges/4-hour/`](./src/challenges/4-hour). It keeps only the activities that give senior attendees the biggest practical return on day one.

| Step | Activity                                | Focus                                                                         |
| ---- | --------------------------------------- | ----------------------------------------------------------------------------- |
| 0    | Setup & Hello World                     | `new App()`, `serve()`, `docs: true`, `/openapi.json`, Scalar at `/docs`      |
| 1    | Contract-First Route                    | `app.route({ request, responses, handler })`, Zod params, response body schema |
| 2    | Validation + RFC 9457 Errors            | `.strict()` schemas, `throw new NotFoundError`, problem+json shape            |
| 3    | Security Middleware Stack               | `requestId`, `secureHeaders`, `cors`, `rateLimit`, body limit, request timeout |
| 4    | Bearer Auth on a Route                  | `auth: { scheme: 'bearer' }`, `bearerAuth({ validate })`, security schemes    |
| 5    | OpenAPI + Typed Client Codegen          | `pnpm gen:openapi`, `@hey-api/openapi-ts`, in-process `createClient(app)`     |
| 6    | Runtime Portability                     | Swap `@daloyjs/core/node` for the Bun/Deno/Workers adapter, same `App`        |
| 7    | Testing & Introspection                 | `app.introspect()`, contract tests, problem+json regression test              |
| C2   | **Bug Challenge:** Security Regression  | Diagnose disabled secureHeaders, missing `.strict()`, JWT alg confusion        |
| HW   | Compressed Capstone                     | Apply the highest-impact patterns to one production slice                     |

## 8-Hour Workshop

The 8-hour track lives under [`src/challenges/8-hour/`](./src/challenges/8-hour). It keeps the full curriculum and adds more practice around JWT/JWK, sessions, WebSocket upgrades, CSRF/CORS edge cases, SSRF fetch-guarding, observability, and a full CRUD feature challenge.

### Part 1 · Contract-First Routing

| #   | Title                              | Focus                                                                       |
| --- | ---------------------------------- | --------------------------------------------------------------------------- |
| 0   | Workshop Setup                     | Verify `@daloyjs/core` install, `/docs`, `/openapi.json`, `app.introspect()` |
| 1   | Contract-First Route               | Zod request/response, `operationId`, `tags`, OpenAPI examples               |
| 2   | Path Params, Query, Body, Headers  | Each slot validated separately, why `.strict()` is the convention           |
| 3   | RFC 9457 Errors & Redaction        | `NotFoundError`, `ValidationError`, prod-mode detail redaction              |

### Part 2 · Plugins, Auth, and OpenAPI

| #   | Title                                  | Focus                                                                       |
| --- | -------------------------------------- | --------------------------------------------------------------------------- |
| 4   | Middleware Plugins & Encapsulation     | `app.use(...)`, plugin scopes, request ids, structured logger               |
| 5   | Bearer Auth + per-Route Auth           | `bearerAuth({ validate })`, route-level `auth`, 401 vs 403                  |
| 6   | JWT with Algorithm Allowlist + JWK     | `createJwtSigner`, `createJwtVerifier`, `none`/alg-confusion defense, JWKs |
| 7   | OpenAPI Auto-Docs & Tuning             | `securitySchemes`, response examples, branded `/docs`, `/openapi.yaml`      |
| 8   | Typed Client Codegen with Hey API      | `pnpm gen`, generated SDK, in-process client for tests                      |

### Part 3 · Production Hardening + Challenges

| #   | Title                              | Focus                                                                       |
| --- | ---------------------------------- | --------------------------------------------------------------------------- |
| 9   | Secure Headers, CSP, CORS, CSRF    | Helmet-grade defaults, CSP nonces, CSRF double-submit                       |
| 10  | Rate Limits, Body Limits, Timeouts | `rateLimit`, `bodyLimitBytes`, `requestTimeoutMs`, 429 vs 408 vs 413        |
| 11  | SSRF, Sessions, WebSocket          | `fetchGuard`, signed-cookie sessions, WebSocket upgrade auth                |
| C1  | **Feature Challenge:** Authors CRUD | Full CRUD slice with validation, errors, OpenAPI examples, typed client    |
| C2  | **Bug Challenge:** Security Regression | Diagnose a weakened guardrail (alg confusion, leaked headers, open CORS) |
| HW  | Capstone Homework                  | Production-ready Books/Admin API using every pattern from the track         |

## Why DaloyJS Is the Pitch

| Concern                             | Express / Fastify              | Hono                  | FastAPI (Python)     | DaloyJS                       |
| ----------------------------------- | ------------------------------ | --------------------- | -------------------- | ----------------------------- |
| Single source of truth for contract | Multiple plugins, drift-prone  | Plugin afterthought   | Yes                  | Yes — one `app.route({...})`  |
| Runtime portability                 | Node / Bun only                | Yes                   | Python only          | Node, Bun, Deno, Vercel, CF   |
| Auto OpenAPI 3.1                    | Manual or plugin               | Plugin                | Yes                  | First-class, one line         |
| Typed client codegen                | Separate, you wire it          | Optional              | Separate             | `pnpm gen` (Hey API)          |
| Validator                           | Pick one, glue it              | Pick one              | Pydantic-only        | Standard Schema (Zod/Valibot) |
| Errors                              | Ad-hoc                         | Ad-hoc                | Custom               | RFC 9457 problem+json         |
| Security defaults                   | BYO helmet                     | BYO                   | BYO                  | Helmet-grade + body/timeout   |
| Supply-chain posture                | `npm install` runs scripts     | Same                  | Same                 | `ignore-scripts`, 24h cooldown |

## How to Use

1. `pnpm install` - installs the same `@daloyjs/core@^1.0.0-rc.1` range used by `create-daloy@1.0.0-rc.1` templates.
2. `pnpm dev:4:0` — run 4-hour exercise 0.
3. Open `http://localhost:3000/docs` (Scalar UI).
4. Edit `src/challenges/4-hour/exercise-0.ts`. Hot reload reflects your changes immediately.
5. Compare against `src/challenges/4-hour/solutions/exercise-0-end.ts` when stuck.
6. Move on to exercise 1, 2, … in order.

To compare the tutorials against a fresh scaffold, run `pnpm create daloy@latest my-api --template node-basic --yes` from a scratch directory.

Every exercise links back to the matching topic on <https://daloyjs.dev/docs> for deeper reading.
