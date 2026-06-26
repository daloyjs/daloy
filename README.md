<p align="center">
  <a href="https://daloyjs.dev">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://daloyjs.dev/assets/banner-x-1500x500.png">
      <img alt="DaloyJS — Contract-first REST APIs for Node · Bun · Deno · Workers · Edge" src="https://daloyjs.dev/assets/banner-light-1280x426.png" width="100%">
    </picture>
  </a>
</p>

# DaloyJS

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/daloyjs/daloy/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/daloyjs/daloy/actions/workflows/ci.yml)
[![CodeQL](https://github.com/daloyjs/daloy/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/daloyjs/daloy/actions/workflows/codeql.yml)
[![Publish](https://github.com/daloyjs/daloy/actions/workflows/release.yml/badge.svg)](https://github.com/daloyjs/daloy/actions/workflows/release.yml)
[![Zizmor](https://github.com/daloyjs/daloy/actions/workflows/zizmor.yml/badge.svg?branch=main)](https://github.com/daloyjs/daloy/actions/workflows/zizmor.yml)
[![GitHub last commit](https://img.shields.io/github/last-commit/daloyjs/daloy)](https://github.com/daloyjs/daloy/commits/main)
[![npm version](https://img.shields.io/npm/v/@daloyjs/core)](https://www.npmjs.com/package/@daloyjs/core)
[![JSR](https://jsr.io/badges/@daloyjs/daloy)](https://jsr.io/@daloyjs/daloy)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/13058/badge)](https://www.bestpractices.dev/projects/13058)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/daloyjs/daloy/badge)](https://securityscorecards.dev/viewer/?uri=github.com/daloyjs/daloy)
[![Security Responsible
Disclosure](https://img.shields.io/badge/Security-Responsible%20Disclosure-yellow.svg)](https://github.com/daloyjs/daloy/blob/main/SECURITY.md)

> A **runtime-portable TypeScript web framework** with built-in **contract-first routing**, **validation**, **OpenAPI (Hey API)**, **typed client generation**, **large-scale maintainability**, and **security-focused runtime plus supply-chain posture**.

**One-line API docs.** `new App({ openapi: { info: ... }, docs: true })` auto-mounts `GET /docs` (Scalar), `GET /openapi.json`, and `GET /openapi.yaml` — the same DX as FastAPI, without leaving TypeScript.

DaloyJS is maintained in the GitHub organization at <https://github.com/daloyjs>; the canonical framework repository is <https://github.com/daloyjs/daloy>.

---

## Built for the vibe-coding era

Most backend code is now written with AI. Non-developers describe an app and ship whatever the model produces; engineers let agents install dependencies, run tests, and open PRs. The code works on the happy path and gets deployed within the hour — usually with no body limits, skippable input validation, admin routes left mounted on the public app, and an outbound `fetch` that will happily call cloud-metadata endpoints. At the same time, the dependency tree itself has become the attack surface: self-replicating npm worms, malicious `postinstall` scripts, CI cache-poisoning, and **slopsquatting** — where an attacker pre-registers a package name an AI assistant is likely to hallucinate.

DaloyJS is built for exactly this moment, from two directions at once:

- **A secure-by-default runtime.** Body limits, prototype-pollution-safe JSON, path-traversal rejection, request timeouts, header-injection guards, real `405`s, and RFC 9457 problem+json with prod-mode redaction are on in the constructor — the dangerous things are off when nobody remembered to turn them off. The app also *refuses to boot* on unsafe configuration (wildcard CORS with credentials, weak session secrets, a state-changing session route with no CSRF protection, unconfigured `X-Forwarded-*` in production).
- **A hardened supply chain.** `@daloyjs/core` ships **zero runtime dependencies**, is published with npm provenance and CycloneDX + SPDX SBOMs, and the pnpm posture (`ignore-scripts`, a 24-hour release-age cooldown, source-verified lockfiles) plus the CI `verify:*` gates shrink the blast radius of the campaigns making headlines.

The point is that none of this costs you developer experience or portability: you keep contract-first DX in the league of ts-rest, Elysia, and FastAPI, and Hono-grade portability across Node, Bun, Deno, Workers, Vercel, Fastly, and Lambda. The secure path is simply the path of least resistance. See [Vibe Coding Security: what DaloyJS already blocks](https://daloyjs.dev/blog/vibe-coding-security-what-daloyjs-already-blocks) and the [security docs](https://daloyjs.dev/docs/security).

---

DaloyJS exists to be the framework you'd build if you took the best ideas from each modern stack:

| You want                                                | Today's best-of                                       | What DaloyJS gives you                                                                                                                               |
| ------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Best **OpenAPI ergonomics**                                | [FastAPI](https://fastapi.tiangolo.com)                               | OpenAPI 3.1 from a single route definition; `docs: true` mounts `/docs` and `/openapi.json`.                          |
| Best **Vercel / serverless / edge fit**                    | [Hono](https://hono.dev/docs/)                                        | Web-standard `Request → Response` core with adapters for Node, Bun, Deno, Cloudflare, Vercel, Fastly, and Lambda.     |
| Mature **Swagger / docs / ops** in Node                    | [Fastify](https://fastify.dev/docs/latest/Reference/)                 | Encapsulated plugins, structured logger, graceful shutdown, request ids, and lifecycle hooks — all first-party.       |
| Modern **TS-first DX**, Bun acceptable                     | [Elysia](https://elysiajs.com/at-glance.html)                         | End-to-end typed handlers, typed context, and a typed in-process client — no codegen step required.                   |
| Best-in-class **typed client codegen** for any consumer    | [Hey API](https://heyapi.dev/openapi-ts/get-started)                  | One `pnpm gen` command emits a fully-typed fetch SDK from your live OpenAPI spec.                                     |
| **Contract-first typed client, no codegen**                | [ts-rest](https://ts-rest.com/)                                       | Your route definition *is* the contract: an in-process typed client with zero codegen, plus OpenAPI 3.1 + a Hey API SDK for consumers that can't import your types. |
| Opinionated **DI / module architecture** for large teams   | [NestJS](https://docs.nestjs.com/)                                    | Plugin encapsulation, `register()` prefixes, and `defineDependency()` typed-DI with per-request dedup — no decorators. |
| Minimalist **async middleware cascade**                    | [Koa](https://koajs.com/)                                             | Koa-style `Context` on a web-standard core, with validation, OpenAPI, errors, and security headers in-box.            |
| **Services + real-time** API framework                     | [FeathersJS](https://feathersjs.com/)                                 | First-party `app.ws()` with CSWSH refuse-to-boot guards, plus SSE / NDJSON streaming and raw `Response` passthrough (return a Vercel AI SDK stream straight from a handler) over explicit OpenAPI routes.    |
| Battle-tested **Node middleware compatibility**            | [Express v5](https://expressjs.com/en/blog/2024-10-15-v5-release)     | Regex-free trie router, schema-validated routes, RFC 9457 problem+json, and refuse-to-boot guards on every runtime.   |
| **Portable supply-chain hardening** for the apps you build | [pnpm](https://pnpm.io/motivation) defaults + a zero-runtime-dep core | Hardened `.npmrc`, source-verified lockfiles, zero runtime deps, CycloneDX + SPDX SBOM, and npm provenance attestations. |

```
framework test suite passing · ≥90% line + function coverage / ≥90% branch coverage · typechecks on TypeScript 6 with `strict: true`
runs on Node, Bun, Deno, Cloudflare, Vercel
~12.3M static-route ops/sec · ~1.5M dynamic-route ops/sec on M-class CPU
```

---

## Why a new framework?

Each existing stack is excellent at one thing and forces tradeoffs everywhere else:

- Hono is small and portable but OpenAPI is a plugin afterthought.
- Elysia has gorgeous typing but pulls you toward Bun.
- Fastify has the best Node ops story but is Node-only and validation/types/docs are not unified.
- FastAPI has the best docs ergonomics — but it's Python.
- Hey API gives you the best typed client — but you still need a server that produces a clean spec.
- ts-rest gives lovely end-to-end types from a shared contract — but it rides on top of another server (Express/Fastify/Nest/Next), its safety is TypeScript-only, and OpenAPI and security are bring-your-own.
- npm leaves supply-chain protection up to you.

DaloyJS combines the wins:

1. **Explicit contracts, minimal ceremony.** One `app.route({...})` is the source of truth for validation, types, OpenAPI, the typed client, and contract tests.
2. **One source of truth for validation, typing, and docs** via [Standard Schema](https://github.com/standard-schema/standard-schema) — Zod 4 / Valibot / ArkType / TypeBox all work, no lock-in.
3. **Portable core, optional runtime optimizations** — the only thing the core knows is `Request → Response`. Adapters live at the edge.
4. **Security guardrails by default — bad defaults are bugs.** The core enforces body limits, prototype-pollution-safe JSON, path-traversal rejection, request timeouts, content-type checks, and RFC 9457 problem+json errors with prod-mode redaction. First-party middleware covers Helmet-grade headers, CORS, CSRF, rate limits, request ids, and signed-cookie sessions.
5. **Tooling and inspectability over magic.** `app.introspect()` is a public API; contract-test runner is built in.
6. **Optimize for large-team maintenance**, not only solo-dev speed. Encapsulated plugins, decorators, request ids, structured logger.

---

## Get started

For a new DaloyJS project, the recommended path is the official scaffolder:

```bash
pnpm create daloy@latest my-api
# or
npm  create daloy@latest my-api

# add GitHub Actions + governance files for a company repo
pnpm create daloy@latest my-api --with-ci --code-owner @acme/security
```

`create-daloy` gives you a working project structure, runtime template selection, docs routes, OpenAPI wiring, production-oriented defaults, and an optional hardened GitHub security bundle without copying code out of the README.

See [Scaffold a project](https://daloyjs.dev/docs/scaffolder) for templates and flags.

## Install core manually

DaloyJS is distributed via **pnpm** for [supply-chain hygiene](https://pnpm.io/motivation) and backed by a hardened release pipeline — strict isolation, content-addressable store, deterministic lockfile, no phantom dependencies, SHA-pinned CI actions, npm staged publishing, and provenance attestations.

```bash
pnpm add @daloyjs/core zod@^4
```

Zod 4 is the recommended validator for new DaloyJS apps because it is modern, smaller, and Standard-Schema-compatible. DaloyJS still accepts any Standard Schema validator, so teams can use Valibot, ArkType, TypeBox, or another compatible schema library when that better fits their stack.

The repo ships an [`.npmrc`](.npmrc) with hardened defaults:

```ini
ignore-scripts=true
minimum-release-age=1440
strict-peer-dependencies=true
prefer-frozen-lockfile=true
verify-store-integrity=true
provenance=true
```

These defaults block transitive lifecycle scripts, wait 24 hours before resolving freshly published versions, verify the pnpm store, and require provenance on publish. The few dependencies that truly need install-time builds are allowlisted in [`pnpm-workspace.yaml`](pnpm-workspace.yaml) under `allowBuilds` (currently `esbuild` only), and CI runs `pnpm verify:lockfile` to reject git dependency sources and non-registry tarball URLs in `pnpm-lock.yaml`.
The same defaults blunt **[slopsquatting](https://www.aikido.dev/blog/slopsquatting-ai-package-hallucination-attacks)** — the supply-chain attack where an AI coding assistant hallucinates a package name (`request-promise-native2`, `@types/fastify-helmet`, etc.) and an attacker registers it on npm with a malicious payload. `minimum-release-age=1440` refuses to install anything published in the last 24 hours (the typical detect-and-unpublish window), `ignore-scripts=true` suppresses lifecycle payloads, `blockExoticSubdeps: true` and `pnpm verify:lockfile` reject non-registry sources, `pnpm verify:known-dep-names` ([`scripts/verify-known-dep-names.ts`](scripts/verify-known-dep-names.ts)) refuses any top-level dep name across the workspace that is not on an explicit allowlist (so `pnpm add <hallucinated-name>` cannot land in any `package.json` without a one-line diff that forces a name-review checkpoint), and `@daloyjs/core`'s zero-runtime-dep posture means a hallucinated dep cannot transitively land in the published tarball. See [SECURITY.md § Slopsquatting](SECURITY.md#slopsquatting--ai-package-hallucination-aikido-2025-pattern) for the full mapping.

Run `pnpm audit --prod` regularly (or `pnpm run audit` in this repo) — and `pnpm install --frozen-lockfile --ignore-scripts` in CI.

---

## SBOM + release automation

Daloy ships a CycloneDX 1.5 + SPDX 2.3 SBOM for both `@daloyjs/core` and `create-daloy`.

If you want to run the SBOM flow locally, the two commands are:

```bash
pnpm gen:sbom
pnpm verify:sbom
```

`pnpm gen:sbom` regenerates the publishable SBOM files for both packages. `pnpm verify:sbom` checks that the generated SBOMs match the current package manifests and that `@daloyjs/core` still declares zero runtime dependencies.

You do **not** need to remember to run those commands manually for CI or publish:

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs `pnpm gen:sbom` and `pnpm verify:sbom` on every push to `main` and every PR.
- [`.github/workflows/release.yml`](.github/workflows/release.yml) reruns `pnpm gen:sbom` and `pnpm verify:sbom` before either npm staged-publish job is allowed to proceed.

That means a release will fail before publish if the SBOMs are missing, stale, or inconsistent with `package.json`.
The workflow stages releases on npm instead of making them installable immediately, so a maintainer still has to review the stage ID and approve it with npm MFA.

For maintainers, the safe rule is: use one publish path per version. Either publish through the protected GitHub release workflow, or publish locally for an exceptional case, but do not do both for the same version.

---

## Hello world

```ts
import { z } from "zod";
import {
  App,
  NotFoundError,
  secureHeaders,
  rateLimit,
  requestId,
} from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const app = new App({ bodyLimitBytes: 1024 * 1024, requestTimeoutMs: 5_000 });

// First-party security middleware — usually three plugins in other frameworks.
app.use(requestId());
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

app.route({
  method: "GET",
  path: "/books/:id",
  operationId: "getBookById",
  tags: ["Books"],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: "Found",
      body: z.object({ id: z.string(), title: z.string() }),
    },
    404: { description: "Not found" },
  },
  handler: async ({ params }) => ({
    status: 200,
    body: { id: params.id, title: `Book ${params.id}` },
  }),
});

serve(app, { port: 3000 });
```

---

## OpenAPI + Hey API typed client

DaloyJS produces a clean OpenAPI 3.1 document with **zero plugins**, then [@hey-api/openapi-ts](https://heyapi.dev/openapi-ts/get-started) turns that into a fully typed TypeScript SDK that any consumer (your web app, mobile RN bundle, internal CLI) can drop in.

```bash
pnpm gen          # writes generated/openapi.json + generated/client/
```

That single command runs the two scripts:

```jsonc
// package.json
"scripts": {
  "gen:openapi": "node --import tsx scripts/dump-openapi.ts",
  "gen:client":  "openapi-ts",
  "gen":         "pnpm gen:openapi && pnpm gen:client"
}
```

`openapi-ts.config.ts`:

```ts
import { defineConfig } from "@hey-api/openapi-ts";
export default defineConfig({
  input: "./generated/openapi.json",
  output: { path: "./generated/client", postProcess: ["prettier"] },
  plugins: ["@hey-api/client-fetch", "@hey-api/typescript", "@hey-api/sdk"],
});
```

For TypeScript consumers in the same monorepo you can skip codegen entirely and use the **in-process typed client**:

```ts
import { createClient } from "@daloyjs/core/client";
const client = createClient(app, { baseUrl: "http://localhost:3000" });
const r = await client.getBookById({ params: { id: "1" } });
//    ^? { status: 200; body: { id: string; title: string } } | { status: 404; ... }
```

> Method inference relies on **chaining** your `app.route(...)` calls (`new App().route(a).route(b)`) and letting
> TypeScript infer the variable's type. A widening `const app: App` annotation, a `: App` factory return type, or
> registering routes as separate statements erases the per-route types and collapses the client to an untyped surface.

---

## Built-in docs UI (Scalar / Swagger UI / Redoc)

FastAPI-style. One line on the `App` constructor mounts `GET /docs`, `GET /openapi.json`, and `GET /openapi.yaml` for you,
with a strict CSP and CDN-hosted assets:

```ts
import { App } from "@daloyjs/core";

const app = new App({
  openapi: { info: { title: "My API", version: "1.0.0" } },
  docs: true, // mounts GET /docs (Scalar), GET /openapi.json, GET /openapi.yaml
});
```

Use `docs: "auto"` to mount only when `production: false`, or the object form for full control:

```ts
new App({
  openapi: { info: { title: "My API", version: "1.0.0" } },
  docs: {
    ui: "scalar", // "scalar" (default) | "swagger" | "redoc"
    path: "/reference",
    openapiPath: "/spec.json",
    openapiYamlPath: "/spec.yaml", // or `false` to disable the YAML route
    scalar: {
      theme: "kepler",
      customCss: ":root { --scalar-color-accent: #2563eb; }",
      hideTestRequestButton: true,
    },
    swagger: {
      docExpansion: "none",
      displayRequestDuration: true,
    },
    tags: ["Docs"],
  },
});
```

Switch UIs with one word. Scalar and Swagger UI include developer request
consoles for authenticated endpoints: Scalar selects the first configured
OpenAPI security scheme by default, and Swagger UI keeps values from the
Authorize dialog across reloads. `ui: "redoc"` renders Redoc instead, and its
options are forwarded to `Redoc.init` via `docs.redoc`; Redoc displays security
requirements but is a read-only reference UI, not a Try It console:

```ts
new App({
  openapi: { info: { title: "My API", version: "1.0.0" } },
  docs: {
    ui: "redoc",
    redoc: { hideDownloadButtons: true, sortPropsAlphabetically: true },
  },
});
```

The `scalar` option is forwarded to Scalar's HTML API as JSON configuration,
with Daloy keeping the live `openapiPath` as the source. Use it for themes,
custom CSS, layout, auth defaults, and client visibility without copying the
HTML helper. The `swagger` option is forwarded to `SwaggerUIBundle` with Daloy
owning `url` / `dom_id`. Redoc spins up a `blob:` Web Worker for search, so the
auto-mounted `/docs` page widens its CSP with `worker-src 'self' blob:` for
`ui: "redoc"` only — Scalar and Swagger UI keep the tighter default.

Prefer to mount manually? Import the helpers directly:

```ts
import { swaggerUiHtml, scalarHtml, redocHtml, htmlResponse } from "@daloyjs/core/docs";
import { generateOpenAPI } from "@daloyjs/core/openapi";
```

The UI is always contract-accurate — never stale. `create-daloy` templates opt in with `docs: true`.

If you omit `openapi.info.title` / `info.version`, Daloy reads your project's `package.json` (`name`, `version`, `description`) automatically — no boilerplate. Deno projects without a `package.json` fall back to `deno.json` / `deno.jsonc`. Explicit values always win.

Prefer a factory? `createApp(options)` is exported as an alias of `new App(options)`.

```ts
import { createApp } from "@daloyjs/core";

const app = createApp({ docs: true });
```

### `daloy dev` — one-command watch mode

`daloy dev [entry]` delegates to the host runtime's native watch tool, with no extra config:

| Runtime | Spawned command                                                 |
| ------- | --------------------------------------------------------------- |
| Node    | `node --import tsx --watch <entry>`                             |
| Bun     | `bun --hot <entry>`                                             |
| Deno    | `deno run --watch --allow-net --allow-env --allow-read <entry>` |

Entry defaults to `src/index.ts`, `src/main.ts`, `src/server.ts`, or `src/app.ts`. Install `tsx` as a dev dependency on Node for TypeScript entries.

Pass `--runtime <node|bun|deno>` to override runtime detection. This is required when running `daloy dev` from a `package.json` script on Bun or Deno, because the CLI binary's `#!/usr/bin/env node` shebang otherwise forces Node detection. The `bun-basic` template ships `"dev": "daloy dev --runtime bun"` for this reason.

---

## Security guardrails

Some protections are enforced by the `App` core whenever the relevant request
path is used. Others are first-party middleware so applications can choose the
right CORS policy, rate-limit key, CSP, session secret, or CSRF rollout for their
deployment.

| Threat                           | Built-in behavior                                                                                                                                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Body-size DoS**                | Core-enforced streamed read with a hard cap (default 1 MiB); `Content-Length` checked first.                                                                                                                          |
| **Prototype pollution**          | Core JSON parser strips `__proto__` / `constructor` / `prototype` via reviver.                                                                                                                                        |
| **Header / response splitting**  | Core header sanitizers reject CRLF + NUL.                                                                                                                                                                             |
| **Path traversal**               | Core router rejects `..` segments and `//` before walking.                                                                                                                                                            |
| **Slow-loris / hung handlers**   | Core `requestTimeoutMs` aborts handlers (default 30 s); Node adapter sets `requestTimeout` + `headersTimeout` + `maxHeaderSize`.                                                                                      |
| **HTTP/2 Bomb / header-count flood** | Core `maxHeaderCount` rejects requests with more than 100 header fields (`431`) before routing; Node adapter sets `server.maxHeadersCount`. See [SECURITY.md](SECURITY.md) for the upstream HTTP/2 mitigations.   |
| **MIME sniffing**                | First-party `secureHeaders()` sets `X-Content-Type-Options: nosniff`; scaffolded apps enable it.                                                                                                                      |
| **Clickjacking**                 | First-party `secureHeaders()` sets `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`; scaffolded apps enable it.                                                                                                 |
| **XSS via injected scripts**     | First-party `secureHeaders()` provides a strict CSP `default-src 'self'` baseline; the directives-object form supports per-request **nonces** and **Trusted Types** (`require-trusted-types-for 'script'`).           |
| **Cross-origin leakage**         | First-party `secureHeaders()` sets `cross-origin-opener-policy` + `cross-origin-resource-policy` to `same-origin`; scaffolded apps enable it.                                                                         |
| **CSRF**                         | First-party `csrf()` ships two strategies: **double-submit cookie** (default) and **Fetch-Metadata** (`Sec-Fetch-Site`-based, tokenless); both with timing-safe verification.                                         |
| **Information disclosure (5xx)** | Production mode strips `detail` from 5xx problem+json automatically.                                                                                                                                                  |
| **Credential timing attacks**    | First-party `timingSafeEqual()` helper for tokens & signatures.                                                                                                                                                       |
| **Brute-force / scraping**       | First-party `rateLimit()` with token-bucket + `Retry-After`; Node/Bun/Deno scaffolded apps enable it.                                                                                                                 |
| **Method confusion**             | Real **405** with `Allow` header, not a misleading 404.                                                                                                                                                               |
| **CORS misconfig**               | First-party `cors()` requires an explicit allowlist and throws for `*` with credentials.                                                                                                                              |
| **Request correlation**          | First-party `requestId()` uses cryptographic ids; scaffolded apps enable it.                                                                                                                                          |
| **Supply chain (portable)**      | pnpm scaffolds keep `ignore-scripts=true`, `minimum-release-age=1440`, verified store, reproducible lockfile, and `pnpm verify:lockfile` source verification; every app also installs a zero-runtime-dependency `@daloyjs/core` published with CycloneDX + SPDX SBOM and npm provenance you can verify on install — regardless of where you host your repo. |

**Portable vs. GitHub-only.** The runtime protections and the published `@daloyjs/core` SBOM/provenance travel with every app you scaffold, no matter which CI host you use — GitLab, Bitbucket, Azure DevOps, Jenkins, on-prem, or laptop. The strongest install-time bundle is available when you choose pnpm, because `minimum-release-age`, `blockExoticSubdeps`, and the workspace gates are pnpm features. The **`@daloyjs/core` release pipeline itself** is separately hardened on GitHub Actions — no `pull_request_target`, no Actions cache, top-level `permissions: {}`, `step-security/harden-runner`, a protected `release.yml`, npm trusted publishing with `--provenance`, CodeQL + Opengrep dual SAST, OpenSSF Scorecard, zizmor, Dependabot, and CODEOWNERS — and `create-daloy --with-ci` ships the app-safe parts as an **optional GitHub Actions bundle** for teams on GitHub. See [SECURITY.md](SECURITY.md) and the [supply-chain security docs](https://daloyjs.dev/docs/security/supply-chain).

---

## Authentication, OAuth2 & OpenID Connect

DaloyJS is a **resource server** (and a toolkit for building a relying party),
**not** an identity provider. Like Hono, Express, Fastify, or ASP.NET Core, it
*verifies* and *enforces* tokens on each request — it does **not** ship a login
UI, a user database, or an OAuth2 authorization server. It is **not** an
"IdentityServer": it cannot, on its own, do what Duende IdentityServer,
Keycloak, or Auth0 do (run login pages, manage clients/consent, mint tokens).

To add login you bring an **OpenID Connect provider**. It does not have to be
Auth0/Okta/Clerk specifically — any standards-compliant IdP works, including
managed (Auth0, Okta, Clerk, Microsoft Entra ID, AWS Cognito) and **self-hosted
open source** (Keycloak, Zitadel, Ory, Authentik, Logto, SuperTokens, Dex).
Don't build your own authorization server — verify tokens from a vetted one.

- **API as a resource server (default):** verify JWTs with `jwk()` against the
  provider's JWKS (asymmetric-only algorithm allowlist, `issuer`/`audience`
  enforced), then authorize per route with `requireScopes()`.
- **Browser app:** use the back-end-for-frontend (BFF) pattern — run the
  authorization-code + PKCE flow server-side, keep tokens in a `session()`
  cookie (never in JavaScript), and protect mutations with `csrf()`.

Read [Auth architecture: where DaloyJS fits in OAuth2 & OpenID Connect](https://daloyjs.dev/docs/auth/architecture)
for the full picture, plus the per-provider guides under [`/docs/auth`](https://daloyjs.dev/docs/auth).

---

## Performance

```text
$ pnpm bench
static route lookup        12,363,799 ops/sec
dynamic 4-segment lookup    1,513,983 ops/sec
miss                        4,763,878 ops/sec
```

- Static (no-param) routes resolve via a single `Map.get` — **~12M ops/sec**.
- Dynamic routes walk a trie, **O(path-segments)** regardless of route count.
- Body parsing is lazy and only runs when a route declares a body schema.
- No regex on the hot path.

### Cold-start tip (serverless / edge)

For deployments where every millisecond of startup matters (Lambda, Vercel, Cloudflare Workers, Fastly Compute), import `App` from the deep entry point instead of the barrel:

```ts
import { App } from "@daloyjs/core/app";   // ~13 ms faster cold start than "@daloyjs/core"
import { serve } from "@daloyjs/core/node";
```

`@daloyjs/core/app` resolves to the **same `App` class with the same secure-by-default constructor** — `secureHeaders`, `requestId`, body limits, request timeouts, `fetchGuard`, prototype-pollution guards, problem+json redaction, and every other guardrail are still wired automatically. The deep import only skips loading unrelated peripheral modules (`jwk`, `jwt`, `multipart`, `websocket`, `streaming`, `compression`, `subdomains`, etc.) that the barrel re-exports for convenience. If you use any of those, import them directly from their own subpaths (`@daloyjs/core/jwk`, `@daloyjs/core/multipart`, …) so each one is paid for only when used.

Long-lived Node servers will not notice the difference. This is purely a cold-start optimization for serverless.

---

## Test client + contract tests

```ts
const res = await app.request("/books/1");

import { runContractTests } from "@daloyjs/core/contract";
const report = await runContractTests(app);
if (!report.ok) process.exit(1);
```

The contract runner verifies that declared examples actually match their schemas, flags duplicate/missing operationIds, dead routes, and accidental body schemas on safe methods.

Gate it in CI two ways: `daloy inspect --check <entry>` exits non-zero on any error-level issue, or assert `report.ok` inside your test suite. **Every `create-daloy` template ships a contract-gate test** (`tests/contract.test.ts`, `tests/contract_test.ts` on Deno) wired into its `test` task, so scaffolded projects fail CI on a broken contract out of the box. For a localhost-only gate that runs before code leaves your machine, each template also ships an opt-in `pre-push` hook (`.githooks/pre-push`, enabled with `hooks:install` which points `core.hooksPath` at it); it runs `daloy inspect --check` on every `git push` and is bypassable with `git push --no-verify`.

---

## Plugin encapsulation (Fastify-style)

```ts
const usersPlugin = {
  name: "users",
  register(app) {
    app.route({
      method: "GET",
      path: "/me",
      operationId: "me",
      responses: { 200: { description: "ok" } },
      handler: async () => ({ status: 200, body: { user: "alice" } }),
    });
  },
};
app.register(usersPlugin, { prefix: "/users", tags: ["Users"] });
await app.ready();
```

---

## Multi-runtime

```ts
import { serve } from "@daloyjs/core/node"; // Node (Heroku, Railway, Render, Fly.io, any PaaS)
import { serve } from "@daloyjs/core/bun"; // Bun
import { serve } from "@daloyjs/core/deno"; // Deno
import { toFetchHandler } from "@daloyjs/core/cloudflare"; // Cloudflare Workers
import {
  toFetchHandler as toVercelFetchHandler,
  toRouteHandlers,
  toWebHandler,
} from "@daloyjs/core/vercel"; // Vercel Node / Edge / Next.js / Netlify Edge
import { installFastlyListener } from "@daloyjs/core/fastly"; // Fastly Compute
import { toLambdaHandler } from "@daloyjs/core/lambda"; // AWS Lambda / Netlify Functions / Lambda Function URLs
```

The core only ever sees `Request → Response`. Adapters live at the edge.

---

## References

- Hey API — typed OpenAPI client codegen: <https://heyapi.dev/openapi-ts/get-started>
- Hono — portable web-standard router: <https://hono.dev/docs/>
- Elysia — TS-first DX & typed context: <https://elysiajs.com/at-glance.html>
- Fastify — production Node web framework: <https://fastify.dev/docs/latest/Reference/>
- ts-rest — contract-first, RPC-like client/server over REST: <https://ts-rest.com/>
- pnpm — strict, secure, content-addressable package manager: <https://pnpm.io/motivation>
- Standard Schema — universal validator interface: <https://github.com/standard-schema/standard-schema>
- RFC 9457 — Problem Details for HTTP APIs: <https://www.rfc-editor.org/rfc/rfc9457>

---

## Status

DaloyJS is now in the **`1.0.0` beta** (`1.0.0-beta.4`). The public API is feature-complete and stable for the 1.0 line; from `1.0.0` onward, breaking changes follow SemVer and deprecations get at least one minor cycle. Small adjustments are still possible before the `1.0.0` GA if beta feedback surfaces something. The framework is already in use for production trials.

**Release quality bar.** Every release ships with **≥90% line + function coverage and ≥90% branch coverage**, strict TypeScript, OpenSSF Scorecard, CodeQL + Opengrep dual SAST, zizmor workflow linting, and npm provenance. Coverage was relaxed from a former 100% gate so complex security work isn't blocked chasing throwaway tests for unreachable defensive branches or tsx source-map phantoms; see [AGENTS.md](AGENTS.md) for the policy.

### Routing, validation, and docs

- Contract-first routing with Standard Schema validation (Zod 4, Valibot, ArkType, TypeBox) and OpenAPI 3.1 generated from a single source of truth.
- Live OpenAPI 3.1 spec served as both JSON (`GET /openapi.json`) and YAML (`GET /openapi.yaml`) when `docs: true`, with a choice of Scalar (default), Swagger UI, or Redoc via `docs.ui`, plus Scalar theming/custom CSS/auth defaults via `docs.scalar`, Swagger UI options via `docs.swagger` (including persisted Authorize credentials), and Redoc options via `docs.redoc`.
- Zero-config OpenAPI `info` autofill from `package.json` (Node / Bun) or `deno.json` / `deno.jsonc` (Deno); explicit `openapi.info` values always win.
- RFC 7231 + RFC 5789 HTTP-method allowlist enforced inside `app.route()` (WebDAV, `TRACE`, `CONNECT` rejected at the framework boundary).
- AI-friendly route metadata via optional `meta: { examples, extensions, summary, description, tags }`; examples are validated against your schemas at build time, surfaced as OpenAPI `examples` + `x-daloy-*` extensions, and dumped as `routes.json` / `routes.yaml` via `daloy inspect --ai`.
- API lifecycle and breaking-change detection: mark routes `deprecated` or give them a `sunset` date to emit RFC 8594 `Deprecation` / `Sunset` headers and an `x-sunset` OpenAPI extension, then gate CI with `diffOpenAPI()` / the `daloy diff` command, which fail on a breaking change versus the last published spec.
- In-process test client (`app.request()`), contract-test runner (gated in CI via `daloy inspect --check` and shipped as a default test in every `create-daloy` template), in-process typed client, and Hey API codegen via `pnpm gen`.

### Runtimes and deployment

- Adapters for Node (Heroku, Railway, Render, Fly.io), Bun, Deno, Cloudflare Workers, Vercel Node / Edge / Next.js / Netlify Edge, Fastly Compute, and AWS Lambda / Netlify Functions / Lambda Function URLs.
- `daloy dev` watch loop delegates to the host runtime's native watcher (`node --import tsx --watch`, `bun --hot`, or `deno run --watch`) with a `--runtime` override for cross-runtime `package.json` scripts.
- `pnpm create daloy` scaffolder with Node, Bun, Deno, Cloudflare Worker, and Vercel templates, plus optional `--with-ci` GitHub Actions / Dependabot / CODEOWNERS / SECURITY.md hardening. The completion summary surfaces official install links (nodejs.org, pnpm.io, bun.sh) for any runtime or package manager your selections need but that is missing from `PATH`, and skips a doomed dependency install when the chosen package manager is absent.
- Container-first templates: `HEALTHCHECK` to `/readyz`, `STOPSIGNAL SIGTERM`, non-root user, `tini` as PID 1.
- Generated `deploy.yml` for container templates signs every pushed GHCR image with **Sigstore Cosign** (keyless OIDC) and attaches an **SPDX SBOM attestation** so consumers can `cosign verify` and `cosign verify-attestation --type spdxjson` instead of trusting the registry alone.
- Pretty `printStartupBanner()` / `formatStartupBanner()` helpers at `@daloyjs/core/banner`, used by every starter template (TTY + `NO_COLOR` / `FORCE_COLOR` aware, ASCII fallback for dumb terminals).

### Core security primitives

- Body limits, prototype-pollution-safe JSON, path-traversal guard, request timeouts, header injection guards.
- Request-smuggling defense: duplicate `Host`, `Content-Length`, and `Transfer-Encoding` headers are rejected.
- `Server` and `X-Powered-By` headers stripped by default.
- Structured-log redaction defaults for authorization, cookie, password, token, and JWT-shaped values.
- `secureHeaders()` auto-applied; user-installed instances automatically replace the auto one.
- Cross-origin state-changing requests rejected with `403` unless a route's `cors()` policy allows the origin.
- Production mode strips `detail` from 5xx problem+json automatically.
- Real **405** with `Allow` header instead of a misleading 404.
- `Cache-Control: no-store` baked into `UnauthorizedError` / `ForbiddenError` / `TooManyRequestsError` so every first-party auth 401 / 403 / 429 response is uncacheable.

### Refuse-to-boot guardrails

The framework refuses to start (or to construct) when configuration is unsafe:

- Weak session secrets, `cors({ origin: "*" })` with credentials, `session()` + state-changing route without `csrf()`, and unconfigured `X-Forwarded-*` in production.
- `secureDefaults: false` in production unless `acknowledgeInsecureDefaults: true` is set, plus a once-per-process `error` log naming every disabled default.
- `preset: "internal-service"` topology preset for service-to-service deployments behind a mesh / sidecar / private network: turns OFF the browser-only guards (auto `secureHeaders`, `corsCrossOriginGuard`, `csrf` boot guard, unconfigured `X-Forwarded-*` guard) while keeping every input, parser, credential, SSRF, weak-secret, and refuse-to-boot guard ON. Per-knob options still win, the choice is logged at boot under `event: "security.preset.applied"`, and the live posture is auditable via `app.getSecurityPosture()`.
- `createJwtSigner()` / `createJwtVerifier()` refuse `alg: "none"`, accept only an explicit allowlist, refuse HS + JWK combinations, refuse to sign without `exp`, and refuse HS-shaped secrets under 32 bytes (RFC 7518 §3.2).
- `secureHeaders()` refuses to construct with `frameOptions: false` AND no CSP `frame-ancestors` directive (no clickjacking defense).
- `cors()` refuses `methods: ['*']` at construction; default `allowMethods` narrowed to `[GET, HEAD, POST]` so `PUT` / `PATCH` / `DELETE` become explicit opt-ins.
- `cspReportRoute()` refuses non-`application/json` (415) and refuses `maxBodyBytes > 64 KiB` at construction. The default production logger sink omits the parsed report body unless `logCspReportBodies: true` is set explicitly.
- `session()` and `csrf()` refuse cookies that violate the `__Secure-` prefix policy.
- Plugin `dependencies: string[]` refuse-to-boot when a prerequisite is missing; `topoSortExtensions()` refuses cycles, and refuses two extensions declaring overlapping `responseHeaders` without a `before` / `after` relationship.
- `app.ws()` scans the effective hook stack and refuses-at-registration when header-mutating middleware (`secureHeaders()`, `cors()`, `csrf()`, `compression()`) is present, unless the handler opts in via `acknowledgeHeaderMutatingMiddleware: true`.

### First-party middleware

- `secureHeaders` with strict CSP baseline, per-request **nonces**, **Trusted Types** (`require-trusted-types-for 'script'`), `frame-ancestors`, `cross-origin-opener-policy` / `cross-origin-resource-policy`, and reporting endpoints.
- `cors` with explicit-allowlist enforcement.
- `csrf` with **double-submit cookie** (default) and **Fetch-Metadata** (`Sec-Fetch-Site`-based, tokenless) strategies; timing-safe verification.
- `rateLimit` with token-bucket + `Retry-After`, shared `groupId` buckets, and a Redis-backed store at `@daloyjs/core/rate-limit-redis`.
- `loadShedding()` event-loop-pressure middleware (auto-`503` + `Retry-After`).
- `loginThrottle()` credential-entry preset and `rotateSession()` privilege-change session rotation.
- `ipRestriction()` with CIDR-aware IPv4 / IPv6 allow / deny lists.
- `combine` primitives: `every`, `some`, `except`.
- `requestId()` with cryptographic ids; `trustIncoming: false` by default so client-supplied `X-Request-ID` headers cannot poison logs.
- `bearerAuth()` and `basicAuth()` with per-scheme `verify(credentials, ctx)` revalidation hooks, typed-context `onAuthSuccess` callback, and `Cache-Control: no-store` on every 401 challenge.
- `jwk()` asymmetric-only JWKS middleware: refuses `HS*` at construction, cross-checks `kid` and JWT-vs-JWK `alg`, requires `https://` JWKS URLs with TTL caching + in-flight-promise dedup, normalizes `scope` / `scp` / `scopes` claims.
- `requireScopes()` with RFC-6750 `WWW-Authenticate: Bearer` challenge and per-request scope aggregation.
- `session()` with signed cookies and pluggable stores.
- `idempotency()` with `Idempotency-Key` fingerprinting + byte-for-byte response replay, in-flight `409`, `422` on key reuse with a different payload, and a pluggable `IdempotencyStore` (in-memory default) at `@daloyjs/core/idempotency`.
- `responseCache()` server-side body cache (cache-key + TTL with `s-maxage`/`max-age` orchestration, request `no-store`/`no-cache` directives, recursion-safe stale-while-revalidate, `Vary`-aware keying, `X-Cache` HIT/MISS/STALE marker, pluggable `ResponseCacheStore` in-memory default) at `@daloyjs/core/response-cache`. Never caches `Set-Cookie` or `private`/`no-store`/`no-cache` responses. Complements `etag()`/`compression()`, which do not cache bodies.
- `paginationQuery()` / `encodeCursor()` / `decodeCursor()` / `buildPageLinks()` / `buildLinkHeader()` cursor-pagination helpers at `@daloyjs/core/pagination`: opaque base64url cursors (length-capped, prototype-pollution-safe decode → `400` on tamper), RFC 8288 `Link` header emission with CRLF / header-injection guards, and a Standard Schema that validates `cursor`/`limit` and auto-wires both into the OpenAPI spec + typed client via `toJSONSchema()`.
- `app.metrics()` + `MetricsRegistry` / `httpMetrics()` Prometheus / OpenMetrics exposition at `@daloyjs/core/metrics`: dependency-free counters / gauges / histograms, RED instrumentation (`http_requests_total`, `http_request_duration_seconds`, `http_requests_in_flight`) plus process gauges, exposition-injection-safe name/label validation, a per-metric cardinality cap, and an opt-in `/metrics` route with the same hardened posture as `app.healthcheck()` (bearer token + `timingSafeEqual`, per-IP rate limit, refuse-to-boot unauthenticated in production). The repo ships an `examples/observability/` Docker Compose stack that starts a pre-configured Prometheus + Grafana pair (with an auto-provisioned RED + heatmap dashboard) against any local app via `docker compose -f examples/observability/docker-compose.yml up`.
- `otelTracing()` OpenTelemetry-compatible distributed tracing at `@daloyjs/core/tracing`: a dependency-free `Hooks` bundle that opens one `SERVER` span per request, attaches HTTP semantic-convention attributes (`http.request.method`, `url.path`, `server.address` / `server.port`, `http.response.status_code`, …), records exceptions + escalates `5xx` to `ERROR`, guarantees a single `span.end()`, and exposes the live span on `ctx.state.otelSpan`. Bring any tracer matching the small `TracingTracer` interface (the real `@opentelemetry/api` SDK on Node, or a custom exporter on Workers/Deno) plus your own propagator via `contextFromRequest` for `traceparent` continuation — no OTel SDK is forced into your install. The `examples/observability/` stack also runs **Jaeger**, and `examples/otel-tracing-demo.ts` ships a ~120-line dependency-free OTLP/HTTP exporter that streams spans straight to it.
- `tenancy()` secure-by-default multitenancy at `@daloyjs/core/tenancy`: a dependency-free `Hooks` bundle that resolves the calling tenant once per request and exposes it on `ctx.state.tenant`. Pluggable resolution (`tenantFromSubdomain` PSL-aware, `tenantFromHeader`, `tenantFromPathPrefix`, `tenantFromClaim`, or a custom `(ctx) => string`, tried in array order). **Refuse-unresolved by default** (no ambient "default" tenant leak), **format-validated ids** (rejects key/log-injection + cache-poisoning payloads before they reach a key), **no-enumeration `404`** for unknown tenants, and **host-spoof-safe** subdomain resolution. A `tenantScope()` key helper drops straight into `rateLimit` `keyGenerator` and `concurrencyLimit` / `idempotency` / `responseCache` `scope` to partition each per tenant (CWE-524 cross-tenant cache defense). Runnable `examples/multitenancy-demo.ts`.
- `resilientFetch()` + `CircuitBreaker` outbound resilience at `@daloyjs/core/fetch-resilience`: a dependency-free circuit breaker (`closed → open → half-open`), retry-with-backoff (exponential + full jitter, idempotent-method/transient-status scoped, honours `Retry-After`), and a per-call timeout (`AbortController` → `FetchTimeoutError`) designed to layer **on top of** `fetchGuard()` — an `SsrfBlockedError` is a terminal refusal that is never retried and never trips the breaker, so SSRF protection stays intact under the resilience layer.
- `createWebhookSender()` + `MemoryWebhookDeadLetterSink` outbound webhook delivery at `@daloyjs/core/webhook-delivery`: the outbound counterpart to `verifyWebhookSignature()` — timestamped HMAC-signed `POST`s (`webhook-id` / `webhook-timestamp` / `webhook-signature`, computed over `"<timestamp>.<body>"` and reused across retries for safe deduping), bounded retry-with-backoff (transient-status + network scoped, honours `Retry-After`), per-attempt timeout, and dead-letter semantics. Transport defaults to `fetchGuard()`, so a subscriber URL pointing at cloud metadata or a private range is refused with a terminal `SsrfBlockedError` (never retried, dead-lettered once). Zero runtime dependencies.
- `app.cron()` + standalone `Scheduler` in-process scheduled tasks at `@daloyjs/core/scheduler`: a queue-agnostic schedule primitive for periodic housekeeping (cache sweeps, token refresh, reconciliation). Fixed intervals or 5-field cron expressions (lists / ranges / steps / named months & days / `@hourly`–`@yearly` aliases / optional IANA `timeZone`), arithmetic cron parsing (no backtracking regex), fixed-rate **single-flight** (overlapping ticks are skipped, never run concurrently), per-run `timeoutMs` with `AbortSignal`, and graceful-shutdown integration (stop arming → await in-flight → abort after grace). Timers are `unref`'d. `parseCron()` / `nextCronRun()` exported standalone. Zero runtime dependencies.
- `clientCertAuth()` mTLS / client-certificate auth at `@daloyjs/core/mtls`: authenticate zero-trust / service-to-service callers by their TLS client certificate from two sources — **native TLS** (the Node adapter lazily reads the peer cert off the socket; plain requests pay nothing) or a **TLS-terminating proxy** (Envoy `X-Forwarded-Client-Cert` and nginx/HAProxy-style structured headers). `requireVerified` by default, exact `allowSubjectCNs` / `allowIssuerCNs`, **constant-time** `allowFingerprints`, `allowSANs` (SPIFFE/DNS/URI/IP, `TYPE:value` or bare), validity-window enforcement, and a custom async `verify()` hook. Missing cert → `401` problem+json with `Cache-Control: no-store`; any failed check → `403` (never echoes cert details). The accepted `ClientCertificate` is stamped on `ctx.state`. `parseForwardedClientCert()` / `normalizePeerCertificate()` exported standalone. Zero runtime dependencies.
- `autoBan()` adaptive auto-ban (fail2ban-style) at `@daloyjs/core/auto-ban`: temporarily ban abusive clients after repeated suspicious responses (default `401` / `403` / `429`, configurable `watchStatuses`) within a rolling `windowMs`. Bans **escalate** exponentially for repeat offenders (`banMs` → `2×` → `4×`, capped at `maxBanMs`) and **decay** once the client goes quiet. Observes the outgoing status via `onSend` (counts failures from any downstream middleware/handler), enforces in `beforeHandle`. Secure-by-default identity attribution — refuses to construct without `keyGenerator` or `trustProxyHeaders` so one offender can never ban everyone; unattributable requests are skipped. Pluggable `AutoBanStore` (mirrors the `rateLimit()` store; in-memory default, Redis-able for multi-instance), `groupId` sharing across route groups, `429`/`403` ban response with `Retry-After`, and `onBan` / `onStrike` hooks. Zero runtime dependencies.
- `botGuard()` bot / User-Agent management at `@daloyjs/core/bot-guard`: the in-app equivalent of Nginx/WAF bot rules. Blocks empty/missing `User-Agent` (default on) and known-abusive `User-Agent` strings / `RegExp`s, and **verifies declared crawlers** — a request claiming to be Googlebot/Bingbot is confirmed via reverse-DNS + forward-confirm (the method Google and Bing document), so a spoofed `User-Agent` can't impersonate a trusted crawler. Ships `GOOGLEBOT` / `BINGBOT` / `WELL_KNOWN_BOTS` presets and accepts custom `VerifiedBotRule`s. Allowlist-first (`allowUserAgents` bypasses every rule), secure-by-default (`verifiedBots` refuses to construct without an IP source; unverifiable crawlers blocked unless `blockUnverifiableBots: false`), subdomain-boundary-safe domain matching, per-IP verification cache to keep DNS off the hot path, `mode: "log"` monitor mode, `onBlock` callback, and a pluggable `BotResolver` (default lazy `node:dns/promises`). Zero runtime dependencies.
- `ipReputation()` IP reputation / dynamic denylist feed at `@daloyjs/core/ip-reputation`: wires pluggable, periodically-refreshed abuse feeds (Tor exit lists, Spamhaus DROP, cloud-abuse ranges, or your own threat intel) into the request path without a redeploy, reusing the same SSRF-grade CIDR matcher as `ipRestriction()`. Ships `urlFeed()` (fetches newline / Spamhaus-DROP-style lists, skips comment lines, keeps good rows from a partially-malformed feed) plus a custom `IpReputationFeed` interface. **Fail-open by design** — a feed that can't be loaded (initial or refresh) never blocks traffic; the last-known-good list is retained per feed. Periodic `unref`'d refresh, `mode: "log"` monitor mode, `onMatch` / `onError` callbacks, manual `refresh()` / `stop()` / `has()` / `size` controller, and pluggable IP resolution (`trustProxyHeaders` / `resolveIp`). Zero runtime dependencies.
- `geoBlock()` GeoIP / geo-blocking at `@daloyjs/core/geo-block`: country allow/deny middleware that maps the client IP to an ISO 3166-1 alpha-2 country and rejects (or logs) traffic from countries you don't serve. **No bundled GeoIP database and no runtime dependency** — supply either an operator-owned `lookupCountry(ip)` (a MaxMind / `ip2location` reader, or your own table, reusing the trusted-proxy `X-Forwarded-For` / `X-Real-IP` IP resolution) or a `resolveCountry(ctx)` that reads an edge-injected header (`CF-IPCountry`, `CloudFront-Viewer-Country`, `x-vercel-ip-country`). Deny wins over allow (least privilege); **allow-lists fail closed** on an unknown country while deny-only fails open (overridable via `allowUnknownCountry`). Country codes are validated at construction so typos throw instead of silently never matching. `mode: "log"` monitor mode with an `onBlock` decision hook (`denied_country` / `not_in_allowlist` / `unknown_country`), the resolved country stamped on `ctx.state.geo` for allowed requests, and a `403` problem+json rejection that never echoes the country/IP. Zero runtime dependencies.
- `concurrencyLimit()` per-route / per-client concurrency limits + queueing at `@daloyjs/core/concurrency-limit`: HAProxy `maxconn`/queue parity at the app layer. Bounds in-flight requests through a surface with a per-bucket semaphore (`maxConcurrent`), a bounded FIFO queue (`maxQueue`) with an optional `queueTimeoutMs`, and a fast `503` + `Retry-After` once the queue is full or the wait times out. Partition the budget with `scope`: `"global"` (default), `"route"` (per `method + path`), `"client"` (per identity, needs `trustProxyHeaders`/`keyGenerator`), or a custom function (`undefined` skips limiting, fail-open). Acquires in `beforeHandle` and releases in `onSend`, so slots are freed on success, error, and short-circuit paths alike — never leaked. `onReject` observability hook, configurable `retryAfterSeconds`/`message`. Complements the `maxConnections` socket cap and `loadShedding()`. Zero runtime dependencies. HAProxy `maxconn`/queue parity at the app layer. Bounds in-flight requests through a surface with a per-bucket semaphore (`maxConcurrent`), a bounded FIFO queue (`maxQueue`) with an optional `queueTimeoutMs`, and a fast `503` + `Retry-After` once the queue is full or the wait times out. Partition the budget with `scope`: `"global"` (default), `"route"` (per `method + path`), `"client"` (per identity, needs `trustProxyHeaders`/`keyGenerator`), or a custom function (`undefined` skips limiting, fail-open). Acquires in `beforeHandle` and releases in `onSend`, so slots are freed on success, error, and short-circuit paths alike — never leaked. `onReject` observability hook, configurable `retryAfterSeconds`/`message`. Complements the `maxConnections` socket cap and `loadShedding()`. Zero runtime dependencies.
- `requestDecompression()` inbound decompression-bomb guard at `@daloyjs/core/request-decompression`: core is safe by omission (it never decompresses request bodies), so this is the opt-in middleware for services that must accept compressed uploads. Inflates `gzip` / `deflate` bodies behind two caps enforced **during** inflation so a zip bomb is aborted before it is fully materialised: an absolute `maxDecompressedBytes` (required) and an expansion-ratio `maxRatio` (default `100`), both rejecting with `413`. The compressed upload itself is bounded by `maxCompressedBytes` (default 1 MiB) before a byte is inflated. Unknown, non-allowlisted, runtime-unsupported, or **layered** (`gzip, gzip`) encodings are refused `415`; malformed streams `400`; bodyless / uncompressed / `identity` / `GET` / `HEAD` traffic passes through untouched. Runs in `onRequest` and stashes the inflated bytes so schema-validated bodies and raw-body handlers both see the decompressed payload. `onBomb` observability hook, exported `decompressRequestBody()` for custom flows. Built on web-standard `DecompressionStream` (brotli excluded — not in the spec). Zero runtime dependencies.
- `waf()` opt-in WAF-lite signature/anomaly inbound-inspection middleware at `@daloyjs/core/waf`: a first-party defense-in-depth layer for teams without an edge WAF (it does **not** replace ModSecurity / a CDN WAF). Wires DaloyJS' high-confidence injection signatures — SQLi, XSS, NoSQL-operator injection (reusing `hasMongoOperatorKeys` for a structural body check), and command injection — into a single scored inbound-inspection pass over the decoded path, the raw + decoded query string, an opt-in header allowlist, and the validated body. Each rule that fires adds an anomaly `score`; reaching `blockThreshold` (default `5`) rejects with a generic `403` (block mode) or merely reports via `onMatch` (log mode) so operators can tune against real traffic first. Per-rule enable/disable + score overrides, inspection-surface toggles, control-character-stripped log samples, and bounded scanning (`maxValueLength` / `maxBodyNodes`) keep a hostile payload from becoming CPU-DoS. The `403` body never names the rule that fired. Zero runtime dependencies.
- Built-in docs UI Subresource Integrity (SRI): `DocsAssetOptions` lets `scalarHtml()` / `swaggerUiHtml()` / `redocHtml()` and the `docs: { assets }` auto-mount pin version-exact `*Integrity` hashes (`sha256`/`sha384`/`sha512`) plus a `crossOrigin` value (default `"anonymous"`) on the CDN-loaded Scalar / Swagger UI / Redoc `<script>` / `<link>` tags, so a poisoned jsDelivr asset can't execute. Malformed SRI values throw a `TypeError` at startup (browsers ignore unparseable `integrity`, so failing loud avoids a false sense of protection); self-hosting the assets via the same `assets` URLs stays supported. Zero runtime dependencies.
- HTTP Message Signatures (RFC 9421) at `@daloyjs/core/http-signatures`: first-party sign/verify for server-to-server request authentication via the standard `Signature` / `Signature-Input` headers — complements the inbound-only webhook HMAC and `clientCertAuth()` mTLS. `signMessage()` / `signRequest()` build an RFC 9421 signature base over derived components (`@method`, `@target-uri`, `@authority`, `@scheme`, `@request-target`, `@path`, `@query`, `@query-param`, `@status`) and HTTP fields with Structured-Fields header serialization; `verifyMessage()` / `verifyRequest()` and the `httpSignatureAuth()` middleware check them. Algorithms `hmac-sha256` / `ed25519` / `ecdsa-p256-sha256` / `ecdsa-p384-sha384` / `rsa-pss-sha512` / `rsa-v1_5-sha256` via WebCrypto (no `node:` imports). Secure-by-default verify: a **mandatory `algorithms` allowlist** (no implicit "any alg"), optional per-key alg pinning to defeat algorithm-confusion, a required `created` timestamp with a 300s freshness window, `created`-in-future / `expires` skew rejection, configurable `requiredComponents`, a 32-byte raw-HMAC floor, and `nonce` replay defense; the middleware answers a missing/invalid signature with `401` + `Cache-Control: no-store` and stamps the verified result on `ctx.state.httpSignature`. Ships RFC 9530 `contentDigest()` / `verifyContentDigest()` to bind the request body. Zero runtime dependencies.
- `compression()` built on web-standard `CompressionStream` (prefers `br` > `gzip` > `deflate`), with BREACH-aware always-on guards (skips `Set-Cookie`, `Authorization`, session / CSRF cookies, already-compressed content types), `minimumSize: 1024`, negative-compression-ratio post-check, no configurable `compressLevel` knob (CPU-DoS defense — `level: 9` is refused at construction), always-on `Vary: Accept-Encoding`, and strong → weak ETag downgrade per RFC 9110 §8.8.3.
- `etag()` helper auto-skips on `Set-Cookie` and private / no-store / no-cache `Cache-Control` (cross-tenant fingerprinting defense).
- `timing` / `timingSafeEqual` helpers.
- `fileField({ magicBytes })` upload signature checks.
- `ipRestriction()`, `wsRateLimit()`, `requirePayloadAuth` security-scheme guard.
- Zero-knob crypto helpers: `passwordHash` / `passwordVerify` at `@daloyjs/core/hashing`, `verifyWebhookSignature` / `signWebhookPayload`.
- `fetchGuard()` SSRF defaults.

### WebSockets

- WebSocket primitives with the Bun-style handler shape (`open` / `message` / `close` / `drain` / `error`) running on both Node and Bun adapters.
- Typed `app.ws(path, handler)` registration; the upgrade listener is only installed when WS routes exist.
- Production WebSocket routes under `secureDefaults` require:
  - a pre-upgrade `beforeUpgrade` decision hook or an explicit `acknowledgeUnauthenticated: true`, **AND**
  - an Origin policy (`allowedOrigins: "same-origin"` / `string[]` / predicate) or `acknowledgeCrossOriginUpgrade: true`.

  This closes the Cross-Site WebSocket Hijacking (CSWSH) class of bug — Storybook's [CVE-2026-27148](https://www.aikido.dev/blog/storybooks-websockets-attack) is the representative case: cookie auth alone does not stop a malicious site from opening an authenticated WS handshake from a victim's browser. The Origin check runs **before** `beforeUpgrade` in both adapters.
- Contract-first **AsyncAPI 3.0** generation for `app.ws()` surfaces via `@daloyjs/core/asyncapi` (`generateAsyncAPI()` / `asyncapiToYAML()`) and `daloy inspect --asyncapi`. Each route becomes a channel (address + path params) with a `receive` operation for inbound client messages and an optional `send` operation for outbound messages, described via an optional handler `meta` block (`summary` / `description` / `tags` / `send` / `receive` / `operationId`). Set `asyncapi: true` (mirroring `docs: true`) to **auto-mount an interactive AsyncAPI UI** at `/asyncapi` plus `/asyncapi.json` + `/asyncapi.yaml` — the WebSocket counterpart to the Scalar / Swagger / Redoc OpenAPI viewers, served from a CDN with the same SRI + strict-CSP hardening.

### Lifecycle and ops

- Plugin encapsulation (Fastify-style), decorators, structured logging, request-id propagation.
- Lifecycle events: `onPluginInstalled`, `onShutdown`, `onClose`.
- Connection-draining graceful shutdown with `Connection: close` on `503` and in-flight responses.
- `crashOnUnhandledRejection` default-on in production.
- `app.healthcheck()` / `app.readinesscheck()` primitives with bearer-token auth and per-IP rate limit.
- `disconnectStatusCode: 499` default for client-aborted requests.
- `defineConfig({ schema, source })` boot-time typed configuration validation.
- `app({ behindProxy })` declarative model (replaces `trustProxy`); `behindProxy.hops` collapses to the `(N+1)`-from-rightmost slot.
- Adapter-independent `ConnInfo` abstraction: `getConnInfo()`, lazy `ctx.remoteAddress`, `ctx.remotePort`.
- `daloy doctor` production-posture validator with `--audit-secrets` and `--audit-defaults` (flags wildcard-credentials CORS, > 24h CORS `maxAge`, > 25 MiB blanket body limits, zero `idleTimeoutMs` in production, and unsafe opt-ins).
- PSL-aware `subdomains()` helper with a `≤ 90 days` snapshot guard.
- Secure-by-default multitenancy via `tenancy()` + `tenantScope()`: pluggable tenant resolution (subdomain / header / path / JWT claim / custom), refuse-unresolved + format-validated ids + no-enumeration `404` by default, and a key helper that partitions `rateLimit` / `concurrencyLimit` / `idempotency` / `responseCache` per tenant.
- `defineDependency()` typed-DI helper with per-request deduplication.
- Scheme-aware `ctx.state.auth` typed contract; named, optionally seeded stateful plugins.

### Streaming and integrations

- Streaming helpers (SSE + NDJSON), multipart ergonomics, OpenTelemetry-compatible tracing.
- Integration guides for transactional email — AWS SES, SendGrid, Resend, Postmark, Mailgun, Mailtrap — with a common `EmailSender` plugin pattern and runtime-compatibility matrix.
- Authentication & authorization guides for AWS Cognito, Microsoft Entra ID (MSAL), Auth0, Okta, and Clerk — with a common bearer-auth plugin, scope / role enforcement, and runtime-compatibility matrix.

### Supply-chain hardening (CI)

A growing suite of static gates runs on every push and PR:

- Parity / governance / runtime-parity / routing-hardening audits: `verify:parity-audits`, `verify:governance-audits`, `verify:runtime-parity-audits`, `verify:routing-hardening-audits`.
- Source-tree gates: `verify:no-shrinkwrap`, `verify:no-bin-shadowing`, `verify:no-native-addons`, `verify:no-polyfill-cdns` (hijacked-CDN IOCs and typosquats), `verify:no-redos-patterns`, `verify:no-encoded-payloads`, `verify:no-invisible-unicode`, `verify:no-weak-random`, `verify:no-unsafe-buffer`, `verify:no-leaked-credentials`, `verify:no-vulnerable-sandboxes`.
- Agent-skill gates: `verify:no-leaky-agent-skills`, `verify:no-toxic-agent-skills`, `verify:no-toxic-skills` — scanning every agent-instruction surface (`SKILL.md`, `AGENTS.md`, `copilot-instructions.md`, `.cursorrules`, `CLAUDE.md`, `*.instructions.md`, `*.prompt.md`); the `.cursorrules` / `CLAUDE.md` filenames cover the **TrapDoor** crypto-stealer's AI-agent-config prompt-injection persistence ([Socket, 2026-05-24](https://socket.dev/blog/trapdoor-crypto-stealer)).
- Agent / editor config-autorun gate: `verify:no-agent-config-autorun` — refuses editor / AI-coding-agent config files that auto-execute a command on folder open or session start (VS Code `folderOpen` task, Claude/Gemini `"type": "command"` hook, Cursor `alwaysApply` run-a-script rule, a `package.json` `"test": "node .github/setup.js"` hijack, or a loose `.github/` dropper), covering the **Miasma** worm's config-injection detonation surface ([SafeDep, 2026-06-05](https://safedep.io/miasma-worm-ai-coding-agent-config-injection/)).
- Dependency gates: `verify:no-runtime-deps`, `verify:dep-licenses`, `verify:known-dep-names`, `verify:lockfile-sources`, `verify:no-registry-exfiltration`, `verify:no-remote-exec`, `verify:no-lifecycle-scripts`, `verify:runtime-eol` (refuses to release on a Node line past its EOL date).
- IOC coverage in `verify:no-registry-exfiltration` and `verify:lockfile-sources` for active campaigns including Beamglea phishing-CDN, `naya-flore` / `nvlore-hsc` WhatsApp remote-kill-switch, the Toptal GitHub-org hijack, `xuxingfeng` and `xlsx-to-json-lh` destructive payloads, `react-login-page` keylogger, `@crypto-exploit` wallet drainers, Vietnam-Telegram-ban Fastlane typosquats, surveillance-malware packages, the Discord-webhook reconnaissance campaign, the `codexui-android` AI-coding-agent token theft (reads of `~/.codex/auth.json` / `~/.claude/`), and npm-package-aliasing dependency-confusion patterns.
- `SECURITY-CONTACTS.md` rotation file with a machine-readable ACTIVE block and `<!-- last-exercise: -->` marker; the release workflow refuses to publish when `github.actor` is not on the ACTIVE rotation.
- Governance floor reaffirmed by audit: top-level `permissions:` on every workflow, `persist-credentials: false` on every `actions/checkout`, 40-hex SHA pinning on every third-party `uses:`, `step-security/harden-runner` on every workflow using third-party actions, and `.github/CODEOWNERS` on privileged files.
- Mandatory hardware-backed 2FA for every contributor with publish access (documented in `SECURITY.md`).
- `@daloyjs/core` is published with CycloneDX 1.5 + SPDX 2.3 SBOMs and npm `--provenance`; the release workflow uses `npm stage publish` so the protected `npm-publish` GitHub Environment approval is followed by an out-of-band `npm stage approve` step with maintainer MFA before any version is installable.

### Other helpers

- Single-source-of-truth cookie and temporal-claim helpers at `@daloyjs/core/cookie` and `@daloyjs/core/time-claims`.
- `httpError({ status, problem, headers?, res? })` factory extracts headers from a custom `Response` and refuses-at-construction with `MessageLeakError` if the response would leak request-scoped state (`Set-Cookie`, `Server-Timing`, `X-*-Token`, or any `Cache-Control` other than `no-store` / `no-cache`). The allowlist is `WWW-Authenticate` / `Proxy-Authenticate` / `Retry-After` / `Content-Type` / `Content-Language` (with `Content-Length` accepted for safety validation but not forwarded).
- `ProblemRenderOptions.contextHeaders` lets direct callers of `HttpError.toResponse()` get the same Context-merge as the framework boundary.
- A self-paced [workshop](./workshop/README.md) (4-hour and 8-hour tracks) for senior TypeScript / Node developers: contract-first routes, validation, errors, middleware composition, JWT / JWK, sessions, WebSocket upgrades, CSRF / CORS, `fetchGuard()` SSRF defaults, OpenAPI tuning, and contract testing. Every exercise is a single self-contained `tsx --watch` file with ordered coding steps and reference solutions.

Roadmap and shipped / in-progress checklists live in [ROADMAP.md](./ROADMAP.md).

## Contributing

DaloyJS is **public and MIT-licensed, but contributions-closed**. Pull requests
from accounts that are not invited maintainers or explicit repository
collaborators are closed automatically. Bug reports, feature requests, and
security disclosures are very welcome; see [CONTRIBUTING.md](./CONTRIBUTING.md)
and [SECURITY.md](./SECURITY.md) for the channels that *are* open.

## License

MIT
