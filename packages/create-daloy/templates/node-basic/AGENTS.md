# AGENTS.md

A [DaloyJS](https://daloyjs.dev) Node.js REST API. **Contract-first**:
routes are defined with Zod schemas and OpenAPI 3.1 is generated from them.
When `docs: true` is set in `new App({...})`, three routes are auto-mounted:
`GET /openapi.json`, `GET /openapi.yaml`, and `GET /docs` (Scalar UI).

- Package manager: pnpm (use `pnpm` unless the project's `package.json` was rewritten for npm/yarn/bun).
- Runtime: Node.js >= 24.0.0 (active LTS).

## Commands

- `pnpm dev` — watch-mode dev server on http://localhost:3000
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm test` — Node built-in test runner
- `pnpm gen` — regenerate `generated/openapi.json` and the typed Hey API client
- `pnpm build` — emit `dist/`
- `pnpm audit` — supply-chain audit (respects the hardened `.npmrc`)

## Project shape

- `src/build-app.ts` — `buildApp()` factory. Routes, schemas, and middleware live here. **Pure, no side effects.**
- `src/index.ts` — calls `buildApp()` and starts the listener via `@daloyjs/core/node`. The only file that opens a port.
- `scripts/dump-openapi.ts` — imports `buildApp()` and writes `generated/openapi.json`. Codegen reads from `buildApp()` only — never import `src/index.ts` from scripts.
- `generated/` — machine-written by `pnpm gen`. Do not edit by hand.
- `tests/` — `*.test.ts` files run with `node --test` (via `tsx`).

## Imports

This project uses TypeScript with `"module": "NodeNext"` (ESM). Relative imports **must include a `.js` extension**, even when the source file is `.ts`:

```ts
import { buildApp } from "./build-app.js"; // resolves to build-app.ts at typecheck, build-app.js at runtime
```

This is the official Node.js ESM convention — TypeScript rewrites the specifier during typecheck, and the compiled output really is `.js`. Bare-specifier imports from packages (`@daloyjs/core`, `zod`, …) do not need an extension.

## Core rules

1. The route definition is the contract. Method, path, request schemas, and response schemas live in one place — `app.route({...})`.
2. Validate every input with Zod. Use `.strict()` on top-level object schemas to reject unknown keys at the boundary.
3. Preserve literal types in responses: `status: 200 as const`, `z.literal(...)` on discriminator fields. Codegen depends on these.
4. Throw typed errors (`NotFoundError`, `BadRequestError`, etc.) from `@daloyjs/core` — never return raw error responses.
5. Keep `requestId()`, `secureHeaders()`, and `rateLimit()` enabled. They are the project's secure defaults.
6. Every new route ships with a test that covers a happy path and at least one unhappy path.
7. After any route change: `pnpm gen && pnpm typecheck && pnpm test`.

## Secure-by-default (do not let an AI strip these)

Per Supabase + Aikido on [secure-by-default development](https://www.aikido.dev/blog/supabase-approach-to-secure-by-default-development): *"If you tell an AI to make something work, it might remove the very security checks that protect you."* When a guard rejects a request, **satisfy it, do not delete it.**

- Keep `secureHeaders()`, `requestId()`, `rateLimit()` registered, and `bodyLimitBytes` / `requestTimeoutMs` set on `new App({...})`. Tighten per-route; never raise globally to pass a test.
- Keep Zod `.strict()` on top-level request objects; do not switch to `.passthrough()`. Keep `responses[N].body` schemas tight; never widen to `z.any()` to let a privileged field escape.
- Every protected route attaches an auth `beforeHandle` and ships an unhappy-path test proving an unauthenticated request returns `401` (and wrong scope returns `403`) — the HTTP-boundary equivalent of Supabase's pgTAP policy tests.
- JWT verifiers keep an explicit `algorithms` allowlist; never trust the token's `alg` header, never allow `none`, always check `exp` / `nbf`.
- Credential / HMAC comparisons use `timingSafeEqual`, never `===`. Throw typed errors from `@daloyjs/core` so problem+json redacts in prod; never return raw stack traces.
- `.env`, secrets, and private keys never get committed — the template `_gitignore` is the source of truth.
- Do not bypass safety checks (`--no-verify`, `--ignore-scripts=false`, lowering the 24h `minimum-release-age` in `.npmrc`) without recording the reason in the PR.

## Process expectations

- Quality gates must pass before declaring work done: `pnpm typecheck` and `pnpm test`.
- Update the OpenAPI spec and typed client whenever route shapes change (`pnpm gen`).
- Bug fixes include a regression test.
- Never bypass safety checks (`--no-verify`, `--ignore-scripts=false`) without a clear reason.

For the full workflow — adding routes step-by-step, schema conventions, testing patterns, security guidance, and deployment notes — read [.agents/skills/daloyjs-best-practices/SKILL.md](.agents/skills/daloyjs-best-practices/SKILL.md).
