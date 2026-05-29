# DaloyJS Workshop — Agent Instructions

> IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any tasks in this project. The canonical docs live at <https://daloyjs.dev/docs>; always link there, never to repo paths, when citing reference material to attendees.

## Purpose

This directory is a **self-paced, hands-on workshop** that teaches the [DaloyJS](https://daloyjs.dev) framework end-to-end. It is modeled directly on the pedagogy of the sibling `demo-workshop/` (TanStack Query × Hey API), but the subject is the DaloyJS server framework instead of a React data-fetching stack.

## Pedagogical Model

Every exercise ships **three layers of guidance**:

1. **`instructions/exercise-N.md`** — goals, requirements, and the "why this matters" framing. Read first.
2. **`coding-steps/exercise-N-steps.md`** — ordered delete / edit / add walkthrough with mental models, before → after snippets, a code-change cheat sheet, and a "common mistakes" section. Use when you know _what_ but not _the order_.
3. **`solutions/exercise-N-end.ts`** — reference final state. Last resort.

Do not collapse these layers into a single file when adding new exercises. Senior engineers learn faster when they get to attempt the activity at each successive disclosure level.

## Tech Stack

| Category    | Technology         | Version    |
| ----------- | ------------------ | ---------- |
| Scaffolder  | create-daloy       | 0.36.0     |
| Framework   | @daloyjs/core      | ^0.36.0    |
| Runtime     | Node.js            | >= 24.0.0  |
| Language    | TypeScript         | ^6.0.3     |
| Validator   | Zod                | ^4         |
| Codegen     | @hey-api/openapi-ts | ^0.97.1   |
| Dev runner  | tsx                | ^4.22.3    |
| Test runner | node:test (built-in) | n/a      |

## Setup Commands

```bash
pnpm install              # install workshop deps
pnpm create daloy@latest my-api --template node-basic --yes  # compare against the latest scaffold
pnpm dev:4:N              # run 4-hour exercise N with tsx --watch
pnpm dev:8:N              # run 8-hour exercise N with tsx --watch
pnpm dev:sol:4:N          # run 4-hour reference solution N
pnpm dev:sol:8:N          # run 8-hour reference solution N
pnpm typecheck            # tsc --noEmit
pnpm gen                  # regenerate generated/client/ from a running exercise's OpenAPI
pnpm test                 # contract tests (currently the 4-hour exercise 7 solution)
```

## Project Structure

```
src/challenges/
├── 4-hour/                 # 8 exercises + bug challenge + (homework lives at sibling)
│   ├── exercise-N.ts
│   ├── challenge-2-bug.ts
│   ├── instructions/exercise-N.md
│   ├── coding-steps/exercise-N-steps.md
│   └── solutions/exercise-N-end.ts
├── 8-hour/                 # 12 exercises + feature + bug + (homework lives at sibling)
│   ├── exercise-N.ts
│   ├── challenge-1-feature.ts
│   ├── challenge-2-bug.ts
│   ├── instructions/
│   ├── coding-steps/
│   └── solutions/
└── homework/
    ├── 4-hour-homework.md
    └── 8-hour-homework.md
```

Each exercise is **self-contained**: one `.ts` file that constructs an `App`, registers routes, and calls `serve(app, { port: 3000 })`. No shared bootstrap, no plugin loader, no central registry. This is intentional — attendees should read the entire boot-to-listen path in one screen.

## Critical Conventions

### Naming

- **Files**: `kebab-case.ts` (e.g., `exercise-3.ts`, `challenge-1-feature.ts`).
- **Variables/functions**: `camelCase` (NEVER `snake_case`).
- **Types**: `PascalCase`.
- **Constants**: `UPPER_SNAKE_CASE`.

### TypeScript Types

- Use `type` aliases, not `interface` declarations. (Matches the framework's own style.)
- Always use Standard Schema validators (Zod 4 by default in this workshop) — never hand-roll runtime type guards in the exercise files.

### Linking Conventions

- **Always link to <https://daloyjs.dev/docs>**, never to repository file paths, when pointing attendees at reference material. The workshop must remain useful when read on the website or on a fork without the parent repo nearby.
- Examples:
  - ✅ `[Routing docs](https://daloyjs.dev/docs/routing)`
  - ❌ `[Routing docs](../../website/app/docs/routing/page.tsx)`
- Linking _within_ this workshop directory (e.g. instructions ↔ coding-steps ↔ solutions) is fine and encouraged — use relative paths.

### Exercise file shape

Every `exercise-N.ts` file follows this skeleton:

```ts
// TODO:
// 1. <high-level task 1>
// 2. <high-level task 2>
// 3. <high-level task 3>

import { App, NotFoundError } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { z } from "zod";

const app = new App({ /* … */ });

// app.use(...)
// app.route({...})

serve(app, { port: 3000 });
```

Keep the TODO block to **three to five high-level bullets** — never the full step list. The step list lives in `coding-steps/`.

### Solution file shape

`solutions/exercise-N-end.ts` is the reference final state. It must:

- Run cleanly under `pnpm dev:sol:4:N` / `pnpm dev:sol:8:N`.
- Pass `pnpm typecheck`.
- Match every bullet in the `instructions/exercise-N.md` "Requirements" section.
- Use the same import paths as the starter file (no surprise dependencies).

## Adding a New Exercise

1. Pick the next number in either track.
2. Create all four files: `exercise-N.ts`, `instructions/exercise-N.md`, `coding-steps/exercise-N-steps.md`, `solutions/exercise-N-end.ts`.
3. Add `dev:4:N` (or `dev:8:N`) and `dev:sol:4:N` (or `dev:sol:8:N`) scripts to `package.json`.
4. Add a row to the matching table in [WORKSHOP_SCHEDULE.md](./WORKSHOP_SCHEDULE.md).
5. Link the new exercise from the [README.md](./README.md) workflow section if it's a structural change.

## Quality Gates

- `pnpm typecheck` must pass on every exercise and solution.
- Every starter file must boot under `tsx --watch` and respond with at least one 2xx route — even before the attendee makes any edits — so they can confirm the dev loop works before fighting the actual exercise.
- Every solution file must pass the contract test in `tests/` if one exists for that exercise.

## What This Workshop Is NOT

- It is not a replacement for <https://daloyjs.dev/docs>. The docs are the source of truth; this workshop is the guided practice.
- It is not a place to demo experimental features. Every exercise must work on the latest published `@daloyjs/core`.
- It is not a frontend tutorial. Frontend codegen (Hey API SDK consumption) is showcased only in the codegen exercise — full SPA integration lives in `demo-workshop/`.
