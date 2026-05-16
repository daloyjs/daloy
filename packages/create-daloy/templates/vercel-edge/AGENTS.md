# AGENTS.md

A [DaloyJS](https://daloyjs.dev) REST API deployed to **Vercel Edge**. **Contract-first**: routes are defined with Zod schemas and OpenAPI 3.1 is generated from them.

- Package manager: pnpm (use `pnpm` unless the project's `package.json` was rewritten for npm/yarn/bun).
- Runtime: Vercel Edge (Web Standard `Request`/`Response`).

## Commands

- `pnpm dev` — local Vercel dev server on http://localhost:3000
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm test` — run test suite
- `pnpm deploy` — deploy to Vercel
- `pnpm audit` — supply-chain audit

## Project shape

- `api/[...path].ts` — Edge entrypoint. Builds the `App`, registers routes/middleware, and exports `default toEdgeHandler(app)` plus `export const config = { runtime: "edge" }`. **Keep it a catch-all** so DaloyJS owns routing.
- `vercel.json` — Vercel build/runtime configuration.
- `tests/` — test files.

## Core rules

1. The route definition is the contract. Method, path, request schemas, and response schemas live in one place — `app.route({...})`.
2. Validate every input with Zod. Use `.strict()` on top-level object schemas to reject unknown keys at the boundary.
3. Preserve literal types in responses: `status: 200 as const`, `z.literal(...)` on discriminator fields.
4. Throw typed errors (`NotFoundError`, `BadRequestError`, etc.) from `@daloyjs/core`.
5. Keep `requestId()`, `secureHeaders()`, and `rateLimit()` enabled. For production traffic, back rate-limiting with Vercel KV or another shared store (the in-memory limiter resets per instance).
6. Stay on the Edge runtime: only Web Standards APIs. No `node:` modules, no `fs`, no `Buffer`. If a feature requires Node, switch to a Node-runtime template.
7. The catch-all `api/[...path].ts` must remain a catch-all so DaloyJS handles routing.
8. Every new route ships with a test that covers a happy path and at least one unhappy path.

## Process expectations

- Quality gates must pass before declaring work done: `pnpm typecheck` and `pnpm test`.
- Bug fixes include a regression test.
- For deploys, ensure the user has run `vercel login`; do not authenticate on their behalf.
- Never bypass safety checks without a clear reason.

For the full workflow — adding routes step-by-step, schema conventions, testing patterns, security guidance, and deployment notes — read [.agents/skills/daloyjs-best-practices/SKILL.md](.agents/skills/daloyjs-best-practices/SKILL.md).
