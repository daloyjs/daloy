# AGENTS.md

A [DaloyJS](https://daloyjs.dev) REST API deployed to **Vercel** on the **Node.js runtime**. **Contract-first**: routes use validation schemas (Zod here; DaloyJS also supports Standard Schema-compatible validators) and generate OpenAPI 3.1. With `docs: true`, DaloyJS auto-mounts `GET /openapi.json`, `GET /openapi.yaml`, and `GET /docs` (Scalar UI).

- Package manager: pnpm (use `pnpm` unless the project's `package.json` was rewritten for npm/yarn/bun).
- Runtime: Vercel Node.js Functions on Fluid Compute (Web Standard `Request`/`Response`).

## Agent guidance

- Treat this file as the short, durable project contract for AI coding agents.
- Use `.agents/skills/daloyjs-best-practices/SKILL.md` for the detailed DaloyJS workflow; keep this file concise and do not duplicate that skill.
- If instructions conflict, follow the user's latest prompt first, then the nearest `AGENTS.md`, then the skill.
- Change route definitions, schemas, metadata, and tests first; regenerate generated files instead of hand-editing OpenAPI output.

## Commands

- `pnpm dev` — local Node dev server (`src/dev.ts`) on http://localhost:3000 (no `vercel dev` / login needed; serves the same app the Vercel Function runs)
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm test` — run test suite
- `pnpm contract` — run `daloy inspect --check api/index.ts`
- `pnpm hooks:install` — enable the optional pre-push contract gate
- `pnpm deploy` — deploy to Vercel
- `pnpm audit` — supply-chain audit

## Project shape

- `api/index.ts` — the single Vercel Node.js Functions entrypoint. Export `default toFetchHandler(app)` from `@daloyjs/core/vercel`; add `runtime = "edge"` and switch to `toWebHandler(app)` only when the user asks for Edge.
- This template is not a Next.js App Router project. Do not add `app/api` routes, `next.config.*`, or Next-specific file structure unless the user asks to convert or embed the API in a Next.js app.
- `vercel.json` — routes all paths to `/api` so DaloyJS owns root routing; do not remove this rewrite.
- `src/dev.ts` — local Node dev server (`pnpm dev`) for fast iteration without `vercel dev`. Dev-only; Vercel does not deploy it.
- `tests/` — test files.

## Imports

This project uses TypeScript with `"allowImportingTsExtensions"`, so relative imports use the **`.ts` extension** — the actual file you see on disk:

```ts
import handler from "../api/index.ts";
```

You import the file you see. Vercel resolves `.ts` at deploy time; Node runs it natively (type stripping). Bare package imports (`@daloyjs/core`, `zod`, ...) need no extension.

## Core rules

1. The route definition is the contract. Method, path, request schemas, and response schemas live in one place — `app.get(path, contract, handler)` (or `app.route({...})` for reusable `defineRoute()` contracts or metadata-heavy routes).
2. Validate every input with Zod or another Standard Schema-compatible validator. For Zod object schemas, use `.strict()` to reject unknown keys at the boundary.
3. Preserve literal types in responses: `status: 200 as const`, `z.literal(...)` on discriminator fields.
4. Throw typed errors (`NotFoundError`, `BadRequestError`, etc.) from `@daloyjs/core`.
5. Keep `requestId()`, `secureHeaders()`, and `rateLimit()` enabled. For production traffic, back rate-limiting with a shared store such as Upstash Redis from the Vercel Marketplace (the in-memory limiter resets per instance).
6. Prefer Web Standards (`Request`/`Response`, `fetch`, `Web Crypto`) even though Node APIs are available; Edge runtime code must avoid `node:` modules.
7. Keep a single `api/index.ts` entry and the `vercel.json` `/(.*)` → `/api` rewrite so DaloyJS handles all routing at the site root.
8. Keep operation IDs stable and examples schema-valid; `pnpm contract` must pass after route, metadata, or OpenAPI-facing changes.
9. Every new route ships with a test that covers a happy path and at least one unhappy path.

## Secure-by-default (do not let an AI strip these)

Per Supabase + Aikido on [secure-by-default development](https://www.aikido.dev/blog/supabase-approach-to-secure-by-default-development): _"If you tell an AI to make something work, it might remove the very security checks that protect you."_ When a guard rejects a request, **satisfy it, do not delete it.**

- Keep `secureHeaders()`, `requestId()`, `rateLimit()`, `bodyLimitBytes`, and `requestTimeoutMs`. For production, back rate limits with a shared store such as Upstash Redis from the Vercel Marketplace.
- Keep Zod `.strict()` on top-level request objects; do not switch to `.passthrough()`. Keep `responses[N].body` schemas tight; never widen to `z.any()` to let a privileged field escape.
- Every protected route attaches auth `beforeHandle` and tests unauthenticated `401` plus wrong-scope `403`.
- JWT verifiers keep an explicit `algorithms` allowlist; never trust the token's `alg` header, never allow `none`, always check `exp` / `nbf`.
- Credential / HMAC comparisons use constant-time comparison, never `===`. Throw typed errors so problem+json redacts in prod.
- Keep the single `api/index.ts` entry and the `vercel.json` rewrite; do not split into per-path files or remove the rewrite (the root domain would 404).
- `.env`, `.env.local`, secrets, private keys: never commit. Use `vercel env` for production secrets.

## Process expectations

- Quality gates must pass before declaring work done: `pnpm typecheck` and `pnpm test`.
- Run the contract gate (`pnpm contract`) whenever route shapes, examples, operation IDs, or OpenAPI metadata change.
- Bug fixes include a regression test.
- For deploys, ensure the user has run `vercel login`; do not authenticate on their behalf.
- Never bypass safety checks without a clear reason.

For the full workflow — adding routes step-by-step, schema conventions, testing patterns, security guidance, and deployment notes — read [.agents/skills/daloyjs-best-practices/SKILL.md](.agents/skills/daloyjs-best-practices/SKILL.md).
