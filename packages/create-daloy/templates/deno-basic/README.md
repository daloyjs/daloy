# my-daloy-deno-app

A [DaloyJS](https://daloyjs.dev) starter for the [Deno](https://deno.com) runtime.

## Develop

```bash
deno task dev          # http://localhost:3000
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

## Generate the OpenAPI spec

```bash
deno task gen:openapi
# → generated/openapi.json
```

To produce a typed SDK from that spec, run [@hey-api/openapi-ts](https://heyapi.dev)
through `npx` or your favorite Node package manager — it does not yet ship a
first-class Deno entry point.

## Test

```bash
deno task test
```

## Contract gate

Check that your OpenAPI contract is internally consistent (operationIds present and unique, response examples matching their schemas, no dead routes). It ships as `tests/contract_test.ts` (run under `deno task test`) and as a focused task:

```bash
deno task contract        # deno test --allow-net --allow-env tests/contract_test.ts
```

For a localhost-only gate that runs before code leaves your machine, enable the bundled pre-push hook (opt-in; bypass once with `git push --no-verify`):

```bash
deno task hooks:install   # points core.hooksPath at .githooks
```

## What's included

- `@daloyjs/core` (loaded via `jsr:` specifiers in `deno.json`).
- Starter security middleware: `secureHeaders`, `requestId`, and `rateLimit`.

<!-- daloy-minimal:strip-start books -->

- A health route and contract-first `/books/:id` route with Zod validation.

<!-- daloy-minimal:strip-end books -->

- Minimal permissions: `--allow-net --allow-env --allow-read` for `dev`.

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
