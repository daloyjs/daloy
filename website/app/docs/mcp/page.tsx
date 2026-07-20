import { CodeBlock } from "../../../components/code-block";
import { FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Model Context Protocol (MCP)",
  description:
    "Build a dedicated Model Context Protocol server with DaloyJS. Expose tools, resources, and prompts over MCP Streamable HTTP while keeping @daloyjs/core dependency-free and secure by default.",
  path: "/docs/mcp",
  keywords: [
    "DaloyJS MCP",
    "Model Context Protocol",
    "MCP Streamable HTTP",
    "MCP tools",
    "MCP resources",
    "MCP prompts",
    "AI agent backend",
    "createMcpHandler",
    "validateMcpInput",
    "MCP inputSchema validation",
    "mcpRoutes public",
    "MCP auth boot guard",
  ],
  type: "article",
});

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
  // to your host, so Origin.host can equal Host — the allowlist is the gate.
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

      <h2 id="install">Install</h2>
      <CodeBlock code={INSTALL} language="bash" />

      <h2 id="create-an-mcp-server">Create an MCP server</h2>
      <p>
        Use <code>createMcpHandler()</code> for the MCP protocol layer and{" "}
        <code>mcpRoutes()</code> to mount <code>POST</code>
        {", "}<code>GET</code>
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
          <code>initialize</code>
          {", "}<code>ping</code>
          {", "}<code>tools/list</code>
          {", "}
          <code>tools/call</code>
          {", "}<code>resources/list</code>
          {", "}
          <code>resources/templates/list</code>
          {", "}<code>resources/read</code> (including template-matched URIs),{" "}
          <code>prompts/list</code>
          {", "}and <code>prompts/get</code> with required-argument
          enforcement.
        </li>
        <li>
          Protocol-version negotiation, <code>MCP-Protocol-Version</code>{" "}
          rejection for unsupported versions (headerless requests assume{" "}
          <code>2025-03-26</code> per the spec), JSON-RPC parse errors, accepted
          notifications, unknown-pagination-cursor rejection, and bounded
          request bodies parsed with the framework&apos;s{" "}
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
          {", "}<code>annotations</code> (read-only, destructive, idempotent,
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
        <code>Origin.host</code> can equal the request <code>Host</code> — the{" "}
        <code>allowedOrigins</code> allowlist is the real gate for public
        browser clients.
      </p>
      <CodeBlock code={ORIGINS} />

      <h2 id="input-schema-enforcement">Input schema enforcement</h2>
      <blockquote>
        <strong>Breaking change.</strong> A tool&apos;s <code>inputSchema</code>{" "}
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
        {", "}<code>properties</code>
        {", "}
        <code>additionalProperties</code> (including{" "}
        <code>additionalProperties: false</code>), <code>enum</code>
        {", "}
        <code>const</code>
        {", "}and basic bounds (<code>minLength</code> / <code>maxLength</code>
        {", "}<code>minimum</code> / <code>maximum</code>
        {", "}
        <code>minItems</code> / <code>maxItems</code>). It recurses into nested{" "}
        <code>properties</code>
        {", "}<code>items</code>
        {", "}and object-form <code>additionalProperties</code>.
      </p>
      <p>
        These keywords are advertised to clients but{" "}
        <strong>not enforced</strong>
        {", "}so your handler must still check them: <code>pattern</code>
        {", "}<code>format</code>
        {", "}<code>$ref</code>
        {", "}and <code>anyOf</code> / <code>oneOf</code> / <code>allOf</code>
        {". "}
        <code>pattern</code> is skipped on purpose so a developer-authored regex
        can never become a ReDoS sink against attacker-controlled input.
      </p>
      <p>
        The same validator is exported as{" "}
        <code>validateMcpInput(schema, value)</code>
        {", "}which returns an array of error strings (empty when valid). Use
        it to pre-validate arguments in tests or in your own tooling:
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
        OAuth server metadata, persistent MCP sessions, server-initiated SSE, or
        experimental tasks. Those pieces either add dependency weight or need a
        product-specific security model. Keep them in your application or a
        separate integration package until your use case needs them.
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
          {", "}<code>format</code>
          {", "}or <code>anyOf</code>/<code>oneOf</code>/<code>allOf</code>{" "}
          inside the handler.
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
