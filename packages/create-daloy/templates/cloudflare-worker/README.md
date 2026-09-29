# my-daloy-worker

A [DaloyJS](https://daloyjs.dev) Cloudflare Workers starter.

## Develop

```bash
pnpm install
pnpm dev          # http://localhost:8787
```

> **Install refused right after a DaloyJS release?** New installs wait 24 hours
> before using a freshly published version (`minimumReleaseAge` in
> `pnpm-workspace.yaml`), a supply-chain safeguard. If `@daloyjs/core` was just
> released, retry a few hours later rather than turning the safeguard off.

## Deploy

```bash
pnpm run deploy
```

`@daloyjs/core/cloudflare` exposes `toFetchHandler(app)`, so the same `App` you would use on Node also runs on Workers.

## Contract gate

Check that your OpenAPI contract is internally consistent (operationIds present and unique, response examples matching their schemas, no dead routes). It ships as `tests/contract.test.ts` (run under `pnpm test`) and as a focused script:

```bash
pnpm contract        # daloy inspect --check src/index.ts
```

For a localhost-only gate that runs before code leaves your machine, enable the bundled pre-push hook (opt-in; bypass once with `git push --no-verify`):

```bash
pnpm hooks:install   # points core.hooksPath at .githooks
```

## What's included

- `@daloyjs/core/cloudflare` with starter security middleware: `secureHeaders` and `requestId`.
- Smaller edge-friendly body and timeout limits in the generated app.
- `wrangler.toml` ready for local development and deploys.

## Authentication (OAuth2 / OpenID Connect)

This app is a **resource server**: DaloyJS verifies and enforces access tokens,
it does **not** issue them. There is no built-in login UI, user database, or
OAuth2 authorization server (it is not an identity provider like Keycloak,
Auth0, or Duende IdentityServer). To add login, bring an OpenID Connect provider
— managed (Auth0, Okta, Clerk, Microsoft Entra ID, AWS Cognito) or self-hosted
open source (Keycloak, Zitadel, Ory, Logto) — and verify its JWTs with the
first-party `jwk()`, `bearerAuth()`, and `requireScopes()` helpers. Don't build
your own authorization server.

See [Auth architecture](https://daloyjs.dev/docs/auth/architecture) for the
recommended designs (API resource server and browser BFF).

Read the docs at <https://daloyjs.dev/docs>.
