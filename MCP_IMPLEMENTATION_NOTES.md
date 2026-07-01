# MCP Implementation Notes

This note records the reasoning behind adding Model Context Protocol (MCP)
support to DaloyJS core, the implementation choices made, and the security /
performance checks used to keep the feature aligned with DaloyJS' existing
posture.

## Background

The user scenario was not just "document MCP". It was:

> A company already runs a DaloyJS REST API and later decides to run another
> DaloyJS server specifically for MCP.

That changes the decision. A public docs-site MCP endpoint is useful for
DaloyJS documentation, but it does not solve the product case where application
teams need to expose their own tools, resources, and prompts to AI clients from
a DaloyJS service.

The MCP materials reviewed were:

- Model Context Protocol docs: <https://modelcontextprotocol.io/docs/getting-started/intro>
- Anthropic announcement: <https://www.anthropic.com/news/model-context-protocol>
- Cloudflare explainer: <https://www.cloudflare.com/learning/ai/what-is-model-context-protocol-mcp/>

The key protocol facts that shaped the implementation:

- MCP is a JSON-RPC 2.0 protocol.
- Servers expose capabilities such as tools, resources, and prompts.
- Remote MCP servers use Streamable HTTP.
- Stdio is mainly a local-process transport, and spawning / managing those
  processes has a different security model than a web framework route.
- MCP tools are model-callable operations, so they need strong server-side
  validation, auth, rate limits, observability, and safe outbound networking.

## Decision

MCP belongs in `@daloyjs/core`, but only as a narrow, dependency-free
Streamable HTTP helper.

The implementation added:

- `createMcpHandler()` in `src/mcp.ts`
- `mcpRoutes()` in `src/mcp.ts`
- `McpToolError` for recoverable tool / resource / prompt errors
- TypeScript types for MCP tools, resources, prompts, content blocks, JSON
  values, request context, and handler options
- `@daloyjs/core/mcp` and `@daloyjs/daloy/mcp` export subpaths
- Main-barrel exports for the same public API
- Tests in `tests/mcp.test.ts`
- User-facing docs at `website/app/docs/mcp/page.tsx`
- README status entry

The implementation intentionally did not add:

- `@modelcontextprotocol/sdk`
- runtime dependencies
- stdio process spawning
- OAuth metadata / authorization-server implementation
- persistent MCP sessions
- server-initiated SSE streams
- experimental MCP task support

Those features either add dependency weight, require a product-specific trust
boundary, or are better handled by an application/integration package once a
real use case requires them.

## Why This Shape

### 1. Preserve DaloyJS' zero-runtime-dependency posture

`@daloyjs/core` has a strict zero-runtime-dependency policy. Pulling in the
official MCP SDK would violate the spirit of that policy and expand the
supply-chain attack surface for every core user, including users who never
host MCP.

The core helper uses only web-standard platform APIs:

- `Request`
- `Response`
- `TextDecoder`
- `JSON.parse`
- plain TypeScript types

`pnpm verify:no-runtime-deps` passes after the feature.

### 2. Keep existing REST API performance untouched

The change does not modify the router, request dispatch, schema validation,
middleware execution, adapters, body parsing, or response serialization hot
paths.

The MCP code lives in a new file, `src/mcp.ts`. It is only paid for when a user
imports `@daloyjs/core/mcp` or imports from the main barrel and uses it.

The one barrel export addition has a module-load cost for consumers of the
main entrypoint, but it does not affect request-time routing performance. The
tree-shake-friendly subpath exists for users who want narrower imports.

Router smoke benchmark after the change:

```text
static route lookup                      15,204,915 ops/sec
dynamic 4-segment lookup                 1,345,077 ops/sec
miss                                     4,852,429 ops/sec
```

### 3. Use DaloyJS routes instead of bypassing the framework

`mcpRoutes("/mcp", handler)` returns normal DaloyJS route definitions for:

- `POST /mcp`
- `GET /mcp`
- `OPTIONS /mcp`

That is deliberate. It means an MCP server can use the same operational and
security middleware as every other DaloyJS app:

- `bearerAuth()`
- `rateLimit()`
- `ipRestriction()`
- `clientCertAuth()`
- `secureHeaders()`
- request ids
- structured logging
- app-level body limits
- request timeouts

The docs recommend running MCP as a separate DaloyJS app when the MCP surface
has a different trust boundary than the REST API.

### 4. Make the transport explicit

`createMcpHandler()` owns only the Streamable HTTP JSON-RPC transport. It
handles:

- `initialize`
- `ping`
- `tools/list`
- `tools/call`
- `resources/list`
- `resources/read`
- `prompts/list`
- `prompts/get`
- JSON-RPC parse errors
- notifications (`202 Accepted`)
- JSON-RPC responses sent to the server (`202 Accepted`)
- unsupported methods
- unsupported `MCP-Protocol-Version`
- oversized request bodies

It does not pretend to implement every possible MCP deployment shape.

### 5. Keep TSDoc strong for developer experience

The new exported API is heavily documented because MCP is new surface area and
tool safety is subtle. TSDoc covers:

- purpose of each type
- parameters and return values
- handler behavior
- when to throw `McpToolError`
- security-relevant behavior
- why schemas are guidance and not server-side validation by themselves
- why middleware should enforce auth and rate limits

This matches the repo rule that every new exported API must have accurate
TSDoc.

## Security Reasoning

### What the implementation protects by default

The MCP handler includes focused protocol-level guards:

- default request body cap: `256 KiB`
- explicit positive integer validation for `maxBodyBytes`
- required `serverInfo.name`
- required `serverInfo.version`
- duplicate tool names rejected at construction
- duplicate resource URIs rejected at construction
- duplicate prompt names rejected at construction
- unsupported `MCP-Protocol-Version` rejected with HTTP `400`
- JSON-RPC batch requests rejected
- invalid JSON rejected
- invalid UTF-8 rejected
- invalid JSON-RPC id rejected
- `POST` requests without `application/json` rejected with `415`
- unexpected handler failures become JSON-RPC internal errors
- internal error details are redacted by default in production
- recoverable tool errors use `McpToolError` and return `isError: true`

### What remains the application's responsibility

MCP tools are still application code. The helper cannot know a company's
authorization model, data classification, or side-effect boundaries.

Applications must still:

- authenticate MCP clients
- authorize each tool according to the caller
- validate tool arguments server-side
- cap expensive operations
- rate-limit the endpoint
- audit tool calls
- protect outbound fetches with `fetchGuard()` when URLs are influenced by
  prompts, users, model output, or external content
- avoid exposing dangerous tools that let a model execute shell commands,
  mutate production state, or read secrets without approval

The docs page makes this explicit.

### Why no stdio support in core

Stdio MCP servers require launching and supervising local processes. That
introduces a very different set of concerns:

- command execution
- environment-variable exposure
- filesystem access
- process lifetime
- local user trust boundary
- editor / agent config safety

DaloyJS core is a web framework. A dependency-free remote Streamable HTTP
helper fits that boundary. A stdio launcher does not.

### Why no bundled OAuth implementation

Remote MCP deployments may need OAuth, but OAuth server metadata and token
issuance are not one-size-fits-all. Shipping an OAuth implementation in core
would either be too shallow to be safe or too broad for DaloyJS' dependency and
maintenance goals.

Instead, MCP routes are normal DaloyJS routes. Users can put bearer auth,
mTLS, gateway auth, IP restrictions, or their existing identity middleware in
front of them.

## Implementation Details

### `createMcpHandler(options)`

Creates a Fetch-compatible function:

```ts
type McpHandler = (request: Request) => Promise<Response>;
```

The handler:

1. Handles `OPTIONS` with `204`.
2. Handles `GET` with a JSON discovery hint and `405`.
3. Requires `POST` for actual MCP calls.
4. Requires `application/json` on `POST`.
5. Checks `MCP-Protocol-Version`.
6. Enforces `maxBodyBytes` using `Content-Length` first and the actual body
   size second.
7. Decodes UTF-8 with fatal decoding.
8. Parses one JSON-RPC message.
9. Rejects batch requests.
10. Routes supported MCP methods to the configured tools, resources, and
    prompts.
11. Returns JSON-RPC responses with `cache-control: no-store`.

### `mcpRoutes(path, handler)`

Returns route definitions for a DaloyJS app:

```ts
for (const route of mcpRoutes("/mcp", mcp)) {
  app.route(route);
}
```

The routes return raw `Response` objects. That is appropriate here because MCP
is a protocol envelope, not a normal REST JSON response modeled by route
schemas.

To avoid false-positive response-body audit warnings, the generated route
metadata includes a permissive response schema for the MCP `200` and `202`
envelopes.

### `McpToolError`

Use `McpToolError` for caller-fixable problems:

- missing argument
- invalid argument
- unknown domain object
- unsupported operation

For tools, it is returned to the MCP client as:

```json
{
  "content": [{ "type": "text", "text": "sku is required." }],
  "isError": true
}
```

Unexpected errors become JSON-RPC internal errors instead.

## Files Changed

- `src/mcp.ts`: new MCP protocol helper and public types
- `src/index.ts`: main-barrel exports
- `package.json`: `./mcp` npm export and keyword
- `jsr.json`: matching `./mcp` JSR export
- `tests/mcp.test.ts`: happy and unhappy path tests
- `website/app/docs/mcp/page.tsx`: user-facing MCP guide
- `website/components/docs-nav.ts`: docs navigation entry
- `website/app/sitemap.ts`: sitemap entry
- `README.md`: status entry

## Test Coverage

The MCP tests cover:

- `initialize` negotiation
- capability advertisement
- `tools/list`
- `tools/call`
- structured tool output
- recoverable `McpToolError`
- redacted unexpected failures
- `resources/list`
- `resources/read`
- `prompts/list`
- `prompts/get`
- unsupported protocol versions
- oversized bodies
- non-JSON POST rejection
- notification acknowledgement
- JSON-RPC response acknowledgement
- real Daloy app mounting via `mcpRoutes()`
- response-body audit compatibility
- duplicate capability names rejected at construction

## Verification Run

Commands run after implementation:

```text
pnpm typecheck
pnpm test
pnpm verify:no-runtime-deps
pnpm verify:parity-audits
pnpm verify:governance-audits
pnpm verify:sbom
pnpm verify:docs-links
pnpm bench
cd website && pnpm typecheck
cd website && pnpm build
```

Notes:

- The first non-escalated `pnpm test` failed because the sandbox blocked local
  socket listener tests with `listen EPERM` on `127.0.0.1` / `0.0.0.0`.
- The escalated rerun passed: `2199` tests, `0` failures.
- The first website build failed because the sandbox blocked Google Fonts
  fetches used by `next/font`.
- The escalated website build passed.

## Security / Performance Conclusion

This implementation should not degrade current DaloyJS runtime performance or
destroy existing built-in security features because:

- no existing request hot path was changed
- no existing security module was weakened
- no existing middleware behavior was changed
- no runtime dependency was added
- MCP is opt-in
- MCP routes are normal DaloyJS routes and therefore compose with existing
  security middleware
- protocol-specific input limits and parsing guards were added
- the docs steer users toward a dedicated MCP server with explicit auth and
  rate limits

The result is intentionally conservative: enough MCP support for real DaloyJS
teams to run a separate MCP server, without turning core into a full MCP SDK or
process manager.
