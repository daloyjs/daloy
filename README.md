# DaloyJS

[![CI](https://github.com/daloyjs/daloy/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/daloyjs/daloy/actions/workflows/ci.yml)
[![CodeQL](https://github.com/daloyjs/daloy/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/daloyjs/daloy/actions/workflows/codeql.yml)
[![Publish](https://github.com/daloyjs/daloy/actions/workflows/release.yml/badge.svg)](https://github.com/daloyjs/daloy/actions/workflows/release.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/daloyjs/daloy/badge)](https://securityscorecards.dev/viewer/?uri=github.com/daloyjs/daloy)
[![Zizmor](https://github.com/daloyjs/daloy/actions/workflows/zizmor.yml/badge.svg?branch=main)](https://github.com/daloyjs/daloy/actions/workflows/zizmor.yml)

> A **runtime-portable TypeScript web framework** with built-in **contract-first routing**, **validation**, **OpenAPI (Hey API)**, **typed client generation**, **large-scale maintainability**, and **security-focused runtime plus supply-chain posture**.

DaloyJS is maintained in the GitHub organization at <https://github.com/daloyjs>; the canonical framework repository is <https://github.com/daloyjs/daloy>.

---

DaloyJS exists to be the framework you'd build if you took the best ideas from each modern stack:

| You want | Today's best-of | What DaloyJS gives you |
|---|---|---|
| Best **OpenAPI ergonomics** | [FastAPI](https://fastapi.tiangolo.com) | First-class OpenAPI 3.1 generation from a single route definition. |
| Best **Vercel / serverless / edge fit** | [Hono](https://hono.dev/docs/) | Web-standard `Request → Response` core, multi-runtime adapters. |
| Mature **Swagger / docs / ops** in Node | [Fastify](https://fastify.dev/docs/latest/Reference/) | Encapsulated plugins, structured logger, graceful shutdown, request ids, hooks. |
| Modern **TS-first DX**, Bun acceptable | [Elysia](https://elysiajs.com/at-glance.html) | End-to-end typed handlers, typed context, typed client. |
| Best-in-class **typed client codegen** for any consumer | [Hey API](https://heyapi.dev/openapi-ts/get-started) | One command (`pnpm gen`) emits a fully-typed fetch SDK from your spec. |
| **Supply-chain-hardened installs and publishing** | [pnpm](https://pnpm.io/motivation) + hardened CI/CD | `ignore-scripts`, release-age cooldown, explicit build allowlist, SHA-pinned actions, isolated OIDC publish with provenance. |

```
framework test suite passing · 100% line + function coverage · clean strict TypeScript 6
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

These defaults block transitive lifecycle scripts, wait 24 hours before resolving freshly published versions, verify the pnpm store, and require provenance on publish. The few dependencies that truly need install-time builds are allowlisted in `package.json` under `pnpm.onlyBuiltDependencies`, and CI runs `pnpm verify:lockfile` to reject git dependency sources and non-registry tarball URLs in `pnpm-lock.yaml`.

Run `pnpm audit --prod` regularly (or `pnpm run audit` in this repo) — and `pnpm install --frozen-lockfile --ignore-scripts` in CI.

---

## Hello world

```ts
import { z } from "zod";
import { App, NotFoundError, secureHeaders, rateLimit, requestId } from "@daloyjs/core";
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
    200: { description: "Found", body: z.object({ id: z.string(), title: z.string() }) },
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
  input:  "./generated/openapi.json",
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

## Built-in docs UI (Swagger UI / Scalar)

```ts
import { swaggerUiHtml, htmlResponse } from "@daloyjs/core/docs";
// returns a self-contained HTML page that loads /openapi.json
```

Mount at `/docs` and the UI is always contract-accurate — never stale.
`create-daloy@0.1.22` mounts Swagger UI at `/docs` and the live spec at `/openapi.json` by default.

---

## Security guardrails

Some protections are enforced by the `App` core whenever the relevant request
path is used. Others are first-party middleware so applications can choose the
right CORS policy, rate-limit key, CSP, session secret, or CSRF rollout for their
deployment.

| Threat | Built-in behavior |
|---|---|
| **Body-size DoS** | Core-enforced streamed read with a hard cap (default 1 MiB); `Content-Length` checked first. |
| **Prototype pollution** | Core JSON parser strips `__proto__` / `constructor` / `prototype` via reviver. |
| **Header / response splitting** | Core header sanitizers reject CRLF + NUL. |
| **Path traversal** | Core router rejects `..` segments and `//` before walking. |
| **Slow-loris / hung handlers** | Core `requestTimeoutMs` aborts handlers (default 30 s); Node adapter sets `requestTimeout` + `headersTimeout` + `maxHeaderSize`. |
| **MIME sniffing** | First-party `secureHeaders()` sets `X-Content-Type-Options: nosniff`; scaffolded apps enable it. |
| **Clickjacking** | First-party `secureHeaders()` sets `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`; scaffolded apps enable it. |
| **XSS via injected scripts** | First-party `secureHeaders()` provides a strict CSP `default-src 'self'` baseline; scaffolded apps enable it. |
| **Cross-origin leakage** | First-party `secureHeaders()` sets `cross-origin-opener-policy` + `cross-origin-resource-policy` to `same-origin`; scaffolded apps enable it. |
| **Information disclosure (5xx)** | Production mode strips `detail` from 5xx problem+json automatically. |
| **Credential timing attacks** | First-party `timingSafeEqual()` helper for tokens & signatures. |
| **Brute-force / scraping** | First-party `rateLimit()` with token-bucket + `Retry-After`; Node/Bun/Deno scaffolded apps enable it. |
| **Method confusion** | Real **405** with `Allow` header, not a misleading 404. |
| **CORS misconfig** | First-party `cors()` requires an explicit allowlist and throws for `*` with credentials. |
| **Request correlation** | First-party `requestId()` uses cryptographic ids; scaffolded apps enable it. |
| **Supply chain** | pnpm `ignore-scripts=true`, `minimum-release-age=1440`, verified store, reproducible lockfile, lockfile source verification, provenance publishing, and CI/CD hardening against cache poisoning and OIDC token abuse. |

The publish pipeline is also hardened: no `pull_request_target`, no GitHub Actions cache in CI, top-level `permissions: {}`, `step-security/harden-runner`, a separate protected `release.yml` workflow, npm trusted publishing with `--provenance`, CodeQL, OpenSSF Scorecard, zizmor workflow linting, Dependabot, and CODEOWNERS on workflow/package files. See [SECURITY.md](SECURITY.md) and the [supply-chain security docs](https://daloyjs.dev/docs/security/supply-chain).

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
    app.route({ method: "GET", path: "/me", operationId: "me",
      responses: { 200: { description: "ok" } },
      handler: async () => ({ status: 200, body: { user: "alice" } }) });
  },
};
app.register(usersPlugin, { prefix: "/users", tags: ["Users"] });
await app.ready();
```

---

## Multi-runtime

```ts
import { serve } from "@daloyjs/core/node";          // Node
import { serve } from "@daloyjs/core/bun";           // Bun
import { serve } from "@daloyjs/core/deno";          // Deno
import { toFetchHandler } from "@daloyjs/core/cloudflare"; // Cloudflare Workers
import { toEdgeHandler }  from "@daloyjs/core/vercel";     // Vercel Edge / Next.js
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

DaloyJS is in **public preview** (`0.x`). The public API may still change between minor versions; deprecations will get at least one minor cycle once `1.0.0` ships. The framework is already in use for production trials — every release ships with **100% line + function test coverage**, strict TypeScript, OpenSSF Scorecard, CodeQL, zizmor workflow linting, and npm provenance.

What works today, at a glance:

- Contract-first routing, Standard Schema validation (Zod 4 / Valibot / ArkType / TypeBox), and OpenAPI 3.1 from a single source of truth.
- Adapters for Node, Bun, Deno, Cloudflare Workers, and Vercel Edge.
- Built-in security primitives (body limits, prototype-pollution-safe JSON, path-traversal guard, request timeouts, header injection guards) plus first-party middleware (`secureHeaders`, `cors`, `rateLimit`, `requestId`, `bearerAuth`, `csrf`, `session`, `timing` / `timingSafeEqual`).
- Streaming helpers (SSE + NDJSON), multipart ergonomics, OpenTelemetry-compatible tracing, signed-cookie sessions with pluggable stores, and a Redis-backed rate-limit store at `@daloyjs/core/rate-limit-redis`.
- In-process test client (`app.request()`), contract-test runner, in-process typed client, and Hey API codegen via `pnpm gen`.
- `pnpm create daloy` scaffolder with Node, Bun, Deno, Cloudflare Worker, and Vercel Edge templates, plus optional `--with-ci` GitHub Actions / Dependabot / CODEOWNERS / SECURITY.md hardening.
- Plugin encapsulation, decorators, structured logging, request-id propagation, lifecycle events (`onPluginInstalled`, `onShutdown`, `onClose`), and graceful shutdown.

Roadmap, version-by-version plan, and shipped/in-progress checklists live in [ROADMAP.md](./ROADMAP.md).

## License

MIT
