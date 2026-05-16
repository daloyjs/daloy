# AGENTS.md

A [DaloyJS](https://daloyjs.dev) REST API deployed to **Cloudflare Workers**. **Contract-first**: routes are defined with Zod schemas and OpenAPI 3.1 is generated from them.

- Package manager: pnpm (use `pnpm` unless the project's `package.json` was rewritten for npm/yarn/bun).
- Runtime: Cloudflare Workers (Web Standard `Request`/`Response`).

## Commands

- `pnpm dev` — `wrangler dev` on http://localhost:8787
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm test` — run test suite
- `pnpm deploy` — `wrangler deploy`
- `pnpm audit` — supply-chain audit

## Project shape

- `src/index.ts` — Worker entrypoint. Builds the `App`, registers routes/middleware, and exports `default { fetch: toFetchHandler(app) }` from `@daloyjs/core/cloudflare`.
- `wrangler.toml` — Worker configuration (name, compatibility date, bindings, routes).
- `tests/` — test files.

## Core rules

1. The route definition is the contract. Method, path, request schemas, and response schemas live in one place — `app.route({...})`.
2. Validate every input with Zod. Use `.strict()` on top-level object schemas to reject unknown keys at the boundary.
3. Preserve literal types in responses: `status: 200 as const`, `z.literal(...)` on discriminator fields.
4. Throw typed errors (`NotFoundError`, `BadRequestError`, etc.) from `@daloyjs/core`.
5. Keep `requestId()`, `secureHeaders()`, and `rateLimit()` enabled. For high-traffic routes, attach Cloudflare's native rate-limit binding (the in-memory limiter resets per isolate).
6. Stay on the Workers runtime: only Web Standards APIs + Cloudflare bindings. No `node:` modules unless `nodejs_compat` is enabled and required.
7. Bindings flow through `env`. Read KV/D1/R2/secrets from the `env` argument; never read them via globals.
8. Long-running work belongs in `ctx.waitUntil(...)`, not blocking the response.
9. Every new route ships with a test that covers a happy path and at least one unhappy path.

## Process expectations

- Quality gates must pass before declaring work done: `pnpm typecheck` and `pnpm test`.
- Bug fixes include a regression test.
- Pin `compatibility_date` in `wrangler.toml`; only bump it deliberately.
- For deploys, ensure the user has run `wrangler login`; do not authenticate on their behalf.
- Never bypass safety checks without a clear reason.

For the full workflow — adding routes step-by-step, bindings, testing patterns, security guidance, and deployment notes — read [.agents/skills/daloyjs-best-practices/SKILL.md](.agents/skills/daloyjs-best-practices/SKILL.md).
