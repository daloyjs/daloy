# create-daloy

Scaffold a new [DaloyJS](https://github.com/daloyjs/daloy) project in seconds.

```bash
# pick the package manager you actually use
pnpm create daloy@latest my-api
npm  create daloy@latest my-api
yarn create daloy           my-api
bun  create daloy           my-api
```

The CLI is interactive when arguments are missing. It will ask you for:

- A project directory name (defaults to `my-daloy-app`)
- A template (`node-basic`, `vercel-edge`, `cloudflare-worker`, `bun-basic`, or `deno-basic`)
- A package manager (`pnpm`, `npm`, `yarn`, or `bun`) — not asked for the
  `deno-basic` runtime template
- Whether to install dependencies
- Whether to initialize a git repository
- Whether to add hardened GitHub Actions and security/governance files

Interactive runs use a polished terminal UI with a DaloyJS welcome banner,
arrow-key template and package-manager pickers, progress indicators, and a
boxed completion summary. Non-TTY environments and `--yes` mode keep a plain,
script-friendly transcript with the same decisions and next steps.

## Non-interactive usage

```bash
pnpm create daloy@latest my-api \
  --template node-basic \
  --package-manager pnpm \
  --with-ci \
  --code-owner @acme/security \
  --install \
  --git
```

### Flags

| Flag | Description |
| --- | --- |
| `--template <name>` | `node-basic` (default), `vercel-edge`, `cloudflare-worker`, `bun-basic`, or `deno-basic`. |
| `--package-manager <pm>` | `pnpm` (default), `npm`, `yarn`, or `bun`. Ignored for `deno-basic`. |
| `--list-templates` | Print available templates with descriptions. |
| `--install` / `--no-install` | Install dependencies after scaffolding. Defaults to interactive. |
| `--git` / `--no-git` | Initialize a git repository. Defaults to interactive. |
| `--minimal` | Strip the bookstore demo route and the built-in `/docs` + `/openapi.json` routes so only the framework bootstrap and `/healthz` ship. |
| `--with-ci` / `--no-ci` | Add the hardened GitHub Actions, Dependabot, CODEOWNERS, SECURITY.md, and lockfile-source verification bundle. |
| `--code-owner <owner>` | Replace the CODEOWNERS placeholder when `--with-ci` is used, for example `@acme/security`. |
| `--force` | Overwrite an existing non-empty directory. |
| `--yes` | Accept all defaults; never prompt. |
| `--help` | Print usage and exit. |
| `--version` | Print version and exit. |

## Templates

Use `create-daloy --list-templates` to inspect available templates without creating a project.

### `node-basic`

A production-ready Node.js HTTP server using `@daloyjs/core` with:

- Strict TypeScript and `tsx` for instant dev runs.
- Hardened `.npmrc` for safer installs.
- `secureHeaders`, `requestId`, and `rateLimit` enabled by default (`rateLimit` is global until you configure `keyGenerator` or trusted proxy headers).
- A sample `GET /healthz` and contract-first `GET /books/:id` route with Zod validation.
- `pnpm gen` wired to emit OpenAPI 3.1 + a typed Hey API client.

### `cloudflare-worker`

A minimal Cloudflare Worker bootstrap using `@daloyjs/core/cloudflare` with:

- `wrangler.toml` ready to deploy.
- `secureHeaders` and `requestId` enabled by default, with smaller edge-friendly body and timeout limits.
- Zod-validated route exposed as `fetch`.
- A sample test that exercises `app.request(...)`.

### `vercel-edge`

A Vercel Edge API bootstrap using `@daloyjs/core/vercel` with:

- `api/[...path].ts` catch-all routing so DaloyJS owns the API surface.
- `export const config = { runtime: "edge" }` ready for Vercel Edge.
- `vercel dev` / `vercel deploy` scripts.
- `secureHeaders` and `requestId` enabled by default, with smaller edge-friendly body and timeout limits.
- A health route and bookstore route mirroring the Node starter.

### `bun-basic`

A [Bun](https://bun.sh) runtime starter using `@daloyjs/core/bun` with:

- `bun --hot src/index.ts` for instant reloads.
- `bun test` wired to in-process `app.request(...)` checks.
- The same starter security middleware as the Node template (`secureHeaders`, `requestId`, `rateLimit`).
- A health route and contract-first `/books/:id` route with Zod validation.
- Hey API codegen wired to `bun run gen:openapi` + `bun run gen:client`.

### `deno-basic`

A [Deno](https://deno.com) runtime starter using `@daloyjs/core/deno` with:

- A `deno.json` with `deno task dev`, `test`, and `gen:openapi` tasks.
- `@daloyjs/core` and Zod loaded via `npm:` import-map specifiers.
- Minimum-permissions dev script (`--allow-net --allow-env --allow-read`).
- The same starter security middleware as the Node template (`secureHeaders`, `requestId`, `rateLimit`).
- A health route and contract-first `/books/:id` route with Zod validation.
- The CLI skips Node-style installs for this template (no `package.json`).

## Minimal scaffolds

Pass `--minimal` to drop the bookstore demo route and the built-in
`/docs` + `/openapi.json` Swagger UI routes from any template that supports
them. The scaffolded app is left with the framework bootstrap and a single
`/healthz` route — the smallest realistic starting point:

```bash
pnpm create daloy@latest my-api --template node-basic --minimal --yes
```

Sentinel comments (`// daloy-minimal:strip-start <tag>` /
`// daloy-minimal:strip-end <tag>`) survive a default scaffold so you can
re-run with `--minimal`, or delete the marked blocks by hand later.

## Hardened GitHub security bundle

Pass `--with-ci` when you want the generated project to start with the same
security posture as a serious company repo:

```bash
pnpm create daloy@latest my-api \
  --template node-basic \
  --package-manager pnpm \
  --with-ci \
  --code-owner @acme/security
```

For Node-style templates, the bundle adds:

- `.github/workflows/ci.yml` with top-level `permissions: {}`, pinned actions,
  `harden-runner`, `persist-credentials: false`, no package-manager cache, and
  install scripts disabled.
- `.github/workflows/release.yml` as a disabled-by-default npm trusted publishing
  skeleton. It only publishes when `NPM_PUBLISH_ENABLED=true`, the package is no
  longer private, and the protected `npm-publish` environment is configured.
- CodeQL, OpenSSF Scorecard, zizmor, Dependabot, CODEOWNERS, and `SECURITY.md`.
- `scripts/verify-lockfile-sources.mjs` plus a `verify:lockfile` package script
  that rejects git dependencies and non-registry tarball URLs in text lockfiles.

For `deno-basic`, `--with-ci` generates a Deno-native CI workflow plus CodeQL,
Scorecard, zizmor, Dependabot for GitHub Actions, CODEOWNERS, and `SECURITY.md`.
It does not generate an npm release workflow because the Deno template has no
`package.json`.

If you omit `--code-owner`, the generated CODEOWNERS file uses
`@your-org/security-team` as a placeholder. Replace it before relying on branch
protection. You should also enable GitHub secret scanning, push protection, and
required status checks in the repository settings.

## What the CLI guarantees

- Zero runtime dependencies (uses only Node built-ins) for a clean supply-chain footprint.
- A modern terminal experience with Unicode/color capability detection and ASCII fallbacks.
- Templates are copied verbatim from this package's `templates/` directory.
- Files and folders prefixed with `_` are renamed on copy (`_gitignore` → `.gitignore`, `_npmrc` → `.npmrc`, `_github/` → `.github`, `_agents/` → `.agents/`) to survive npm packing.
- pnpm-specific `.npmrc` hardening is kept only when you choose `pnpm`; other package managers get a clean project without unsupported config warnings.
- pnpm projects ship with `ignore-scripts=true`, `minimum-release-age=1440`, `verify-store-integrity=true`, `prefer-frozen-lockfile=true`, and `strict-peer-dependencies=true` by default.
- `--with-ci` projects ship with pinned GitHub Actions workflows, CODEOWNERS, Dependabot, SECURITY.md, and lockfile-source verification.
- The CLI never executes template scripts and never makes network calls beyond the package manager you select.

## AI agent helper files

Every scaffolded project ships with two files that help AI coding agents (Copilot, Claude Code, Cursor, Codex, etc.) understand and work in your project:

- `AGENTS.md` (repo root) — a small, top-of-context file (per the open [AGENTS.md](https://agents.md) convention): one-line project description, package manager / runtime, project shape, core rules, and the few commands an agent needs. It links to the full skill below.
- `.agents/skills/daloyjs-best-practices/SKILL.md` — comprehensive operational guidance following the open `agents/skills/<skill-name>/SKILL.md` convention: when to use the skill, project structure, core workflows (adding routes, regenerating the OpenAPI spec and client), schema and validation conventions, error-handling patterns, middleware order, testing best practices (happy and unhappy paths), security best practices, logging and observability notes, configuration and secrets handling, deployment notes, pitfalls and guardrails, and process expectations.

Both files are tailored to the chosen template (Node, Bun, Deno, Vercel Edge, or Cloudflare Workers), and Node-style templates rewrite their commands to match your selected package manager. They follow the "instruction budget" advice — small root file, progressive disclosure for the rest — so they don't waste agent tokens. Edit or delete them freely; the framework does not depend on them at runtime.
