# DaloyJS — Self-Paced Workshop

A self-guided, hands-on workshop for **senior TypeScript/Node developers** who already know HTTP, async/await, basic Express/Fastify/Hono concepts, and want to learn **production-grade contract-first API development** with [DaloyJS](https://daloyjs.dev).

Clone the repo and everything is here: starter exercises, ordered coding steps, reference solutions, and instructions.

This workshop tracks the current published release train: `create-daloy@0.36.0` scaffolds templates with `@daloyjs/core@^0.36.0`, and this workshop uses that same npm range so the exercises match the latest generated projects.

## Quick Start

```bash
git clone <this-repo>
cd workshop
pnpm install
pnpm dev:4:0     # run exercise 0 (4-hour track) — http://localhost:3000/docs
```

Want a fresh generated app beside the workshop for comparison? Use the same scaffolder release channel as the tutorials:

```bash
pnpm create daloy@latest my-api --template node-basic --yes
```

Each exercise is a **self-contained TypeScript file** that boots its own DaloyJS app on `http://localhost:3000`. You run, edit, hit save, and `tsx --watch` hot-reloads.

## Who This Is For

Senior Node/TypeScript developers who have shipped an API at least once and want to learn:

- **Contract-first** routing where a single `app.route({...})` is the source of truth for validation, types, OpenAPI, the typed client, and tests.
- **Standard Schema** validation (Zod 4 / Valibot / ArkType / TypeBox) instead of hand-written DTO classes.
- **Auto-generated OpenAPI 3.1 + Scalar docs** with zero plugins, plus a fully typed fetch SDK via [@hey-api/openapi-ts](https://heyapi.dev/openapi-ts/get-started).
- **Secure-by-default** posture: body limits, request timeouts, header sanitization, RFC 9457 problem+json, JWT allowlists, `fetchGuard()` SSRF defaults, prototype-pollution-safe parsers.
- **Runtime portability** — the same app on Node, Bun, Deno, Vercel, and Cloudflare Workers.
- **Supply-chain hygiene** — `ignore-scripts`, 24h release-age cooldown, zero runtime deps in `@daloyjs/core`, source-verified lockfiles.

This is intentionally not a beginner Node course. The exercises move quickly from "hello world" into validation, errors, middleware composition, OpenAPI codegen, JWT, sessions, WebSocket upgrades, and security hardening.

## What You'll Build

Two versions of the same senior-level curriculum:

| Track  | Use When                              | Skills Unlocked                                                                                                |
| ------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 4-hour | You need the compressed essentials    | Contract-first routes, validation, errors, security middleware, auth, codegen, runtime portability, testing    |
| 8-hour | You want the full hands-on experience | Everything in 4-hour plus JWT/JWK, sessions, WebSocket, CSRF/CORS, fetchGuard SSRF, OpenAPI tuning, observability |

See [WORKSHOP_SCHEDULE.md](./WORKSHOP_SCHEDULE.md) for the full breakdown.

## How the Workshop Is Organized

```
src/challenges/
├── 4-hour/
│   ├── exercise-N.ts                   ← starter file with TODOs (you edit this)
│   ├── challenge-2-bug.ts              ← end-of-track bug challenge
│   ├── instructions/                   ← markdown goals + why-it-matters
│   │   └── exercise-N.md
│   ├── coding-steps/                   ← ordered delete / edit / add walkthrough
│   │   └── exercise-N-steps.md
│   └── solutions/                      ← reference solutions
│       └── exercise-N-end.ts
├── 8-hour/
│   ├── exercise-N.ts
│   ├── challenge-1-feature.ts          ← end-of-track feature challenge
│   ├── challenge-2-bug.ts              ← end-of-track bug challenge
│   ├── instructions/
│   ├── coding-steps/
│   └── solutions/
└── homework/
    ├── 4-hour-homework.md              ← compressed capstone practice
    └── 8-hour-homework.md              ← full capstone practice
```

Every exercise file is runnable on its own with `tsx --watch` — there is no central app, no router config to thread through, and no extension to install. Edit, save, `curl`, repeat.

## Recommended Workflow

1. Pick an exercise from [WORKSHOP_SCHEDULE.md](./WORKSHOP_SCHEDULE.md).
2. Read the matching [`instructions/exercise-N.md`](./src/challenges/4-hour/instructions) — explains _what_ to build and _why_.
3. Run it: `pnpm dev:4:N` (4-hour) or `pnpm dev:8:N` (8-hour). The server starts on `http://localhost:3000` with `/docs` and `/openapi.json` auto-mounted.
4. Edit the matching `src/challenges/<track>/exercise-N.ts` file. `tsx --watch` restarts the server on save.
5. Stuck on the _order_ of edits? Open [`coding-steps/exercise-N-steps.md`](./src/challenges/4-hour/coding-steps) — it lists every delete / edit / add in build order with the reasoning behind each step.
6. Still stuck? Open `solutions/exercise-N-end.ts` and diff against your file.
7. Done? Move on. After the workshop, do the **Homework** capstone for extra practice.

### Three layers of guidance per exercise

| Layer                   | Where                              | When to use it                                                             |
| ----------------------- | ---------------------------------- | -------------------------------------------------------------------------- |
| **Goals & context**     | `instructions/exercise-N.md`       | Always read first — explains _what_ to build and _why_.                    |
| **Ordered build steps** | `coding-steps/exercise-N-steps.md` | When you know _what_ but not _how to get there_ without skipping ahead.    |
| **Reference solution**  | `solutions/exercise-N-end.ts`      | Last resort — verifies the final shape after you've attempted it yourself. |

The `coding-steps/` files include mental models, before → after snippets, a code-change cheat sheet table, and a "common mistakes" section per exercise. They are written for senior engineers who want the _sequence_ of edits without being handed the entire solution at once.

## Useful Commands

| Command                 | Purpose                                                              |
| ----------------------- | -------------------------------------------------------------------- |
| `pnpm install`          | Install dependencies (`@daloyjs/core@^0.36.0`, `zod`, `tsx`)          |
| `pnpm dev:4:N`          | Run 4-hour exercise N with `tsx --watch` on port 3000                |
| `pnpm dev:8:N`          | Run 8-hour exercise N with `tsx --watch` on port 3000                |
| `pnpm dev:sol:4:N`      | Run the 4-hour reference solution for exercise N                     |
| `pnpm dev:sol:8:N`      | Run the 8-hour reference solution for exercise N                     |
| `pnpm typecheck`        | TypeScript check across all exercises                                |
| `pnpm gen`              | Regenerate the typed fetch SDK from a running exercise's OpenAPI doc |
| `pnpm test`             | Run contract tests (4-hour exercise 7 + 8-hour exercise 8 solutions) |

## Why DaloyJS Is the Pitch

This workshop is designed to make the framework's value concrete, not theoretical. By the end you should be able to answer all of these from memory:

| Concern                              | Express / Fastify / Hono              | DaloyJS                                                              |
| ------------------------------------ | ------------------------------------- | -------------------------------------------------------------------- |
| Single source of truth for contracts | Multiple plugins, drift-prone         | One `app.route({...})` drives validation, types, OpenAPI, and client |
| Runtime portability                  | Node-only / Bun-only / Workers-only   | Web-standard core + adapters for Node, Bun, Deno, Vercel, Workers    |
| OpenAPI                              | Plugin afterthought, manual sync      | First-class, auto-generated 3.1 spec, one-line `docs: true`          |
| Typed client                         | Hand-written or separate codegen step | `pnpm gen` emits a Hey API typed fetch SDK from the live spec        |
| Validation                           | Pick a library, glue it yourself      | Standard Schema — Zod / Valibot / ArkType / TypeBox, no lock-in      |
| Errors                               | Ad-hoc JSON                           | RFC 9457 problem+json with consistent shapes and 5xx prod redaction   |
| Security defaults                    | "Bring your own helmet"               | secureHeaders, rateLimit, requestId, fetchGuard, JWT allowlists      |
| Supply chain                         | `npm install` runs arbitrary scripts  | `ignore-scripts=true`, 24h release-age, zero runtime deps in core    |

## Where to Learn More

This workshop is hands-on. For deeper reading, every exercise links to the matching topic on <https://daloyjs.dev/docs>:

- [Getting Started](https://daloyjs.dev/docs/getting-started)
- [Routing](https://daloyjs.dev/docs/routing)
- [Validation](https://daloyjs.dev/docs/validation)
- [Errors](https://daloyjs.dev/docs/errors)
- [OpenAPI](https://daloyjs.dev/docs/openapi)
- [Clients & codegen](https://daloyjs.dev/docs/clients)
- [Security](https://daloyjs.dev/docs/security)
- [Auth](https://daloyjs.dev/docs/auth)
- [Adapters](https://daloyjs.dev/docs/adapters)
- [WebSockets](https://daloyjs.dev/docs/websockets)
- [Testing](https://daloyjs.dev/docs/testing)
- [Tutorials → Bookstore](https://daloyjs.dev/docs/tutorials/bookstore)

---

Happy hacking. Treat the secure-by-default checks as features, not friction — every time a default rejects a request, that's a class of CVE that did not ship.
