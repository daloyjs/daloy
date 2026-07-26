# my-daloy-bun-app

A [DaloyJS](https://daloyjs.dev) starter for the [Bun](https://bun.sh) runtime.

## Develop

```bash
bun install
bun run dev          # http://localhost:3000
```

Try it:

```bash
curl http://localhost:3000/healthz
<!-- daloy-minimal:strip-start books -->
curl http://localhost:3000/books/1
<!-- daloy-minimal:strip-end books -->
```

<!-- daloy-minimal:strip-start docs -->

## API documentation

- API docs (Scalar): <http://localhost:3000/docs>
- OpenAPI 3.1 JSON: <http://localhost:3000/openapi.json>
- OpenAPI 3.1 YAML: <http://localhost:3000/openapi.yaml>

The spec is generated live from your routes, so it stays in sync with what is actually deployed.
To brand Scalar, change `docs: true` in `src/build-app.ts` to `docs: { scalar: { theme, customCss } }`.

<!-- daloy-minimal:strip-end docs -->

## Generate OpenAPI + typed client

```bash
bun run gen:openapi
bun run gen:client
```

## Test

```bash
bun test
```

## Contract gate

Check that your OpenAPI contract is internally consistent (operationIds present and unique, response examples matching their schemas, no dead routes). It ships as `tests/contract.test.ts` (run under `bun test`) and as a focused script:

```bash
bun run contract     # bun test tests/contract.test.ts
```

For a localhost-only gate that runs before code leaves your machine, enable the bundled pre-push hook (opt-in; bypass once with `git push --no-verify`):

```bash
bun run hooks:install   # points core.hooksPath at .githooks
```

## Imports

This project uses TypeScript with `"moduleResolution": "Bundler"` and `"allowImportingTsExtensions": true`. Relative imports use the **`.ts` extension** directly:

```ts
import { buildApp } from "./build-app.ts";
```

Do not use `.js` here — that's the Node NodeNext convention and will not resolve under Bun's setup.

## What's included

- `@daloyjs/core` with starter security middleware: `secureHeaders`, `requestId`, and `rateLimit`.

<!-- daloy-minimal:strip-start books -->

- A health route and contract-first `/books/:id` route with Zod validation.

<!-- daloy-minimal:strip-end books -->

- Hot reload via `bun --hot`.
- Hey API codegen wired to `bun run gen:openapi` + `bun run gen:client`.

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
