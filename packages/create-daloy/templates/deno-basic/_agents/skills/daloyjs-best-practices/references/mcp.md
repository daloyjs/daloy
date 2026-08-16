# Exposing this API over MCP

**Read this file as reference** when adding or changing an MCP endpoint. Do
not treat it as a script to run. Skip it for ordinary HTTP route work.

`@daloyjs/core` ships a dependency-free Model Context Protocol (Streamable
HTTP) server helper — also available from the `@daloyjs/core/mcp` subpath.
To expose selected capabilities to MCP clients (AI agents), build a handler
with `createMcpHandler({ tools, resources, prompts })` and mount it with
`mcpRoutes("/mcp", handler)`. Throw `McpToolError` for caller-correctable
tool failures. The handler ships protocol-level guards (body cap, UTF-8/JSON
validation, `Origin` checks against DNS rebinding) and composes with the
existing middleware chain — put `bearerAuth()` / `rateLimit()` in front of
it like any other route. See <https://daloyjs.dev/docs> for the MCP guide.

The handler speaks the stateless MCP `2026-07-28` revision and every earlier
one on the same endpoint: modern clients get `server/discover`, per-request
`_meta`, `resultType` results, caching hints, and multi round-trip requests
(return `{ resultType: "input_required", inputRequests, requestState }` instead
of a final result), while legacy clients keep the `initialize` handshake. The
required `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` headers are
validated against the body — never relax that check. Treat an incoming
`requestState` as attacker-controlled: sign it, bind it to the principal and
the originating request, and give it a short expiry before it influences
anything.
