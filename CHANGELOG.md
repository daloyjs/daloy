# Changelog

All notable changes to **`@daloyjs/core`** (and its companion **`create-daloy`**
scaffolder, which ships in lockstep) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
For the forward-looking plan and the full thematic release log, see
[`ROADMAP.md`](ROADMAP.md).

> Now in the **1.0.0 beta**. The public API is feature-complete and stable for
> the 1.0 line; from 1.0 onward, breaking changes follow semver. `@daloyjs/core`
> and `create-daloy` ship together, so every release publishes a matching
> scaffolder and generated projects pin the latest peer.

## [Unreleased]

### Fixed

- **Plugin decorations are now correctly encapsulated.** `app.decorate()` called
  inside a plugin/group is scoped to that plugin's routes as the docs promise:
  it no longer leaks sideways to sibling plugins or up to the root, and a
  plugin's own routes reliably see it (previously a decoration set inside a
  plugin was either invisible or, when the root also had a decoration, visible
  app-wide). Each route now snapshots the decorations of its registration scope,
  matching how group/route hooks are already scoped. Decorate before registering
  the routes that read the value (the same ordering Fastify requires).

## [1.0.0-rc.2] - 2026-07-07

### Changed

- **`daloy dev` on Node now spawns `node --watch <entry>`** instead of
  `node --import tsx --watch <entry>` — Node.js (>= 22.18, stable in 24+) runs
  erasable-only TypeScript entries natively via built-in type stripping, so no
  loader is required. Projects that rely on non-erasable syntax (enums, runtime
  namespaces, parameter properties) or extensionless relative imports can keep
  running a loader directly (`node --import tsx --watch <entry>`).
- **The `daloy` CLI shim loads TypeScript entries natively first** for
  `inspect` / `doctor` / `contract`, falling back to registering `tsx` (when
  installed in the consumer project) only if the native load fails.
- **`create-daloy` templates no longer depend on `tsx`** — the `node-basic`,
  `vercel`, and `cloudflare-worker` templates run tests (`node --test`), the
  OpenAPI dump script, and the Vercel dev server (`node --watch src/dev.ts`)
  through Node's native type stripping. Template `tsconfig.json`s adopt the
  Node-recommended `erasableSyntaxOnly` + `verbatimModuleSyntax` flags, and the
  `vercel` / `cloudflare-worker` templates now declare the same Node `engines`
  range as `node-basic`.
- **Template devDependencies refreshed** to match the versions the repo itself
  builds with: `@hey-api/openapi-ts` `^0.97.1` → `^0.99.0` (node-basic,
  bun-basic) and `@types/node` `^25.7.0` → `^26.1.0` (node-basic, vercel).

## [1.0.0-rc.1] - 2026-07-04

A security-hardening release from an internal audit against a 17-category threat
model. It tightens several secure-by-default guarantees and, because the
framework has no external users yet, ships a few **breaking changes** now rather
than deferring them past GA.

### Security

- **MCP `tools/call` arguments are now validated server-side** against the
  tool's `inputSchema` before the handler runs, via a new dependency-free
  JSON-Schema subset validator (`type` incl. `integer`, `required`,
  `properties`, `additionalProperties`, `enum`, `const`, and string/number/array
  bounds). A violation is rejected with JSON-RPC `-32602` and the handler never
  sees a non-conforming payload. `pattern` is intentionally not enforced
  (ReDoS-sink avoidance) — validate those constraints in your handler.
- **MCP JSON-RPC request bodies are parsed with `safeJsonParse`**, stripping
  `__proto__` / `constructor` / `prototype` keys before tool arguments reach a
  handler (parity with the REST body parsers).
- **HTTP Message Signatures enforce a 2048-bit RSA modulus floor** for
  `rsa-pss-sha512` / `rsa-v1_5-sha256`, matching the JWT verifier
  (NIST SP 800-131A).
- **`urlFeed()` (ip-reputation) is SSRF-hardened by default** — its outbound
  feed fetch now runs through `fetchGuard()` (per-hop redirect re-validation,
  cloud-metadata / internal targets refused). Override via `fetchImpl`.
- **The unconfigured-`trustProxy` production boot guard also refuses vendor
  client-IP headers** (`cf-connecting-ip`, `fly-client-ip`, `true-client-ip`)
  alongside `X-Forwarded-*` / `X-Real-IP`.

### Added

- **`markAuthHook(hooks)` + `AUTH_HOOK_MARKER`** to mark a custom (or
  upstream-gateway-enforced) authentication hook so it satisfies the new
  route-auth boot guard. The built-in auth middlewares (`bearerAuth`,
  `basicAuth`, `jwk`, `httpSignatureAuth`, `clientCertAuth`) carry the marker
  automatically.
- **`validateMcpInput(schema, value)`** — the reusable MCP input validator.
- **`mcpRoutes(path, handler, { public: true })`** (`McpRoutesOptions`) to opt a
  deliberately public MCP endpoint out of the new MCP auth boot guard.

### Changed

- **BREAKING: production `secureDefaults` apps refuse to boot on shadow auth.** A
  route that declares an `auth:` requirement but installs no authentication hook
  to enforce it is now a boot error (previously `auth:` was OpenAPI-only
  documentation). Wire an auth middleware, mark a custom hook with
  `markAuthHook()`, or drop the `auth:` declaration.
- **BREAKING: production `secureDefaults` apps refuse to boot on an
  unauthenticated `mcpRoutes()` endpoint.** Cover the route with auth or pass
  `{ public: true }`.
- **BREAKING: MCP `tools/call` rejects schema-violating arguments** with
  `-32602` before the handler runs (previously `inputSchema` was advertised to
  clients but never enforced). Handlers that relied on receiving unvalidated
  arguments must adjust.
- **Version: `1.0.0-rc.0` → `1.0.0-rc.1`** across the lockstep packages
  (`@daloyjs/core`, `create-daloy`, JSR `@daloyjs/daloy`), the `create-daloy`
  templates, the website version reference, the Deno adapter docs, and the SBOMs.

## [1.0.0-rc.0] - 2026-07-03

The **first `1.0.0` release candidate**. The public API is frozen: from here to
GA only bug fixes and documentation land, no new surface. `@daloyjs/core`,
`create-daloy`, and the JSR package `@daloyjs/daloy` move to `1.0.0-rc.0` in
lockstep, and every `create-daloy` template now pins `@daloyjs/core@^1.0.0-rc.0`.
Projects on `^1.0.0-beta.7` upgrade with a version bump.

### Changed

- **Version: `1.0.0-beta.7` → `1.0.0-rc.0`** across the lockstep packages
  (`@daloyjs/core`, `create-daloy`, and JSR `@daloyjs/daloy`), with the
  `create-daloy` templates, workshop, README status line, website version
  reference, Deno adapter docs, and SBOMs synced to `1.0.0-rc.0`.
- **Scaffolder templates aligned with their own security + contract guidance.**
  The `node-basic`, `bun-basic`, `deno-basic`, `cloudflare-worker`, and `vercel`
  templates and their bundled `daloyjs-best-practices` skill were brought into
  agreement so a freshly scaffolded app follows the secure-by-default and
  contract-first patterns the docs describe out of the box.

### Performance

- **Faster Node hot path: lazy Request/Response shims + sync-first validation**
  (+21% on the full-contract benchmark, +53% on the bare echo path). No public
  API or behavior change; existing security checks (body limits, timeouts,
  validation, response-field stripping) are unchanged and still covered.

### Fixed

- **Docs site hydration stabilized** and the docs UX pass finished (navigation
  table of contents, pager, breadcrumb, and search components). Website only;
  not part of the `@daloyjs/core` / `create-daloy` package release.

## [1.0.0-beta.7] - 2026-07-02

### Added

- **MCP spec catch-up (2025-06-18 / 2025-11-25 server features).**
  `createMcpHandler()` now supports RFC 6570 resource templates
  (`resourceTemplates` + `resources/templates/list`, with `{name}` variable
  extraction on `resources/read`), tool `outputSchema` and `annotations`
  (read-only / destructive / idempotent / open-world hints), icons on the
  server, tools, resources, templates, and prompts, and `description` /
  `websiteUrl` on `serverInfo`. Tool results that return only
  `structuredContent` get a serialized text block backfilled for older
  clients; unknown pagination cursors are rejected with invalid-params on all
  list methods; `prompts/get` enforces `required` prompt arguments; and
  headerless non-`initialize` requests assume protocol `2025-03-26` per the
  Streamable HTTP backwards-compatibility rule.
- **`acknowledgeNoResponseBodySchema` route flag.** The documented escape
  hatch for the `security.response.bodySchemaMissing` boot warning and the
  `audit.response.bodySchema` doctor finding: set it on routes that
  intentionally return an opaque or framework-controlled body (a raw
  `Response`, HTML, a proxied payload). The warning message now names the
  flag and links to the OWASP API3 docs.

### Changed

- **Framework-mounted routes no longer trip the framework's own
  `bodySchemaMissing` warning.** The `docs: true` routes (`/openapi.json`,
  `/openapi.yaml`, `/docs`), the AsyncAPI surface (`/asyncapi.json`,
  `/asyncapi.yaml`, `/asyncapi`), and the health / metrics probes serialize
  framework-controlled bodies, so they now acknowledge themselves — the
  diagnostic only ever names routes the application authored. `mcpRoutes()`
  additionally exposes the JSON-RPC 2.0 envelope as a real JSON Schema in the
  generated OpenAPI document instead of an empty placeholder.

### Fixed

- **Multipart uploads from real-world clients no longer fail with `500`.** The
  request body parser lower-cased the whole `Content-Type` header for its
  case-insensitive media-type check and then reused that string — including the
  `boundary=` parameter — when reconstructing the request for `formData()`.
  Multipart boundaries are case-sensitive (RFC 2046 §5.1.1), so any upload whose
  boundary contained uppercase letters — every Chromium/WebKit browser
  (`----WebKitFormBoundary…`) and curl (`------------------------…`) — failed to
  parse and returned `500 Internal Server Error`. Native `fetch`/undici (which
  emits an all-lowercase boundary) worked, masking the bug. The parser now
  preserves the original-case `Content-Type` when reparsing, and a body the
  platform parser cannot read is surfaced as an RFC 9457 `400 Bad Request`
  instead of a generic `500`.
- **`discriminatedUnion()` no longer 500s on an inherited-property discriminator
  value.** The variant lookup used a bare `variants[discriminatorValue]`, so a
  request whose discriminator named an inherited `Object.prototype` member
  (`constructor`, `toString`, `valueOf`, `hasOwnProperty`, `__proto__`,
  `isPrototypeOf`) resolved to that member, slipped past the "unknown value"
  guard, and then threw an uncaught `TypeError` on `variant["~standard"]` —
  surfacing as an unauthenticated `500` (and error-log flood) on any route with
  a `discriminatedUnion` body schema. The lookup now requires an **own**
  property (`Object.hasOwn`), so these values return the intended clean
  `400`/validation issue.

### Security

- **MCP Streamable HTTP endpoints now validate `Origin` (DNS-rebinding
  defense).** The spec requires it; `createMcpHandler()` previously accepted
  any origin. Requests without an `Origin` header (non-browser MCP clients),
  same-origin requests, and loopback origins (`localhost`, `*.localhost`,
  `127.0.0.1`, `[::1]`) are allowed; every other browser origin is rejected
  with `403` unless listed in the new `allowedOrigins` option.
- **`waf()` query inspection now matches the application's own query parser.**
  The WAF decoded the query string with `decodeURIComponent`, which does **not**
  turn `+` into a space, while the framework parses the query with
  `URLSearchParams`, which does. An attacker could therefore replace spaces with
  `+` (`1+OR+1=1`) to slip a signature past the WAF while the handler still
  received the space-separated payload (`1 OR 1=1`) — a parser differential. The
  WAF now also scans each `URLSearchParams`-decoded key/value, closing the gap.
  (Decoding remains deliberately single-pass; recursive decoding is intentionally
  avoided to prevent false positives, and a double-encoded payload stays inert
  all the way to the handler.)
- **`waf()` inline-event-handler XSS signature broadened.** The handler
  allowlist covered only `onerror|onload|onclick|onmouseover|onfocus|onsubmit|ontoggle|onanimationstart`,
  letting paren-less evasions using other handlers (`onpointerover`, `onfocusin`,
  `onwheel`, `onauxclick`, `oncontextmenu`, `onbeforetoggle`, touch/drag/clipboard
  events, …) through. The signature now covers the commonly-abused handler set
  via an explicit alternation (still not `on\w+`, to avoid false-positives on
  benign params such as `online=`/`once=`), verified linear-time (no ReDoS).

## [1.0.0-beta.6] - 2026-07-01

The seventh **1.0.0 beta**. Adds a dependency-free **Model Context Protocol
(MCP)** Streamable HTTP server helper to `@daloyjs/core` and advances the
lockstep version train. Projects on `^1.0.0-beta.5` upgrade with a version
bump. `@daloyjs/core`, `create-daloy`, and the JSR package `@daloyjs/daloy`
move to `1.0.0-beta.6` in lockstep, and every `create-daloy` template now pins
`@daloyjs/core@^1.0.0-beta.6`.

### Added

- **MCP Streamable HTTP helpers** at `@daloyjs/core/mcp` (and the main barrel):
  `createMcpHandler()` exposes tools, resources, and prompts over JSON-RPC 2.0,
  and `mcpRoutes("/mcp", handler)` mounts the `POST` / `GET` / `OPTIONS` Daloy
  routes for a dedicated MCP service. `McpToolError` marks caller-correctable
  tool failures. The helper adds no runtime dependencies, ships protocol-level
  guards (256 KiB body cap, UTF-8/JSON validation, batch rejection,
  protocol-version allowlist, `application/json` enforcement, and prod-mode
  error redaction), and composes with existing middleware (`bearerAuth`,
  `rateLimit`, `secureHeaders`) for auth and rate limits.

### Changed

- **Version: `1.0.0-beta.5` → `1.0.0-beta.6`** across the lockstep packages
  (`@daloyjs/core`, `create-daloy`, and JSR `@daloyjs/daloy`), with the
  `create-daloy` templates, workshop, README status line, website version
  reference, Deno adapter docs, and SBOMs synced to `1.0.0-beta.6`.

## [1.0.0-beta.5] - 2026-07-01

The sixth **1.0.0 beta**. A lockstep maintenance release that advances the
version train and keeps every package, template, and doc reference in sync.
Projects on `^1.0.0-beta.4` upgrade with a version bump. `@daloyjs/core`,
`create-daloy`, and the JSR package `@daloyjs/daloy` move to `1.0.0-beta.5` in
lockstep, and every `create-daloy` template now pins
`@daloyjs/core@^1.0.0-beta.5`.

### Changed

- **Version: `1.0.0-beta.4` → `1.0.0-beta.5`** across the lockstep packages
  (`@daloyjs/core`, `create-daloy`, and JSR `@daloyjs/daloy`), with the
  `create-daloy` templates, workshop, README status line, website version
  reference, Deno adapter docs, and SBOMs synced to `1.0.0-beta.5`.

## [1.0.0-beta.4] - 2026-06-26

The fifth **1.0.0 beta**. Keeps the 1.0 line in beta while adding a handler
escape hatch, a routing-safety guard, and a broad documentation accuracy pass.
Projects on `^1.0.0-beta.3` upgrade with a version bump. `@daloyjs/core`,
`create-daloy`, and the JSR package `@daloyjs/daloy` move to `1.0.0-beta.4` in
lockstep, and every `create-daloy` template now pins
`@daloyjs/core@^1.0.0-beta.4`.

### Added

- **Raw `Response` return from handlers.** A route handler (or an `afterHandle`
  transform) may now return a web-standard `Response` directly, an escape hatch
  for streaming, proxying, or pre-built bodies (for example a Vercel AI SDK
  `result.toUIMessageStreamResponse()` or a forwarded upstream `fetch()`). A
  returned `Response` bypasses response-schema validation by design (no schema
  can describe an opaque stream), but is finalized through the exact same
  pipeline as every other response, so no security control is skipped: `ctx.set`
  headers (`secureHeaders` / CORS) are copied on, `x-request-id` is added when
  absent, `onSend` / `onResponse` hooks run, server-fingerprint headers are
  stripped, and a `HEAD` request still yields an empty body. Prefer the
  structured `{ status, body }` result whenever a schema can describe the payload.
- **AI SDK, auth, and database guides.** New website docs for the Vercel AI SDK
  integration, Better Auth, LoginRadius, DuckDB, and Replit deployment, plus a
  streaming docs refresh.

### Fixed

- **Routing-safety guard: array or keyless `hooks` no longer silently no-op.**
  `app.route({ hooks })` now throws when `hooks` is an array, or an object that
  carries none of the recognized hook keys (`onRequest`, `beforeHandle`,
  `afterHandle`, `onError`, `onSend`, `onResponse`). Previously such a value was
  read as `undefined` and applied nothing, so a route that looked guarded
  (`hooks: [ipRestriction(...), bearerAuth(...)]`) could ship wide open. Compose
  multiple bundles with `every(...)` (all must pass) or `some(...)` (any may
  pass). An empty `{}` stays an explicit, allowed no-op.
- **Documentation accuracy pass.** Verified and corrected concrete examples
  across the docs against the published framework: the errors page now lists
  `ConflictError` (409) and `RequestHeaderFieldsTooLargeError` (431); the
  response-cache `X-Cache` marker claim is scoped to requests the cache actually
  handles; and the API reference plus the security, auth, geo-block,
  webhook-delivery, and database guides were corrected to match the real route,
  hook, and middleware APIs.

### Changed

- **Version: `1.0.0-beta.3` → `1.0.0-beta.4`** across the lockstep packages
  (`@daloyjs/core`, `create-daloy`, and JSR `@daloyjs/daloy`), with the
  `create-daloy` templates, workshop, README status line, website version
  reference, Deno adapter docs, and SBOMs synced to `1.0.0-beta.4`.

## [1.0.0-beta.3] - 2026-06-24

The fourth **1.0.0 beta**. This keeps the 1.0 line in beta, not release
candidate, while shipping hardening and docs polish gathered after
`1.0.0-beta.2`. Projects on `^1.0.0-beta.2` upgrade with a version bump.
`@daloyjs/core`, `create-daloy`, and the JSR package `@daloyjs/daloy` move to
`1.0.0-beta.3` in lockstep, and every `create-daloy` template now pins
`@daloyjs/core@^1.0.0-beta.3`.

### Added

- **End-of-life runtime scanning for generated apps.** The `create-daloy`
  `--with-ci` templates now include runtime EOL checks for Node, Bun, and Deno,
  with matching SECURITY.md guidance and template coverage. Generated projects
  can catch unsupported runtime majors before they become a deployment risk.
- **Stripe payment integration docs.** The website now includes a Stripe guide
  and navigation/sitemap entries alongside the existing payment docs.

### Fixed

- **Safe redirects reject encoded backslashes and protocol-relative paths.**
  The redirect helper now blocks more bypass forms that can otherwise collapse
  into attacker-controlled absolute URLs in downstream clients or proxies.
- **Node adapter request-target normalization.** Malformed request targets are
  normalized before URL construction so invalid paths no longer surface as
  unexpected 500 responses.

### Changed

- **Version: `1.0.0-beta.2` → `1.0.0-beta.3`** across the lockstep packages
  (`@daloyjs/core`, `create-daloy`, and JSR `@daloyjs/daloy`), with the
  `create-daloy` templates, workshop, README status line, website version
  reference, Deno adapter docs, and SBOMs synced to `1.0.0-beta.3`.
- **Template pre-push hooks and docs were refreshed** to match the current
  verification workflow and reduce stale generated-project guidance before GA.
- **Framework docs received broad polish** across routing, validation, CLI,
  AsyncAPI, plugins, testing, pagination, config, and migration pages.

## [1.0.0-beta.2] - 2026-06-22

The third **1.0.0 beta**. The public API remains feature-complete and stable for
the 1.0 line, but the release train stays open for final polish before GA.
Projects on `^1.0.0-beta.1` upgrade with a version bump. `@daloyjs/core`,
`create-daloy`, and the JSR package `@daloyjs/daloy` move to `1.0.0-beta.2` in
lockstep, and every `create-daloy` template now pins
`@daloyjs/core@^1.0.0-beta.2`.

### Added

- **Continuous fuzzing via ClusterFuzzLite.** The untrusted-input parsers in
  `@daloyjs/core` are now continuously fuzzed with Jazzer.js, wired through
  [ClusterFuzzLite](https://google.github.io/clusterfuzzlite/): a per-PR
  `code-change` run on `src/` changes plus a daily batch run that persists a
  growing corpus. Six targets in [`.clusterfuzzlite/`](.clusterfuzzlite/) cover
  `safeJsonParse` (prototype-pollution gate), the cookie/header sanitizers,
  `decodeCursor`, `parseCron`, and `parseIp`. Each target asserts the function's
  documented contract — a declared rejection (e.g. `BadRequestError` on
  malformed input) is correct behavior, so only an undocumented throw or a hang
  is a finding. This is also what earns the OpenSSF Scorecard **Fuzzing** check.
  The OSS-Fuzz base image is digest-pinned and all workflow actions are
  SHA-pinned.

### Removed

- **The deprecated `--template vercel-edge` scaffolder alias.** The template was
  renamed `vercel-edge` → `vercel` back in `0.38.2`; the leftover back-compat
  alias (and its test) are now gone. Scaffold with `--template vercel`. This is a
  `create-daloy` CLI change only — the framework's `@daloyjs/core/vercel` adapter
  surface is unchanged.

### Changed

- **Version: `1.0.0-beta.1` → `1.0.0-beta.2`** across the lockstep
  packages (`@daloyjs/core`, `create-daloy`, and JSR `@daloyjs/daloy`), with the
  `create-daloy` templates, workshop, README status line, and website version
  reference synced to `1.0.0-beta.2`.
- **Swagger UI option types are exported from the package barrel.**
  `SwaggerUiConfiguration` and `SwaggerUiHtmlOptions` were already documented
  and implemented in `@daloyjs/core/docs`; they now flow through the root
  `@daloyjs/core` type export list as well.
- **OpenSSF Scorecard now uses an optional `SCORECARD_TOKEN`** (a read-only admin
  PAT) for fuller Branch-Protection evaluation, falling back to `GITHUB_TOKEN`
  when the secret is absent — safe to run before the secret exists.

### Notes

- Source files carry an internal formatting normalization (no behavior change)
  and a TSDoc wording fix (“Vercel Edge Functions” → “Vercel Functions”).

## [1.0.0-beta.1] - 2026-06-21

The second **1.0.0 beta** — a small, security-leaning patch on top of
`1.0.0-beta.0`. No breaking changes and no public API additions; projects on
`^1.0.0-beta.0` upgrade with a version bump. `@daloyjs/core`, `create-daloy`,
and the JSR package `@daloyjs/daloy` move to `1.0.0-beta.1` in lockstep, and
every `create-daloy` template now pins `@daloyjs/core@^1.0.0-beta.1`.

### Added

- **Indeterminate-environment security warning.** When a production-only
  refuse-to-boot guard (a wildcard `cors({ origin: "*" })`, a weak `session()`
  secret) is bypassed *only* because the runtime environment is indeterminate
  (no `env` option and no `NODE_ENV`, the default on edge runtimes such as
  Cloudflare Workers / Deno Deploy / Vercel), the framework now logs a
  single once-per-process warning pointing at `app({ env: "production" })`.
  Enforcement is unchanged and the runtime is deliberately not sniffed (which
  would break portability); the warning only surfaces a previously silent skip,
  and only when a risky config is actually present.

### Fixed

- **Node adapter: Fetch-forbidden methods (`TRACE` / `CONNECT` / `TRACK`) are
  refused with `501 Not Implemented`** instead of surfacing a generic `500`.
  The WHATWG `Request` constructor throws on these methods, so the adapter now
  refuses them cleanly before constructing a `Request` (which also closes
  Cross-Site Tracing). Other unsupported verbs continue to return `405`.
- **`multipart/form-data` bodies are capped at `bodyLimitBytes` even without a
  `Content-Length`.** Chunked or mislabeled multipart uploads were handed to the
  platform `formData()` parser uncapped on runtimes without a socket-layer limit
  (Workers / Deno / Vercel); the actual bytes are now bounded before
  parsing. Web-standard only (`Request` + `formData`), so it stays
  runtime-portable.

### Changed

- **Version: `1.0.0-beta.0` → `1.0.0-beta.1`** across the lockstep packages
  (`@daloyjs/core`, `create-daloy`, and JSR `@daloyjs/daloy`), with the
  `create-daloy` templates, workshop, README status line, and website version
  reference synced to `1.0.0-beta.1`.

## [1.0.0-beta.0] - 2026-06-21

The first public **1.0.0 beta**. After the `0.x` preview line, the public API is
now feature-complete and considered stable for the 1.0 release. This is the build
we want people to test in anger and report back on before the `1.0.0` GA. There
are no functional code changes from `0.44.0`: every guardrail, adapter, and
helper that shipped across `0.x` is here, unchanged. What changed is the promise.
From 1.0 onward, breaking changes follow SemVer (no breaking change in a `1.x`
minor).

### Changed

- **Version milestone: `0.44.0` → `1.0.0-beta.0`.** `@daloyjs/core`,
  `create-daloy`, and the JSR package `@daloyjs/daloy` all move to
  `1.0.0-beta.0` in lockstep, and every `create-daloy` template now pins
  `@daloyjs/core@^1.0.0-beta.0`. Published to the npm `latest` tag (and JSR), so
  `pnpm create daloy@latest` and a plain `npm i @daloyjs/core` resolve the beta.
- Workshop, README status, and website version references synced to
  `1.0.0-beta.0`.

### Notes

- **No API changes from `0.44.0`.** If you are on `^0.44.0` today, nothing
  breaks; the upgrade is a version bump.
- Still pre-GA: small adjustments are possible before `1.0.0` final if beta
  feedback surfaces something. Once `1.0.0` ships, deprecations follow the
  one-minor-cycle policy.

## [0.44.0] — 2026-06-21

A security-hardening release driven by a live black-box red-team engagement
against a running server: a slowloris fix in the Node adapter and an opt-in
SSRF DNS-pinning knob that closes the documented rebinding window for `http:`.

### Added

- **`fetchGuard({ pinDns: true })` — DNS-rebinding (TOCTOU) protection for
  `http:`.** The SSRF guard validates a hostname's resolved address and then,
  by default, hands the original `Request` to `fetch`, which re-resolves the
  hostname at connect time — the documented residual rebinding window. With
  `pinDns: true`, `http:` requests are dispatched through Node's built-in
  `node:http` with the socket **pinned to the validated IP** and the original
  `Host` header preserved (so virtual-host routing still works), so an
  attacker's TTL=0 rebind to `127.0.0.1` / `169.254.169.254` can no longer take
  effect between validation and connect. Scope: `http:` only (the prime
  metadata vector), Node only, opt-in (default `false` — zero behavior change
  for existing callers); `https:` retains the documented caveat. Covered by new
  tests in [`tests/fetch-guard.test.ts`](tests/fetch-guard.test.ts) and a
  regression that proves re-encoded internal IPs (decimal/hex/octal/short form)
  are normalized and blocked.

### Security

- **The Node adapter now enforces `connectionTimeoutMs` promptly (slowloris
  fix).** `serve()` derived `headersTimeout` / `requestTimeout` from
  `connectionTimeoutMs`, but left Node's `connectionsCheckingInterval` at its
  30-second default — so Node only *checked* for timed-out connections every
  30s. A client that stalled (or trickled its request headers a byte at a time)
  held a socket open until the next sweep, far past the configured timeout. The
  adapter now lowers `connectionsCheckingInterval` to a fraction of
  `connectionTimeoutMs` (bounded to 1–5s), so a stalled connection is reaped
  with `408` close to its deadline. `connectionTimeoutMs: 0` still disables the
  timeouts entirely. This is a setup-time change only (no per-request hot-path
  cost) and the `connectionTimeoutMs` contract is unchanged. New regression
  tests in [`tests/node-adapter.test.ts`](tests/node-adapter.test.ts) cover the
  idle and active-trickle slowloris variants and the disable path. A live
  attack harness, `pnpm red-team:live`, reproduces the engagement end-to-end.

## [0.43.0] — 2026-06-20

A maintenance release focused on **scaffolder onboarding** and **runtime
portability**. `create-daloy` now points you at the official install guide for
any runtime or package manager the chosen template needs but that isn't on your
`PATH`, and `@daloyjs/core`'s startup banner is now safe under Deno's
capability-based `--allow-env` permission model. The unused `/app` package
export was removed and is now guarded by an exports-parity test. `@daloyjs/core`
and `create-daloy` publish at the same version in lockstep.

### Added

- **Missing-tooling install links in `create-daloy`.** After scaffolding, the
  CLI probes `PATH` (without executing anything) for the runtime and package
  manager the generated project's "Next steps" rely on — Node, npm, pnpm, Yarn,
  Bun, or Deno depending on the template — and prints the official install URL
  for any that are absent. When the selected package manager itself is missing,
  the dependency install is skipped with a clear pointer instead of failing on
  an opaque spawn error.

### Fixed

- **Startup banner under Deno `--allow-env`.** The cosmetic startup banner read
  environment variables (`NO_COLOR`, `FORCE_COLOR`, `LANG`, `TERM_PROGRAM`, …)
  directly. On Deno's capability-based permission model, reading a variable not
  granted via `--allow-env` throws `NotCapable` and could crash the host app.
  Banner env reads are now wrapped defensively so a denied read is treated as
  "unset" — never a crash. No-op on Node and Bun, where `process.env` access
  never throws.

### Changed

- **Removed the unused `/app` package subpath export.** `@daloyjs/core/app` was
  never a documented entrypoint; the public surface is unchanged for every
  supported import. A new exports-parity test now guards the export map against
  drift, and subpath imports are documented.
- **CLI TSDoc:** corrected the documented `daloy doctor` exit codes and the
  `--json` `ok` semantics.

## [0.42.0] — 2026-06-19

A feature release that rounds out two areas: **multitenancy** and **real-time
docs**. `@daloyjs/core` gains a secure-by-default `tenancy()` primitive and an
auto-mounted interactive **AsyncAPI UI** (the WebSocket counterpart to the
Scalar / Swagger / Redoc OpenAPI viewers), plus a WebSocket close-lifecycle fix.
`create-daloy` publishes at the same version in lockstep.

### Added

- **Multitenancy via `tenancy()`** at `@daloyjs/core/tenancy` — a dependency-free
  `Hooks` bundle that resolves the calling tenant once per request and exposes
  it on `ctx.state.tenant`. Pluggable resolution (`tenantFromSubdomain`
  PSL-aware, `tenantFromHeader`, `tenantFromPathPrefix`, `tenantFromClaim`, or a
  custom `(ctx) => string`, tried in array order). Secure-by-default:
  **refuse-unresolved** (no ambient "default" tenant leak), **format-validated
  ids** (rejects key/log-injection and cache-poisoning payloads before they
  reach a key), **no-enumeration `404`** for unknown tenants, and
  **host-spoof-safe** subdomain resolution. A `tenantScope()` key helper drops
  straight into `rateLimit` `keyGenerator` and `concurrencyLimit` /
  `idempotency` / `responseCache` `scope` to partition each per tenant
  (CWE-524 cross-tenant cached-response defense). Runnable
  `examples/multitenancy-demo.ts`.
- **Interactive AsyncAPI UI** via `asyncapi: true` (mirroring `docs: true`) —
  auto-mounts `GET /asyncapi` (the official AsyncAPI React component, loaded from
  a CDN via a `<script>` tag exactly like the OpenAPI viewers — no build step, no
  runtime dependency), plus `GET /asyncapi.json` and `GET /asyncapi.yaml`. The
  document is generated lazily so `app.ws()` routes registered after construction
  are included. `"auto"` skips production; the object form
  (`AsyncAPIRouteOptions`) exposes custom paths, `servers`, UI `configuration`,
  and SRI-pinnable `assets`. The UI page ships the same hardened response as the
  OpenAPI docs (strict CSP scoped to the asset origin + `connect-src 'self'`,
  `nosniff`, `no-referrer`). HTTP `openapi.servers` are mapped to AsyncAPI
  `ws`/`wss` servers when none are given. Runnable `examples/websocket-demo.ts`
  and `examples/scheduler-demo.ts`.

### Fixed

- **WebSocket close lifecycle (Node adapter).** A socket error arriving *after*
  the close handshake — e.g. a peer that resets the TCP connection right after
  closing, or a `terminate()` racing the OS — no longer fires the handler's
  `error()` callback after `close()` already fired. This restores the "no events
  after close" contract and prevents double-running handler cleanup.

## [0.41.0] — 2026-06-18

A tooling release for the **`create-daloy`** scaffolder: every generated project
now gates its OpenAPI contract automatically, and gets an opt-in localhost
`pre-push` hook. `@daloyjs/core` publishes at the same version in lockstep — there
is **no runtime code change** this release (the `runContractTests` runner and
`daloy inspect --check` already shipped in 0.40.0); only the scaffolder, its
templates, the docs, and the package README change.

### Added

- **Contract gate in every template.** Each scaffold now ships a
  `tests/contract.test.ts` (`tests/contract_test.ts` on Deno) that runs
  `runContractTests` against the real app and proves the gate rejects a broken
  contract. It runs under the project's `test` task, so a missing or duplicate
  `operationId`, a response example that doesn't match its schema, or a route
  with no declared responses fails CI from the first commit.
- **Opt-in `pre-push` contract hook.** Templates ship `.githooks/pre-push` plus a
  `hooks:install` script that points `core.hooksPath` at it — a localhost-only
  gate that runs the contract check before a push (`daloy inspect --check` on
  Node / Vercel / Cloudflare, the contract test on Bun / Deno). It skips
  gracefully when tooling is absent (never blocks a push over a missing
  dependency) and is bypassable with `git push --no-verify`. A new `contract`
  script/task runs the same check on demand.
- **Example-app contract gated in CI.** The framework's own CI now runs
  `daloy inspect --check examples/app.ts` after the build, guarding the showcase
  app's contract (and the `daloy inspect --check` path itself) against regressions.

### Changed

- The scaffolder preserves file modes when copying templates (so the executable
  `pre-push` hook survives scaffolding) and maps the authored `_githooks/`
  directory to `.githooks/` in generated projects.

## [0.40.0] — 2026-06-18

A security-hardening release focused on **response-side data exposure** and
**cross-tenant cache isolation** (OWASP API3 / API2, CWE-524 / CWE-213), plus a
large internal quality pass that brings the entire test suite and build scripts
under type-checking in CI.

> **Behavior changes (pre-1.0 minor).** Three secure-by-default changes may
> affect apps that relied on the previous looser behavior — see **Changed**
> below. Each has an explicit opt-out where a legitimate use case exists.

### Security

- **Response schemas now filter output, not just validate it (OWASP API3 /
  CWE-213).** Response-body validation previously checked the handler's return
  against the declared schema but serialized the original object, so fields a
  handler returned that were **not** declared in the response schema (a stray
  `passwordHash`, a spread ORM row) were emitted to the client. The serializer
  now emits the validator's parsed value, so **only declared fields are sent**,
  at every nesting depth (objects and arrays). Schemas that opt into
  pass-through keep their extra fields.
- **`idempotency()` keys are now namespaced per principal (CWE-524).**
  Previously a client that reused another client's `Idempotency-Key` with the
  same request shape received the other client's stored response. The store key
  is now scoped by the caller — the `Authorization` header by default, or a new
  `scope(ctx)` option for cookie/custom identity. Same-principal retries still
  replay; unauthenticated idempotency still dedupes by key alone.
- **`responseCache()` no longer caches `Authorization`-bearing requests by
  default (CWE-524, RFC 9111 §3.5).** A shared cache keyed on method + URL would
  otherwise serve one user's private response to the next caller of the same
  URL. Opt back in with `cacheAuthenticatedRequests: true` for genuinely
  shareable content (pair it with `varyHeaders: ["authorization"]`).

### Added

- **`findRoutesMissingResponseBodySchema()`** introspection helper, a
  `daloy doctor` **`audit.response.bodySchema`** finding, and a development-mode
  boot warning that surface routes whose `2xx` responses declare no body schema
  (where the new output filtering above cannot run).
- **`idempotency({ scope })`** — namespace idempotency keys by a caller-supplied
  identity.
- **`responseCache({ cacheAuthenticatedRequests })`** — opt in to caching
  responses for `Authorization`-bearing requests.
- **`typecheck:tests`** package script (and `pnpm typecheck` now also
  type-checks `tests/**` and `scripts/**`).

### Changed

- See **Security** above: response field stripping, per-principal idempotency
  keys, and the response-cache `Authorization` bypass are all enabled by
  default.

### Fixed

- **`MemoryIdempotencyStore` / `MemoryResponseCacheStore` method arity** now
  matches the `IdempotencyStore` / `ResponseCacheStore` interfaces (the
  `ttlMs` parameter the framework's own call sites already pass).
- **Synthetic 404 / preflight contexts** in the request pipeline now compile
  when a consumer augments `AppState` (the documented
  `interface AppState extends SessionState {}` pattern).
- **The test suite and build scripts are now type-checked in CI.** They were
  previously excluded from `pnpm typecheck`, which let ~64 latent type errors
  accumulate — including a Zod v4 `z.record(key, value)` arity break,
  `@types/node` v22 `Dirent` / `parseInt` drift in `scripts/`, and a real
  test bug that passed an object to `app.close(timeoutMs: number)`. All fixed
  and gated.

### Tests

- Expanded the adversarial red-team suite to **127 attacks across 7 waves**
  (injection, SSRF, DoS, auth/authz, smuggling, cross-tenant isolation, and a
  three-front offensive simulation covering exfiltration, denial of service,
  and code execution), run as a dedicated `pnpm test:red-team` CI gate.

## [0.39.1] — 2026-06-17

`@daloyjs/core` has no runtime changes; this is a lockstep re-release whose only
purpose is to ship the **JSR** package [`@daloyjs/daloy`](https://jsr.io/@daloyjs/daloy)
with a **Sigstore provenance attestation**.

### Security

- **The JSR build now ships with a provenance attestation.** `@daloyjs/daloy@0.39.0`
  published to JSR but *without* provenance: the `publish-jsr` CI job's hardened
  egress allowlist was missing the Sigstore hosts (`fulcio.sigstore.dev`,
  `rekor.sigstore.dev`, `tuf-repo-cdn.sigstore.dev`), so `jsr publish` created the
  version and then failed attaching its attestation. The allowlist is fixed, so
  `0.39.1` is published to JSR with verifiable provenance — matching the npm
  packages, which already shipped `0.39.0` with an SLSA provenance attestation.

`create-daloy` is a lockstep `0.39.1` bump: every template now pins
`@daloyjs/core@^0.39.1` (`jsr:@daloyjs/daloy@^0.39.1` for the Deno template).

## [0.39.0] — 2026-06-17

### Added

- **Redoc is now a third built-in OpenAPI docs UI**, alongside Scalar (default)
  and Swagger UI. Set `docs: { ui: "redoc" }` on the `App` constructor to render
  Redoc at `/docs`, and pass Redoc options through `docs.redoc` (forwarded to
  `Redoc.init`). A new `redocHtml` helper is exported from `@daloyjs/core/docs`
  for manual mounting, with matching `RedocConfiguration` and `RedocHtmlOptions`
  types. Because Redoc spins up a `blob:` Web Worker for search, the
  auto-mounted `/docs` CSP widens with `worker-src 'self' blob:` **for
  `ui: "redoc"` only** — Scalar and Swagger UI keep the tighter default.

### Fixed

- **`otelTracing` now follows the OTel HTTP semantic conventions for
  `server.address`/`server.port`.** The span attribute `server.address`
  previously carried the host *with* its port (e.g. `api.example.com:8443`);
  it now holds the bare hostname and the port is emitted separately as the
  numeric `server.port`, so traces line up with conformant backends.
- **`httpMetrics` no longer drives the in-flight gauge negative on OPTIONS
  preflight.** A CORS preflight handled by the framework's `preflightHooks`
  (when no `OPTIONS` route is registered) calls `onSend` without a prior
  `onRequest`, so the gauge is now only balanced — and request/duration metrics
  recorded — when a matching `onRequest` actually ran for that request.

### Documentation

- Added runnable observability example stacks: an OpenTelemetry tracing demo
  wired to Jaeger over OTLP, and a Prometheus + Grafana metrics integration
  stack.

`create-daloy` is a lockstep `0.39.0` bump: every template now pins
`@daloyjs/core@^0.39.0` (`jsr:@daloyjs/daloy@^0.39.0` for the Deno template).

## [0.38.3] — 2026-06-16

`@daloyjs/core` has no runtime changes; this is a lockstep bump alongside the
`create-daloy` Vercel-template fixes below, so a freshly scaffolded Vercel
project deploys cleanly.

### Fixed

- **The `vercel` template now deploys cleanly on Vercel out of the box.** Two
  issues made a freshly scaffolded Vercel project error on deploy:
  - **Root routing.** Vercel maps `api/<file>` to `/api/<file>`, but a DaloyJS
    app routes at the root, so the old `api/[...path].ts` only answered
    `/api/*` and the deployed root domain returned a Vercel 404. The template
    now ships a single `api/index.ts` plus a `vercel.json` rewrite
    (`/(.*)` → `/api`) — the canonical Vercel "framework owns routing"
    pattern — so the app's routes (`/healthz`, `/docs`, …) are served at the
    site root.
  - **Proxy posture.** Vercel always proxies through its edge and sets
    `x-forwarded-for`, so DaloyJS's production boot guard returned 500 on every
    request. The template now sets
    `behindProxy: { hops: Number(process.env.TRUST_PROXY_HOPS ?? "1") }`
    (Vercel is one trusted edge hop; override the env var if another proxy sits
    in front).
- **The `cloudflare-worker` template no longer 500s on deploy.** Cloudflare
  Workers always run behind Cloudflare's edge (which sets `x-forwarded-for`), so
  the same unconfigured-proxy boot guard returned 500 on every request. The
  template now sets `behindProxy: { hops: 1 }` (Cloudflare is one trusted edge
  hop). It also now enables `docs: true` for parity with the other templates, so
  `/docs`, `/openapi.json`, and `/openapi.yaml` are served (the Scalar UI loads
  from a CDN, so the Worker bundle cost is negligible).
- **The `vercel` template's `pnpm dev` no longer recurses.** It previously
  aliased `vercel dev`, which Vercel rejects (`vercel dev must not recursively
  invoke itself`) because it re-reads that script as its dev command. `pnpm dev`
  now runs a local Node dev server (`src/dev.ts`) that serves the same app over
  `@daloyjs/core/node` at the site root — fast iteration with no `vercel dev` or
  Vercel login.
- **Scalar's "Try it" panel works on every deploy target.** The `node-basic`,
  `bun-basic`, and `deno-basic` templates previously set an OpenAPI `servers`
  URL that fell back to `localhost`, which the browser's `connect-src 'self'`
  CSP blocked once deployed where no `PUBLIC_URL` / `RAILWAY_PUBLIC_DOMAIN` was
  set (e.g. Deno Deploy). They now leave `servers` unset by default so Scalar
  calls the origin the docs are served from (the deployed domain in production,
  localhost in dev); set `PUBLIC_URL` to pin an absolute base URL.

### Security

- Pin transitive, dev-only dependencies to clear OSV advisories via pnpm
  overrides: `esbuild` >= 0.28.1 (GHSA-gv7w-rqvm-qjhr, GHSA-g7r4-m6w7-qqqr) and
  `js-yaml` >= 4.2.0 (GHSA-h67p-54hq-rp68). Both are build-time only and not
  part of the published `@daloyjs/core` surface.

### Documentation

- Refreshed the Vercel adapter, scaffolder, and deployment docs to the single
  `api/index.ts` + rewrite pattern.

## [0.38.2] — 2026-06-16

`@daloyjs/core` has no runtime changes in this release; it is a lockstep version
bump published alongside the `create-daloy` scaffolder fixes below, so newly
scaffolded projects pin the latest peer.

### Fixed

- **Scaffolded apps now boot cleanly behind a PaaS edge proxy** (Railway,
  Render, Fly, Heroku). Three deploy-blocking issues in the `create-daloy`
  templates are resolved:
  - The reverse-proxy posture is now an opt-in env knob: set
    `TRUST_PROXY_HOPS` (a single PaaS edge is `1`) and the template wires
    `behindProxy: { hops: N }`. Previously, with the posture unconfigured, the
    production boot guard returned `500 problem+json` on every request carrying
    an `X-Forwarded-*` header (which, behind such a proxy, is every request).
    The secure default is preserved when the variable is unset.
  - The OpenAPI `servers` URL is resolved at runtime
    (`PUBLIC_URL` → `RAILWAY_PUBLIC_DOMAIN` → localhost) so the Scalar "Try it"
    panel targets the deployed origin instead of `localhost` (which the browser
    blocked under the `connect-src 'self'` CSP).
  - The `node-basic` production build now emits a flat `dist/index.js`
    (`tsconfig.build.json` roots at `src`), matching the `start` script and
    Dockerfile `CMD` (`node dist/index.js`). It previously emitted
    `dist/src/index.js`, crashing the container with `MODULE_NOT_FOUND`.
- **Bun template no longer crashes on startup.** Removed the `export default app`
  line from the Bun entrypoint: Bun auto-starts a second server from any module
  whose default export has a `fetch` method, colliding with the explicit
  `serve()` on the same port (`EADDRINUSE`) and surfacing on Railway as an
  "Uncaught exception — exiting" restart loop.

### Changed

- **The Vercel template now targets Vercel's Node.js runtime** (on Fluid
  Compute), which Vercel recommends for standalone functions after deprecating
  standalone Edge Functions. The template was renamed `vercel-edge` → `vercel`
  and now exports `toFetchHandler(app)` (the `{ fetch }` shape Node.js Functions
  expect, no `runtime` export needed); opting into the Edge runtime stays

### Documentation

- New Railway deployment guidance (the `TRUST_PROXY_HOPS` posture and public-URL
  resolution) and a corrected start command; the deployment-overview "Reverse
  proxy" section now documents the real `behindProxy` API instead of a
  nonexistent option. Refreshed the Vercel adapter and scaffolder docs for the
  Node.js-runtime template, and corrected the `SECURITY.md` container-hardening
  section (every scaffolded template ships a hardened `Dockerfile`; the
  `HEALTHCHECK` targets `/healthz`).

## [0.38.1] — 2026-06-11

### Changed

- **Refuse-to-boot / refuse-to-sign guardrails now explain themselves.** The
  error messages thrown by the framework's fail-fast security checks are now
  actionable instead of terse: a weak `session()` secret, `jwt()` configured
  with `alg: "none"` (both the signer and the verifier allowlist),
  `secureDefaults: false` in production, a `session()` chain on a state-changing
  route without `csrf()`, and an unconfigured `trustProxy` when a forwarded
  header is present each now describe the concrete risk (forged sessions,
  signature-stripping / algorithm-confusion, cross-site state changes, spoofed
  client IPs), suggest a fix (e.g. `openssl rand -base64 32`, picking HS256 /
  RS256 / ES256, the right `trustProxy` value), and link to the relevant docs
  page. The error **codes** (`alg_none_refused`, …) and the validation behavior
  are unchanged — only the human-readable guidance improved, so existing
  programmatic checks keep working.
- **`create-daloy --with-ci` workflow templates and the repo's own workflows
  refresh their pinned GitHub Actions SHAs** (CodeQL, OpenGrep, Scorecard, and
  the container-scan jobs) to current upstream releases. Actions remain fully
  SHA-pinned; only the pinned commits moved forward.

### Documentation

- **New "where DaloyJS fits in OAuth2 & OpenID Connect" auth-architecture
  guide** clarifies that DaloyJS is a resource-server / relying-party toolkit
  rather than an identity provider or authorization server, with managed-vs
  self-hosted IdP guidance and the two recommended designs. It is linked from
  the auth overview and summarized in the `@daloyjs/core` and `create-daloy`
  READMEs and every scaffolded template README.
- **New "Coming from ts-rest?" comparison** on the typed-client docs page, plus
  a ts-rest row in the README framework-comparison table.

## [0.38.0] — 2026-06-10

### Added

- **End-to-end inference for the in-process typed client.** `App` is now
  generic over the tuple of routes it has registered: each `app.route(...)`
  call returns an `App` type that accumulates the new route (capturing its
  literal `operationId`, params, and response schemas). `createClient(app)` and
  `ClientFor<App>` recover that tuple, so methods such as
  `client.getBookById({ params: { id } })` are now fully typed end-to-end —
  precise `operationId` keys, typed params, and a discriminated response union —
  with **zero codegen and no runtime change**. Inference relies on **chaining**
  the `route()` calls and letting TypeScript infer the variable type; a widening
  `const app: App` annotation or a `: App` factory return type erases the tuple
  and collapses the client back to an untyped surface. New type-level regression
  test under `tests/types/` plus a dedicated `tsconfig.typetest.json` lock the
  behavior. TSDoc on `createClient` / `ClientFor`, the README, and the
  `/docs/typed-client` and `/docs/getting-started` pages document the chaining
  requirement.

### Changed

- **`create-daloy` templates now use `.ts` relative import specifiers** (for
  example `./build-app.ts` and `../api/[...path].ts`) instead of `.js`, so the
  files you import match the files on disk. The `node-basic` and `vercel`
  templates gain the required `allowImportingTsExtensions` (and, where it emits,
  `rewriteRelativeImportExtensions`) tsconfig flags; `bun-basic` and
  `deno-basic` already used `.ts` natively. npm + JSR publish output for
  `@daloyjs/core` itself is unchanged (source keeps `.js` specifiers). The base
  `tsconfig.json` enables the same flags so authored examples can use `.ts`.

### Fixed

- **`create-daloy` Dockerfile package-manager scaffolding on CRLF working
  trees.** `patchDockerfileForPackageManager` used `\n`-only regular
  expressions and a literal `"...\n"` string replace, so on a Windows checkout
  (CRLF line endings, no `.gitattributes` normalization) npm/yarn/bun scaffolds
  kept the pnpm `COPY pnpm-lock.yaml*` / `corepack ... pnpm install` lines and
  the bun image swap silently no-op'd. The substitutions are now CRLF-tolerant
  (`\r?\n`). Linux/macOS (LF) output is unchanged; this fixes scaffolding on
  Windows and any package published from a Windows host.

## [0.37.0] — 2026-05-31

### Added

- **GeoIP / geo-blocking middleware at `@daloyjs/core/geo-block`.** New
  dependency-free `geoBlock()` enforces ISO 3166-1 alpha-2 country allow/deny
  lists without bundling any GeoIP database. Pick exactly one resolution
  strategy: `lookupCountry(ip)` (you bring a MaxMind / `ip2location` reader or
  your own table — Daloy resolves the client IP first, reusing the trusted-proxy
  `X-Forwarded-For` / `X-Real-IP` handling) or `resolveCountry(ctx)` (read an
  edge-injected header such as Cloudflare `CF-IPCountry`, AWS CloudFront
  `CloudFront-Viewer-Country`, or Vercel `x-vercel-ip-country`). `deny` wins
  over `allow` (least privilege); allow-lists **fail closed** on an unknown
  country while deny-only configurations **fail open** (overridable via
  `allowUnknownCountry`). Country codes are validated at construction so typos
  throw instead of silently never matching. Adds a `mode: "log"` monitor mode
  with an `onBlock` decision hook (`denied_country` / `not_in_allowlist` /
  `unknown_country`), stamps the resolved country on `ctx.state.geo` for allowed
  requests, and rejects blocked traffic with a `403`
  `application/problem+json` (`Cache-Control: no-store`) that never echoes the
  country or IP. New docs page: **GeoIP / geo-blocking**.

- **HTTP Message Signatures (RFC 9421) at `@daloyjs/core/http-signatures`.**
  First-party, dependency-free sign/verify for server-to-server request
  authentication via the standard `Signature` / `Signature-Input` headers.
  `signMessage` / `signRequest` build an RFC 9421 signature base over derived
  components (`@method`, `@target-uri`, `@authority`, `@scheme`,
  `@request-target`, `@path`, `@query`, `@query-param`, `@status`) and HTTP
  fields, with Structured-Fields header serialization; `verifyMessage` /
  `verifyRequest` and the `httpSignatureAuth()` middleware check them. Supports
  `hmac-sha256`, `ed25519`, `ecdsa-p256-sha256`, `ecdsa-p384-sha384`,
  `rsa-pss-sha512`, and `rsa-v1_5-sha256` via WebCrypto (no `node:` imports).
  Secure-by-default verify: a mandatory `algorithms` allowlist, optional
  per-key algorithm pinning to defeat algorithm-confusion, a required `created`
  timestamp with a `DEFAULT_MAX_SIGNATURE_AGE_SECONDS` (300s) freshness window,
  `created`-in-future / `expires` skew rejection, configurable
  `requiredComponents`, a 32-byte raw-HMAC floor, and `nonce` replay defense.
  The middleware answers a missing/invalid signature with `401` +
  `Cache-Control: no-store` and stamps the verified result on
  `ctx.state.httpSignature`. Adds RFC 9530 `contentDigest` /
  `verifyContentDigest` helpers to bind the request body into the signature.

- **Subresource Integrity (SRI) for the CDN-loaded docs UI assets.** The
  built-in `/docs` page loads Scalar / Swagger UI bundles from jsDelivr; the
  new `DocsAssetOptions` lets you pin version-exact `*Integrity` hashes
  (`scalarScriptIntegrity`, `swaggerUiCssIntegrity`, `swaggerUiBundleIntegrity`)
  plus a `crossOrigin` value (default `"anonymous"`) so `scalarHtml()` /
  `swaggerUiHtml()` and the `docs: { assets }` auto-mount emit
  `integrity="…" crossorigin="…"` on the external `<script>` / `<link>` tags.
  A malformed SRI value throws a `TypeError` at startup (browsers silently
  ignore unparseable `integrity`, so failing loud prevents a false sense of
  protection). Self-hosting the assets remains supported via the same `assets`
  URLs. New docs page: **Docs UI asset integrity (SRI)**.
- **Opt-in WAF-lite signature/anomaly inspection middleware.** New
  dependency-free `@daloyjs/core/waf` module adds `waf()` — a first-party
  defense-in-depth layer for teams without an edge WAF (it does **not** replace
  ModSecurity / a CDN WAF). Wires curated, low-false-positive SQLi / XSS /
  NoSQL-operator / command-injection signatures (NoSQLi reuses
  `hasMongoOperatorKeys` for a structural body check) into one scored
  `beforeHandle` inspection pass over the decoded path, the raw + decoded query
  string, an opt-in header allowlist, and the validated body. Each rule that
  fires adds an anomaly `score`; reaching `blockThreshold` (default `5`) rejects
  with a generic `403` (block mode, never naming the rule that fired) or reports
  via `onMatch` (log mode) so operators can tune against real traffic first.
  Per-rule enable/disable + score overrides, inspection-surface toggles, and
  bounded scanning (`maxValueLength` / `maxBodyNodes`) with
  control-character-stripped log samples keep a hostile payload from becoming
  CPU-DoS. Exposes `WafOptions` / `WafEvent` / `WafMatch` / `WafRuleId` /
  `WafRuleConfig` / `WafMode` / `WafInspectConfig` / `WafInspectionLocation`.

- **Inbound request-decompression bomb guard.** New dependency-free
  `@daloyjs/core/request-decompression` module adds `requestDecompression()`.
  DaloyJS core deliberately does not decompress request bodies (safe by
  omission), so a `Content-Encoding: gzip` body is read as-is and a schema parse
  simply fails on the compressed bytes. For services that genuinely must accept
  compressed uploads, this opt-in middleware inflates `gzip` / `deflate` bodies
  **with the decompression-bomb (zip-bomb) guard baked in**: two independent caps
  are enforced *during* inflation so a bomb is aborted long before it is fully
  materialised — a required absolute `maxDecompressedBytes` cap and an
  expansion-`maxRatio` cap (default `100`, the inflated size may never exceed
  `compressedBytes * maxRatio`), both rejecting with `413`. The compressed upload
  itself is bounded by `maxCompressedBytes` (default 1 MiB) before a single byte
  is inflated. Unknown, non-allowlisted, runtime-unsupported, or **layered**
  (`gzip, gzip`) encodings are refused `415` (with an `Accept-Encoding` header);
  malformed / truncated streams `400` (never silently treated as empty, to avoid
  request-smuggling-style desync); and requests without a `Content-Encoding` (or
  `identity`), as well as `GET` / `HEAD`, pass through untouched. The middleware
  runs in the `onRequest` phase and stashes the inflated bytes on the request so
  schema-validated bodies and raw-body handlers both see the decompressed
  payload. Offers an `onBomb` observability hook (encoding, compressed size,
  inflated bytes produced before the abort, `"absolute"` / `"ratio"` reason) and
  exports a low-level `decompressRequestBody()` guard for custom raw-body flows.
  Built on the web-standard `DecompressionStream` (works on Node, Bun, Deno,
  Workers, Edge; brotli intentionally excluded — not in the Compression Streams
  spec). Exports `requestDecompression`, `decompressRequestBody`,
  `DecompressionBombError`, `UnsupportedContentEncodingError`,
  `MalformedCompressedBodyError`, and the `RequestDecompressionOptions`,
  `RequestDecompressionEncoding`, and `DecompressionBombInfo` types.
- **Per-route / per-client concurrency limits + queueing.** New dependency-free
  `@daloyjs/core/concurrency-limit` module adds `concurrencyLimit()`, HAProxy
  `maxconn` + request-queue parity at the app layer. Where the Node adapter's
  `maxConnections` caps sockets at accept time and `loadShedding()` rejects
  traffic under process pressure, `concurrencyLimit()` bounds the number of
  requests in flight through a given surface: each request acquires a slot from a
  per-bucket semaphore (`maxConcurrent`); if all slots are busy it waits in a
  bounded FIFO queue (`maxQueue`) for up to `queueTimeoutMs`; and it is rejected
  with a fast `503 Service Unavailable` (+ `Retry-After`) once the queue is full
  or the wait times out. The budget is partitioned by `scope`: `"global"`
  (default), `"route"` (per `method + path`, so one hot endpoint can't starve the
  others), `"client"` (per identity — requires `trustProxyHeaders` or a
  `keyGenerator`, so a heavy client can't consume everyone else's slots), or a
  custom function (return a bucket key, or `undefined` to skip limiting —
  fail-open). The slot is acquired in `beforeHandle` and released in `onSend`,
  which the framework runs on the success, error, and short-circuit response
  paths alike, so a slot is never leaked. Offers an `onReject` observability hook
  (bucket key, `"queue-full"` / `"queue-timeout"` reason, live active/queued
  counts) and configurable `retryAfterSeconds` / `message`. Exports
  `concurrencyLimit` and the `ConcurrencyLimitOptions` and `ConcurrencyRejection`
  types.
- **IP reputation / dynamic denylist feed.** New dependency-free
  `@daloyjs/core/ip-reputation` module adds `ipReputation()`. Where
  `ipRestriction()` enforces a static allow/deny list compiled once at startup,
  `ipReputation()` wires pluggable, periodically-refreshed abuse feeds — Tor exit
  lists, Spamhaus DROP, cloud-abuse ranges, or your own threat intelligence —
  into the request path without a redeploy, reusing the same SSRF-grade CIDR
  matcher as `ipRestriction()`. Feeds implement the `IpReputationFeed` interface;
  `urlFeed()` ships for the common case (fetch a newline / Spamhaus-DROP-style
  list over HTTP, understands the `<cidr> ; <annotation>` format, skips `#` / `;`
  / `//` comment lines, and keeps the good rows from a partially-malformed feed).
  **Fail-open by design** — a feed that cannot be loaded never blocks traffic: a
  failed initial load leaves an empty (permissive) denylist, a failed refresh
  retains that feed's last-known-good entries, and an unresolvable client IP is
  treated as not-listed. The denylist reloads on an `unref`'d timer
  (`refreshIntervalMs`, default hourly), with a per-feed `fetchTimeoutMs`
  abort. Returns an `IpReputationController` exposing `hooks` (for `app.use`),
  manual `refresh()`, `stop()`, `has()`, `size`, and a `ready` promise. Offers a
  `mode: "log"` monitor mode, `onMatch` / `onError` callbacks, and pluggable IP
  resolution (`trustProxyHeaders` / `resolveIp`). Exports `ipReputation`,
  `urlFeed`, and the `IpReputationOptions`, `IpReputationFeed`,
  `IpReputationMatch`, `IpReputationController`, and `UrlFeedOptions` types.
- **Bot / User-Agent management middleware.** New dependency-free
  `@daloyjs/core/bot-guard` module adds `botGuard()`, the in-app equivalent of
  the bot rules Nginx, Cloudflare, and other WAFs run at the edge — but inside
  the app, where the framework already owns request parsing and client-IP
  resolution. It does three opt-in jobs: blocks empty / missing `User-Agent`
  strings (on by default, a common scraper/scanner signature); blocks
  known-abusive `User-Agent` patterns (caller-supplied substrings or `RegExp`s);
  and **verifies declared crawlers** — when a request claims to be Googlebot or
  Bingbot, it is confirmed via reverse-DNS + forward-confirm (the method Google
  and Bing themselves document) so a spoofed `User-Agent` cannot impersonate a
  trusted crawler. Ships `GOOGLEBOT`, `BINGBOT`, and the `WELL_KNOWN_BOTS`
  bundle, and accepts custom `VerifiedBotRule`s. Allowlist-first:
  `allowUserAgents` is consulted before every other rule. Secure-by-default:
  `verifiedBots` refuses to construct without a client-IP source (`resolveIp` or
  `trustProxyHeaders`), and a crawler that cannot be verified — no client IP, or
  a DNS failure — is blocked unless `blockUnverifiableBots: false`. Domain
  matching is subdomain-boundary-safe (a leading dot in a rule domain stops
  `evil-googlebot.com` from satisfying `.googlebot.com`), verification results
  are cached per IP (default 1 h) to keep DNS off the hot path, a `mode: "log"`
  monitor mode reports matches via `onBlock` without blocking, and the DNS
  resolver is a pluggable `BotResolver` (default lazy `node:dns/promises`).
  Exports `botGuard`, `GOOGLEBOT`, `BINGBOT`, `WELL_KNOWN_BOTS`, and the
  `BotGuardOptions`, `BotGuardEvent`, `BotResolver`, and `VerifiedBotRule` types.
- **Adaptive auto-ban (fail2ban-style).** New dependency-free
  `@daloyjs/core/auto-ban` module adds `autoBan()`, a reusable escalating /
  decaying ban primitive that generalizes `loginThrottle()` beyond credential
  routes. It observes the outgoing response status via the `onSend` hook — so it
  counts suspicious statuses (default `401` / `403` / `429`, configurable via
  `watchStatuses`) produced by **any** downstream middleware or handler — and
  enforces the ban in `beforeHandle` before the handler runs. Each watched
  response is a strike; strikes accumulate inside a rolling `windowMs`
  (default 10 min) and reaching `maxStrikes` (default 5) issues a ban for `banMs`
  (default 15 min). With `escalate` (default `true`) each repeat ban doubles —
  `banMs` → `2×` → `4×`, capped at `maxBanMs` (default 24 h) — and the whole
  record **decays** once the client goes quiet, so a one-off burst is forgiven
  while a persistent attacker is locked out for progressively longer. Identity
  attribution is **secure-by-default**: the middleware refuses to construct
  unless a `keyGenerator` or `trustProxyHeaders: true` is provided, so a single
  offender can never collapse every caller into one `"global"` bucket; requests
  the key generator cannot attribute are skipped (never counted, never banned).
  A banned request returns `429 Too Many Requests` with `Retry-After` and
  `Cache-Control: no-store` by default, or `403 Forbidden` with a custom
  `message` when `banStatus: 403`. The pluggable `AutoBanStore` (`get` / `set`
  with variable TTL / `delete`) mirrors the `rateLimit()` store contract and is
  Redis-backable for multi-instance deployments; the in-memory default lazily
  expires records and opportunistically prunes. A shared `groupId` (default
  `"auto-ban"`) means a client banned on one route group is banned on all of
  them, and `onBan` / `onStrike` callbacks feed logging, alerting, or an external
  denylist. Exports `autoBan`, `MemoryAutoBanStore`, and the `AutoBanOptions`,
  `AutoBanStore`, `AutoBanRecord`, `AutoBanEvent`, and `AutoBanStrikeEvent`
  types.
- **mTLS / client-certificate auth.** New dependency-free `@daloyjs/core/mtls`
  module adds `clientCertAuth()`, a middleware that authenticates a request by
  its TLS client certificate for zero-trust / service-to-service deployments.
  The certificate is resolved from one of two sources: **native TLS** — the Node
  adapter lazily reads the peer certificate off the socket and normalizes it
  (subject, issuer, fingerprint, SANs, validity window, verified flag), behind a
  thunk so plain-HTTP requests pay nothing — or a **TLS-terminating proxy**, by
  parsing the verified identity forwarded in request headers (Envoy
  `X-Forwarded-Client-Cert`, or operator-named nginx/HAProxy/Traefik structured
  headers). Enforcement is opt-in per check: `requireVerified` (default `true`)
  refuses any chain the TLS terminator did not verify; `allowSubjectCNs` /
  `allowIssuerCNs` do exact CN matching; `allowFingerprints` matches the SHA-256
  fingerprint in **constant time** (separators/case ignored); `allowSANs`
  requires at least one Subject Alternative Name (SPIFFE/DNS/URI/IP, as
  `TYPE:value` or bare); `checkValidity` (default `true`) rejects certificates
  outside their `[notBefore, notAfter]` window; and a custom async
  `verify(cert, ctx)` hook runs last. A missing certificate yields `401`
  `application/problem+json` with `Cache-Control: no-store`; any failed check
  yields `403` without echoing certificate details. The accepted
  `ClientCertificate` is stamped on `ctx.state` (configurable `stateKey`). The
  building blocks `parseForwardedClientCert()`, `normalizePeerCertificate()`,
  and `setClientCertificate()` / `getClientCertificate()` are exported
  standalone for custom adapters. Zero runtime dependencies. _(`@since 0.37.0`)_
- **In-process scheduled tasks (cron).** New dependency-free
  `@daloyjs/core/scheduler` module adds a queue-agnostic schedule primitive for
  periodic housekeeping (cache sweeps, token refresh, reconciliation). Register
  tasks with `app.cron(def, handler)` — the first call lazily creates an
  app-managed `Scheduler`, starts it, and wires the graceful-shutdown drain — or
  drive a standalone `Scheduler` directly. Tasks run on a fixed `intervalMs` or
  a 5-field `cron` expression supporting wildcards, lists, ranges, steps
  (`*/5`), case-insensitive month/day names, `0`/`7` Sunday, and the
  `@yearly`/`@monthly`/`@weekly`/`@daily`/`@hourly` aliases, plus an optional
  IANA `timeZone`. Cron parsing is purely arithmetic (no backtracking regex) and
  rejects malformed or unsatisfiable expressions with a `CronParseError` at
  registration time. Scheduling is **fixed-rate with single-flight**: the next
  tick is armed before each run, and a tick that fires while the previous run is
  still in progress is skipped (and counted) rather than run concurrently, so a
  slow task can never pile up. An optional per-run `timeoutMs` aborts the run's
  `AbortSignal` and records the run as a timed-out failure. Timers are
  `unref`'d, so a scheduler never keeps an otherwise-idle process alive. On
  shutdown the scheduler stops arming new runs, awaits in-flight runs, and
  aborts any that outlast the grace period. The cron utilities `parseCron()` and
  `nextCronRun()` are exported standalone, and `app.scheduledTasks` exposes
  `list()` / `getState(name)` / `runNow(name)` for inspection and out-of-band
  runs. Zero runtime dependencies. _(`@since 0.37.0`)_

- **Outbound webhook delivery.** New dependency-free
  `@daloyjs/core/webhook-delivery` module adds `createWebhookSender()` — the
  outbound counterpart to the inbound `verifyWebhookSignature()` /
  `signWebhookPayload()` helpers. Each delivery is a `POST` carrying a stable
  `webhook-id`, a `webhook-timestamp`, and a `webhook-signature`
  (`sha256=…`) computed over `"<timestamp>.<body>"` and reused across retries so
  receivers can dedupe safely. Failed deliveries are retried with bounded
  exponential backoff + jitter, scoped to transient statuses
  (`408`/`429`/`5xx`) and network/timeout errors, honouring a `Retry-After`
  header; each attempt has its own `AbortController` timeout. Events that
  exhaust their attempts — or fail permanently — are handed to a
  `WebhookDeadLetterSink` (with a bounded `MemoryWebhookDeadLetterSink` built
  in). The transport defaults to `fetchGuard()`, so a subscriber URL resolving
  to cloud metadata or a private range is refused with a terminal
  `SsrfBlockedError` that is never retried and is dead-lettered once. Caller
  headers can never clobber the signature headers.

- **Outbound resilience for `fetch`.** New dependency-free
  `@daloyjs/core/fetch-resilience` module adds `resilientFetch()` — a circuit
  breaker, retry-with-backoff, and per-call timeout designed to layer **on top
  of** `fetchGuard()` (which only covers SSRF on egress). The per-call timeout
  uses an `AbortController` combined with any caller-supplied `signal` and
  surfaces as `FetchTimeoutError`; retries are exponential with full jitter,
  scoped to idempotent methods (`GET`/`HEAD`/`OPTIONS`/`PUT`/`DELETE`) and
  transient statuses (`408`/`429`/`5xx`), and honour a `Retry-After` header; the
  shared three-state `CircuitBreaker` (`closed → open → half-open`) fails fast
  with `CircuitOpenError` when an upstream is down and probes for recovery. SSRF
  protection stays intact: an `SsrfBlockedError` is a terminal refusal that is
  never retried and never trips the breaker, and a caller-initiated abort is
  neither retried nor counted as an upstream failure. `CircuitBreaker` is
  exported standalone (with `execute()` / `admit()` / `recordOutcome()` /
  `release()`) so the same semantics can protect any non-`fetch` dependency.

- **Metrics &amp; the `/metrics` endpoint.** New dependency-free
  `@daloyjs/core/metrics` module and `app.metrics()` route method add the third
  observability pillar alongside the structured logger and the OpenTelemetry
  tracer. `MetricsRegistry` holds memoized counters, gauges, and histograms and
  renders them to the Prometheus text exposition format; metric and label names
  are validated against the Prometheus grammar at definition time and label
  values are escaped, an exposition-injection defense, while a per-metric
  cardinality cap (`maxSeries`) drops overflowing label combinations and counts
  them in `daloy_metrics_series_dropped_total` to bound memory. `httpMetrics()`
  is a `Hooks` bundle that records RED metrics (`http_requests_total`,
  `http_request_duration_seconds`, `http_requests_in_flight`) with a
  cardinality-capped `route` label, plus scrape-time process gauges on
  Node-like runtimes. `app.metrics()` installs that instrumentation as a group
  hook and registers an opt-in `/metrics` scrape route that inherits the same
  hardened posture as `app.healthcheck()`: an optional bearer token compared
  with `timingSafeEqual` (`401` missing / `403` wrong), a per-IP fixed-window
  rate limit (`429` on overflow), and a refuse-to-boot guard that blocks an
  unauthenticated scrape endpoint in production unless a token is set or
  `acknowledgeUnauthenticated: true` is passed.
- **Pagination &amp; cursor helpers.** New dependency-free
  `@daloyjs/core/pagination` module for cursor-paginated list endpoints.
  `encodeCursor()` / `decodeCursor()` turn an arbitrary JSON-serializable sort
  key into an opaque, URL-safe base64url token and back; decoding is hardened
  with a 4 KiB length cap, malformed-input rejection, and prototype-pollution
  key stripping, so a tampered cursor surfaces as a `400` rather than a `500`.
  `buildLinkHeader()` / `buildPageLinks()` assemble an RFC 8288 `Link` header
  (with `next`/`prev`/`first` rels) from the current request URL — preserving
  all other query parameters — and reject CRLF, angle brackets, and quote
  characters to block header-injection. `paginationQuery()` is a Standard Schema
  for the `cursor` + `limit` query parameters that validates and clamps `limit`
  to a configurable `[minLimit, maxLimit]` range at the request boundary **and**
  advertises both parameters to the OpenAPI generator (and typed client) through
  a `toJSONSchema()` method — so `request: { query: paginationQuery() }` wires
  the contract with no duplicate declarations.
- **Response caching.** New dependency-free `responseCache()` middleware (also
  exported from `@daloyjs/core/response-cache`) caches rendered response bodies
  server-side so a fresh hit skips the handler entirely — the missing third
  piece alongside `etag()` (conditional `304`s) and `compression()` (wire
  bytes), neither of which cache bodies. Freshness is orchestrated from the
  response's own `Cache-Control` (`s-maxage` &gt; `max-age`) with a
  `ttlSeconds` fallback; request `Cache-Control: no-store`/`no-cache` bypass the
  cache; and `staleWhileRevalidateSeconds` + a `revalidate` callback serve stale
  content while a recursion-safe background refresh repopulates the entry. Ships
  a pluggable `ResponseCacheStore` (mirroring `SessionStore`) with an in-memory
  `MemoryResponseCacheStore` default, `Vary`-aware keying, a body-size cap, and
  an `X-Cache` HIT/MISS/STALE marker. Secure-by-default: responses carrying
  `Set-Cookie` or `Cache-Control: private`/`no-store`/`no-cache`, non-`200`
  statuses, and oversized bodies are never cached.
- **Idempotency keys.** New dependency-free `idempotency()` middleware (also
  exported from `@daloyjs/core/idempotency`) gives unsafe methods
  (`POST`/`PUT`/`PATCH`/`DELETE`) exactly-once semantics under retries. A
  client-supplied `Idempotency-Key` header drives request fingerprinting
  (method + path + body), byte-for-byte response replay (with an
  `Idempotency-Replayed: true` marker), an in-flight `409 Conflict`, and a
  `422` when a key is reused with a different payload. Ships a pluggable
  `IdempotencyStore` (mirroring `SessionStore`) with an in-memory
  `MemoryIdempotencyStore` default, plus a new `ConflictError` (`409`).
  Server errors and oversized responses are never cached so retries stay safe.
- **API lifecycle headers (RFC 8594).** Routes accept an optional `sunset`
  date (ISO-8601 string or `Date`). A route with a `sunset` is implicitly
  deprecated: every response carries a `Deprecation: true` header and a
  `Sunset: <HTTP-date>` header, and the generated OpenAPI operation gains
  `deprecated: true` plus an `x-sunset` extension. The value is validated and
  normalized once at `app.route(...)` registration time.
- **OpenAPI diff engine.** New pure, dependency-free `@daloyjs/core/openapi-diff`
  module exporting `diffOpenAPI(baseline, current)` and
  `hasBreakingChanges(baseline, current)` to classify added, removed, and
  changed operations as breaking or non-breaking.
- **`daloy diff <baseline> <current>` CLI command** and a
  `verify:breaking-changes` script that compares the generated spec against the
  last published one and exits non-zero on a breaking change, so CI can gate
  "did this PR break my published API?".

- **AsyncAPI 3.0 generation for WebSockets.** New pure, dependency-free
  `@daloyjs/core/asyncapi` module exporting `generateAsyncAPI(app, options)` and
  `asyncapiToYAML(doc)`. Every `app.ws()` route becomes an AsyncAPI channel
  (address + path parameters) with a `receive` operation for inbound client
  messages and an optional `send` operation for outbound messages. Payloads are
  taken from a new optional `meta` block on the WebSocket handler
  (`summary`, `description`, `tags`, `send`, `receive`, `operationId`), falling
  back to the handler's `request.body` schema for the inbound payload. A new
  `daloy inspect --asyncapi` flag (with `--format yaml`) prints the document.
  This extends the contract-first story past HTTP, mirroring the built-in
  OpenAPI generator.

### Security

- **Safe percent-decoding of path segments.** The router now decodes each URL
  path segment defensively: a malformed percent-escape (e.g. a stray `%` or an
  invalid `%XY` sequence) no longer throws a `URIError` that would surface as an
  unhandled `500`, and an over-decoded segment can no longer smuggle a path
  separator. Malformed segments are rejected at the boundary instead of being
  passed through, keeping route matching and downstream handlers from operating
  on attacker-shaped paths.
- **`fetchGuard()` drains intermediate 3xx redirect bodies.** When following a
  redirect chain the guard now fully drains each intermediate `3xx` response
  body before issuing the next hop, preventing a slow/never-ending redirect
  response body from pinning a socket open (a resource-exhaustion vector).
- **Hardened defenses against AI-agent credential theft and expanded
  agent-instruction surface scanning.** The supply-chain governance gates grew
  new coverage: `verify-no-registry-exfiltration.ts` now flags registry
  credential-exfiltration patterns, and the `verify-no-leaky-agent-skills.ts` /
  `verify-no-toxic-agent-skills.ts` scanners broadened the agent-instruction
  surfaces they inspect (each backed by new tests). A new
  `examples/residential-proxy-defense.ts` demonstrates blocking residential-proxy
  credential-harvesting traffic.

### Fixed

- **Redis rate-limit fail-open posture is now documented.** The Redis-backed
  `rateLimit()` store clarifies in its docs and code comments that a Redis
  outage degrades **open** (requests are allowed rather than blocked), so
  operators can make an informed availability-vs-enforcement trade-off.
- **4xx error-detail security note clarified.** The error module documents that
  `4xx` problem details are returned to the client by design and must not carry
  internal/sensitive context, matching the prod-mode redaction posture.
- **Multipart `fileField()` format-option assignment normalized.** Internal
  cleanup so the `format` option is assigned consistently; no behavior change.

### Docs

- **`pnpm verify:docs-links` — docs link / nav / sitemap parity gate.** New
  dependency-free `scripts/verify-docs-links.ts` statically validates the
  documentation site: every internal `/docs/...` link inside a docs page, every
  `docsNav` sidebar entry, every `sitemap.ts` path, and every `#anchor` target
  is checked against the real `website/app/docs/**/page.tsx` tree. It fails CI
  on broken links, dangling nav/sitemap entries, docs pages missing from the
  sitemap, and nav↔sitemap drift — replacing the manual "navigation, sitemap,
  and search discovery are manually maintained" process noted in
  `website/AGENTS.md`. The first per-surface freshness sweep across all 119 docs
  pages passed clean.
- **Roadmap "Integrations & docs" standing track.** `ROADMAP.md` now carries a
  dedicated track enumerating the documentation surfaces the core release log
  never tracked — Email (6 providers), Payments (9), Database hosting (5), ORM
  (6), ODM (2), Authentication (5), Deployment platforms (4), Adapters/runtimes
  (8), the compliance/security-posture slice, and the tutorials — so adding or
  removing a documented provider is reviewed as a roadmap change instead of
  staying invisible to planning. Counts mirror the live docs navigation
  (`website/components/docs-nav.ts`).

## [0.36.0] — 2026-05-28 to 2026-05-30

### Added

- `preset: "internal-service"` topology security preset for service-to-service
  deployments behind a mesh / sidecar / private network. Flips **off** only the
  browser-only guards (auto `secureHeaders`, the cross-origin state-changing
  request guard, the `session()` + `csrf` boot guard, and the unconfigured
  `X-Forwarded-*` 500) while keeping every input / parser / credential / SSRF
  guard on. The choice is logged once at boot under
  `event: "security.preset.applied"` enumerating disabled + kept guards and any
  caller overrides; per-knob options still win on top of the preset.
- `app.getSecurityPosture()` returns a frozen live snapshot of the active
  security posture for `/__security` introspection routes or CI audits.
- Node adapter `maxConnections` option mapping to `server.maxConnections` —
  connection-layer admission control that rejects overflow sockets at accept
  time instead of queuing them into the event loop under overload.

### Security

- Credential redaction extended to the 2026 GitHub stateless installation-token
  format (`ghs_`-prefixed ~520-char JWT, matched at 36–1024 chars).
- Bun adapter last-resort `error:` handler now logs server-side but never echoes
  `err.message` to the client, preserving prod-mode error redaction parity with
  the Node adapter.

### Fixed

- Deno adapter shutdown ordering: drain app-level hooks first (while the HTTP
  server can still respond), then call `server.shutdown()`, and abort the listen
  signal last as a safety net — so in-flight requests can finish.
- Welcome-banner polish and `detectAscii` platform handling.

### Docs

- Refreshed API reference, new "Where to use DaloyJS" beginner guide, conference
  `workshop/` materials, and per-runtime `SKILL.md` best-practices.

## [0.35.2] — 2026-05-28

### Performance

- Zero-copy buffered-body fast-path via the `DALOY_REQUEST_RAW_BODY` symbol:
  adapters stash a pre-validated `Uint8Array` so `readBodyLimited` skips the
  WHATWG `ReadableStream` reader loop entirely (re-checking the limit as
  defense-in-depth) with a tunable cap.
- `randomUUID` caching, dropped redundant header lowercasing, and a skipped
  no-op `logger.child` (~+23% on `bench:routes`).
- Stable hidden classes for `ctx` / `ctx.set` ("Round 19"), error-path parity
  with a hand-stripped baseline, and Node `Readable` responses piped directly to
  the socket.

### Fixed

- `randomId()` WebCrypto-reference fallback.
- `Buffer.alloc` used over `allocUnsafe`.
- Benchmark accuracy fixes (Windows RSS, Zod-parity rows).

## [0.35.1] — 2026-05-27

### Performance

- Rewritten HTTP dispatch + buffered Node body, measured **+37% GET / +61% POST**
  on `bench:routes`, after an added-then-reverted lazy-request experiment
  settled on the buffered fast-path.
- New `@daloyjs/core/app` deep entry point for a lighter cold start.
- Install-size trim (build source maps disabled).

### Added

- Isolated cross-framework HTTP benchmark suite under `bench/cross-framework/`
  (multiple server implementations + autocannon/pino logging bench).
- `clipboard-write` permission knob on `secureHeaders()`.

## [0.35.0] — 2026-05-24

### Added

- `safeRedirect()` + `OpenRedirectBlockedError`: validates redirect targets
  against an explicit path/origin allowlist and refuses protocol-relative
  (`//evil.com`) and scheme-bearing (`javascript:`, `https://evil`) targets.
- `fetchMetadata()` middleware enforcing a Fetch Metadata Resource Isolation
  Policy (`Sec-Fetch-Site` / `-Mode` / `-Dest` / `-User`) to block cross-site
  XS-Leaks while allowing same-origin, top-level navigations, and configured
  cross-site `Sec-Fetch-Dest` + navigate-method allowlists.
- Webhook timestamp verification + replay protection via a signed-timestamp
  tolerance window (`WEBHOOK_DEFAULT_TOLERANCE_SECONDS`, 5 minutes).
- `createJwtVerifier({ isRevoked })` token-revocation callback (logout / key
  rotation / compromise) without weakening the algorithm allowlist.
- `sanitizeFilename`, `assertSafeRelativePath`, `hasMongoOperatorKeys`, and
  `assertNoMongoOperators` — path-traversal and NoSQL-operator injection guards.

### Security

- `secureHeaders()` default `Permissions-Policy` now adds `clipboard-write=()`
  (alongside `camera=()`, `microphone=()`, `geolocation=()`) to neutralize the
  ClickFix paste-attack chain ([CVE-2026-26980], the May 2026 Ghost CMS campaign
  across 700+ domains). Override via `permissionsPolicy:` for legitimate copy
  buttons.
- Duplicate `Transfer-Encoding` headers are rejected (HTTP request smuggling).
- CORS middleware manages `Vary: Origin` to prevent cross-origin cache
  poisoning.
- `fetchGuard()` DNS-rebinding documentation and cloud-metadata test hardening.

### Added — supply chain & governance

- New verification gates: `verify:known-dep-names` (slopsquatting),
  `verify:no-polyfill-cdns`, `verify:runtime-eol`, `verify:no-shrinkwrap`,
  `verify:no-weak-random`, `verify:dep-licenses`, `verify:no-leaky-agent-skills`,
  `verify:no-toxic-agent-skills`.
- npm staged publishing, a gitleaks secret-scan workflow + staged-secret
  pre-commit hook, OSV-Scanner workflows, Opengrep SAST, and Cosign image
  signing / SBOM attestation.

### Docs

- Compliance docs (EU CRA, NIS2 self-assessment, ISO/IEC 27001:2022, DORA, UK
  Cyber Security & Resilience Bill), OWASP API Security Top 10 + injection
  guides, PWA support, conference `workshop/`.

## [0.34.3] — 2026-05-23

### Changed

- Split the portable, runtime-agnostic supply-chain hardening from the optional
  GitHub Actions CI bundle in the `create-daloy` templates, so scaffolded
  projects on any platform get the baseline hardening without inheriting
  GitHub-specific workflows.
- Website/branding refresh: homepage, layout, OpenGraph image + social banner
  SVGs, Deno adapter docs, and `seo.ts` metadata.

## [0.34.2] — 2026-05-23

### Changed

- Pinned `tsx ^4.22.3`; turbopack-root config.
- Per-adapter deployment + Payments docs, Vercel Analytics + Speed Insights,
  reading-progress / BackToTop / LogoLockup site components, Deno + Node
  deployment workflow templates.

### Fixed

- `create-daloy` now publishes correctly on tag releases.

## [0.34.1] — 2026-05-22

### Fixed

- CI builds and runs `gen:sbom` before `pnpm test`; verify scripts resolve
  `REPO_ROOT` via `process.cwd()`; SBOM release-automation docs; metadata-title
  fix.

## [0.34.0] — 2026-05-22

### Added

- `fetchGuard()` + `SsrfBlockedError` SSRF guard ([`src/fetch-guard.ts`](src/fetch-guard.ts)):
  blocks cloud-metadata (`169.254.169.254`), private/loopback/link-local ranges,
  and DNS rebinding by re-resolving and re-checking the resolved IP, sharing its
  CIDR matcher with `ipRestriction()`.
- CycloneDX 1.5 / SPDX 2.3 / SWID SBOM generation + verification
  ([`scripts/generate-sbom.ts`](scripts/generate-sbom.ts),
  [`scripts/verify-sbom.ts`](scripts/verify-sbom.ts)); SBOMs ship inside every
  tarball and are transitively bound by npm `--provenance` Sigstore attestation.

### Security

- `assertNoReservedInternalHeaders()` rejects inbound `x-daloy(js)-internal-*`
  headers — a structural defense against the Next.js [CVE-2025-29927]
  middleware-bypass class.
- Spring4Shell-class `isForbiddenObjectKey()` checks extended to query-string,
  `x-www-form-urlencoded`, and multipart field names.
- Prototype-pollution-safe JSON parsing of the JWT header and payload.
- `fileField` rejects scriptable image payloads (SVG/HTML/XML magic bytes).
- Cookie-tossing defense in `readRequestCookie`.
- Logger redaction extended to opaque-provider and AI-gateway credentials.
- New supply-chain gates: `verify:no-registry-exfiltration` (300+ IOC corpus —
  Lazarus BeaverTail/InvisibleFerret, Jade Sleet, xrpl.js, RATatouille, Advcash
  reverse-shell, Telegram-bot SSH-backdoor), `verify:no-bin-shadowing`,
  `verify:no-remote-exec`, `verify:no-vulnerable-sandboxes`,
  `verify:no-invisible-unicode`, `verify:no-unsafe-buffer`,
  `verify:no-encoded-payloads`, `verify:no-leaked-credentials`,
  `verify:actions-pinned` (GitHub Actions SHA-pin); `verify:secret-comparisons`
  tightened.
- Lockfiles reject all npm git-shorthand specifiers; daily SCA + container-scan
  + DAST workflows; Log4Shell / Spring4Shell regression tests.

> The `0.34.0` release commit itself is TSDoc-only across the public API; the
> behavior above landed in the preceding commits of the release.

## [0.33.0] — 2026-05-21

### Security

- **WebSocket CSWSH (Cross-Site WebSocket Hijacking) defense.** `app.ws()` gained
  `allowedOrigins` (`"same-origin"` / explicit origin allowlist / predicate),
  validated by `checkWebSocketOrigin()` **before** `beforeUpgrade` runs — a
  mismatched `Origin` returns `403` in both the Node and Bun upgrade paths.
  Under production secure-defaults, a route that neither sets `allowedOrigins`
  nor opts in via `acknowledgeCrossOriginUpgrade: true` **refuses to register**,
  closing the [CVE-2026-27148] Storybook-class hole. See
  [`src/websocket.ts`](src/websocket.ts) (`assertWebSocketOriginPolicy`).
- New `scripts/verify-no-lifecycle-scripts.ts` → `pnpm verify:no-lifecycle-scripts`
  refuses `preinstall` / `install` / `postinstall` / `prepare` / `prepublish` on
  the shipped packages.

### Changed

- Wave-number identifiers stripped from `src/` and docs comments.
- `SECURITY.md` expanded for slopsquatting, typosquat + init-time C2,
  dormant-maintainer / account-recovery-email risks, and IDE-extension /
  AI-agent threats.

## [0.32.0] — 2026-05-20

### Security

- WebSocket post-upgrade header immutability + pre-upgrade auth
  refuse-at-registration; `httpError({ res })` state-mutating-header refusal with
  Context-aware merge; middleware-order header-conflict refusal via
  `responseHeaders[]`.

## [0.31.0] — 2026-05-20

### Added

- Mature-Node second-pass audits: semicolon-delimiter refusal,
  error-handler-override refusal, `requestId()` trust-default audit,
  `addHttpMethod` RFC-method runtime allowlist + audit, draining
  `Connection: close` reaffirm audit.

## [0.30.0] — 2026-05-20

### Security

- Auth-failure `Cache-Control: no-store` (`UnauthorizedError` / `ForbiddenError`
  / `TooManyRequestsError`); CSP report receiver hardening (`application/json` →
  `415`, `maxBodyBytes > 64 KiB` refused at construction, prod sink omits report
  body unless `logCspReportBodies: true`); `cors()` `allowMethods` default
  narrowed to `[GET, HEAD, POST]` (refuse `methods: ['*']`); reverse-proxy helper
  absence audit; compression skip-already-encoded reaffirm. Wired into CI as
  `pnpm verify:runtime-parity-audits`.

## [0.29.1] — 2026-05-20

### Fixed

- Repair release: republished to fix an incomplete `0.29.0` publish and resync
  the `@daloyjs/core` version pin across every `create-daloy` template
  (`node-basic`, `bun-basic`, `deno-basic`, `cloudflare-worker`, `vercel`)
  and the `seo.ts` fallback. No runtime behavior change.

## [0.29.0] — 2026-05-20

### Added

- Governance audit: `SECURITY-CONTACTS.md` rotation file,
  `scripts/verify-governance-audits.ts` → `pnpm verify:governance-audits`,
  release-workflow contributor-rotation refusal, plugin-prerequisite +
  `topoSortExtensions` cycle-detection reaffirm, documented governance floor with
  `SECURITY.md` waiver-required removal.

## [0.28.0] — 2026-05-20

### Added

- Parity audit suite: `scripts/verify-parity-audits.ts` →
  `pnpm verify:parity-audits` static gates, `daloy doctor --audit-defaults`
  live-config audits.

## [0.27.0] — 2026-05-20

### Security

- `secureDefaults` single-source-of-truth bake-ins: cookie / time-claim SSoT
  helpers, `__Secure-` cookie refusal, zero-runtime-deps + secret-comparison CI
  gates.

## [0.26.0] — 2026-05-20

### Security

- Secure-by-default slice 6: `secureDefaults: false` production acknowledgement +
  audit log, JWT HS-secret length refusal, `secureHeaders()` dual framing-defense
  refusal, mandatory 2FA release-audit docs.

## [0.25.0] — 2026-05-20

### Added

- `compression()` middleware on `CompressionStream` (`br` > `gzip` > `deflate`)
  with BREACH-aware always-on guards (skip `Set-Cookie` / `Authorization` /
  session-or-CSRF cookie / already-compressed types), `minimumSize: 1024` +
  negative-ratio post-check, no `compressLevel: 9` opt-in, always-on
  `Vary: Accept-Encoding`, and strong → weak ETag downgrade (RFC 9110).

## [0.24.0] — 2026-05-20

### Added

- Production fitness & deploy hardening: `app({ behindProxy })`,
  adapter-independent `ConnInfo`, `daloy doctor`, container-first `create-daloy`
  templates (`HEALTHCHECK`, `STOPSIGNAL SIGTERM`, non-root, `tini`), PSL-aware
  `subdomains()`, lazy `info.remote`, plugin `dependencies: string[]`
  refuse-to-boot, namespace-protected decorators, plugin extension `before` /
  `after` ordering with cycle detection, `defineDependency()`, scheme-aware
  `ctx.state.auth`, plugin lifecycle default `local`, required `name` + optional
  `seed` for stateful plugins.

## [0.23.0] — 2026-05-20

### Added

- `wsRateLimit()`, `loginThrottle()`, `rotateSession()`, file-upload magic-byte
  guards, `requirePayloadAuth`, and WebSocket safe defaults.

## [0.22.0] — 2026-05-20

### Added

- `jwk()` asymmetric-only JWKS middleware, `bearerAuth({ verify })`,
  `basicAuth({ onAuthSuccess })`, `Cache-Control: no-store` on auth 401
  challenges.

## [0.21.0] — 2026-05-20

### Added

- `createJwtSigner()` / `createJwtVerifier()` (`alg`-discipline, `exp`-required
  sign refusal), `requireScopes()` (RFC 6750 challenge, per-request aggregation),
  `etag()` helper with auto-skip on `Set-Cookie` /
  `Cache-Control: private | no-store | no-cache`.

## [0.20.0] — 2026-05-20

### Added

- `loadShedding()`, `app.cspReportRoute()` + `secureHeaders({ reportingEndpoints,
  reportTo })`, `disconnectStatusCode: 499` default, `defineConfig({ schema,
  source })`.

## [0.19.0] — 2026-05-20

### Added

- Secure-by-default slice 5: `rateLimit({ groupId })` shared buckets, `combine`
  primitives (`every` / `some` / `except`), `ipRestriction()` with CIDR
  IPv4/IPv6, `internal: true` routes (`404` via `app.fetch`, dispatch via
  `app.inject`).

## [0.18.0] — 2026-05-20

### Added

- Secure-by-default slice 4: connection-draining shutdown (`Connection: close`
  on `503` + in-flight), Node idle-close hook, `crashOnUnhandledRejection`
  default-on in prod, `app.healthcheck()` / `app.readinesscheck()` (bearer-token
  + per-IP rate limit), prod refuse-to-boot without
  `acknowledgeUnauthenticated: true`.

## [0.17.0] — 2026-05-19

### Security

- Secure-by-default slice 3: refuse-to-boot on weak session secrets /
  `cors({ origin: "*" })` / `session()` + state-changing route without `csrf()`.
  First-request `500` on unconfigured `X-Forwarded-*`.

## [0.16.0] — 2026-05-19

### Security

- Secure-by-default slice 2: `secureHeaders()` auto-applied, cross-origin
  state-changing requests → `403` unless `cors()` allows, per-route `accepts`
  content-type opt-in.

## [0.15.0] — 2026-05-19

### Added

- Secure-by-default slice 1: log redaction defaults, stripped `Server` /
  `X-Powered-By`, duplicate `Host` / `Content-Length` rejection,
  `@daloyjs/core/hashing` (`passwordHash` / `passwordVerify`),
  `verifyWebhookSignature` / `signWebhookPayload`, explicit `app({ env })` with
  `NODE_ENV` mismatch warning.

## [0.14.x] — 2026-05-19

### Added

- `docs.scalar` configuration for Scalar UI theming/custom CSS.
- AI-friendly route metadata: optional `meta` on routes (examples, summary,
  tags, `x-*`), schema-validated example pairs, `daloy inspect --ai`, `--yaml` /
  `--format yaml` output for AI and OpenAPI dumps, docs at
  `website/app/docs/ai-metadata/`.

## [0.13.x] — 2026-05-18

### Added

- `createApp(options)` alias, `daloy dev` watcher with
  `--runtime <node|bun|deno>` override, OpenAPI `info` autofill from `deno.json`
  / `deno.jsonc`.
- `GET /openapi.yaml` mounted alongside JSON, `openapiYamlPath` option,
  dependency-free `openapiToYAML`.
- `/openapi.yaml` served as `text/yaml`; `create-daloy` then made install +
  `--with-ci` default to yes and documented `/openapi.yaml` across templates
  while core stayed on `0.13.2`.

## [0.12.0] — 2026-05-18

### Security

- CSRF Fetch-Metadata strategy, dual CSRF (`"both"`), CSP nonce + Trusted Types
  in `secureHeaders()`, `basicAuth()` with UTF-8 credential decoding.

## [0.11.0] — 2026-05-17

### Added

- WebSockets: RFC 6455 frame protocol in [`src/websocket.ts`](src/websocket.ts),
  typed `app.ws(path, handler)`, `defineWebSocket()`, Node + Bun adapter wiring,
  `@daloyjs/core/websocket` subpath.

## [0.10.x] — 2026-05-16

### Added

- Branch coverage gate: `pnpm coverage:branches` against compiled JS, introduced
  at ≥95% in CI and later relaxed to the current ≥90% floor.

> No standalone `0.10.x` was published — the `package.json` version went
> `0.9.1` → `0.11.0`, so this work shipped as part of `0.11.0`.

## [0.9.x] — 2026-05-16

### Changed

- Boot banner; Node 24 runtime floor (current manifest: `>=24.0.0`; `0.9.0`
  briefly used `>=24.15.0`).

## [0.8.x] — 2026-05-16

### Changed

- Web-standard adapter cleanup.

## [0.7.x] — 2026-05-16

### Added

- Edge-friendly signed-cookie session (`__Host-`, HMAC-SHA256, key rotation),
  pluggable `SessionStore`, `ctx.state.session`.

> The public repository's initial commit was already at `0.7.5`, so the
> `0.2.x`–`0.7.x` entries below predate this repo's git history; they share the
> initial-commit date (2026-05-16) rather than individual version-bump dates.

## [0.6.x] — 2026-05-16

### Added

- Plugin lifecycle events: `onPluginInstalled`, `onShutdown`.

## [0.5.0] — 2026-05-16

### Added

- Bun + Deno scaffolder templates + `--minimal`,
  `@daloyjs/core/rate-limit-redis` (ioredis + node-redis), `daloy inspect` CLI.

## [0.4.0] — 2026-05-16

### Added

- Multipart/form-data (`fileField`, `multipartObject`), CSRF helper
  (double-submit + same-site).

## [0.3.x] — 2026-05-16

### Added

- Streaming & observability: `sseStream` / `ndjsonStream` helpers, `otelTracing`
  hook, OpenAPI extras (`securitySchemes`, `webhooks`, `callbacks`,
  `discriminator`).

## [0.2.x] — 2026-05-16

### Added

- Confidence & lifecycle: `onSend` hook, GitHub Actions CI, `SECURITY.md`, OIDC
  publish with provenance, `pnpm create daloy` scaffolder (`node-basic`,
  `vercel`, `cloudflare-worker`), docs metadata + ORM guides.

[Unreleased]: https://github.com/daloyjs/daloy/compare/v1.0.0-rc.2...HEAD
[1.0.0-rc.2]: https://github.com/daloyjs/daloy/compare/v1.0.0-rc.1...v1.0.0-rc.2
[1.0.0-rc.1]: https://github.com/daloyjs/daloy/compare/v1.0.0-rc.0...v1.0.0-rc.1
[1.0.0-rc.0]: https://github.com/daloyjs/daloy/compare/v1.0.0-beta.7...v1.0.0-rc.0
[1.0.0-beta.7]: https://github.com/daloyjs/daloy/compare/v1.0.0-beta.6...v1.0.0-beta.7
[1.0.0-beta.6]: https://github.com/daloyjs/daloy/compare/v1.0.0-beta.5...v1.0.0-beta.6
[1.0.0-beta.5]: https://github.com/daloyjs/daloy/compare/v1.0.0-beta.4...v1.0.0-beta.5
[1.0.0-beta.4]: https://github.com/daloyjs/daloy/compare/v1.0.0-beta.3...v1.0.0-beta.4
[1.0.0-beta.3]: https://github.com/daloyjs/daloy/compare/v1.0.0-beta.2...v1.0.0-beta.3
[1.0.0-beta.2]: https://github.com/daloyjs/daloy/compare/v1.0.0-beta.1...v1.0.0-beta.2
[1.0.0-beta.1]: https://github.com/daloyjs/daloy/compare/v1.0.0-beta.0...v1.0.0-beta.1
[1.0.0-beta.0]: https://github.com/daloyjs/daloy/compare/v0.44.0...v1.0.0-beta.0
[0.44.0]: https://github.com/daloyjs/daloy/compare/v0.43.0...v0.44.0
[0.43.0]: https://github.com/daloyjs/daloy/compare/v0.42.0...v0.43.0
[0.42.0]: https://github.com/daloyjs/daloy/compare/v0.41.0...v0.42.0
[0.41.0]: https://github.com/daloyjs/daloy/compare/v0.40.0...v0.41.0
[0.40.0]: https://github.com/daloyjs/daloy/compare/v0.39.1...v0.40.0
[0.39.1]: https://github.com/daloyjs/daloy/compare/v0.39.0...v0.39.1
[0.39.0]: https://github.com/daloyjs/daloy/compare/v0.38.3...v0.39.0
[0.38.3]: https://github.com/daloyjs/daloy/compare/v0.38.2...v0.38.3
[0.38.2]: https://github.com/daloyjs/daloy/compare/v0.38.1...v0.38.2
[0.38.1]: https://github.com/daloyjs/daloy/compare/v0.38.0...v0.38.1
[0.38.0]: https://github.com/daloyjs/daloy/compare/v0.37.0...v0.38.0
[0.37.0]: https://github.com/daloyjs/daloy/compare/f37ce20...v0.37.0
[0.36.0]: https://github.com/daloyjs/daloy/compare/10de2f5...f37ce20
[0.35.2]: https://github.com/daloyjs/daloy/compare/f4a9733...10de2f5
[0.35.1]: https://github.com/daloyjs/daloy/compare/70592cb...f4a9733
[0.35.0]: https://github.com/daloyjs/daloy/compare/2fc135c...70592cb
[0.34.3]: https://github.com/daloyjs/daloy/compare/1805e7f...2fc135c
[0.34.2]: https://github.com/daloyjs/daloy/compare/v0.34.1...1805e7f
[0.34.1]: https://github.com/daloyjs/daloy/compare/v0.34.0...v0.34.1
[0.34.0]: https://github.com/daloyjs/daloy/compare/v0.33.0...v0.34.0
[0.33.0]: https://github.com/daloyjs/daloy/compare/v0.32.0...v0.33.0
[0.32.0]: https://github.com/daloyjs/daloy/compare/v0.31.0...v0.32.0
[0.31.0]: https://github.com/daloyjs/daloy/compare/v0.30.0...v0.31.0
[0.30.0]: https://github.com/daloyjs/daloy/compare/v0.29.1...v0.30.0
[0.29.1]: https://github.com/daloyjs/daloy/compare/v0.29.0...v0.29.1
[0.29.0]: https://github.com/daloyjs/daloy/compare/v0.28.0...v0.29.0
[0.28.0]: https://github.com/daloyjs/daloy/compare/v0.27.0...v0.28.0
[0.27.0]: https://github.com/daloyjs/daloy/compare/v0.26.0...v0.27.0
[0.26.0]: https://github.com/daloyjs/daloy/compare/v0.25.0...v0.26.0
[0.25.0]: https://github.com/daloyjs/daloy/compare/v0.24.0...v0.25.0
[0.24.0]: https://github.com/daloyjs/daloy/compare/v0.23.0...v0.24.0
[0.23.0]: https://github.com/daloyjs/daloy/compare/v0.22.0...v0.23.0
[0.22.0]: https://github.com/daloyjs/daloy/compare/v0.21.0...v0.22.0
[0.21.0]: https://github.com/daloyjs/daloy/compare/v0.20.0...v0.21.0
[0.20.0]: https://github.com/daloyjs/daloy/compare/v0.19.0...v0.20.0
[0.19.0]: https://github.com/daloyjs/daloy/compare/v0.18.0...v0.19.0
[0.18.0]: https://github.com/daloyjs/daloy/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/daloyjs/daloy/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/daloyjs/daloy/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/daloyjs/daloy/compare/v0.14.2...v0.15.0
[0.14.x]: https://github.com/daloyjs/daloy/compare/v0.13.2...v0.14.2
[0.13.x]: https://github.com/daloyjs/daloy/compare/v0.12.0...v0.13.2
[0.12.0]: https://github.com/daloyjs/daloy/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/daloyjs/daloy/compare/v0.9.1...v0.11.0
[0.10.x]: https://github.com/daloyjs/daloy/compare/v0.9.1...v0.11.0
[0.9.x]: https://github.com/daloyjs/daloy/compare/v0.8.2...v0.9.1
[0.8.x]: https://github.com/daloyjs/daloy/compare/v0.8.0...v0.8.2
[0.7.x]: https://github.com/daloyjs/daloy/releases
[0.6.x]: https://github.com/daloyjs/daloy/releases
[0.5.0]: https://github.com/daloyjs/daloy/releases
[0.4.0]: https://github.com/daloyjs/daloy/releases
[0.3.x]: https://github.com/daloyjs/daloy/releases
[0.2.x]: https://github.com/daloyjs/daloy/releases
[CVE-2026-27148]: https://www.aikido.dev/blog/storybooks-websockets-attack
[CVE-2026-26980]: https://www.aikido.dev/blog
[CVE-2025-29927]: https://nvd.nist.gov/vuln/detail/CVE-2025-29927
