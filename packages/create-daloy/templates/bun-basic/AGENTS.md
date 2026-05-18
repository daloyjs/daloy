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

## Core rules

1. The route definition is the contract. Method, path, request schemas, and response schemas live in one place — `app.route({...})`.
2. Validate every input with Zod. Use `.strict()` on top-level object schemas to reject unknown keys at the boundary.
3. Preserve literal types in responses: `status: 200 as const`, `z.literal(...)` on discriminator fields. Codegen depends on these.
4. Throw typed errors (`NotFoundError`, `BadRequestError`, etc.) from `@daloyjs/core` — never return raw error responses.
5. Keep `requestId()`, `secureHeaders()`, and `rateLimit()` enabled. They are the project's secure defaults.
6. Every new route ships with a test that covers a happy path and at least one unhappy path.
7. After any route change: `bun run gen:openapi && bun run gen:client && bun run typecheck && bun test`.

## Process expectations

- Quality gates must pass before declaring work done: `bun run typecheck` and `bun test`.
- Regenerate the OpenAPI spec and typed client whenever route shapes change.
- Bug fixes include a regression test.
- Never bypass safety checks without a clear reason.

For the full workflow — adding routes step-by-step, schema conventions, testing patterns, security guidance, and deployment notes — read [.agents/skills/daloyjs-best-practices/SKILL.md](.agents/skills/daloyjs-best-practices/SKILL.md).
