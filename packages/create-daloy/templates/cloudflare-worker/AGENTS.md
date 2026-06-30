# AGENTS.md

A [DaloyJS](https://daloyjs.dev) REST API deployed to **Cloudflare Workers**. **Contract-first**: routes are defined with validation schemas (Zod in this template; DaloyJS also supports Standard Schema-compatible validators) and OpenAPI 3.1 is generated from them. `docs: true` is set in `new App({...})`, so `GET /openapi.json`, `GET /openapi.yaml`, and `GET /docs` (Scalar UI) are auto-mounted. DaloyJS is dependency-free and the Scalar UI loads from a CDN, so this adds negligible Worker bundle size; drop `docs` (and the `openapi` block) if you want the smallest possible bundle.

- Package manager: pnpm (use `pnpm` unless the project's `package.json` was rewritten for npm/yarn/bun).
- Runtime: Cloudflare Workers (Web Standard `Request`/`Response`).

## Agent guidance

- Treat this file as the short, durable project contract for AI coding agents.
- Use `.agents/skills/daloyjs-best-practices/SKILL.md` for the detailed DaloyJS workflow; keep this file concise and do not duplicate that skill.
- If instructions conflict, follow the user's latest prompt first, then the nearest `AGENTS.md`, then the skill.
- Change route definitions, schemas, metadata, and tests first; regenerate generated files instead of hand-editing OpenAPI output.

## Commands

- `pnpm dev` — `wrangler dev` on http://localhost:8787
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm test` — run test suite
- `pnpm contract` — run `daloy inspect --check src/index.ts`
- `pnpm hooks:install` — enable the optional pre-push contract gate
- `pnpm deploy` — `wrangler deploy`
- `pnpm audit` — supply-chain audit

## Project shape

- `src/index.ts` — Worker entrypoint. Builds the `App`, registers routes/middleware, and exports `default toFetchHandler(app)` from `@daloyjs/core/cloudflare`. Do NOT wrap the result in another `{ fetch }` object — `toFetchHandler` already returns the shape Workers expect.
- `wrangler.toml` — Worker configuration (name, compatibility date, bindings, routes).
- `tests/` — test files.

## Core rules

1. The route definition is the contract. Method, path, request schemas, and response schemas live in one place — `app.route({...})`.
2. Validate every input with Zod or another Standard Schema-compatible validator. For Zod object schemas, use `.strict()` to reject unknown keys at the boundary.
3. Preserve literal types in responses: `status: 200 as const`, `z.literal(...)` on discriminator fields.
4. Throw typed errors (`NotFoundError`, `BadRequestError`, etc.) from `@daloyjs/core`.
5. Keep `requestId()`, `secureHeaders()`, and `rateLimit()` enabled. For high-traffic routes, attach Cloudflare's native rate-limit binding (the in-memory limiter resets per isolate).
6. Stay on the Workers runtime: only Web Standards APIs + Cloudflare bindings. No `node:` modules unless you explicitly add `nodejs_compat` and require it.
7. Bindings flow through `env`. Read KV/D1/R2/secrets from the `env` argument; never read them via globals.
8. Long-running work belongs in `ctx.waitUntil(...)`, not blocking the response.
9. Keep operation IDs stable and examples schema-valid; `pnpm contract` must pass after route, metadata, or OpenAPI-facing changes.
10. Every new route ships with a test that covers a happy path and at least one unhappy path.

## Secure-by-default (do not let an AI strip these)

Per Supabase + Aikido on [secure-by-default development](https://www.aikido.dev/blog/supabase-approach-to-secure-by-default-development): _"If you tell an AI to make something work, it might remove the very security checks that protect you."_ When a guard rejects a request, **satisfy it, do not delete it.**

- Keep `secureHeaders()`, `requestId()`, `rateLimit()` registered, and `bodyLimitBytes` / `requestTimeoutMs` set on `new App({...})`. For production, add Cloudflare's native rate-limit binding **in addition to** the in-memory limiter, not instead of it.
- Read secrets and bindings (KV, D1, R2) from the `env` argument; never hard-code, never log them.
- Keep Zod `.strict()` on top-level request objects; do not switch to `.passthrough()`. For other validators, use the strict / no-extra-keys equivalent. Keep `responses[N].body` schemas tight; never widen to `z.any()` to let a privileged field escape.
- Every protected route attaches an auth `beforeHandle` and ships an unhappy-path test proving an unauthenticated request returns `401` (and wrong scope returns `403`) — the HTTP-boundary equivalent of Supabase's pgTAP policy tests.
- JWT verifiers keep an explicit `algorithms` allowlist; never trust the token's `alg` header, never allow `none`, always check `exp` / `nbf`.
- Credential / HMAC comparisons use constant-time verification, never `===`. Prefer Web Crypto verification APIs or the framework timing-safe helper where available. Throw typed errors from `@daloyjs/core` so problem+json redacts in prod; never return raw stack traces.
- Keep `compatibility_date` pinned; do not enable `nodejs_compat` unless a feature requires it.
- `.env`, `.dev.vars`, secrets, private keys: never commit. Use `wrangler secret put` for production secrets.

## Process expectations

- Quality gates must pass before declaring work done: `pnpm typecheck` and `pnpm test`.
- Run the contract gate (`pnpm contract`) whenever route shapes, examples, operation IDs, or OpenAPI metadata change.
- Bug fixes include a regression test.
- Pin `compatibility_date` in `wrangler.toml`; only bump it deliberately.
- For deploys, ensure the user has run `wrangler login`; do not authenticate on their behalf.
- Never bypass safety checks without a clear reason.

For the full workflow — adding routes step-by-step, bindings, testing patterns, security guidance, and deployment notes — read [.agents/skills/daloyjs-best-practices/SKILL.md](.agents/skills/daloyjs-best-practices/SKILL.md).
