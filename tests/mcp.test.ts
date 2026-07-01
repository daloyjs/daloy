import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  McpToolError,
  createMcpHandler,
  findRoutesMissingResponseBodySchema,
  mcpRoutes,
  type McpHandler,
} from "../src/index.js";

const ENDPOINT = "http://test.local/mcp";

interface RpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: any;
  error?: { code: number; message: string; data?: unknown };
}

function createTestHandler(): McpHandler {
  return createMcpHandler({
    serverInfo: { name: "inventory-mcp", title: "Inventory MCP", version: "1.0.0" },
    instructions: "Use this server for inventory lookups.",
    tools: [
      {
        name: "inventory_lookup",
        title: "Inventory lookup",
        description: "Look up available units by SKU.",
        inputSchema: {
          type: "object",
          properties: { sku: { type: "string" } },
          required: ["sku"],
          additionalProperties: false,
        },
        handler: async (args) => {
          const sku = typeof args.sku === "string" ? args.sku : "";
          if (!sku) throw new McpToolError("`sku` is required.");
          return {
            content: [{ type: "text", text: `${sku}: 42 units` }],
            structuredContent: { sku, units: 42 },
          };
        },
      },
      {
        name: "inventory_fail",
        description: "Throw an unexpected failure.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        handler: () => {
          throw new Error("database offline");
        },
      },
    ],
    resources: [
      {
        uri: "daloy://schemas/inventory",
        name: "inventory_schema",
        title: "Inventory schema",
        description: "Shape of the inventory table.",
        mimeType: "application/json",
        read: () => ({
          uri: "daloy://schemas/inventory",
          mimeType: "application/json",
          text: '{"sku":"string","units":"number"}',
        }),
      },
    ],
    prompts: [
      {
        name: "stock_report",
        title: "Stock report",
        description: "Prepare a stock report prompt.",
        arguments: [{ name: "sku", required: true }],
        get: (args) => ({
          messages: [
            {
              role: "user",
              content: { type: "text", text: `Summarize stock for ${String(args.sku)}` },
            },
          ],
        }),
      },
    ],
    exposeInternalErrors: false,
  });
}

function post(handler: McpHandler, body: string | object, headers: Record<string, string> = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return handler(
    new Request(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: raw,
    })
  );
}

async function rpc(
  handler: McpHandler,
  body: object,
  headers?: Record<string, string>
): Promise<{ res: Response; json: RpcResponse }> {
  const res = await post(handler, body, headers);
  const json = (await res.json()) as RpcResponse;
  return { res, json };
}

test("createMcpHandler negotiates initialize and advertises configured capabilities", async () => {
  const handler = createTestHandler();
  const { res, json } = await rpc(handler, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
    },
  });

  assert.equal(res.status, 200);
  assert.equal(json.result.protocolVersion, "2025-06-18");
  assert.deepEqual(json.result.capabilities, {
    tools: {},
    resources: {},
    prompts: {},
  });
  assert.equal(json.result.serverInfo.name, "inventory-mcp");
  assert.equal(json.result.instructions, "Use this server for inventory lookups.");
});

test("createMcpHandler lists and calls tools with structured output", async () => {
  const handler = createTestHandler();
  const listed = await rpc(handler, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.deepEqual(
    listed.json.result.tools.map((tool: { name: string }) => tool.name),
    ["inventory_lookup", "inventory_fail"]
  );
  assert.equal(listed.json.result.tools[0].inputSchema.additionalProperties, false);
  assert.equal("handler" in listed.json.result.tools[0], false);

  const called = await rpc(handler, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "inventory_lookup", arguments: { sku: "ABC-123" } },
  });

  assert.equal(called.json.result.content[0].text, "ABC-123: 42 units");
  assert.deepEqual(called.json.result.structuredContent, { sku: "ABC-123", units: 42 });
});

test("createMcpHandler returns recoverable tool errors as MCP tool results", async () => {
  const handler = createTestHandler();
  const { json } = await rpc(handler, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "inventory_lookup", arguments: {} },
  });

  assert.equal(json.result.isError, true);
  assert.equal(json.result.content[0].text, "`sku` is required.");
});

test("createMcpHandler redacts unexpected tool failures by default in production mode", async () => {
  const handler = createTestHandler();
  const { json } = await rpc(handler, {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "inventory_fail", arguments: {} },
  });

  assert.equal(json.error?.code, -32603);
  assert.equal(json.error?.message, "Tool execution failed.");
  assert.equal(json.error?.data, undefined);
});

test("createMcpHandler lists and reads resources", async () => {
  const handler = createTestHandler();
  const listed = await rpc(handler, { jsonrpc: "2.0", id: 6, method: "resources/list" });
  assert.deepEqual(
    listed.json.result.resources.map((resource: { uri: string }) => resource.uri),
    ["daloy://schemas/inventory"]
  );

  const read = await rpc(handler, {
    jsonrpc: "2.0",
    id: 7,
    method: "resources/read",
    params: { uri: "daloy://schemas/inventory" },
  });
  assert.deepEqual(read.json.result.contents, [
    {
      uri: "daloy://schemas/inventory",
      mimeType: "application/json",
      text: '{"sku":"string","units":"number"}',
    },
  ]);
});

test("createMcpHandler lists and renders prompts", async () => {
  const handler = createTestHandler();
  const listed = await rpc(handler, { jsonrpc: "2.0", id: 8, method: "prompts/list" });
  assert.deepEqual(
    listed.json.result.prompts.map((prompt: { name: string }) => prompt.name),
    ["stock_report"]
  );

  const rendered = await rpc(handler, {
    jsonrpc: "2.0",
    id: 9,
    method: "prompts/get",
    params: { name: "stock_report", arguments: { sku: "ABC-123" } },
  });
  assert.equal(rendered.json.result.messages[0].content.text, "Summarize stock for ABC-123");
});

test("createMcpHandler rejects malformed protocol and oversized bodies", async () => {
  const handler = createMcpHandler({
    serverInfo: { name: "small", version: "1.0.0" },
    maxBodyBytes: 16,
  });

  const badProtocol = await rpc(
    handler,
    { jsonrpc: "2.0", id: 1, method: "ping" },
    { "mcp-protocol-version": "1900-01-01" }
  );
  assert.equal(badProtocol.res.status, 400);
  assert.equal(badProtocol.json.error?.code, -32600);

  const tooLarge = await post(handler, {
    jsonrpc: "2.0",
    id: 1,
    method: "ping",
  });
  const json = (await tooLarge.json()) as RpcResponse;
  assert.equal(tooLarge.status, 413);
  assert.equal(json.error?.message, "Request body too large.");
});

test("createMcpHandler rejects POST requests without an application/json content type", async () => {
  const handler = createTestHandler();
  const res = await handler(
    new Request(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    })
  );
  const json = (await res.json()) as RpcResponse;

  assert.equal(res.status, 415);
  assert.equal(json.error?.message, "MCP POST requests must use application/json.");
});

test("createMcpHandler acknowledges notifications and JSON-RPC responses with 202", async () => {
  const handler = createTestHandler();

  const notification = await post(handler, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  assert.equal(notification.status, 202);
  assert.equal(await notification.text(), "");

  const response = await post(handler, { jsonrpc: "2.0", id: 1, result: {} });
  assert.equal(response.status, 202);
  assert.equal(await response.text(), "");
});

test("mcpRoutes mounts POST, GET, and OPTIONS on a Daloy app", async () => {
  const app = new App({ logger: false });
  const handler = createTestHandler();
  for (const route of mcpRoutes("/mcp", handler)) {
    app.route(route);
  }

  const ping = await app.request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "ping-1", method: "ping" }),
  });
  assert.equal(ping.status, 200);
  assert.deepEqual(await ping.json(), { jsonrpc: "2.0", id: "ping-1", result: {} });

  const get = await app.request("/mcp");
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST, OPTIONS");

  const options = await app.request("/mcp", { method: "OPTIONS" });
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("allow"), "GET, POST, OPTIONS");
});

test("mcpRoutes declares a response schema for the 200 MCP envelope", () => {
  const routes = mcpRoutes("/mcp", createTestHandler());
  assert.deepEqual(findRoutesMissingResponseBodySchema(routes), []);
});

test("createMcpHandler refuses duplicate capability names at construction", () => {
  assert.throws(
    () =>
      createMcpHandler({
        serverInfo: { name: "dupes", version: "1.0.0" },
        tools: [
          {
            name: "same",
            description: "first",
            inputSchema: { type: "object" },
            handler: () => "first",
          },
          {
            name: "same",
            description: "second",
            inputSchema: { type: "object" },
            handler: () => "second",
          },
        ],
      }),
    /tool names must be unique/
  );
});

test("createMcpHandler validates serverInfo, protocol, and body-size options at construction", () => {
  assert.throws(
    () => createMcpHandler({ serverInfo: { name: "  ", version: "1.0.0" } }),
    /name is required/
  );
  assert.throws(
    () => createMcpHandler({ serverInfo: { name: "x", version: "  " } }),
    /version is required/
  );
  assert.throws(
    () => createMcpHandler({ serverInfo: { name: "x", version: "1.0.0" }, protocolVersions: [] }),
    /at least one version/
  );
  assert.throws(
    () =>
      createMcpHandler({
        serverInfo: { name: "x", version: "1.0.0" },
        protocolVersions: ["2025-06-18"],
        preferredProtocolVersion: "1999-01-01",
      }),
    /preferredProtocolVersion/
  );
  assert.throws(
    () => createMcpHandler({ serverInfo: { name: "x", version: "1.0.0" }, maxBodyBytes: 0 }),
    /maxBodyBytes/
  );
  assert.throws(
    () => createMcpHandler({ serverInfo: { name: "x", version: "1.0.0" }, maxBodyBytes: 1.5 }),
    /maxBodyBytes/
  );
});

test("createMcpHandler refuses duplicate resource URIs and prompt names at construction", () => {
  assert.throws(
    () =>
      createMcpHandler({
        serverInfo: { name: "x", version: "1.0.0" },
        resources: [
          { uri: "u", name: "a", read: () => ({ uri: "u", text: "1" }) },
          { uri: "u", name: "b", read: () => ({ uri: "u", text: "2" }) },
        ],
      }),
    /resource URIs must be unique/
  );
  assert.throws(
    () =>
      createMcpHandler({
        serverInfo: { name: "x", version: "1.0.0" },
        prompts: [
          { name: "p", get: () => ({ messages: [] }) },
          { name: "p", get: () => ({ messages: [] }) },
        ],
      }),
    /prompt names must be unique/
  );
});

test("createMcpHandler returns method-not-found and invalid-params for unknown targets", async () => {
  const handler = createTestHandler();

  const unknownMethod = await rpc(handler, { jsonrpc: "2.0", id: 1, method: "does/not/exist" });
  assert.equal(unknownMethod.json.error?.code, -32601);

  const unknownTool = await rpc(handler, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "nope" },
  });
  assert.equal(unknownTool.json.error?.code, -32602);
  assert.match(unknownTool.json.error?.message ?? "", /Unknown tool/);

  const unknownResource = await rpc(handler, {
    jsonrpc: "2.0",
    id: 3,
    method: "resources/read",
    params: { uri: "missing://x" },
  });
  assert.equal(unknownResource.json.error?.code, -32602);

  const unknownPrompt = await rpc(handler, {
    jsonrpc: "2.0",
    id: 4,
    method: "prompts/get",
    params: { name: "missing" },
  });
  assert.equal(unknownPrompt.json.error?.code, -32602);
});

test("createMcpHandler maps recoverable resource/prompt errors and redacts unexpected ones", async () => {
  const handler = createMcpHandler({
    serverInfo: { name: "err", version: "1.0.0" },
    resources: [
      {
        uri: "err://recoverable",
        name: "r1",
        read: () => {
          throw new McpToolError("bad resource argument");
        },
      },
      {
        uri: "err://boom",
        name: "r2",
        read: () => {
          throw new Error("db offline");
        },
      },
    ],
    prompts: [
      {
        name: "recoverable",
        get: () => {
          throw new McpToolError("bad prompt argument");
        },
      },
      {
        name: "boom",
        get: () => {
          throw new Error("db offline");
        },
      },
    ],
    exposeInternalErrors: false,
  });

  const recoverableResource = await rpc(handler, {
    jsonrpc: "2.0",
    id: 1,
    method: "resources/read",
    params: { uri: "err://recoverable" },
  });
  assert.equal(recoverableResource.json.error?.code, -32602);
  assert.equal(recoverableResource.json.error?.message, "bad resource argument");

  const brokenResource = await rpc(handler, {
    jsonrpc: "2.0",
    id: 2,
    method: "resources/read",
    params: { uri: "err://boom" },
  });
  assert.equal(brokenResource.json.error?.code, -32603);
  assert.equal(brokenResource.json.error?.data, undefined);

  const recoverablePrompt = await rpc(handler, {
    jsonrpc: "2.0",
    id: 3,
    method: "prompts/get",
    params: { name: "recoverable" },
  });
  assert.equal(recoverablePrompt.json.error?.code, -32602);

  const brokenPrompt = await rpc(handler, {
    jsonrpc: "2.0",
    id: 4,
    method: "prompts/get",
    params: { name: "boom" },
  });
  assert.equal(brokenPrompt.json.error?.code, -32603);
});

test("createMcpHandler exposes internal error detail when configured", async () => {
  const handler = createMcpHandler({
    serverInfo: { name: "dev", version: "1.0.0" },
    exposeInternalErrors: true,
    tools: [
      {
        name: "fail",
        description: "always throws",
        inputSchema: { type: "object" },
        handler: () => {
          throw new Error("kaboom");
        },
      },
    ],
  });
  const { json } = await rpc(handler, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "fail", arguments: {} },
  });
  assert.equal(json.error?.code, -32603);
  assert.deepEqual(json.error?.data, { detail: "kaboom" });
});

test("createMcpHandler rejects invalid JSON, batches, and non-JSON-RPC envelopes", async () => {
  const handler = createTestHandler();

  const badJson = await post(handler, "{ not valid json");
  assert.equal(badJson.status, 400);
  assert.equal(((await badJson.json()) as RpcResponse).error?.code, -32700);

  const batch = await post(handler, [{ jsonrpc: "2.0", id: 1, method: "ping" }]);
  assert.equal(batch.status, 400);
  assert.equal(((await batch.json()) as RpcResponse).error?.code, -32600);

  const notRpc = await post(handler, { id: 1, method: "ping" });
  assert.equal(notRpc.status, 400);
  assert.equal(((await notRpc.json()) as RpcResponse).error?.code, -32600);

  const badId = await post(handler, { jsonrpc: "2.0", id: { bad: true }, method: "ping" });
  assert.equal(badId.status, 400);

  const badMethod = await post(handler, { jsonrpc: "2.0", id: 1, method: 42 });
  assert.equal(badMethod.status, 400);

  const emptyEnvelope = await post(handler, { jsonrpc: "2.0", id: 1 });
  assert.equal(emptyEnvelope.status, 400);
  assert.equal(((await emptyEnvelope.json()) as RpcResponse).error?.code, -32600);
});

test("createMcpHandler rejects non-UTF-8 request bodies", async () => {
  const handler = createTestHandler();
  const res = await handler(
    new Request(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new Uint8Array([0xff, 0xfe, 0xfd]),
    })
  );
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as RpcResponse).error?.code, -32700);
});

test("createMcpHandler handles OPTIONS, GET discovery, and unsupported methods", async () => {
  const handler = createTestHandler();

  const options = await handler(new Request(ENDPOINT, { method: "OPTIONS" }));
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("allow"), "GET, POST, OPTIONS");

  const get = await handler(new Request(ENDPOINT, { method: "GET" }));
  assert.equal(get.status, 405);
  const discovery = (await get.json()) as { transport: string; capabilities: { tools: string[] } };
  assert.equal(discovery.transport, "streamable-http");
  assert.ok(Array.isArray(discovery.capabilities.tools));

  const del = await handler(new Request(ENDPOINT, { method: "DELETE" }));
  assert.equal(del.status, 405);
});

test("createMcpHandler applies custom response headers and echoes a header protocol version", async () => {
  const handler = createMcpHandler({
    serverInfo: { name: "x", version: "1.0.0" },
    headers: { "x-mcp": "yes" },
  });
  const ping = await rpc(handler, { jsonrpc: "2.0", id: 1, method: "ping" });
  assert.equal(ping.res.headers.get("x-mcp"), "yes");

  const negotiated = await rpc(
    createTestHandler(),
    { jsonrpc: "2.0", id: 2, method: "initialize" },
    { "mcp-protocol-version": "2025-06-18" }
  );
  assert.equal(negotiated.json.result.protocolVersion, "2025-06-18");
});

test("createMcpHandler normalizes string tool results and multi-content resources", async () => {
  const handler = createMcpHandler({
    serverInfo: { name: "x", version: "1.0.0" },
    tools: [
      {
        name: "echo",
        description: "echo back a fixed string",
        inputSchema: { type: "object" },
        handler: () => "hello world",
      },
    ],
    resources: [
      {
        uri: "multi://doc",
        name: "multi",
        read: () => [
          { uri: "multi://doc#1", text: "a" },
          { uri: "multi://doc#2", text: "b" },
        ],
      },
    ],
  });

  const echoed = await rpc(handler, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "echo", arguments: {} },
  });
  assert.equal(echoed.json.result.content[0].text, "hello world");

  const multi = await rpc(handler, {
    jsonrpc: "2.0",
    id: 2,
    method: "resources/read",
    params: { uri: "multi://doc" },
  });
  assert.equal(multi.json.result.contents.length, 2);
});
