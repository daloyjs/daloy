import { CodeBlock } from "../../../components/code-block";
import { FlowDiagram, SequenceDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Model Context Protocol (MCP)",
  description:
    "Build a dedicated Model Context Protocol server with DaloyJS. Expose tools, resources, and prompts over stateless MCP 2026-07-28 Streamable HTTP while keeping @daloyjs/core dependency-free and secure by default.",
  path: "/docs/mcp",
  keywords: [
    "DaloyJS MCP",
    "Model Context Protocol",
    "MCP 2026-07-28",
    "stateless MCP",
    "MCP Streamable HTTP",
    "MCP tools",
    "MCP resources",
    "MCP prompts",
    "AI agent backend",
    "createMcpHandler",
    "validateMcpInput",
    "MCP inputSchema validation",
    "server/discover",
    "multi round-trip requests",
    "MRTR",
    "x-mcp-header",
    "mcpRoutes public",
    "MCP auth boot guard",
  ],
  type: "article",
});

const DISCOVER_REQUEST = `POST /mcp HTTP/1.1
Content-Type: application/json
MCP-Protocol-Version: 2026-07-28
Mcp-Method: server/discover

{
  "jsonrpc": "2.0",
  "id": "discover-1",
  "method": "server/discover",
  "params": {
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { "name": "ExampleClient", "version": "1.0.0" },
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  }
}`;

const DISCOVER_RESPONSE = `{
  "jsonrpc": "2.0",
  "id": "discover-1",
  "result": {
    "resultType": "complete",
    "supportedVersions": ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25", "2026-07-28"],
    "capabilities": { "tools": {}, "resources": {}, "prompts": {} },
    "instructions": "Use this server to inspect inventory and prepare stock reports.",
    "ttlMs": 0,
    "cacheScope": "private",
    "_meta": {
      "io.modelcontextprotocol/serverInfo": { "name": "inventory-mcp", "version": "1.0.0" }
    }
  }
}`;

const STRICT_VERSIONS = `const mcp = createMcpHandler({
  serverInfo: { name: "inventory-mcp", version: "1.0.0" },
  // Refuse every pre-2026 revision. A client that asks for an older version
  // gets -32022 with the supported list instead of legacy semantics, so the
  // Mcp-Method / Mcp-Name header contract holds for every request that reaches
  // a tool. Only do this once your clients have migrated.
  protocolVersions: ["2026-07-28"],
  tools: [/* ... */],
});`;

const HEADER_MISMATCH = `{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32020,
    "message": "Header mismatch: Mcp-Method header value 'prompts/list' does not match body value 'tools/list'"
  }
}`;

const CACHE = `const mcp = createMcpHandler({
  serverInfo: { name: "inventory-mcp", version: "1.0.0" },
  // Defaults: { ttlMs: 0, scope: "private" } — clients revalidate every call and
  // no shared proxy may store the response. Raise ttlMs once you are sure the
  // list is stable, and only use "public" when every caller sees the same tools.
  cache: { ttlMs: 300_000, scope: "private" },
  tools: [/* ... */],
});`;

const MRTR = `const mcp = createMcpHandler({
  serverInfo: { name: "deploy-mcp", version: "1.0.0" },
  tools: [
    {
      name: "deploy_service",
      description: "Deploy a service after the user confirms.",
      inputSchema: {
        type: "object",
        properties: { service: { type: "string", minLength: 1 } },
        required: ["service"],
        additionalProperties: false,
      },
      handler: async (args, ctx) => {
        const confirmation = ctx.inputResponses?.confirm as
          | { action?: string }
          | undefined;

        if (!confirmation) {
          // Nothing to resume from yet: ask the client to collect a decision.
          return {
            resultType: "input_required",
            inputRequests: {
              confirm: {
                method: "elicitation/create",
                params: {
                  mode: "form",
                  message: \`Deploy \${String(args.service)} to production?\`,
                  requestedSchema: {
                    type: "object",
                    properties: { approve: { type: "boolean" } },
                    required: ["approve"],
                  },
                },
              },
            },
            // Opaque to the client, attacker-controlled on the way back.
            // Sign it: this one carries the principal, the target, and an expiry.
            requestState: await signState({
              sub: ctx.request.headers.get("x-user-id"),
              service: args.service,
              exp: Date.now() + 120_000,
            }),
          };
        }

        // Retry path. Never trust requestState before verifying it.
        const state = await verifyState(ctx.requestState);
        if (state.service !== args.service) {
          throw new McpToolError("Request state does not match this call.");
        }
        if (confirmation.action !== "accept") {
          return "Deploy cancelled.";
        }

        await deploy(state.service);
        return \`Deployed \${state.service}.\`;
      },
    },
  ],
});`;

const MRTR_WIRE = `// 1. First call — the server cannot finish yet.
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "resultType": "input_required",
    "inputRequests": {
      "confirm": { "method": "elicitation/create", "params": { "...": "..." } }
    },
    "requestState": "v1.eyJzdWIiOiJ1XzEifQ.<hmac>"
  }
}

// 2. Retry — NEW JSON-RPC id, original params, plus the answers and state.
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "deploy_service",
    "arguments": { "service": "checkout-api" },
    "inputResponses": { "confirm": { "action": "accept", "content": { "approve": true } } },
    "requestState": "v1.eyJzdWIiOiJ1XzEifQ.<hmac>",
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": { "elicitation": {} }
    }
  }
}`;

const MIRRORED = `{
  name: "execute_sql",
  description: "Execute SQL in a regional cluster.",
  inputSchema: {
    type: "object",
    properties: {
      // Mirrored into "Mcp-Param-Region" so a gateway can route on it.
      region: { type: "string", "x-mcp-header": "Region" },
      query: { type: "string" },
    },
    required: ["region", "query"],
    additionalProperties: false,
  },
  handler: async (args) => runSql(String(args.region), String(args.query)),
}`;

const STATE_HANDLE = `// No protocol session exists, so carry state in an explicit handle.
{
  name: "add_item",
  description: "Add a SKU to an existing basket. Baskets expire after 24h.",
  inputSchema: {
    type: "object",
    properties: {
      basket_id: { type: "string", minLength: 1 },
      sku: { type: "string", minLength: 1 },
    },
    required: ["basket_id", "sku"],
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    // A handle is a name, not a capability: re-authorize it on every call.
    const basket = await baskets.findForCaller(String(args.basket_id), ctx.request);
    if (!basket) throw new McpToolError("Unknown or expired basket.");
    await basket.add(String(args.sku));
    return \`Added \${String(args.sku)} to \${basket.id}.\`;
  },
}`;

const INSTALL = `# MCP support ships in @daloyjs/core.
# No @modelcontextprotocol/sdk dependency is required.
pnpm add @daloyjs/core`;

const SERVER = `import {
  App,
  McpToolError,
  bearerAuth,
  createMcpHandler,
  mcpRoutes,
  rateLimit,
} from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const mcp = createMcpHandler({
  serverInfo: {
    name: "inventory-mcp",
    title: "Inventory MCP",
    version: "1.0.0",
  },
  instructions:
    "Use this server to inspect inventory and prepare stock reports.",
  tools: [
    {
      name: "inventory_lookup",
      title: "Inventory lookup",
      description: "Look up available inventory units by SKU.",
      inputSchema: {
        type: "object",
        properties: { sku: { type: "string", minLength: 1 } },
        required: ["sku"],
        additionalProperties: false,
      },
      handler: async (args) => {
        const sku = typeof args.sku === "string" ? args.sku : "";
        if (!sku) {
          throw new McpToolError("sku is required.");
        }

        const units = await inventory.countAvailable(sku);
        return {
          content: [{ type: "text", text: \`\${sku}: \${units} units\` }],
          structuredContent: { sku, units },
        };
      },
    },
  ],
  resources: [
    {
      uri: "daloy://schemas/inventory",
      name: "inventory_schema",
      title: "Inventory schema",
      mimeType: "application/json",
      read: () => ({
        uri: "daloy://schemas/inventory",
        mimeType: "application/json",
        text: JSON.stringify({
          sku: "string",
          units: "number",
          warehouseId: "string",
        }),
      }),
    },
  ],
  prompts: [
    {
      name: "stock_report",
      title: "Stock report",
      description: "Draft a stock report for one SKU.",
      arguments: [{ name: "sku", required: true }],
      get: (args) => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: \`Prepare a stock report for SKU \${String(args.sku)}.\`,
            },
          },
        ],
      }),
    },
  ],
});

const app = new App({
  bodyLimitBytes: 64 * 1024,
  requestTimeoutMs: 10_000,
});

app.use(rateLimit({ windowMs: 60_000, max: 120 }));
app.use(
  bearerAuth({
    realm: "inventory-mcp",
    validate: (token) => token === process.env.MCP_TOKEN,
  })
);

for (const route of mcpRoutes("/mcp", mcp)) {
  app.route(route);
}

serve(app, { port: 3001 });`;

const CLIENT_CONFIG = `{
  "mcpServers": {
    "inventory": {
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer \${MCP_TOKEN}"
      }
    }
  }
}`;

const SCALAR_SEARCH_BODY = `{
  "query": "How do I enable OpenAPI docs and Scalar UI in DaloyJS?",
  "limit": 2
}`;

const SCALAR_SEARCH_RESPONSE = `{
  "results": [
    {
      "slug": "docs/openapi",
      "title": "OpenAPI generation",
      "heading": "Scalar UI",
      "url": "https://daloyjs.dev/docs/openapi",
      "text": "Enable OpenAPI generation and Scalar UI from your DaloyJS app.",
      "score": 0.82
    }
  ]
}`;

const MCP_SEARCH_CALL = `{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "search_docs",
    "arguments": {
      "query": "How do I enable OpenAPI docs and Scalar UI in DaloyJS?",
      "limit": 2
    }
  }
}`;

const ORIGINS = `const mcp = createMcpHandler({
  serverInfo: { name: "inventory-mcp", version: "1.0.0" },
  // Streamable HTTP DNS-rebinding defense (spec requirement) is built in:
  // requests without an Origin header (Claude, Cursor, CLIs) and loopback
  // origins (localhost, *.localhost, 127.0.0.1, [::1]) are allowed. Every
  // other browser origin gets 403 unless listed here. A same-origin Origin is
  // NOT implicitly trusted: under DNS rebinding the attacker hostname resolves
  // to your host, so Origin.host can equal Host. The allowlist is the gate.
  allowedOrigins: ["https://app.example.com"],
  tools: [/* ... */],
});`;

const TEMPLATES = `const mcp = createMcpHandler({
  serverInfo: { name: "inventory-mcp", version: "1.0.0" },
  resourceTemplates: [
    {
      uriTemplate: "daloy://records/{table}/{id}",
      name: "record",
      description: "Read one record by table and id.",
      mimeType: "application/json",
      // {table} and {id} each match one URI segment. The values are raw,
      // untrusted strings: validate them before touching your database.
      read: async (uri, variables) => {
        const row = await db.findRecord(variables.table, variables.id);
        if (!row) throw new McpToolError(\`No record \${variables.id}.\`);
        return { uri, mimeType: "application/json", text: JSON.stringify(row) };
      },
    },
  ],
});`;

const ACKNOWLEDGE = `// Hand-rolled MCP mount (instead of mcpRoutes()): the response is an opaque
// JSON-RPC envelope built by createMcpHandler, so acknowledge the missing
// response body schema instead of leaving the boot warning unanswered.
app.post(
  "/mcp",
  {
    operationId: "mcpStreamableHttp",
    acknowledgeNoResponseBodySchema: true,
    responses: {
      200: { description: "MCP JSON-RPC response" },
      202: { description: "Accepted (notification, no content)" },
    },
  },
  ({ request }) => mcp(request),
);`;

const INPUT_INVALID = `{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32602,
    "message": "Invalid params"
  }
}`;

const VALIDATE_HELPER = `import { validateMcpInput } from "@daloyjs/core";

const schema = {
  type: "object",
  properties: { sku: { type: "string", minLength: 1 } },
  required: ["sku"],
  additionalProperties: false,
} as const;

// [] means valid; a non-empty array holds human-readable error messages.
validateMcpInput(schema, { sku: "ABC-1" });        // []
validateMcpInput(schema, {});                       // ["arguments: missing required property \\"sku\\""]
validateMcpInput(schema, { sku: "", extra: true }); // 2 errors`;

const ERROR_HANDLING = `import { McpToolError, createMcpHandler } from "@daloyjs/core/mcp";

const mcp = createMcpHandler({
  serverInfo: { name: "inventory-mcp", version: "1.0.0" },
  tools: [
    {
      name: "inventory_lookup",
      description: "Look up inventory by SKU.",
      inputSchema: {
        type: "object",
        properties: { sku: { type: "string" } },
        required: ["sku"],
        additionalProperties: false,
      },
      handler: async (args) => {
        const sku = typeof args.sku === "string" ? args.sku.trim() : "";
        if (!sku) {
          throw new McpToolError("sku is required.");
        }

        const row = await inventory.findBySku(sku);
        if (!row) {
          throw new McpToolError(\`No inventory record found for \${sku}.\`);
        }

        return \`\${row.sku}: \${row.units} units\`;
      },
    },
  ],
});`;

export default function Page() {
  return (
    <>
      <h1>Model Context Protocol (MCP)</h1>
      <p>
        DaloyJS can host a dedicated{" "}
        <a
          href="https://modelcontextprotocol.io/docs/getting-started/intro"
          target="_blank"
          rel="noreferrer noopener"
        >
          Model Context Protocol
        </a>{" "}
        server for AI clients that need tools, resources, and prompts. The core
        helper implements MCP Streamable HTTP with JSON-RPC 2.0, so a company
        that already runs a DaloyJS REST API can run a second DaloyJS service at
        <code>/mcp</code> with a different auth policy and a smaller, agent-safe
        surface area.
      </p>
      <p>
        Keep the REST API and the MCP server separate when the callers,
        permissions, or rate limits differ. MCP tools are model-callable
        operations, so they deserve the same care as any production API route,
        plus tighter descriptions and schemas because the caller may be an AI
        client acting on a user&apos;s behalf.
      </p>

      <FlowDiagram
        title="Dedicated MCP boundary"
        steps={[
          {
            label: "AI client",
            detail: "Claude, Cursor, VS Code",
            tone: "accent",
          },
          {
            label: "DaloyJS MCP app",
            detail: "POST /mcp JSON-RPC",
            tone: "default",
          },
          {
            label: "Tools and context",
            detail: "tools, resources, prompts",
            tone: "default",
          },
          {
            label: "Existing systems",
            detail: "database, REST API, queues",
            tone: "muted",
          },
        ]}
        caption="Run MCP as its own DaloyJS service when it has a different trust boundary than your REST API. The app still gets body limits, request timeouts, rate limits, auth middleware, and problem+json errors."
      />

      <h2 id="protocol-versions">Protocol versions and the stateless core</h2>
      <p>
        MCP <code>2026-07-28</code> removed the <code>initialize</code> /{" "}
        <code>notifications/initialized</code> handshake and the{" "}
        <code>Mcp-Session-Id</code> header. The protocol is now stateless: every
        request carries its own protocol version, client identity, and client
        capabilities in <code>params._meta</code>
        {", "}so any request can land on any instance. That is exactly the shape
        serverless and edge deployments want, and it is the shape DaloyJS was
        already built for.
      </p>
      <p>
        <code>createMcpHandler()</code> serves <strong>both eras</strong> on one
        endpoint. A request is handled as <em>modern</em> when its{" "}
        <code>_meta</code> protocol version (or the{" "}
        <code>MCP-Protocol-Version</code> header) is <code>2026-07-28</code> or
        later; everything else takes the unchanged legacy path. You do not
        configure this, and older clients keep working.
      </p>
      <p>
        Because the era follows the version the <em>client</em> declares, a
        naive dual-era server would hand attackers a free bypass: declare{" "}
        <code>2025-11-25</code>
        {", "}keep whatever <code>Mcp-Method</code> or{" "}
        <code>Mcp-Param-*</code> header satisfies the gateway in front, and send
        a body that does something else. DaloyJS closes that.{" "}
        <a href="#request-headers">Header/body agreement</a> is validated in{" "}
        <strong>both</strong> eras. Legacy requests are not{" "}
        <em>required</em> to carry the standard headers — those headers postdate
        them — but any they do carry must match the body, or the request is
        refused with <code>-32020</code>
        {". "}A genuine legacy client, which sends none of them, is unaffected.
      </p>
      <p>
        Once your clients have migrated you can go further and refuse the older
        revisions entirely, so no request reaches a tool without the full modern
        contract:
      </p>
      <CodeBlock code={STRICT_VERSIONS} />
      <div className="not-prose overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Concern</th>
              <th>Legacy (2024-11-05 … 2025-11-25)</th>
              <th>Modern (2026-07-28)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Handshake</td>
              <td>
                <code>initialize</code> + <code>ping</code>
              </td>
              <td>
                none; optional <code>server/discover</code>
              </td>
            </tr>
            <tr>
              <td>Version and capabilities</td>
              <td>negotiated once per session</td>
              <td>
                per request, in <code>_meta</code>
              </td>
            </tr>
            <tr>
              <td>Sessions</td>
              <td>
                <code>Mcp-Session-Id</code>
              </td>
              <td>none; use explicit handles</td>
            </tr>
            <tr>
              <td>Required headers</td>
              <td>
                <code>MCP-Protocol-Version</code>
              </td>
              <td>
                <code>MCP-Protocol-Version</code>, <code>Mcp-Method</code>,{" "}
                <code>Mcp-Name</code>
              </td>
            </tr>
            <tr>
              <td>Result envelope</td>
              <td>method-specific</td>
              <td>
                <code>resultType</code> + <code>_meta.serverInfo</code>
              </td>
            </tr>
            <tr>
              <td>Server asks the user something</td>
              <td>server-initiated request over SSE</td>
              <td>
                <code>input_required</code> + client retry
              </td>
            </tr>
            <tr>
              <td>Resource not found</td>
              <td>
                <code>-32002</code>
              </td>
              <td>
                <code>-32602</code>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 id="install">Install</h2>
      <CodeBlock code={INSTALL} language="bash" />

      <h2 id="create-an-mcp-server">Create an MCP server</h2>
      <p>
        Use <code>createMcpHandler()</code> for the MCP protocol layer and{" "}
        <code>mcpRoutes()</code> to mount <code>POST</code>
        {", "}
        <code>GET</code>
        {", "}
        and <code>OPTIONS</code> on a DaloyJS app. The <code>POST</code> route
        is the actual MCP transport. <code>GET</code> returns a JSON hint
        instead of opening a server-initiated SSE stream, and{" "}
        <code>OPTIONS</code> supports browser-based clients when CORS middleware
        is installed.
      </p>
      <CodeBlock code={SERVER} />

      <h2 id="client-config">Client config</h2>
      <p>
        Point an MCP-compatible client at the deployed endpoint. The exact
        config file differs by client, but remote Streamable HTTP servers use a
        URL and whatever headers your auth middleware requires.
      </p>
      <CodeBlock code={CLIENT_CONFIG} language="json" />

      <h2 id="testing-in-scalar">Testing in Scalar</h2>
      <p>
        Scalar is best for testing normal REST endpoints. If your app exposes a
        regular docs search route and an MCP route, use{" "}
        <code>POST /search</code> in Scalar for the normal API request. Do not
        paste the search body into <code>POST /mcp</code>; MCP uses JSON-RPC
        envelopes, not plain REST request bodies.
      </p>
      <CodeBlock code={SCALAR_SEARCH_BODY} language="json" />
      <p>
        The REST endpoint should return <code>200 OK</code> with a response like
        this:
      </p>
      <CodeBlock code={SCALAR_SEARCH_RESPONSE} language="json" />
      <p>
        Use <code>POST /mcp</code> only with an MCP-compatible client or with a
        JSON-RPC request. If you see <code>202 Accepted</code> with an empty
        body while testing <code>/mcp</code>
        {", "}that means the MCP request did not ask for a JSON-RPC response.
        Add an <code>id</code> and call the tool through <code>tools/call</code>
        {": "}
      </p>
      <CodeBlock code={MCP_SEARCH_CALL} language="json" />
      <p>
        Short version: test normal APIs on <code>/search</code> in Scalar, and
        reserve <code>/mcp</code> for MCP clients or explicit JSON-RPC requests.
      </p>

      <h2 id="what-core-supports">What core supports</h2>
      <ul>
        <li>
          <strong>MCP 2026-07-28 (stateless):</strong>{" "}
          <code>server/discover</code>
          {", "}
          <code>tools/list</code>
          {", "}
          <code>tools/call</code>
          {", "}
          <code>resources/list</code>
          {", "}
          <code>resources/templates/list</code>
          {", "}
          <code>resources/read</code> (including template-matched URIs),{" "}
          <code>prompts/list</code>
          {", "}and <code>prompts/get</code>
          {". "}Every result carries <code>resultType</code> and{" "}
          <code>_meta.serverInfo</code>
          {"; "}cacheable ones also carry <code>ttlMs</code> /{" "}
          <code>cacheScope</code>
          {". "}Per-request <code>_meta</code> validation, standard-header
          validation (<code>-32020</code>), multi round-trip results, and{" "}
          <code>x-mcp-header</code> mirroring are all enforced.
        </li>
        <li>
          <strong>MCP 2025-11-25 and earlier (legacy):</strong>{" "}
          <code>initialize</code> and <code>ping</code> on the same endpoint,
          unchanged, so existing clients keep working while the ecosystem
          migrates.
        </li>
        <li>
          Protocol-version negotiation with{" "}
          <code>UnsupportedProtocolVersion</code> (<code>-32022</code>)
          responses that name the versions this server does speak (headerless
          legacy requests assume <code>2025-03-26</code> per the spec), JSON-RPC
          parse errors, accepted notifications, unknown-pagination-cursor
          rejection, and bounded request bodies parsed with the framework&apos;s{" "}
          <code>safeJsonParse</code> so <code>__proto__</code> /{" "}
          <code>constructor</code> / <code>prototype</code> keys are stripped,
          matching the REST body parsers.
        </li>
        <li>
          <strong>
            Server-side <code>tools/call</code> argument validation
          </strong>{" "}
          against each tool&apos;s <code>inputSchema</code> before the handler
          runs (see below).
        </li>
        <li>
          Built-in <code>Origin</code> validation against DNS rebinding, with an{" "}
          <code>allowedOrigins</code> allowlist for browser-based clients.
        </li>
        <li>
          MCP 2025-11-25 metadata: server <code>description</code>
          {", "}
          <code>websiteUrl</code>
          {", "}and <code>icons</code>; tool <code>outputSchema</code>
          {", "}
          <code>annotations</code> (read-only, destructive, idempotent,
          open-world hints), and <code>icons</code>; icons on resources,
          templates, and prompts. Tool results that return only{" "}
          <code>structuredContent</code> get a serialized text block backfilled
          for older clients.
        </li>
        <li>
          Dependency-free TypeScript types for tools, resources, resource
          templates, prompts, JSON schemas, content blocks, structured tool
          output, and handler context.
        </li>
      </ul>

      <h2 id="server-discover">Discovery (<code>server/discover</code>)</h2>
      <p>
        A modern server <strong>must</strong> implement{" "}
        <code>server/discover</code>
        {". "}It is the one call that tells a client which protocol versions,
        capabilities, and identity a server has, without probing{" "}
        <code>tools/list</code>
        {", "}
        <code>prompts/list</code>
        {", "}and <code>resources/list</code> separately. DaloyJS answers it
        from the same <code>serverInfo</code>
        {", "}
        <code>instructions</code>
        {", "}and capability set you already configured, so there is nothing
        extra to wire up.
      </p>
      <CodeBlock code={DISCOVER_REQUEST} language="http" />
      <CodeBlock code={DISCOVER_RESPONSE} language="json" />
      <p>
        Legacy clients that call <code>server/discover</code> get{" "}
        <code>-32601</code>
        {", "}and modern clients that call <code>initialize</code> or{" "}
        <code>ping</code> get <code>-32601</code> with HTTP <code>404</code>
        {" — "}the status the spec reserves for &ldquo;modern server, unknown
        method&rdquo; so a client can tell it apart from a legacy endpoint.
      </p>

      <h2 id="request-headers">Required request headers</h2>
      <p>
        Streamable HTTP mirrors selected body fields into HTTP headers so load
        balancers, gateways, and WAFs can route and inspect requests without
        parsing JSON. On a modern request all of these are{" "}
        <strong>required</strong>
        {": "}
        <code>MCP-Protocol-Version</code> (must equal{" "}
        <code>_meta[&quot;io.modelcontextprotocol/protocolVersion&quot;]</code>
        ), <code>Mcp-Method</code> (must equal the JSON-RPC{" "}
        <code>method</code>), and <code>Mcp-Name</code> for{" "}
        <code>tools/call</code>
        {", "}
        <code>resources/read</code>
        {", "}and <code>prompts/get</code> (must equal{" "}
        <code>params.name</code> or <code>params.uri</code>).
      </p>
      <p>
        DaloyJS rejects a missing or disagreeing header with HTTP{" "}
        <code>400</code> and JSON-RPC <code>-32020</code> (
        <code>HeaderMismatch</code>). This is a security control, not
        bookkeeping: without it a gateway can authorize, route, or rate-limit on
        the header value while the server executes the body value.
      </p>
      <p>
        The agreement check also runs on <strong>legacy</strong> requests, which
        is stricter than the specification requires. Those revisions predate the
        headers, so a legacy request may omit them — but one that sends them is
        held to them. Without that, declaring an old protocol version would be
        enough to keep a gateway-satisfying <code>Mcp-Method</code>
        {", "}
        <code>Mcp-Name</code>
        {", "}or <code>Mcp-Param-*</code> header while the body called something
        else entirely.
      </p>
      <CodeBlock code={HEADER_MISMATCH} language="json" />
      <p>
        Values that cannot be represented as plain ASCII arrive in the Base64
        sentinel form <code>=?base64?&lt;payload&gt;?=</code>
        {"; "}DaloyJS decodes them before comparing, and treats an undecodable
        payload as a mismatch. <code>Mcp-Session-Id</code> and{" "}
        <code>Last-Event-ID</code> from older clients are ignored: no session is
        ever minted or echoed, and streams are not resumable.
      </p>

      <h2 id="mirrored-parameters">
        Mirrored tool parameters (<code>x-mcp-header</code>)
      </h2>
      <p>
        A tool may ask clients to mirror a primitive parameter into an{" "}
        <code>Mcp-Param-&#123;Name&#125;</code> header so infrastructure can
        route on it. Annotate the property in <code>inputSchema</code>
        {": "}
      </p>
      <CodeBlock code={MIRRORED} />
      <p>
        DaloyJS validates the contract in both directions on every{" "}
        <code>tools/call</code>
        {": "}a value present in the arguments requires the matching header, an
        absent value forbids it, and integers compare numerically. Any
        disagreement is a <code>-32020</code>
        {". "}Invalid annotations (empty, non-token, duplicated
        case-insensitively, or on a non-primitive property) throw at{" "}
        <code>createMcpHandler()</code> construction, so a misconfigured tool
        fails at boot rather than in front of a model.
      </p>
      <p>
        <strong>Do not mirror secrets.</strong> Header values are visible to
        every intermediary on the path, so passwords, API keys, tokens, and PII
        must never carry an <code>x-mcp-header</code> annotation.
      </p>

      <h2 id="caching-hints">Caching hints</h2>
      <p>
        Modern list results and <code>resources/read</code> carry{" "}
        <code>ttlMs</code> (a freshness hint) and <code>cacheScope</code> (
        <code>&quot;public&quot;</code> or <code>&quot;private&quot;</code>), so
        clients can cache instead of polling. DaloyJS defaults to{" "}
        <code>&#123; ttlMs: 0, scope: &quot;private&quot; &#125;</code>
        {". "}That is deliberate: MCP explicitly allows a tool list to vary with
        the credential on the request, and a <code>&quot;public&quot;</code>{" "}
        scope would let a shared proxy hand one caller&apos;s tools to another.
        Widen it once you know your results are identical for every caller.
      </p>
      <CodeBlock code={CACHE} />

      <h2 id="multi-round-trip-requests">Multi round-trip requests (MRTR)</h2>
      <p>
        Servers can no longer send their own JSON-RPC requests. When a tool,
        resource, or prompt needs elicitation, sampling, or the client&apos;s
        roots, it returns an interim result with{" "}
        <code>resultType: &quot;input_required&quot;</code>
        {". "}The client gathers the input and retries the{" "}
        <em>original request</em> with a new JSON-RPC id, carrying{" "}
        <code>inputResponses</code> and whatever <code>requestState</code> the
        server handed back. Nothing is stored server-side between the two calls.
      </p>
      <SequenceDiagram
        title="Multi round-trip request"
        participants={["MCP client", "DaloyJS tool", "User"]}
        steps={[
          {
            from: "MCP client",
            to: "DaloyJS tool",
            label: "tools/call (id: 1)",
            detail: "deploy_service { service: 'checkout-api' }",
            kind: "request",
          },
          {
            from: "DaloyJS tool",
            to: "MCP client",
            label: "input_required + signed requestState",
            detail: "inputRequests: { confirm: elicitation/create }",
            kind: "response",
          },
          {
            from: "MCP client",
            to: "User",
            label: "Prompts for confirmation",
            detail: "the client owns the UI, not the server",
            kind: "note",
          },
          {
            from: "MCP client",
            to: "DaloyJS tool",
            label: "tools/call (id: 2)",
            detail: "same params + inputResponses + requestState",
            kind: "request",
          },
          {
            from: "DaloyJS tool",
            to: "DaloyJS tool",
            label: "Verify requestState before acting",
            detail: "HMAC/AEAD, principal binding, short expiry",
            kind: "note",
          },
          {
            from: "DaloyJS tool",
            to: "MCP client",
            label: "complete",
            detail: "the final tool result",
            kind: "response",
          },
        ]}
        caption="No shared storage and no sticky load balancing: the retry carries everything the server needs, which is why requestState has to be integrity-protected."
      />
      <CodeBlock code={MRTR} />
      <CodeBlock code={MRTR_WIRE} language="json" />
      <p>
        DaloyJS enforces the protocol rules around this so your handler cannot
        get them wrong: an <code>input_required</code> result must carry{" "}
        <code>inputRequests</code> or <code>requestState</code>
        {", "}it is only valid on <code>tools/call</code>
        {", "}
        <code>resources/read</code>
        {", "}and <code>prompts/get</code> in the modern era, and a request the
        client did not declare support for is refused with <code>-32021</code> (
        <code>MissingRequiredClientCapability</code>) rather than sent to a
        client that cannot answer it.
      </p>
      <blockquote>
        <strong>
          Treat <code>requestState</code> as attacker-controlled.
        </strong>{" "}
        It round-trips through the client. If it influences authorization,
        resource access, or business logic, integrity-protect it (HMAC or AEAD),
        bind it to the authenticated principal <em>and</em> the originating
        request, give it a short expiry, and reject anything that fails
        verification. Incoming values are capped at{" "}
        <code>MCP_MAX_REQUEST_STATE_LENGTH</code> (8 KiB) so a hostile client
        cannot force large state parsing.
      </blockquote>

      <h2 id="state-without-sessions">State without sessions</h2>
      <p>
        With protocol sessions gone, a server that needs state across calls
        returns an explicit handle from one tool and accepts it as an ordinary
        argument on the next. The model carries the handle forward; the protocol
        does not.
      </p>
      <CodeBlock code={STATE_HANDLE} />
      <p>
        A handle is a name, not a capability. Re-authorize it on every call, keep
        it opaque, give it a bounded lifetime, state that lifetime in the
        tool&apos;s description so the model can see it, and return a recoverable{" "}
        <code>McpToolError</code> when it expires.
      </p>

      <h2 id="origin-validation-dns-rebinding">
        Origin validation (DNS rebinding)
      </h2>
      <p>
        The MCP Streamable HTTP spec requires servers to validate the{" "}
        <code>Origin</code> header so a malicious web page cannot use DNS
        rebinding to drive a local MCP server. <code>createMcpHandler()</code>{" "}
        does this on every request. Non-browser clients that send no{" "}
        <code>Origin</code> header work unchanged; browser clients must be
        loopback or explicitly allowlisted, and everything else receives{" "}
        <code>403</code>
        {". "}A same-origin <code>Origin</code> is deliberately{" "}
        <strong>not</strong> treated as sufficient on its own: under DNS
        rebinding the attacker&apos;s hostname resolves to your host, so{" "}
        <code>Origin.host</code> can equal the request <code>Host</code>. The{" "}
        <code>allowedOrigins</code> allowlist is the real gate for public
        browser clients.
      </p>
      <CodeBlock code={ORIGINS} />

      <h2 id="input-schema-enforcement">Input schema enforcement</h2>
      <blockquote>
        <strong>Behavior change.</strong> A tool&apos;s <code>inputSchema</code>{" "}
        used to be documentation only. It is now enforced server-side:{" "}
        <code>tools/call</code> arguments that violate the schema are rejected
        before your handler runs. Handlers that previously received malformed
        arguments (and coped) will now see those calls fail with{" "}
        <code>-32602</code> instead.
      </blockquote>
      <p>
        On every <code>tools/call</code>
        {", "}DaloyJS validates <code>params.arguments</code> against the
        tool&apos;s <code>inputSchema</code> <strong>before</strong> the handler
        runs. A violation returns a JSON-RPC <code>-32602</code> (Invalid
        params) error and the handler never executes, so a tool no longer has to
        defend against the shapes its schema already forbids.
      </p>
      <CodeBlock code={INPUT_INVALID} language="json" />
      <p>
        The enforced subset is deliberately small and dependency-free, but
        covers the security-relevant keywords: <code>type</code> (including{" "}
        <code>integer</code>), <code>required</code>
        {", "}
        <code>properties</code>
        {", "}
        <code>additionalProperties</code> (including{" "}
        <code>additionalProperties: false</code>), <code>enum</code>
        {", "}
        <code>const</code>
        {", "}and basic bounds (<code>minLength</code> / <code>maxLength</code>
        {", "}
        <code>minimum</code> / <code>maximum</code>
        {", "}
        <code>minItems</code> / <code>maxItems</code>). It recurses into nested{" "}
        <code>properties</code>
        {", "}
        <code>items</code>
        {", "}and object-form <code>additionalProperties</code>.
      </p>
      <p>
        These keywords are advertised to clients but{" "}
        <strong>not enforced</strong>
        {", "}so your handler must still check them: <code>pattern</code>
        {", "}
        <code>format</code>
        {", "}
        <code>$ref</code>
        {", "}and <code>anyOf</code> / <code>oneOf</code> / <code>allOf</code>
        {". "}
        <code>pattern</code> is skipped on purpose so a developer-authored regex
        can never become a ReDoS sink against attacker-controlled input.
      </p>
      <p>
        The same validator is exported as{" "}
        <code>validateMcpInput(schema, value)</code>
        {", "}which returns an array of error strings (empty when valid). Use it
        to pre-validate arguments in tests or in your own tooling:
      </p>
      <CodeBlock code={VALIDATE_HELPER} />

      <h2 id="resource-templates">Resource templates</h2>
      <p>
        Concrete resources cover fixed documents; resource templates cover
        families of them. A template advertises an RFC 6570 style URI pattern
        through <code>resources/templates/list</code>
        {", "}and <code>resources/read</code> matches non-listed URIs against
        your templates, passing the extracted variables to your{" "}
        <code>read</code> handler. Only simple <code>{"{name}"}</code> variables
        are supported, and each matches a single URI segment; operator
        expressions like <code>{"{+path}"}</code> are rejected at construction
        so the server never advertises a pattern it cannot serve.
      </p>
      <CodeBlock code={TEMPLATES} />

      <h2 id="what-stays-out-of-core">What stays out of core</h2>
      <p>
        DaloyJS does not bundle the official MCP SDK, stdio process management,
        OAuth server metadata, or the{" "}
        <code>subscriptions/listen</code> notification stream (so no{" "}
        <code>listChanged</code> capability). It also does not implement the{" "}
        <code>io.modelcontextprotocol/tasks</code> or MCP Apps extensions — you
        can advertise an extension you implement yourself through the{" "}
        <code>extensions</code> option, but core ships none. Those pieces either
        add dependency weight or need a product-specific security model.
      </p>
      <p>
        Features the specification deprecated in <code>2026-07-28</code> are
        deliberately absent rather than reimplemented: Roots, Sampling, and
        Logging (pass paths as tool parameters, call your LLM provider directly,
        and log to stderr or OpenTelemetry instead), the legacy HTTP+SSE
        transport, SSE resumability, and Dynamic Client Registration. New
        servers should not adopt them.
      </p>

      <h2 id="error-handling">Error handling</h2>
      <p>
        Throw <code>McpToolError</code> when the model can fix the call, for
        example missing arguments or a domain object that does not exist. The
        client receives an MCP tool result with <code>isError: true</code>
        {". "}
        Unexpected errors become JSON-RPC internal errors and are redacted in
        production.
      </p>
      <CodeBlock code={ERROR_HANDLING} />

      <h2 id="the-bodyschemamissing-warning-and-mcp">
        The <code>bodySchemaMissing</code> warning and MCP
      </h2>
      <p>
        DaloyJS warns in development when a route declares a <code>2xx</code>{" "}
        response without a body schema, because OWASP API3 response-field
        stripping cannot run there (see the{" "}
        <a href="/docs/security/owasp-api-top-10#api3">API3 mapping</a>). MCP
        responses are opaque JSON-RPC envelopes produced by{" "}
        <code>createMcpHandler()</code>
        {", "}so the routes from <code>mcpRoutes()</code> ship with an envelope
        schema attached: they do not trip the warning, and the JSON-RPC envelope
        shows up in your generated OpenAPI document. Framework-mounted routes
        such as <code>/openapi.json</code> and <code>/docs</code> acknowledge
        themselves, so the warning only ever names routes you wrote.
      </p>
      <p>
        If you mount the MCP handler on a hand-rolled route instead (for example
        to add extra <code>beforeHandle</code> hooks), declare that the opaque
        body is intentional with{" "}
        <code>acknowledgeNoResponseBodySchema: true</code>
        {": "}
      </p>
      <CodeBlock code={ACKNOWLEDGE} />

      <h2 id="security-checklist">Security checklist</h2>
      <ul>
        <li>
          Put auth in DaloyJS middleware before the MCP route. Bearer tokens,
          mTLS, IP restrictions, and per-client rate limits all work normally.
          In production a <code>secureDefaults</code> App{" "}
          <a href="/docs/security/boot-guards#6-unauthenticated-mcp-endpoint">
            refuses to boot
          </a>{" "}
          if the <code>mcpRoutes()</code> <code>POST</code> endpoint has no auth
          hook. For a genuinely public server, opt out explicitly with{" "}
          <code>
            mcpRoutes(path, handler, {"{"} public: true {"}"})
          </code>
          {"."}
        </li>
        <li>
          Leave the built-in <code>Origin</code> validation alone and prefer
          adding trusted web apps to <code>allowedOrigins</code> over any
          wildcard CORS layer in front of the endpoint.
        </li>
        <li>
          The advertised <code>inputSchema</code> is now{" "}
          <a href="#input-schema-enforcement">enforced server-side</a> for its
          supported subset, but it is still not a substitute for full
          validation: check anything expressed only through <code>pattern</code>
          {", "}
          <code>format</code>
          {", "}or <code>anyOf</code>/<code>oneOf</code>/<code>allOf</code>{" "}
          inside the handler.
        </li>
        <li>
          Sign and bind <code>requestState</code> before it can influence
          anything. It passes through the client, so an unsigned blob is a
          request-forgery primitive. Include the authenticated principal, an
          identifier for the originating request, and a short expiry, and reject
          state that fails verification. See{" "}
          <a href="#multi-round-trip-requests">multi round-trip requests</a>
          {"."}
        </li>
        <li>
          Pin <code>protocolVersions</code> to{" "}
          <code>[&quot;2026-07-28&quot;]</code> once your clients have migrated.
          Header/body agreement is already enforced in both eras, so this is
          defense in depth rather than a fix — it just means nothing reaches a
          tool without the full modern contract (required headers, per-request{" "}
          <code>_meta</code>
          {", "}declared capabilities).
        </li>
        <li>
          Never mark a secret with <code>x-mcp-header</code>
          {". "}Mirrored parameter values are visible to every proxy on the
          path.
        </li>
        <li>
          Re-authorize state handles on every call. Without protocol sessions,
          a handle passed as a tool argument is just a string the model
          carries — treat it as a name, not a capability.
        </li>
        <li>
          Leave <code>cacheScope</code> at <code>&quot;private&quot;</code>{" "}
          unless every caller genuinely sees the same tools, resources, and
          prompts.
        </li>
        <li>
          Keep tool descriptions precise. A vague tool is easier for a model to
          misuse and harder for a human to approve.
        </li>
        <li>
          Route outbound calls through <code>fetchGuard()</code> when a tool
          fetches URLs influenced by users, prompts, or external content.
        </li>
      </ul>
    </>
  );
}
