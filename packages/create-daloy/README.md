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
- A template (`node-basic` or `cloudflare-worker`)
- Whether to install dependencies
- Whether to initialize a git repository

## Non-interactive usage

```bash
pnpm create daloy@latest my-api \
  --template node-basic \
  --package-manager pnpm \
  --install \
  --git
```

### Flags

| Flag | Description |
| --- | --- |
| `--template <name>` | `node-basic` (default) or `cloudflare-worker`. |
| `--package-manager <pm>` | `pnpm` (default), `npm`, `yarn`, or `bun`. |
| `--install` / `--no-install` | Install dependencies after scaffolding. Defaults to interactive. |
| `--git` / `--no-git` | Initialize a git repository. Defaults to interactive. |
| `--force` | Overwrite an existing non-empty directory. |
| `--yes` | Accept all defaults; never prompt. |
| `--help` | Print usage and exit. |
| `--version` | Print version and exit. |

## Templates

### `node-basic`

A production-ready Node.js HTTP server using `@daloyjs/core` with:

- Strict TypeScript and `tsx` for instant dev runs.
- Hardened `.npmrc` for safer installs.
- `secureHeaders`, `requestId`, and `rateLimit` enabled by default.
- A sample `GET /healthz` and contract-first `GET /books/:id` route with Zod validation.
- `pnpm gen` wired to emit OpenAPI 3.1 + a typed Hey API client.

### `cloudflare-worker`

A minimal Cloudflare Worker bootstrap using `@daloyjs/core/cloudflare` with:

- `wrangler.toml` ready to deploy.
- Zod-validated route exposed as `fetch`.
- A sample test that exercises `app.request(...)`.

## What the CLI guarantees

- Zero runtime dependencies (uses only Node built-ins) for a clean supply-chain footprint.
- Templates are copied verbatim from this package's `templates/` directory.
- Files prefixed with `_` are renamed (`_gitignore` → `.gitignore`, `_npmrc` → `.npmrc`) to survive npm packing.
- The CLI never executes template scripts and never makes network calls beyond the package manager you select.
