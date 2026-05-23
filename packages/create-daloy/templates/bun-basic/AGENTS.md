# AGENTS.md

A [DaloyJS](https://daloyjs.dev) REST API for the [Bun](https://bun.sh) runtime. **Contract-first**: routes are defined with Zod schemas and OpenAPI 3.1 is generated from them. When `docs: true` is set in `new App({...})`, three routes are auto-mounted: `GET /openapi.json`, `GET /openapi.yaml`, and `GET /docs` (Scalar UI).

- Package manager / runtime: Bun.

## Commands

- `bun run dev` — hot-reload server on http://localhost:3000
- `bun run typecheck` — `tsc --noEmit`
- `bun test` — Bun's native test runner
- `bun run gen:openapi` — write `generated/openapi.json`
- `bun run gen:client` — write the typed Hey API client
- `bun run build` — produce `dist/`

## Project shape

- `src/build-app.ts` — `buildApp()` factory. Routes, schemas, and middleware live here. **Pure, no side effects.**
- `src/index.ts` — calls `buildApp()` and starts the listener via `@daloyjs/core/bun`. The only file that opens a port.
- `scripts/dump-openapi.ts` — imports `buildApp()` and writes `generated/openapi.json`. Codegen reads from `buildApp()` only — never import `src/index.ts` from scripts.
- `generated/` — machine-written. Do not edit by hand.
- `tests/` — Bun test files.

## Imports

This project uses TypeScript with `"moduleResolution": "Bundler"` and `"allowImportingTsExtensions": true`. Relative imports use the **`.ts` extension** directly, since Bun executes TypeScript natively:

```ts
import { buildApp } from "./build-app.ts";
```

Do not write `.js` here — that's the Node NodeNext convention and will fail to resolve under Bun's setup. Bare-specifier imports from packages (`@daloyjs/core`, `zod`, …) do not need an extension.

## Core rules

1. The route definition is the contract. Method, path, request schemas, and response schemas live in one place — `app.route({...})`.
2. Validate every input with Zod. Use `.strict()` on top-level object schemas to reject unknown keys at the boundary.
3. Preserve literal types in responses: `status: 200 as const`, `z.literal(...)` on discriminator fields. Codegen depends on these.
4. Throw typed errors (`NotFoundError`, `BadRequestError`, etc.) from `@daloyjs/core` — never return raw error responses.
5. Keep `requestId()`, `secureHeaders()`, and `rateLimit()` enabled. They are the project's secure defaults.
6. Every new route ships with a test that covers a happy path and at least one unhappy path.
7. After any route change: `bun run gen:openapi && bun run gen:client && bun run typecheck && bun test`.

## Secure-by-default (do not let an AI strip these)

Per Supabase + Aikido on [secure-by-default development](https://www.aikido.dev/blog/supabase-approach-to-secure-by-default-development): *"If you tell an AI to make something work, it might remove the very security checks that protect you."* When a guard rejects a request, **satisfy it, do not delete it.**

- Keep `secureHeaders()`, `requestId()`, `rateLimit()` registered, and `bodyLimitBytes` / `requestTimeoutMs` set on `new App({...})`. Tighten per-route; never raise globally to pass a test.
- Keep Zod `.strict()` on top-level request objects; do not switch to `.passthrough()`. Keep `responses[N].body` schemas tight; never widen to `z.any()` to let a privileged field escape.
- Every protected route attaches an auth `beforeHandle` and ships an unhappy-path test proving an unauthenticated request returns `401` (and wrong scope returns `403`) — the HTTP-boundary equivalent of Supabase's pgTAP policy tests.
- JWT verifiers keep an explicit `algorithms` allowlist; never trust the token's `alg` header, never allow `none`, always check `exp` / `nbf`.
- Credential / HMAC comparisons use `timingSafeEqual`, never `===`. Throw typed errors from `@daloyjs/core` so problem+json redacts in prod; never return raw stack traces.
- `.env`, secrets, and private keys never get committed — the template `_gitignore` is the source of truth.
- Do not bypass safety checks (`--no-verify`, `bun install --trust`) without recording the reason in the PR.

## Process expectations

- Quality gates must pass before declaring work done: `bun run typecheck` and `bun test`.
- Regenerate the OpenAPI spec and typed client whenever route shapes change.
- Bug fixes include a regression test.
- Never bypass safety checks without a clear reason.

For the full workflow — adding routes step-by-step, schema conventions, testing patterns, security guidance, and deployment notes — read [.agents/skills/daloyjs-best-practices/SKILL.md](.agents/skills/daloyjs-best-practices/SKILL.md).
