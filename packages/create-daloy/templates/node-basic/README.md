# my-daloy-app

A [DaloyJS](https://daloyjs.dev) starter — runtime-portable, contract-first TypeScript REST API.

## Develop

```bash
pnpm install
pnpm dev          # http://localhost:3000
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
pnpm gen
# → generated/openapi.json
# → generated/client/  (typed Hey API client)
```

## Contract gate

Check that your OpenAPI contract is internally consistent (operationIds present and unique, response examples matching their schemas, no dead routes):

```bash
pnpm contract        # daloy inspect --check src/build-app.ts
```

It also runs as `tests/contract.test.ts` under `pnpm test`. For a localhost-only gate that runs before code leaves your machine, enable the bundled pre-push hook (opt-in; bypass once with `git push --no-verify`):

```bash
pnpm hooks:install   # points core.hooksPath at .githooks
```

## Build

```bash
pnpm build
node dist/index.js
```

## Imports

This project uses Node.js **ESM** with `"module": "NodeNext"` and `"rewriteRelativeImportExtensions"`. Relative imports use the `.ts` extension — the actual file on disk:

```ts
import { buildApp } from "./build-app.ts";
```

On `pnpm build`, TypeScript rewrites the `.ts` specifier to `.js` in the compiled `dist/` output, so the deployed code is valid Node ESM. (Node ESM has no extensionless relative imports — `.ts` is the most natural form available.)

## What's included

- `@daloyjs/core` with starter security middleware: `secureHeaders`, `requestId`, and `rateLimit`.

<!-- daloy-minimal:strip-start books -->

- A health route and a contract-first `/books/:id` route with Zod validation.

<!-- daloy-minimal:strip-end books -->

- Hardened `.npmrc` for safer installs.
- Hey API codegen wired to `pnpm gen`.

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
