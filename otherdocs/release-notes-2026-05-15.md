# Release notes draft — 2026-05-15

Use these as the GitHub release bodies for the prepared npm releases.

## `@daloyjs/core@0.1.3`

Title:

`@daloyjs/core@0.1.3` — security-default hardening

Body:

```md
## Highlights

- `rateLimit()` no longer trusts `X-Forwarded-For` or `X-Real-IP` by default. The default limiter is now global unless you explicitly opt in to `trustProxyHeaders: true` behind a trusted proxy or provide your own key generator.
- The built-in docs helpers now support self-hosted Swagger UI / Scalar assets and nonce-based CSP via `docsContentSecurityPolicy()` and `htmlResponse(..., opts)`.
- The repository supply-chain posture is stronger: third-party GitHub Actions are SHA-pinned, installs are hardened, and npm publishing remains isolated behind trusted publishing with provenance.

## Why this release matters

This patch tightens defaults in places where ambiguous or overly trusting behavior can become a security footgun:

- proxy headers are no longer trusted unless you say so
- docs UI CSP is configurable for stricter deployments
- CI/CD controls now rely on immutable action pins instead of mutable tags

## Upgrade notes

- If you previously relied on per-client rate limiting behind a reverse proxy, set `trustProxyHeaders: true` only when your proxy strips and rewrites those headers correctly.
- If you self-host docs assets or need stricter CSP, switch to the new docs helper options and nonce support.

## Validation

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm pack --dry-run`
- `cd daloyjs.dev && pnpm typecheck`
- `cd daloyjs.dev && pnpm build`
```

## `create-daloy@0.1.9`

Title:

`create-daloy@0.1.9` — scaffold on the hardened core release

Body:

```md
## Highlights

- All shipped templates now depend on `@daloyjs/core@^0.1.3`.
- Newly scaffolded apps inherit the latest security-default behavior from the core release, including the safer `rateLimit()` proxy-header default.
- The scaffolder documentation is aligned with the repo's current supply-chain posture and install hardening guidance.

## Why this release matters

This patch keeps the scaffolder aligned with the current core package so fresh projects start from the hardened defaults instead of older dependency ranges.

## Validation

- `pnpm --filter create-daloy test`
- `cd packages/create-daloy && pnpm pack --dry-run`
```

## Publish path

- `@daloyjs/core@0.1.3`: create and push signed tag `v0.1.3`, then approve `release.yml` in the protected `npm-publish` environment.
- `create-daloy@0.1.9`: run `release.yml` with manual dispatch and `package=create-daloy` or `package=all` after approval in the same protected environment.