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
| Best **OpenAPI ergonomics**                             | [FastAPI](https://fastapi.tiangolo.com)               | First-class OpenAPI 3.1 generation from a single route definition; one-line `docs: true` auto-mounts `/docs` and `/openapi.json`.                                                           |
| Best **Vercel / serverless / edge fit**                 | [Hono](https://hono.dev/docs/)                        | Web-standard `Request → Response` core, multi-runtime adapters.                                                                                      |
| Mature **Swagger / docs / ops** in Node                 | [Fastify](https://fastify.dev/docs/latest/Reference/) | Encapsulated plugins, structured logger, graceful shutdown, request ids, hooks.                                                                       |
| Modern **TS-first DX**, Bun acceptable                  | [Elysia](https://elysiajs.com/at-glance.html)         | End-to-end typed handlers, typed context, typed client.                                                                                              |
| Best-in-class **typed client codegen** for any consumer | [Hey API](https://heyapi.dev/openapi-ts/get-started)  | One command (`pnpm gen`) emits a fully-typed fetch SDK from your spec.                                                                                 |
| **Portable supply-chain hardening for the apps you build** | [pnpm](https://pnpm.io/motivation) defaults + a zero-runtime-dep core | pnpm scaffolds keep the hardened `.npmrc` (`ignore-scripts`, 24h release-age cooldown, explicit build allowlist), source-verified lockfiles, zero runtime deps, CycloneDX + SPDX SBOM, and an opt-in hardened GitHub Actions bundle for teams that ship on GitHub. npm/yarn/bun scaffolds still get the runtime guardrails and generated CI/Docker install commands that disable lifecycle scripts, but pnpm's release-age and workspace checks are pnpm features. |

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

DaloyJS is distributed via **pnpm** for [supply-chain hygiene](https://pnpm.io/motivation) and backed by a hardened release pipeline — strict isolation, content-addressable store, deterministic lockfile, no phantom dependencies, SHA-pinned CI actions, and provenance publishing.

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
- [`.github/workflows/release.yml`](.github/workflows/release.yml) reruns `pnpm gen:sbom` and `pnpm verify:sbom` before either npm publish job is allowed to proceed.

That means a release will fail before publish if the SBOMs are missing, stale, or inconsistent with `package.json`.

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

DaloyJS is in **public preview** (`0.x`). The public API may still change between minor versions; deprecations will get at least one minor cycle once `1.0.0` ships. The framework is already in use for production trials — every release ships with **≥90% line + function coverage and ≥90% branch coverage**, strict TypeScript, OpenSSF Scorecard, CodeQL + Opengrep dual SAST, zizmor workflow linting, and npm provenance. Coverage was relaxed from a former 100% gate so that complex security work isn't blocked chasing throwaway tests for unreachable defensive branches or tsx source-map phantoms; see [AGENTS.md](AGENTS.md) for the policy.

What works today, at a glance:

- Contract-first routing, Standard Schema validation (Zod 4 / Valibot / ArkType / TypeBox), and OpenAPI 3.1 from a single source of truth.
- Adapters for Node (Heroku/Railway/Render/Fly.io), Bun, Deno, Cloudflare Workers, Vercel Node / Edge / Next.js / Netlify Edge, Fastly Compute, and AWS Lambda / Netlify Functions / Lambda Function URLs.
- Built-in security primitives (body limits, prototype-pollution-safe JSON, path-traversal guard, request timeouts, header injection guards, **duplicate `Host` / `Content-Length` rejection**, **stripped `Server` / `X-Powered-By` headers by default**, **structured-log redaction defaults** for authorization / cookie / password / token / JWT-shaped values, **`secureHeaders()` auto-applied since `0.16.0`** with user-installed overrides automatically replacing the auto instance, **cross-origin state-changing requests rejected with `403` since `0.16.0`** unless a route's `cors()` policy allows the request origin, **refuse-to-boot on weak session secrets, `cors({ origin: "*" })`, `session()` + state-changing route without `csrf()`, and unconfigured `X-Forwarded-*` in production since `0.17.0`**, **connection-draining shutdown with `Connection: close` on `503` and in-flight responses, `crashOnUnhandledRejection` default-on in production, and `app.healthcheck()` / `app.readinesscheck()` primitives with bearer-token auth + per-IP rate limit since `0.18.0`**, **`rateLimit({ groupId })` shared buckets, `combine` primitives `every` / `some` / `except`, `ipRestriction()` with CIDR-aware IPv4/IPv6 allow/deny lists, and `internal: true` route flag + `app.inject()` since `0.19.0`**, **`loadShedding()` event-loop-pressure middleware (auto-`503` + `Retry-After`), `app.cspReportRoute()` rate-limited CSP violation receiver + `secureHeaders({ reportingEndpoints, reportTo })` wiring, `disconnectStatusCode: 499` default for client-aborted requests, and `defineConfig({ schema, source })` boot-time typed configuration validation since `0.20.0`**, **`createJwtSigner()` / `createJwtVerifier()` with `alg`-discipline (no `alg: "none"`, explicit allowlist, HS+JWK refused at construction) + `exp`-required sign refusal, `requireScopes()` with RFC-6750 `WWW-Authenticate: Bearer` challenge + per-request scope aggregation, and `etag()` helper with `Set-Cookie` / `Cache-Control: private | no-store | no-cache` auto-skip (cross-tenant fingerprinting defense) since `0.21.0`**, **`jwk()` asymmetric-only JWKS middleware (refuses `HS*` at construction, `kid` + JWT-vs-JWK `alg` cross-check, `https://` JWKS URL with TTL caching + in-flight-promise dedup, normalizes `scope` / `scp` / `scopes` claims), per-scheme `verify(credentials, ctx)` revalidation hook on `bearerAuth()` / `jwk()`, `basicAuth({ onAuthSuccess })` typed-context callback, and `Cache-Control: no-store` on every first-party auth helper 401 challenge since `0.22.0`**, **`wsRateLimit()` for WebSocket upgrades, `loginThrottle()` credential-entry preset, `rotateSession()` privilege-change session rotation, `fileField({ magicBytes })` upload signature checks, `requirePayloadAuth` security-scheme guard, and WebSocket safe defaults since `0.23.0`**, **`app({ behindProxy })` declarative model (replaces `trustProxy`), adapter-independent `ConnInfo` abstraction (`getConnInfo()` / lazy `ctx.remoteAddress` / `ctx.remotePort`), `daloy doctor` production-posture validator (with `--audit-secrets` + `--no-audit-defaults`), container-first `create-daloy` templates (`HEALTHCHECK` to `/readyz`, `STOPSIGNAL SIGTERM`, non-root user, `tini` PID 1), PSL-aware `subdomains()` helper with `≤ 90 days` snapshot guard, plugin `dependencies: string[]` refuse-to-boot, namespace-protected `decorate({ override })`, plugin extension ordering with `before` / `after` + cycle detection, `behindProxy.hops` collapses to the `(N+1)`-from-rightmost slot, `defineDependency()` typed-DI helper with per-request deduplication, scheme-aware `ctx.state.auth` typed contract, plugin lifecycle encapsulation default of `local`, and required `name` + optional `seed` for stateful plugins since `0.24.0`**, **`compression()` middleware (built on the web-standard `CompressionStream`, prefers `br` > `gzip` > `deflate` and probes runtime support once) with BREACH-aware always-on guards (skip `Set-Cookie` / `Authorization` / session-or-CSRF cookie / already-compressed content types), `minimumSize: 1024` + negative-compression-ratio post-check, no configurable `compressLevel` knob (CPU-DoS defense — `level: 9` is refused at construction), always-on `Vary: Accept-Encoding`, and strong → weak ETag downgrade per RFC 9110 §8.8.3 since `0.25.0`**, **`secureDefaults: false` refuse-to-construct in production (unless `acknowledgeInsecureDefaults: true`) + once-per-process `error` log naming every disabled default, `createJwtSigner()` / `createJwtVerifier()` refuse HS-shaped secrets `< 32` bytes (RFC 7518 §3.2), `secureHeaders()` refuses to construct with both `frameOptions: false` AND no CSP `frame-ancestors` directive (no clickjacking defense), and mandatory hardware-backed 2FA for every contributor with publish access (documented in `SECURITY.md`) since `0.26.0`**, and **single-source-of-truth cookie and temporal-claim helpers (`@daloyjs/core/cookie`, `@daloyjs/core/time-claims`), `session()` / `csrf()` `__Secure-` cookie refuse-to-boot, zero-runtime-dependency CI governance, and secret-comparison CI grep gate since `0.27.0`**, and **pattern-agnostic-framework parity audit suite since `0.28.0`** (`scripts/verify-parity-audits.ts` static gates wired into CI as `pnpm verify:parity-audits` — refuses public setters on `request.url` / `request.path` / `request.method`, refuses `ctx.respond = false`-style response-bypass switches, refuses `Referer`-based redirect targets, refuses `AES-CBC` / `SHA-1` / third-party crypto reach inside the cookie helper module, refuses adapter dispatch via `allowInternal: true` / `app.inject()`, and reaffirms the zero-runtime-dependency posture — plus `daloy doctor --audit-defaults` live-config checks that flag wildcard-credentials CORS, > 24 h CORS `maxAge`, > 25 MiB blanket body limits, zero `idleTimeoutMs` in production, `allowUnsafeValidationDetails` / `exposeFrameworkIdentity` / `enableServerTimingInProduction` opt-ins that the public type does not expose), and **zero-runtime-dependency batteries-included parity & governance audit suite since `0.29.0`** (`SECURITY-CONTACTS.md` rotation file with machine-readable ACTIVE block + `<!-- last-exercise: -->` marker, `scripts/verify-governance-audits.ts` static gates wired into CI as `pnpm verify:governance-audits` — refuses a missing/stale rotation file, refuses runtime deps on `@daloyjs/core/package.json`, refuses removal of the plugin-prerequisite refuse-to-boot path or the `topoSortExtensions` cycle-detection throw from `src/app.ts`, and reaffirms the governance floor: top-level `permissions:` on every workflow, `persist-credentials: false` on every `actions/checkout`, 40-hex SHA pinning on every third-party `uses:`, `step-security/harden-runner` on every workflow that uses third-party actions, and `.github/CODEOWNERS` on privileged files — plus a release-workflow contributor-rotation refusal step that exits non-zero when `github.actor` is not on the `SECURITY-CONTACTS` ACTIVE rotation), and **multi-runtime web-standard ergonomic-framework parity bake-ins since `0.30.0`** (`Cache-Control: no-store` baked into `UnauthorizedError` / `ForbiddenError` / `TooManyRequestsError` so every first-party auth helper 401 / 403 / 429 response is uncacheable, `cspReportRoute()` refuses `application/json` with `415` and refuses `maxBodyBytes > 64 KiB` at construction with the default production logger sink omitting the parsed report body unless `logCspReportBodies: true` is set explicitly (PII defense — CSP reports include the violated source URL), `cors()` `allowMethods` default narrowed to `[GET, HEAD, POST]` with `methods: ['*']` refused at construction (`PUT` / `PATCH` / `DELETE` are now explicit opt-ins), and `scripts/verify-runtime-parity-audits.ts` wired into CI as `pnpm verify:runtime-parity-audits` covering all of the above plus the reverse-proxy-helper absence audit and the compression skip-already-encoded reaffirm), and **mature-Node ergonomic-framework second-pass bake-ins since `0.31.0`** (`useSemicolonDelimiter: false` router-level audit so `/users/42;admin=true` cannot smuggle attacker-controlled query data past auth / CSRF / rate-limit middleware via a reverse-proxy / origin disagreement on RFC 3986 path-segment delimiters, `allowErrorHandlerOverride: false` audit so the framework never ships a standalone `setErrorHandler()` / `onError()` class method that could silently overwrite previously-registered error handlers, `requestId()` `trustIncoming: false` default audit so client-supplied `X-Request-ID` headers cannot poison framework logs by default, RFC 7231 + RFC 5789 HTTP-method allowlist now runtime-enforced inside `app.route()` (WebDAV / `TRACE` / `CONNECT` rejected at the framework boundary), `Connection: close` on every response produced during graceful shutdown reaffirmed by audit, and `scripts/verify-routing-hardening-audits.ts` wired into CI as `pnpm verify:routing-hardening-audits` covering all of the above), and **leftover focused slice since `0.32.0`** (`app.ws()` now scans the effective hook stack for header-mutating middleware — `secureHeaders()` / `cors()` / `csrf()` / `compression()` — and refuses-at-registration with a structured error naming both the WebSocket route AND every conflicting middleware unless the handler opts in via `acknowledgeHeaderMutatingMiddleware: true`, new `httpError({ status, problem, headers?, res? })` factory in `@daloyjs/core` extracts headers from a custom `Response` and refuses-at-construction with `MessageLeakError` when the response would leak request-scoped state — `Set-Cookie`, `Server-Timing`, `X-*-Token`, or `Cache-Control` other than `no-store` / `no-cache` all trip the gate, leaving only the `WWW-Authenticate` / `Proxy-Authenticate` / `Retry-After` / `Content-Type` / `Content-Language` allowlist (with `Content-Length` accepted for safety validation but not forwarded), plus a new `ProblemRenderOptions.contextHeaders` extension so direct callers of `HttpError.toResponse()` get the same Context-merge as the framework boundary, and the `PluginExtension` contract now accepts `responseHeaders?: readonly string[]` — `topoSortExtensions()` refuses-at-call when two extensions declare overlapping `responseHeaders` without declaring a `before` / `after` relationship between them so plugin-registration order can no longer non-deterministically pick a winner on a shared response header) — WebSocket public-route exposure can be acknowledged explicitly, while middleware/header-order checks remain registration invariants) plus first-party middleware (`secureHeaders` with CSP nonce + Trusted Types, `cors`, `rateLimit`, `requestId`, `bearerAuth`, `basicAuth`, `csrf` with **double-submit cookie** + **Fetch-Metadata** strategies, `session`, `timing` / `timingSafeEqual`) and **zero-knob crypto helpers** (`passwordHash` / `passwordVerify` at `@daloyjs/core/hashing`, `verifyWebhookSignature` / `signWebhookPayload`).
- Streaming helpers (SSE + NDJSON), multipart ergonomics, OpenTelemetry-compatible tracing, signed-cookie sessions with pluggable stores, and a Redis-backed rate-limit store at `@daloyjs/core/rate-limit-redis`.
- Request-smuggling singleton-header rejection now covers duplicate `Transfer-Encoding` in addition to duplicate `Host` and `Content-Length`.
- WebSocket primitives with the same Bun-style handler shape (`open`/`message`/`close`/`drain`/`error`) running on both Node and Bun adapters, plus typed `app.ws(path, handler)` registration and route-table awareness so the upgrade listener is only installed when WS routes exist.
- Production WebSocket routes under `secureDefaults` require a pre-upgrade `beforeUpgrade` decision hook or an explicit `acknowledgeUnauthenticated: true` marker, **AND** an Origin policy (`allowedOrigins: "same-origin"` / `string[]` / predicate) or `acknowledgeCrossOriginUpgrade: true` since `0.33.0` to close the Cross-Site WebSocket Hijacking (CSWSH) class of bug — Storybook's [CVE-2026-27148](https://www.aikido.dev/blog/storybooks-websockets-attack) is the representative case: cookie auth alone does not stop a malicious site from opening an authenticated WS handshake from a victim's browser, because browsers always attach cookies on the upgrade. The Origin check runs **before** `beforeUpgrade` in both Node and Bun adapters; `httpError({ res })` also uses case-insensitive header merging and never forwards a custom response's `Content-Length` onto the rendered `problem+json` body.
- Registration-conflict guards are deliberate startup invariants: use `acknowledgeHeaderMutatingMiddleware` for reviewed WebSocket/middleware scopes and explicit plugin `before` / `after` ordering for shared `responseHeaders`, rather than expecting `secureDefaults: false` to suppress those checks.
- Pretty `printStartupBanner()` / `formatStartupBanner()` startup helpers at `@daloyjs/core/banner`, used by every starter template so `pnpm dev` greets you with a colorized boxed panel (TTY + `NO_COLOR` / `FORCE_COLOR` aware, with an ASCII fallback for dumb terminals).
- In-process test client (`app.request()`), contract-test runner, in-process typed client, and Hey API codegen via `pnpm gen`.
- One-command watch loop: `daloy dev` delegates to the host runtime's native watcher (`node --import tsx --watch`, `bun --hot`, or `deno run --watch`) with a `--runtime` override for cross-runtime `package.json` scripts.
- AI-friendly route metadata via an optional `meta: { examples, extensions, summary, description, tags }` field on `route()`; examples are validated against your Standard Schemas at build time, surfaced into OpenAPI as `examples` + `x-daloy-*` extensions, and dumped as a sibling `routes.json` (or `routes.yaml` via `--yaml` / `--format yaml`, ~30% fewer LLM tokens) through `daloy inspect --ai` for LLM / Hey API / codegen consumption.
- Zero-config OpenAPI `info` autofill from `package.json` (Node / Bun) or `deno.json` / `deno.jsonc` (Deno) — explicit `openapi.info` values always win.
- Live OpenAPI 3.1 spec served as both JSON (`GET /openapi.json`) and YAML (`GET /openapi.yaml`) when `docs: true`, with Scalar UI theming/custom CSS via `docs.scalar` — covers Swagger UI's `swagger.yaml` convention out of the box.
- `pnpm create daloy` scaffolder with Node, Bun, Deno, Cloudflare Worker, and Vercel Edge templates, plus optional `--with-ci` GitHub Actions / Dependabot / CODEOWNERS / SECURITY.md hardening. The generated `deploy.yml` for container templates signs every pushed GHCR image with **Sigstore Cosign** (keyless OIDC) and attaches an **SPDX SBOM attestation** so consumers can `cosign verify` + `cosign verify-attestation --type spdxjson` instead of trusting the registry alone (Aikido [container-security checklist](https://www.aikido.dev/blog/container-security-best-practices) — "Use Signed Images" + "Generate an SBOM").
- Plugin encapsulation, decorators, structured logging, request-id propagation, lifecycle events (`onPluginInstalled`, `onShutdown`, `onClose`), and graceful shutdown.
- Integration guides for transactional email providers — AWS SES, SendGrid, Resend, Postmark, Mailgun, and Mailtrap — with a common `EmailSender` plugin pattern and runtime-compatibility matrix.
- Authentication & authorization guides for AWS Cognito, Microsoft Entra ID (MSAL), Auth0, Okta, and Clerk — with a common bearer-auth plugin, scope/role enforcement, and runtime-compatibility matrix.

Roadmap, version-by-version plan, and shipped/in-progress checklists live in [ROADMAP.md](./ROADMAP.md).

## Contributing

DaloyJS is **public and MIT-licensed, but contributions-closed**. Pull requests
from accounts that are not invited maintainers or explicit repository
collaborators are closed automatically. Bug reports, feature requests, and
security disclosures are very welcome; see [CONTRIBUTING.md](./CONTRIBUTING.md)
and [SECURITY.md](./SECURITY.md) for the channels that *are* open.

## License

MIT
