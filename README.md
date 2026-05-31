<p align="center">
  <a href="https://daloyjs.dev">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://daloyjs.dev/assets/banner-x-1500x500.png">
      <img alt="DaloyJS — Contract-first REST APIs for Node · Bun · Deno · Workers · Edge" src="https://daloyjs.dev/assets/banner-light-1280x426.png" width="100%">
    </picture>
  </a>
</p>

# DaloyJS

[![CI](https://github.com/daloyjs/daloy/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/daloyjs/daloy/actions/workflows/ci.yml)
[![CodeQL](https://github.com/daloyjs/daloy/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/daloyjs/daloy/actions/workflows/codeql.yml)
[![Publish](https://github.com/daloyjs/daloy/actions/workflows/release.yml/badge.svg)](https://github.com/daloyjs/daloy/actions/workflows/release.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/daloyjs/daloy/badge)](https://securityscorecards.dev/viewer/?uri=github.com/daloyjs/daloy)
[![Zizmor](https://github.com/daloyjs/daloy/actions/workflows/zizmor.yml/badge.svg?branch=main)](https://github.com/daloyjs/daloy/actions/workflows/zizmor.yml)

> A **runtime-portable TypeScript web framework** with built-in **contract-first routing**, **validation**, **OpenAPI (Hey API)**, **typed client generation**, **large-scale maintainability**, and **security-focused runtime plus supply-chain posture**.

**One-line API docs.** `new App({ openapi: { info: ... }, docs: true })` auto-mounts `GET /docs` (Scalar), `GET /openapi.json`, and `GET /openapi.yaml` — the same DX as FastAPI, without leaving TypeScript.

DaloyJS is maintained in the GitHub organization at <https://github.com/daloyjs>; the canonical framework repository is <https://github.com/daloyjs/daloy>.

---

DaloyJS exists to be the framework you'd build if you took the best ideas from each modern stack:

| You want                                                | Today's best-of                                       | What DaloyJS gives you                                                                                                                               |
| ------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Best **OpenAPI ergonomics**                                | [FastAPI](https://fastapi.tiangolo.com)                               | OpenAPI 3.1 from a single route definition; `docs: true` mounts `/docs` and `/openapi.json`.                          |
| Best **Vercel / serverless / edge fit**                    | [Hono](https://hono.dev/docs/)                                        | Web-standard `Request → Response` core with adapters for Node, Bun, Deno, Cloudflare, Vercel, Fastly, and Lambda.     |
| Mature **Swagger / docs / ops** in Node                    | [Fastify](https://fastify.dev/docs/latest/Reference/)                 | Encapsulated plugins, structured logger, graceful shutdown, request ids, and lifecycle hooks — all first-party.       |
| Modern **TS-first DX**, Bun acceptable                     | [Elysia](https://elysiajs.com/at-glance.html)                         | End-to-end typed handlers, typed context, and a typed in-process client — no codegen step required.                   |
| Best-in-class **typed client codegen** for any consumer    | [Hey API](https://heyapi.dev/openapi-ts/get-started)                  | One `pnpm gen` command emits a fully-typed fetch SDK from your live OpenAPI spec.                                     |
| Opinionated **DI / module architecture** for large teams   | [NestJS](https://docs.nestjs.com/)                                    | Plugin encapsulation, `register()` prefixes, and `defineDependency()` typed-DI with per-request dedup — no decorators. |
| Minimalist **async middleware cascade**                    | [Koa](https://koajs.com/)                                             | Koa-style `Context` on a web-standard core, with validation, OpenAPI, errors, and security headers in-box.            |
| **Services + real-time** API framework                     | [FeathersJS](https://feathersjs.com/)                                 | First-party `app.ws()` with CSWSH refuse-to-boot guards, plus SSE / NDJSON streaming over explicit OpenAPI routes.    |
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

---

## Built-in docs UI (Scalar / Swagger UI)

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
    ui: "scalar",
    path: "/reference",
    openapiPath: "/spec.json",
    openapiYamlPath: "/spec.yaml", // or `false` to disable the YAML route
    scalar: {
      theme: "kepler",
      customCss: ":root { --scalar-color-accent: #2563eb; }",
      hideTestRequestButton: true,
    },
    tags: ["Docs"],
  },
});
```

The `scalar` option is forwarded to Scalar's HTML API as JSON configuration,
with Daloy keeping the live `openapiPath` as the source. Use it for themes,
custom CSS, layout, auth defaults, and client visibility without copying the
HTML helper.

Prefer to mount manually? Import the helpers directly:

```ts
import { swaggerUiHtml, scalarHtml, htmlResponse } from "@daloyjs/core/docs";
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

For deployments where every millisecond of startup matters (Lambda, Vercel Edge, Cloudflare Workers, Fastly Compute), import `App` from the deep entry point instead of the barrel:

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
- pnpm — strict, secure, content-addressable package manager: <https://pnpm.io/motivation>
- Standard Schema — universal validator interface: <https://github.com/standard-schema/standard-schema>
- RFC 9457 — Problem Details for HTTP APIs: <https://www.rfc-editor.org/rfc/rfc9457>

---

## Status

DaloyJS is in **public preview** (`0.x`). The public API may still change between minor versions; deprecations will get at least one minor cycle once `1.0.0` ships. The framework is already in use for production trials.

**Release quality bar.** Every release ships with **≥90% line + function coverage and ≥90% branch coverage**, strict TypeScript, OpenSSF Scorecard, CodeQL + Opengrep dual SAST, zizmor workflow linting, and npm provenance. Coverage was relaxed from a former 100% gate so complex security work isn't blocked chasing throwaway tests for unreachable defensive branches or tsx source-map phantoms; see [AGENTS.md](AGENTS.md) for the policy.

### Routing, validation, and docs

- Contract-first routing with Standard Schema validation (Zod 4, Valibot, ArkType, TypeBox) and OpenAPI 3.1 generated from a single source of truth.
- Live OpenAPI 3.1 spec served as both JSON (`GET /openapi.json`) and YAML (`GET /openapi.yaml`) when `docs: true`, with Scalar UI theming and custom CSS via `docs.scalar`.
- Zero-config OpenAPI `info` autofill from `package.json` (Node / Bun) or `deno.json` / `deno.jsonc` (Deno); explicit `openapi.info` values always win.
- RFC 7231 + RFC 5789 HTTP-method allowlist enforced inside `app.route()` (WebDAV, `TRACE`, `CONNECT` rejected at the framework boundary).
- AI-friendly route metadata via optional `meta: { examples, extensions, summary, description, tags }`; examples are validated against your schemas at build time, surfaced as OpenAPI `examples` + `x-daloy-*` extensions, and dumped as `routes.json` / `routes.yaml` via `daloy inspect --ai`.
- API lifecycle and breaking-change detection: mark routes `deprecated` or give them a `sunset` date to emit RFC 8594 `Deprecation` / `Sunset` headers and an `x-sunset` OpenAPI extension, then gate CI with `diffOpenAPI()` / the `daloy diff` command, which fail on a breaking change versus the last published spec.
- In-process test client (`app.request()`), contract-test runner, in-process typed client, and Hey API codegen via `pnpm gen`.

### Runtimes and deployment

- Adapters for Node (Heroku, Railway, Render, Fly.io), Bun, Deno, Cloudflare Workers, Vercel Node / Edge / Next.js / Netlify Edge, Fastly Compute, and AWS Lambda / Netlify Functions / Lambda Function URLs.
- `daloy dev` watch loop delegates to the host runtime's native watcher (`node --import tsx --watch`, `bun --hot`, or `deno run --watch`) with a `--runtime` override for cross-runtime `package.json` scripts.
- `pnpm create daloy` scaffolder with Node, Bun, Deno, Cloudflare Worker, and Vercel Edge templates, plus optional `--with-ci` GitHub Actions / Dependabot / CODEOWNERS / SECURITY.md hardening.
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
- Agent-skill gates: `verify:no-leaky-agent-skills`, `verify:no-toxic-agent-skills`, `verify:no-toxic-skills`.
- Dependency gates: `verify:no-runtime-deps`, `verify:dep-licenses`, `verify:known-dep-names`, `verify:lockfile-sources`, `verify:no-registry-exfiltration`, `verify:no-remote-exec`, `verify:no-lifecycle-scripts`, `verify:runtime-eol` (refuses to release on a Node line past its EOL date).
- IOC coverage in `verify:no-registry-exfiltration` and `verify:lockfile-sources` for active campaigns including Beamglea phishing-CDN, `naya-flore` / `nvlore-hsc` WhatsApp remote-kill-switch, the Toptal GitHub-org hijack, `xuxingfeng` and `xlsx-to-json-lh` destructive payloads, `react-login-page` keylogger, `@crypto-exploit` wallet drainers, Vietnam-Telegram-ban Fastlane typosquats, surveillance-malware packages, the Discord-webhook reconnaissance campaign, and npm-package-aliasing dependency-confusion patterns.
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
