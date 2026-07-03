---
name: daloyjs-core-contributor
description: >-
  End-to-end workflow for adding or changing a feature in the `@daloyjs/core`
  framework (this repo). Use when editing `src/`, adding a middleware, error
  type, adapter, or public API; wiring tests; writing docs on the website; or
  running the security and quality gates before a commit. Not for scaffolded
  DaloyJS apps (those ship their own daloyjs-best-practices skill) — this is for
  contributors working on the framework itself.
license: MIT
---

# SKILL.md — Contributing to `@daloyjs/core`

Operational guide for AI coding agents working on the DaloyJS framework
monorepo itself. The root [`AGENTS.md`](../../../AGENTS.md) is the durable
contract; this skill is the step-by-step workflow that satisfies it. Read
`AGENTS.md` first for the non-negotiable rules — this skill assumes them.

## When to use this skill

- Adding or changing a `src/` module: routing, parsing, serialization,
  middleware, error types, JWT/JWK, hashing, fetch-guard, MCP, an adapter.
- Adding a new public export or changing a signature on the public API surface.
- Wiring tests, docs, and the README status table for a new capability.
- Running the security / quality gates before staging a commit.

Do **not** use this for scaffolded app work (that lives in a template's own
`daloyjs-best-practices` skill), for `website/`-only changes (read
[`website/AGENTS.md`](../../../website/AGENTS.md)), or for cutting a release
(use the `cut-a-release` skill).

## Non-negotiables (from AGENTS.md)

1. **Never weaken a security control to make code compile or a test pass.** If a
   guardrail blocks a legitimate use case, add a scoped knob (per-route
   override, narrower default) and raise it in the PR — never strip it inline.
   Protected controls include `secureHeaders`, `requestId`, `rateLimit`,
   `bodyLimitBytes`, `requestTimeoutMs`, `fetchGuard`, `isForbiddenObjectKey`,
   JWT algorithm allowlists, `timingSafeEqual` comparisons, schema `.strict()`,
   response-body schema validation, and prod-mode error redaction.
2. **No runtime dependencies.** `@daloyjs/core` must stay dependency-free —
   `pnpm verify:no-runtime-deps` is the floor. Do not add a `dependencies`
   entry; implement it dependency-free or reject the approach.
3. **Never regress the hot paths** (routing, parsing, serialization, middleware
   dispatch). Validate against `bench/` and call out any measured delta.
4. **Always add accurate TSDoc** to every new or changed exported function,
   class, method, type, and public API surface — purpose, params, return,
   thrown errors, and security-relevant behavior. Keep TSDoc concise on
   coverage-sensitive code (large blocks shift tsx source maps).
5. **Ship happy- and unhappy-path tests**, and for any auth / header / parsing /
   crypto path, an unhappy-path test proving the guard still rejects.

## Feature workflow (end to end)

1. **Locate the module.** Framework source is in `src/`. Security-critical
   files: `security.ts`, `hashing.ts`, `jwt.ts`, `jwk.ts`, `fetch-guard.ts`,
   `middleware.ts`, `errors.ts`, `mcp.ts`. If you add a new public symbol,
   export it from `src/index.ts` and, when it warrants its own subpath, add the
   `./<name>` entry to both `package.json` `exports` and `jsr.json` `exports`
   (JSR ships the raw `src/*.ts`, so keep the two maps in sync).
2. **Implement dependency-free**, matching the surrounding style. Add TSDoc as
   you go.
3. **Add tests under `tests/`** (`node --test` via `tsx`). Cover the happy path
   and at least one unhappy path. For a security control, add an adversarial
   case; the `tests/red-team-attacks*.test.ts` suites are the right home for
   attack-shaped coverage (`pnpm test:red-team` runs them alone).
4. **Document on the website.** Every new feature or public API surface ships
   with matching docs under [`website/app/docs/`](../../../website/app/docs)
   (usage + examples) plus the nav/search updates required by
   [`website/AGENTS.md`](../../../website/AGENTS.md) — read it before editing
   anything under `website/`.
5. **Update the README "Status" table** to reflect the new capability.
6. **Add a `CHANGELOG.md` entry** under the current unreleased/next version
   heading (`## [X.Y.Z]`), in the right subsection (Added / Changed / Fixed /
   Security). The release job later extracts this section verbatim.
7. **Run the gates** (below). Do not consider the task done until they pass.

## Quality gates (run before every commit)

```sh
pnpm typecheck && pnpm test
pnpm verify:no-runtime-deps
pnpm verify:parity-audits
pnpm verify:governance-audits
pnpm verify:sbom
```

If the change touches a security path (`src/security.ts`, `hashing.ts`,
`jwt.ts`, `fetch-guard.ts`, `jwk.ts`, the `verify-*` scripts, or `.github/`
workflows), also keep the full security gate set green — see the guardrails
section of `AGENTS.md` for the complete list (`verify:secret-comparisons`,
`verify:no-remote-exec`, `verify:no-weak-random`, `verify:no-unsafe-buffer`,
`verify:routing-hardening-audits`, `verify:runtime-parity-audits`, and the
rest). If the change touches `website/`, also run
`cd website && pnpm typecheck && pnpm build` (a local verification only —
Vercel auto-deploys the site; it is not part of the package release).

Coverage targets are **90% lines / 90% functions** (`pnpm coverage`) and **92%
branches** (`pnpm coverage:branches`). Do not burn cycles chasing the last few
percent on hard security features — ship the feature and revisit tests rather
than adding useless coverage of unreachable defensive branches.

## Commit etiquette

- Do not commit for the user unless they explicitly delegate it. Provide the
  suggested commit title/body and let them commit.
- Never add a `Co-Authored-By: Claude` trailer — attribute solely to the human.
- Never bypass safety checks (`--no-verify`, `--ignore-scripts=false`) without
  recording the reason in the PR.

## More

- Root contract: [`AGENTS.md`](../../../AGENTS.md)
- Releasing: the `cut-a-release` skill
- Framework docs: <https://daloyjs.dev/docs>
