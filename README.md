# DaloyJS

> A **runtime-portable TypeScript web framework** with built-in **contract-first routing**, **validation**, **OpenAPI (Hey API)**, **typed client generation**, **large-scale maintainability**, and **highly secured by default (pnpm)**.

📚 **Documentation site:** [`./daloyjs.dev`](./daloyjs.dev) — a Next.js 16 + shadcn/ui + Tailwind v4 site with the landing page, getting-started guide, tutorials, security docs, and full API reference. Run it with:

```zsh
cd daloyjs.dev
pnpm install
pnpm dev      # http://localhost:3000
pnpm build    # static prerender of every docs route
```

---

DaloyJS exists to be the framework you'd build if you took the best ideas from each modern stack:

| You want | Today's best-of | What DaloyJS gives you |
|---|---|---|
| Best **OpenAPI ergonomics** | [FastAPI](https://fastapi.tiangolo.com) | First-class OpenAPI 3.1 generation from a single route definition. |
| Best **Vercel / serverless / edge fit** | [Hono](https://hono.dev/docs/) | Web-standard `Request → Response` core, multi-runtime adapters. |
| Mature **Swagger / docs / ops** in Node | [Fastify](https://fastify.dev/docs/latest/Reference/) | Encapsulated plugins, structured logger, graceful shutdown, request ids, hooks. |
| Modern **TS-first DX**, Bun acceptable | [Elysia](https://elysiajs.com/at-glance.html) | End-to-end typed handlers, typed context, typed client. |
| Best-in-class **typed client codegen** for any consumer | [Hey API](https://heyapi.dev/openapi-ts/get-started) | One command (`pnpm gen`) emits a fully-typed fetch SDK from your spec. |
| **Better supply-chain security** than npm | [pnpm](https://pnpm.io/motivation) | Strict, content-addressable installs; reproducible lockfile; per-project `.npmrc` hardening. |

```
114/114 tests passing · 100% line + function coverage · clean strict TypeScript 6
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
4. **Secure by default — bad defaults are bugs.** Body limits, prototype-pollution-safe JSON, path-traversal rejection, request timeouts, Helmet-grade headers, RFC 9457 problem+json errors with prod-mode redaction.
5. **Tooling and inspectability over magic.** `app.introspect()` is a public API; contract-test runner is built in.
6. **Optimize for large-team maintenance**, not only solo-dev speed. Encapsulated plugins, decorators, request ids, structured logger.

---

## Install

DaloyJS is distributed via **pnpm** for [supply-chain hygiene](https://pnpm.io/motivation) — strict isolation, content-addressable store, deterministic lockfile, no phantom dependencies.

```bash
pnpm add @daloyjs/core zod@^4
```

Zod 4 is the recommended validator for new DaloyJS apps because it is modern, smaller, and Standard-Schema-compatible. DaloyJS still accepts any Standard Schema validator, so teams can use Valibot, ArkType, TypeBox, or another compatible schema library when that better fits their stack.

The repo ships an [`.npmrc`](.npmrc) with hardened defaults:

```ini
auto-install-peers=true
strict-peer-dependencies=true
prefer-frozen-lockfile=true
verify-store-integrity=true
# Optional: pnpm 10+ supply-chain controls
# minimum-release-age=1440        # wait 24h before installing fresh releases
# ignore-scripts=true             # whitelist install scripts via approve-builds
```

Run `pnpm audit --prod` regularly (or `pnpm run audit` in this repo) — and `pnpm install --frozen-lockfile` in CI.

---

## Quick start

```bash
pnpm create daloy@latest my-api
# or
npm  create daloy@latest my-api
```

See [Scaffold a project](https://daloyjs.dev/docs/scaffolder) for templates and flags.

## Hello world

```ts
import { z } from "zod";
import { App, NotFoundError, secureHeaders, rateLimit, requestId } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const app = new App({ bodyLimitBytes: 1024 * 1024, requestTimeoutMs: 5_000 });

// Security defaults — usually three plugins in other frameworks.
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

## Built-in docs UI (Scalar / Swagger UI)

```ts
import { scalarHtml, htmlResponse } from "@daloyjs/core/docs";
// returns a self-contained HTML page that loads /openapi.json
```

Mount at `/docs` and the UI is always contract-accurate — never stale.

---

## Security defaults (no plugins required)

| Threat | Default behavior |
|---|---|
| **Body-size DoS** | Streamed read, hard cap (default 1 MiB), `Content-Length` checked first. |
| **Prototype pollution** | `safeJsonParse` strips `__proto__` / `constructor` / `prototype` via reviver. |
| **Header / response splitting** | `sanitizeHeaderName` / `sanitizeHeaderValue` reject CRLF + NUL. |
| **Path traversal** | Router rejects `..` segments and `//` before walking. |
| **Slow-loris / hung handlers** | `requestTimeoutMs` aborts handlers (default 30 s); Node adapter sets `requestTimeout` + `headersTimeout` + `maxHeaderSize`. |
| **MIME sniffing** | `secureHeaders()` sets `X-Content-Type-Options: nosniff`. |
| **Clickjacking** | `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`. |
| **XSS via injected scripts** | Strict CSP `default-src 'self'` baseline. |
| **Cross-origin leakage** | `cross-origin-opener-policy` + `cross-origin-resource-policy` set to `same-origin`. |
| **Information disclosure (5xx)** | Production mode strips `detail` from 5xx problem+json automatically. |
| **Credential timing attacks** | `timingSafeEqual()` for tokens & signatures. |
| **Brute-force / scraping** | `rateLimit()` with token-bucket + `Retry-After`. |
| **Method confusion** | Real **405** with `Allow` header, not a misleading 404. |
| **CORS misconfig** | Explicit allowlist; never `*` with credentials. |
| **Request correlation** | Cryptographic `randomId()` request ids on every response. |
| **Supply chain** | Distributed via pnpm with hardening `.npmrc`; reproducible lockfile; opt-in `ignore-scripts` + `minimum-release-age`. |

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

## Status & roadmap

Full, versioned plan: [ROADMAP.md](./ROADMAP.md).

**Implemented (v0.1):**

- [x] Trie router with static fast path + 405 with `Allow` + traversal guard
- [x] Contract-first `app.route()`, groups, encapsulated plugins, decorators
- [x] Standard Schema validation (Zod 4 / Valibot / ArkType / TypeBox)
- [x] Problem+json error model with prod-mode redaction
- [x] OpenAPI 3.1 generator (built-in)
- [x] In-process test client + contract-test runner
- [x] In-process typed client factory + Hey API codegen integration (`pnpm gen`)
- [x] Node / Bun / Deno / Cloudflare / Vercel adapters
- [x] Security: body limits, content-type allowlist, prototype-pollution-safe JSON, path-traversal rejection, request timeout, header injection guards
- [x] Security middleware: `secureHeaders` / `cors` / `rateLimit` / `requestId` / `bearerAuth` / `timing` / `timingSafeEqual`
- [x] Pluggable structured logger + request id propagation
- [x] Graceful shutdown
- [x] Mock mode
- [x] Scalar + Swagger UI handlers
- [x] **pnpm-first distribution with hardened `.npmrc`**
- [x] **100% line + function coverage** enforced by `pnpm coverage`

**Next (`0.2.0` — see [ROADMAP.md](./ROADMAP.md) for the full plan):**

- [ ] `onSend` hook for response transformation
- [x] GitHub Actions CI for install, typecheck, tests, coverage, build, and audit
- [x] `SECURITY.md` and vulnerability disclosure process
- [x] `pnpm create daloy` project scaffolder (Node + Vercel Edge + Cloudflare templates)
- [ ] Branch coverage push to `>= 98%`
- [ ] Release and package-name docs cleanup

**On deck (`0.3.0` and beyond):** SSE/NDJSON streaming, OpenTelemetry,
multipart/form-data ergonomics, CSRF helper, scaffolder, Redis rate-limit store,
CLI route and schema inspector, WebSockets, and HTTP/2 + HTTP/3 adapters.

## License

MIT
