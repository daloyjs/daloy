# AGENTS.md

A [DaloyJS](https://daloyjs.dev) REST API for the [Deno](https://deno.com) runtime. **Contract-first**: routes are defined with Zod schemas and OpenAPI 3.1 is generated from them. When `docs: true` is set in `new App({...})`, three routes are auto-mounted: `GET /openapi.json`, `GET /openapi.yaml`, and `GET /docs` (Scalar UI).

- Runtime: Deno (no Node package manager). Dependencies are loaded via `npm:` and `jsr:` specifiers in `deno.json`.

## Commands

- `deno task dev` — watch-mode server on http://localhost:3000
- `deno task typecheck`
- `deno task test`
- `deno task gen:openapi` — write `generated/openapi.json`

The typed Hey API SDK is generated outside Deno (Hey API has no Deno entrypoint yet). Run `npx @hey-api/openapi-ts -i generated/openapi.json -o generated/client` if you need the client.

## Project shape

- `src/build-app.ts` — `buildApp()` factory. Routes, schemas, and middleware live here. **Pure, no side effects.**
- `src/main.ts` — calls `buildApp()` and starts the listener via `@daloyjs/core/deno`. The only file that opens a port.
- `scripts/dump-openapi.ts` — imports `buildApp()` and writes `generated/openapi.json`. Codegen reads from `buildApp()` only — never import `src/main.ts` from scripts.
- `deno.json` — tasks, import map, and `npm:` specifiers. There is no `package.json` in this project.
- `generated/` — machine-written. Do not edit by hand.
- `tests/` — Deno test files.

## Core rules

1. The route definition is the contract. Method, path, request schemas, and response schemas live in one place — `app.route({...})`.
2. Validate every input with Zod. Use `.strict()` on top-level object schemas to reject unknown keys at the boundary.
3. Preserve literal types in responses: `status: 200 as const`, `z.literal(...)` on discriminator fields.
4. Throw typed errors (`NotFoundError`, `BadRequestError`, etc.) from `@daloyjs/core`.
5. Keep `requestId()`, `secureHeaders()`, and `rateLimit()` enabled.
6. Deno permissions are part of the contract — keep `--allow-net --allow-env --allow-read` narrow; never use `--allow-all`.
7. Every new route ships with a test that covers a happy path and at least one unhappy path.
8. After any route change: `deno task gen:openapi && deno task typecheck && deno task test`.

## Secure-by-default (do not let an AI strip these)

Per Supabase + Aikido on [secure-by-default development](https://www.aikido.dev/blog/supabase-approach-to-secure-by-default-development): *"If you tell an AI to make something work, it might remove the very security checks that protect you."* When a guard rejects a request, **satisfy it, do not delete it.**

- Keep `secureHeaders()`, `requestId()`, `rateLimit()` registered, and `bodyLimitBytes` / `requestTimeoutMs` set on `new App({...})`. Tighten per-route; never raise globally to pass a test.
- Keep Deno permissions narrow. Never add `--allow-all`; never broaden `--allow-net` / `--allow-read` / `--allow-env` to silence a prompt — add the specific host / path / var.
- Keep Zod `.strict()` on top-level request objects; do not switch to `.passthrough()`. Keep `responses[N].body` schemas tight; never widen to `z.any()` to let a privileged field escape.
- Every protected route attaches an auth `beforeHandle` and ships an unhappy-path test proving an unauthenticated request returns `401` (and wrong scope returns `403`) — the HTTP-boundary equivalent of Supabase's pgTAP policy tests.
- JWT verifiers keep an explicit `algorithms` allowlist; never trust the token's `alg` header, never allow `none`, always check `exp` / `nbf`.
- Credential / HMAC comparisons use a constant-time comparison, never `===`. Throw typed errors from `@daloyjs/core` so problem+json redacts in prod; never return raw stack traces.
- `.env`, secrets, and private keys never get committed — the template `_gitignore` is the source of truth.

## Process expectations

- Quality gates must pass before declaring work done: `deno task typecheck` and `deno task test`.
- Regenerate the OpenAPI spec whenever route shapes change.
- Bug fixes include a regression test.
- Use `deno task ...`, not `npm`/`pnpm`. There is no `package.json` here.

For the full workflow — adding routes step-by-step, schema conventions, testing patterns, security guidance, and deployment notes — read [.agents/skills/daloyjs-best-practices/SKILL.md](.agents/skills/daloyjs-best-practices/SKILL.md).
