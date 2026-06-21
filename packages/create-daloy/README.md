<p align="center">
  <a href="https://daloyjs.dev">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://daloyjs.dev/assets/banner-x-1500x500.png">
      <img alt="DaloyJS — Contract-first REST APIs for Node · Bun · Deno · Workers · Edge" src="https://daloyjs.dev/assets/banner-light-1280x426.png" width="100%">
    </picture>
  </a>
</p>

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
- A template (`node-basic`, `vercel`, `cloudflare-worker`, `bun-basic`, or `deno-basic`)
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
| `--template <name>` | `node-basic` (default), `vercel`, `cloudflare-worker`, `bun-basic`, or `deno-basic`, `vercel`. |
| `--package-manager <pm>` | `pnpm` (default), `npm`, `yarn`, or `bun`. Ignored for `deno-basic`. |
| `--list-templates` | Print available templates with descriptions. |
| `--install` / `--no-install` | Install dependencies after scaffolding. Defaults to **Y** for npm/yarn/bun and **N** for pnpm so you can review the hardened `.npmrc` / `pnpm-workspace.yaml` and aren't blocked by the 24h `minimumReleaseAge` embargo on the first run. |
| `--git` / `--no-git` | Initialize a git repository. Defaults to interactive. |
| `--minimal` | Strip the bookstore demo route and the built-in `/docs` + `/openapi.json` routes so only the framework bootstrap and `/healthz` ship. |
| `--with-ci` / `--no-ci` | Add the hardened GitHub Actions, Dependabot, CODEOWNERS, SECURITY.md, and lockfile-source verification bundle. **Defaults to Y** so scaffolded projects are secure by default. |
| `--with-deploy` / `--no-deploy` | Add the starter `.github/workflows/deploy.yml`. Defaults to the same value as `--with-ci`, so you can keep CI but opt out of deploy scaffolding with `--no-deploy`. |
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
- Auto-mounted Scalar docs can be branded by changing `docs: true` to
  `docs: { scalar: { theme, customCss } }`.

### `cloudflare-worker`

A minimal Cloudflare Worker bootstrap using `@daloyjs/core/cloudflare` with:

- `wrangler.toml` ready to deploy.
- `secureHeaders` and `requestId` enabled by default, with smaller edge-friendly body and timeout limits.
- A Zod-validated `/healthz` route and contract-first `/books/:id` route exposed via `toFetchHandler(app)`.

### `vercel`

A Vercel API bootstrap on the **Node.js runtime** (Vercel's recommended runtime
for standalone functions, on Fluid Compute) using `@daloyjs/core/vercel` with:

- `api/[...path].ts` catch-all routing so DaloyJS owns the API surface.
- `export default toFetchHandler(app)` — the `{ fetch }` shape Vercel Node.js Functions expect (no `runtime` export needed; Node.js is the default).
- Notes for opting into the Edge runtime (`export const runtime = "edge"` + `toWebHandler(app)`) if you specifically need it.
- `vercel dev` / `vercel deploy` scripts.
- `secureHeaders` and `requestId` enabled by default, with smaller serverless-friendly body and timeout limits.
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

## Authentication (OAuth2 / OpenID Connect)

Scaffolded apps are **resource servers**: DaloyJS verifies and enforces access
tokens, it does **not** issue them. There is no built-in login UI, user
database, or OAuth2 authorization server (it is not an identity provider like
Keycloak, Auth0, or Duende IdentityServer). To add login, bring an OpenID
Connect provider — managed (Auth0, Okta, Clerk, Microsoft Entra ID, AWS
Cognito) or self-hosted open source (Keycloak, Zitadel, Ory, Logto) — and have
DaloyJS verify its JWTs with the first-party `jwk()`, `bearerAuth()`, and
`requireScopes()` helpers. Don't build your own authorization server.

See [Auth architecture](https://daloyjs.dev/docs/auth/architecture) for the full
picture and the two recommended designs (API resource server and browser BFF).

## Minimal scaffolds

Pass `--minimal` to drop the bookstore demo route and the built-in
`/docs` + `/openapi.json` API docs routes from any template that supports
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

For Node-style templates, the bundle adds the following.

**CI and deploy**

- `.github/workflows/ci.yml` — top-level `permissions: {}`, pinned actions,
  `harden-runner`, `persist-credentials: false`, no package-manager cache,
  install scripts disabled.
- `.github/workflows/deploy.yml` — a manual-only deployment starter, gated to
  `main` or a tag by default. Container templates publish a Docker image to
  GHCR with the repo-scoped `GITHUB_TOKEN`. Vercel and Cloudflare templates
  ship concrete CLI deploy steps that read platform credentials from GitHub
  Actions secrets / variables. Node-style templates re-run `verify:lockfile`
  before shipping.

**Scheduled vulnerability scanning (SCA)**

- `.github/workflows/vuln-scan.yml` — daily cron that runs the package
  manager's audit against the committed lockfile. Catches CVEs disclosed
  *after* the last PR or push and provides SOC 2 CC7.1
  ([continuous vulnerability management](https://www.aikido.dev/blog/a-guide-to-automating-technical-vulnerability-management-for-soc-2))
  evidence even when nobody is touching the repo.
- `.github/workflows/osv-scan.yml` — a second, independent SCA source.
  `vuln-scan.yml` queries the package manager's audit feed (GHSA); this one
  runs Google's OSV-Scanner against the committed lockfile and cross-references
  the OpenSSF [malicious-packages](https://github.com/ossf/malicious-packages)
  corpus, so a malware advisory that lands in OSV.dev before it propagates to
  GHSA still fails the build. The binary is downloaded from a pinned official
  release and verified by SHA-256 before execution — no third-party action is
  added to the supply chain just for this scan. This is the missing layer that
  Aikido's [SAST vs SCA](https://www.aikido.dev/blog/sast-vs-sca) and
  [npm-audit-guide](https://www.aikido.dev/blog/npm-audit-guide) write-ups warn
  about, and the Deno scaffold gets it too (Deno has no `audit` built in, so
  without OSV-Scanner a Deno scaffold would have no scheduled SCA at all).

**Secret and static analysis**

- `.github/workflows/secret-scan.yml` — runs [gitleaks](https://github.com/gitleaks/gitleaks)
  on every PR / push (working tree) and on a daily schedule across the **full
  git history**, so a credential leaked anywhere in any commit, branch, or tag
  is surfaced even if GitHub-native push protection missed it. Binary is
  pinned-release + SHA-256-verified before execution. See Aikido's
  [Secrets Detection guide](https://www.aikido.dev/blog/secret-detection-application-security)
  for why history-aware scanning is the floor, not the ceiling.
- `.github/workflows/opengrep.yml` — a second SAST source alongside CodeQL,
  using [Opengrep](https://github.com/opengrep/opengrep) (an open-source
  Semgrep fork) with the same pinned-binary + SHA-256-verified pattern.
- CodeQL (built in via the GitHub bundle).

**Container and runtime scanning**

- `.github/workflows/container-scan.yml` — runs Trivy against the image
  produced by the template's `_Dockerfile` (filesystem scan on PR, full image
  scan on push to `main`) so a base-image CVE or a vulnerable layer is
  surfaced before deploy.
- `.github/workflows/dast.yml` — a manual-only dynamic-analysis workflow that
  boots the scaffolded API and runs an OWASP ZAP baseline scan against it,
  for teams that want a black-box check before promoting a release.

**Governance**

- OpenSSF Scorecard, zizmor, Dependabot, CODEOWNERS, and `SECURITY.md`.
- `scripts/verify-lockfile-sources.mjs` plus a `verify:lockfile` package script
  that rejects git dependencies and non-registry tarball URLs in text
  lockfiles.

The bundle deliberately does **not** generate an npm publish workflow.
`create-daloy` scaffolds REST API services, not libraries; if you later carve
out a reusable package, opt into npm trusted publishing yourself.

For `deno-basic`, `--with-ci` generates a Deno-native CI workflow, a manual-only
container publish starter for GHCR that is guarded to `main` or a tag by
default, plus CodeQL, Opengrep, **OSV-Scanner** (the only scheduled SCA layer
a Deno scaffold has, since Deno ships no `audit`), Scorecard, zizmor,
Dependabot for GitHub Actions, CODEOWNERS, and `SECURITY.md`.

If you want the governance bundle but not the deployment starter, pass
`--with-ci --no-deploy`. If you only want a deployment starter, pass
`--with-deploy --no-ci`.

If you omit `--code-owner`, the generated CODEOWNERS file uses
`@your-org/security-team` as a placeholder. Replace it before relying on branch
protection. You should also enable GitHub secret scanning, push protection, and
required status checks in the repository settings.

## Container-first scaffolds

Every template (Node, Bun, Vercel, Cloudflare Worker, and Deno) ships a
production-oriented `Dockerfile` and `.dockerignore` with secure-by-default
posture: a non-root user, `STOPSIGNAL SIGTERM`, `tini` as PID 1, and a
`HEALTHCHECK` pointed at `/readyz`. Node-style templates also ship an
`.env.example`. None of this is required — delete or replace whatever you do
not need.

## What the CLI guarantees

- Zero runtime dependencies (uses only Node built-ins) for a clean supply-chain footprint.
- A modern terminal experience with Unicode/color capability detection and ASCII fallbacks.
- Templates are copied verbatim from this package's `templates/` directory.
- Files and folders prefixed with `_` are renamed on copy (`_gitignore` → `.gitignore`, `_npmrc` → `.npmrc`, `_github/` → `.github`, `_agents/` → `.agents/`, `_vscode/` → `.vscode/`, `_Dockerfile` → `Dockerfile`, `_dockerignore` → `.dockerignore`, `_env.example` → `.env.example`) to survive npm packing.
- pnpm-specific `.npmrc` hardening is kept only when you choose `pnpm`; other package managers get a clean project without unsupported config warnings.
- pnpm projects ship with `ignore-scripts=true`, `minimum-release-age=1440`, `verify-store-integrity=true`, `prefer-frozen-lockfile=true`, and `strict-peer-dependencies=true` by default.
- `--with-ci` projects ship with pinned GitHub Actions workflows, CODEOWNERS, Dependabot, SECURITY.md, and lockfile-source verification.
- The CLI never executes template scripts and never makes network calls beyond the package manager you select.

## AI agent helper files

Every scaffolded project ships with two files that help AI coding agents (Copilot, Claude Code, Cursor, Codex, etc.) understand and work in your project:

- `AGENTS.md` (repo root) — a small, top-of-context file (per the open [AGENTS.md](https://agents.md) convention): one-line project description, package manager / runtime, project shape, core rules, and the few commands an agent needs. It links to the full skill below.
- `.agents/skills/daloyjs-best-practices/SKILL.md` — comprehensive operational guidance following the open `agents/skills/<skill-name>/SKILL.md` convention: when to use the skill, project structure, core workflows (adding routes, regenerating the OpenAPI spec and client), schema and validation conventions, error-handling patterns, middleware order, testing best practices (happy and unhappy paths), security best practices, logging and observability notes, configuration and secrets handling, deployment notes, pitfalls and guardrails, and process expectations.

Both files are tailored to the chosen template (Node, Bun, Deno, Vercel, or Cloudflare Workers), and Node-style templates rewrite their commands to match your selected package manager. They follow the "instruction budget" advice — small root file, progressive disclosure for the rest — so they don't waste agent tokens. Edit or delete them freely; the framework does not depend on them at runtime.

Every scaffold also ships a `.vscode/mcp.json` (authored as `_vscode/mcp.json` in the template) that wires VS Code and other MCP-aware editors to the DaloyJS documentation MCP server (`https://daloyjs.dev/mcp`) over HTTP. AI assistants in your editor can then pull current DaloyJS docs with no manual setup. Delete the file or remove the server entry to opt out; it is editor configuration only and the framework does not depend on it at runtime.
