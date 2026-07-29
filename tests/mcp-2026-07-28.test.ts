import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MCP_ERROR_CODES,
  MCP_MAX_REQUEST_STATE_LENGTH,
  MCP_META_KEYS,
  MCP_PROTOCOL_VERSION,
  McpToolError,
  createMcpHandler,
  isModernProtocolVersion,
  type McpHandler,
  type McpJsonSchema,
} from "../src/index.js";

const ENDPOINT = "http://test.local/mcp";
const VERSION = "2026-07-28";

interface RpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

/** Build the `_meta` block every modern request must carry. */
function meta(extra: Record<string, unknown> = {}) {
  return {
    [MCP_META_KEYS.protocolVersion]: VERSION,
    [MCP_META_KEYS.clientInfo]: { name: "test-client", version: "1.0.0" },
    [MCP_META_KEYS.clientCapabilities]: {},
    ...extra,
  };
}

/**
 * Send a spec-compliant modern request: `_meta` in the body, mirrored into the
 * standard headers. Both may be overridden to exercise the validation paths.
 */
async function modern(
  handler: McpHandler,
  body: {
    id?: string | number;
    method: string;
    params?: Record<string, unknown>;
  },
  headerOverrides: Record<string, string | null> = {}
): Promise<{ res: Response; json: RpcResponse }> {
  const params = body.params ?? {};
  if (params._meta === undefined) params._meta = meta();
  const name = body.method === "resources/read" ? params.uri : params.name;

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "mcp-protocol-version": VERSION,
    "mcp-method": body.method,
  };
  if (typeof name === "string") headers["mcp-name"] = name;
  for (const [key, value] of Object.entries(headerOverrides)) {
    if (value === null) delete headers[key];
    else headers[key] = value;
  }

  const res = await handler(
    new Request(ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: body.id ?? 1, method: body.method, params }),
    })
  );
  return { res, json: (await res.json()) as RpcResponse };
}

function createTestHandler(): McpHandler {
  return createMcpHandler({
    serverInfo: { name: "inventory-mcp", version: "1.0.0" },
    instructions: "Use this server for inventory lookups.",
    tools: [
      {
        name: "inventory_lookup",
        description: "Look up available units by SKU.",
        inputSchema: {
          type: "object",
          properties: { sku: { type: "string" } },
          required: ["sku"],
          additionalProperties: false,
        },
        handler: (args) => `${String(args.sku)}: 42 units`,
      },
    ],
    resources: [
      {
        uri: "daloy://schemas/inventory",
        name: "inventory_schema",
        mimeType: "application/json",
        read: () => ({ uri: "daloy://schemas/inventory", text: "{}" }),
      },
    ],
    prompts: [
      {
        name: "stock_report",
        arguments: [{ name: "sku", required: true }],
        get: (args) => ({
          messages: [
            { role: "user", content: { type: "text", text: `Report for ${String(args.sku)}` } },
          ],
        }),
      },
    ],
  });
}

test("default protocol version is the stateless 2026-07-28 revision", () => {
  assert.equal(MCP_PROTOCOL_VERSION, "2026-07-28");
  assert.equal(isModernProtocolVersion("2026-07-28"), true);
  assert.equal(isModernProtocolVersion("2027-01-01"), true);
  assert.equal(isModernProtocolVersion("2025-11-25"), false);
  assert.equal(isModernProtocolVersion("2024-11-05"), false);
});

test("server/discover advertises versions, capabilities, identity, and cache hints", async () => {
  const handler = createTestHandler();
  const { res, json } = await modern(handler, { method: "server/discover" });

  assert.equal(res.status, 200);
  assert.equal(json.result.resultType, "complete");
  assert.ok(json.result.supportedVersions.includes("2026-07-28"));
  assert.ok(json.result.supportedVersions.includes("2025-11-25"));
  assert.deepEqual(json.result.capabilities, { tools: {}, resources: {}, prompts: {} });
  assert.equal(json.result.instructions, "Use this server for inventory lookups.");
  assert.deepEqual(json.result._meta[MCP_META_KEYS.serverInfo], {
    name: "inventory-mcp",
    version: "1.0.0",
  });
  // Secure defaults: no caching, never shared across callers.
  assert.equal(json.result.ttlMs, 0);
  assert.equal(json.result.cacheScope, "private");
});

test("configured cache hints and extensions surface on modern results", async () => {
  const handler = createMcpHandler({
    serverInfo: { name: "cached", version: "1.0.0" },
    cache: { ttlMs: 300_000, scope: "public" },
    extensions: { "io.modelcontextprotocol/tasks": {} },
    tools: [
      {
        name: "noop",
        description: "Does nothing.",
        inputSchema: { type: "object", additionalProperties: false },
        handler: () => "ok",
      },
    ],
  });

  const discover = await modern(handler, { method: "server/discover" });
  assert.deepEqual(discover.json.result.capabilities.extensions, {
    "io.modelcontextprotocol/tasks": {},
  });

  const list = await modern(handler, { method: "tools/list" });
  assert.equal(list.json.result.ttlMs, 300_000);
  assert.equal(list.json.result.cacheScope, "public");
});

test("rejects extension identifiers without a reverse-DNS prefix", () => {
  assert.throws(
    () =>
      createMcpHandler({
        serverInfo: { name: "bad", version: "1.0.0" },
        extensions: { tasks: {} },
      }),
    /reverse-DNS prefix/
  );
});

test("rejects invalid cache hints", () => {
  assert.throws(
    () =>
      createMcpHandler({
        serverInfo: { name: "bad", version: "1.0.0" },
        cache: { ttlMs: -1 },
      }),
    /cache.ttlMs/
  );
  assert.throws(
    () =>
      createMcpHandler({
        serverInfo: { name: "bad", version: "1.0.0" },
        cache: { scope: "shared" as unknown as "public" },
      }),
    /cache.scope/
  );
});

test("modern results carry resultType and server identity on every method", async () => {
  const handler = createTestHandler();

  const tools = await modern(handler, { method: "tools/list" });
  assert.equal(tools.json.result.resultType, "complete");
  assert.equal(tools.json.result._meta[MCP_META_KEYS.serverInfo].name, "inventory-mcp");
  assert.equal(tools.json.result.ttlMs, 0);

  const call = await modern(handler, {
    method: "tools/call",
    params: { name: "inventory_lookup", arguments: { sku: "ABC-1" }, _meta: meta() },
  });
  assert.equal(call.json.result.resultType, "complete");
  assert.equal(call.json.result.content[0].text, "ABC-1: 42 units");

  const read = await modern(handler, {
    method: "resources/read",
    params: { uri: "daloy://schemas/inventory", _meta: meta() },
  });
  assert.equal(read.json.result.resultType, "complete");
  assert.equal(read.json.result.cacheScope, "private");

  const prompt = await modern(handler, {
    method: "prompts/get",
    params: { name: "stock_report", arguments: { sku: "ABC-1" }, _meta: meta() },
  });
  assert.equal(prompt.json.result.resultType, "complete");
  assert.equal(prompt.json.result.messages[0].content.text, "Report for ABC-1");
});

test("rejects a modern request missing required _meta fields", async () => {
  const handler = createTestHandler();

  const noVersion = await modern(handler, {
    method: "tools/list",
    params: { _meta: { [MCP_META_KEYS.clientCapabilities]: {} } },
  });
  assert.equal(noVersion.res.status, 400);
  assert.equal(noVersion.json.error?.code, -32602);
  assert.match(noVersion.json.error!.message, /protocolVersion/);

  const noCapabilities = await modern(handler, {
    method: "tools/list",
    params: { _meta: { [MCP_META_KEYS.protocolVersion]: VERSION } },
  });
  assert.equal(noCapabilities.res.status, 400);
  assert.equal(noCapabilities.json.error?.code, -32602);
  assert.match(noCapabilities.json.error!.message, /clientCapabilities/);
});

test("rejects a modern request whose headers disagree with the body", async () => {
  const handler = createTestHandler();

  const noMethodHeader = await modern(handler, { method: "tools/list" }, { "mcp-method": null });
  assert.equal(noMethodHeader.res.status, 400);
  assert.equal(noMethodHeader.json.error?.code, MCP_ERROR_CODES.headerMismatch);

  const wrongMethod = await modern(
    handler,
    { method: "tools/list" },
    { "mcp-method": "prompts/list" }
  );
  assert.equal(wrongMethod.res.status, 400);
  assert.equal(wrongMethod.json.error?.code, -32020);
  assert.match(wrongMethod.json.error!.message, /Mcp-Method/);

  const wrongName = await modern(
    handler,
    {
      method: "tools/call",
      params: { name: "inventory_lookup", arguments: { sku: "ABC-1" }, _meta: meta() },
    },
    { "mcp-name": "some_other_tool" }
  );
  assert.equal(wrongName.res.status, 400);
  assert.equal(wrongName.json.error?.code, -32020);

  const missingName = await modern(
    handler,
    {
      method: "resources/read",
      params: { uri: "daloy://schemas/inventory", _meta: meta() },
    },
    { "mcp-name": null }
  );
  assert.equal(missingName.res.status, 400);
  assert.equal(missingName.json.error?.code, -32020);
});

test("rejects a modern request whose protocol-version header disagrees with _meta", async () => {
  const handler = createTestHandler();
  const { res, json } = await modern(
    handler,
    {
      method: "tools/list",
      params: { _meta: meta({ [MCP_META_KEYS.protocolVersion]: "2025-11-25" }) },
    },
    { "mcp-protocol-version": VERSION }
  );
  assert.equal(res.status, 400);
  assert.equal(json.error?.code, -32020);
  assert.match(json.error!.message, /MCP-Protocol-Version/);
});

test("reports an unsupported _meta protocol version with the supported list", async () => {
  const handler = createMcpHandler({
    serverInfo: { name: "modern-only", version: "1.0.0" },
    protocolVersions: ["2026-07-28"],
  });
  const { res, json } = await modern(
    handler,
    {
      method: "tools/list",
      params: { _meta: meta({ [MCP_META_KEYS.protocolVersion]: "2027-12-31" }) },
    },
    { "mcp-protocol-version": "2027-12-31" }
  );
  assert.equal(res.status, 400);
  assert.equal(json.error?.code, MCP_ERROR_CODES.unsupportedProtocolVersion);
  assert.deepEqual(json.error?.data.supported, ["2026-07-28"]);
  assert.equal(json.error?.data.requested, "2027-12-31");
});

test("decodes the Base64 sentinel form of Mcp-Name", async () => {
  const handler = createMcpHandler({
    serverInfo: { name: "unicode", version: "1.0.0" },
    resources: [
      {
        uri: "daloy://records/世界",
        name: "unicode_record",
        read: () => ({ uri: "daloy://records/世界", text: "ok" }),
      },
    ],
  });

  const encoded = `=?base64?${Buffer.from("daloy://records/世界", "utf8").toString("base64")}?=`;
  const ok = await modern(
    handler,
    { method: "resources/read", params: { uri: "daloy://records/世界", _meta: meta() } },
    { "mcp-name": encoded }
  );
  assert.equal(ok.res.status, 200);
  assert.equal(ok.json.result.contents[0].text, "ok");

  const broken = await modern(
    handler,
    { method: "resources/read", params: { uri: "daloy://records/世界", _meta: meta() } },
    { "mcp-name": "=?base64?!!!not-base64!!!?=" }
  );
  assert.equal(broken.res.status, 400);
  assert.equal(broken.json.error?.code, -32020);
});

test("validates x-mcp-header mirrored tool parameters against the body", async () => {
  const handler = createMcpHandler({
    serverInfo: { name: "mirrored", version: "1.0.0" },
    tools: [
      {
        name: "execute_sql",
        description: "Run SQL in a region.",
        inputSchema: {
          type: "object",
          properties: {
            region: { type: "string", "x-mcp-header": "Region" },
            attempt: { type: "integer", "x-mcp-header": "Attempt" },
            query: { type: "string" },
          },
          required: ["region", "query"],
          additionalProperties: false,
        },
        handler: (args) => `ran in ${String(args.region)}`,
      },
    ],
  });

  const base = {
    method: "tools/call",
    params: {
      name: "execute_sql",
      arguments: { region: "us-west1", query: "SELECT 1" },
      _meta: meta(),
    },
  };

  const ok = await modern(handler, structuredClone(base), { "mcp-param-region": "us-west1" });
  assert.equal(ok.res.status, 200);
  assert.equal(ok.json.result.content[0].text, "ran in us-west1");

  const missing = await modern(handler, structuredClone(base));
  assert.equal(missing.res.status, 400);
  assert.equal(missing.json.error?.code, -32020);
  assert.match(missing.json.error!.message, /Mcp-Param-Region/);

  const mismatched = await modern(handler, structuredClone(base), {
    "mcp-param-region": "eu-north1",
  });
  assert.equal(mismatched.res.status, 400);
  assert.equal(mismatched.json.error?.code, -32020);

  // A header sent for an argument that is absent is also a mismatch.
  const spurious = await modern(handler, structuredClone(base), {
    "mcp-param-region": "us-west1",
    "mcp-param-attempt": "3",
  });
  assert.equal(spurious.res.status, 400);
  assert.equal(spurious.json.error?.code, -32020);

  // Integers compare numerically, not as strings.
  const withInteger = await modern(
    handler,
    {
      method: "tools/call",
      params: {
        name: "execute_sql",
        arguments: { region: "us-west1", attempt: 3, query: "SELECT 1" },
        _meta: meta(),
      },
    },
    { "mcp-param-region": "us-west1", "mcp-param-attempt": "3.0" }
  );
  assert.equal(withInteger.res.status, 200);
});

test("rejects invalid x-mcp-header annotations at construction", () => {
  const tool = (schema: McpJsonSchema) => ({
    serverInfo: { name: "bad", version: "1.0.0" },
    tools: [
      {
        name: "t",
        description: "d",
        inputSchema: schema,
        handler: () => "ok",
      },
    ],
  });

  assert.throws(
    () => createMcpHandler(tool({ type: "object", properties: { a: { "x-mcp-header": "" } } })),
    /empty or non-string/
  );
  assert.throws(
    () =>
      createMcpHandler(
        tool({
          type: "object",
          properties: { a: { type: "string", "x-mcp-header": "bad header" } },
        })
      ),
    /field-name token/
  );
  assert.throws(
    () =>
      createMcpHandler(
        tool({
          type: "object",
          properties: {
            a: { type: "string", "x-mcp-header": "Dup" },
            b: { type: "string", "x-mcp-header": "dup" },
          },
        })
      ),
    /case-insensitively unique/
  );
  assert.throws(
    () =>
      createMcpHandler(
        tool({ type: "object", properties: { a: { type: "number", "x-mcp-header": "N" } } })
      ),
    /string, integer, or boolean/
  );
});

test("multi round-trip: a tool can ask for input and complete on retry", async () => {
  const handler = createMcpHandler({
    serverInfo: { name: "mrtr", version: "1.0.0" },
    tools: [
      {
        name: "deploy",
        description: "Deploy after confirmation.",
        inputSchema: {
          type: "object",
          properties: { service: { type: "string" } },
          required: ["service"],
          additionalProperties: false,
        },
        handler: (args, ctx) => {
          const answer = ctx.inputResponses?.confirm as { action?: string } | undefined;
          if (!answer) {
            return {
              resultType: "input_required" as const,
              inputRequests: {
                confirm: {
                  method: "elicitation/create" as const,
                  params: { mode: "form", message: "Confirm deploy?" },
                },
              },
              requestState: "signed-state",
            };
          }
          assert.equal(ctx.requestState, "signed-state");
          return `deployed ${String(args.service)} (${answer.action})`;
        },
      },
    ],
  });

  const capable = meta({ [MCP_META_KEYS.clientCapabilities]: { elicitation: {} } });

  const first = await modern(handler, {
    method: "tools/call",
    params: { name: "deploy", arguments: { service: "api" }, _meta: capable },
  });
  assert.equal(first.res.status, 200);
  assert.equal(first.json.result.resultType, "input_required");
  assert.equal(first.json.result.inputRequests.confirm.method, "elicitation/create");
  assert.equal(first.json.result.requestState, "signed-state");

  const retry = await modern(handler, {
    id: 2,
    method: "tools/call",
    params: {
      name: "deploy",
      arguments: { service: "api" },
      inputResponses: { confirm: { action: "accept" } },
      requestState: "signed-state",
      _meta: capable,
    },
  });
  assert.equal(retry.json.result.resultType, "complete");
  assert.equal(retry.json.result.content[0].text, "deployed api (accept)");
});

test("refuses to request input the client did not declare support for", async () => {
  const handler = createMcpHandler({
    serverInfo: { name: "mrtr", version: "1.0.0" },
    tools: [
      {
        name: "ask",
        description: "Always elicits.",
        inputSchema: { type: "object", additionalProperties: false },
        handler: () => ({
          resultType: "input_required" as const,
          inputRequests: { q: { method: "elicitation/create" as const } },
        }),
      },
    ],
  });

  const { res, json } = await modern(handler, {
    method: "tools/call",
    params: { name: "ask", arguments: {}, _meta: meta() },
  });
  assert.equal(res.status, 400);
  assert.equal(json.error?.code, MCP_ERROR_CODES.missingRequiredClientCapability);
  assert.deepEqual(json.error?.data.requiredCapabilities, ["elicitation"]);
});

test("rejects an input_required result that carries neither requests nor state", async () => {
  const handler = createMcpHandler({
    serverInfo: { name: "mrtr", version: "1.0.0" },
    tools: [
      {
        name: "broken",
        description: "Returns an empty interim result.",
        inputSchema: { type: "object", additionalProperties: false },
        handler: () => ({ resultType: "input_required" as const }),
      },
    ],
  });

  const { json } = await modern(handler, {
    method: "tools/call",
    params: { name: "broken", arguments: {}, _meta: meta() },
  });
  assert.equal(json.error?.code, -32603);
  assert.match(json.error!.message, /inputRequests or requestState/);
});

test("rejects an input_required result on a legacy request", async () => {
  const handler = createMcpHandler({
    serverInfo: { name: "mrtr", version: "1.0.0" },
    tools: [
      {
        name: "ask",
        description: "Always elicits.",
        inputSchema: { type: "object", additionalProperties: false },
        handler: () => ({
          resultType: "input_required" as const,
          requestState: "state",
        }),
      },
    ],
  });

  const res = await handler(
    new Request(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "mcp-protocol-version": "2025-11-25" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "ask", arguments: {} },
      }),
    })
  );
  const json = (await res.json()) as RpcResponse;
  assert.equal(json.error?.code, -32603);
  assert.match(json.error!.message, /2026-07-28/);
});

test("bounds a client-supplied requestState", async () => {
  const handler = createTestHandler();
  const { res, json } = await modern(handler, {
    method: "tools/call",
    params: {
      name: "inventory_lookup",
      arguments: { sku: "ABC-1" },
      requestState: "x".repeat(MCP_MAX_REQUEST_STATE_LENGTH + 1),
      _meta: meta(),
    },
  });
  assert.equal(res.status, 400);
  assert.equal(json.error?.code, -32602);
  assert.match(json.error!.message, /requestState/);
});

test("removed methods answer 404 in the modern era and server/discover is legacy-only", async () => {
  const handler = createTestHandler();

  for (const method of ["initialize", "ping", "logging/setLevel", "subscriptions/listen"]) {
    const { res, json } = await modern(handler, { method });
    assert.equal(res.status, 404, method);
    assert.equal(json.error?.code, -32601, method);
  }

  const legacyDiscover = await handler(
    new Request(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "mcp-protocol-version": "2025-11-25" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover" }),
    })
  );
  assert.equal(legacyDiscover.status, 200);
  assert.equal(((await legacyDiscover.json()) as RpcResponse).error?.code, -32601);
});

test("legacy clients keep the initialize handshake untouched", async () => {
  const handler = createTestHandler();
  const res = await handler(
    new Request(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {} },
      }),
    })
  );
  const json = (await res.json()) as RpcResponse;

  assert.equal(res.status, 200);
  assert.equal(json.result.protocolVersion, "2025-11-25");
  assert.equal(json.result.serverInfo.name, "inventory-mcp");
  // No modern-only fields leak into a legacy response.
  assert.equal(json.result.resultType, undefined);

  const list = await handler(
    new Request(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "mcp-protocol-version": "2025-11-25" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    })
  );
  const listJson = (await list.json()) as RpcResponse;
  assert.equal(listJson.result.resultType, undefined);
  assert.equal(listJson.result.ttlMs, undefined);
  assert.equal(listJson.result._meta, undefined);
});

test("declaring a legacy version does not bypass header/body agreement", async () => {
  // Threat model: a gateway routes, authorizes, or rate-limits on the mirrored
  // headers without parsing the body. If a legacy request could carry a
  // gateway-satisfying header while the server executed a different body value,
  // the whole mirroring contract would be one downgrade away from useless.
  let ran: unknown = null;
  const handler = createMcpHandler({
    serverInfo: { name: "downgrade", version: "1.0.0" },
    tools: [
      {
        name: "read_only",
        description: "Harmless.",
        inputSchema: { type: "object", additionalProperties: false },
        handler: () => "safe",
      },
      {
        name: "delete_everything",
        description: "Dangerous.",
        inputSchema: {
          type: "object",
          properties: { region: { type: "string", "x-mcp-header": "Region" } },
          required: ["region"],
          additionalProperties: false,
        },
        handler: (args) => {
          ran = args;
          return "destroyed";
        },
      },
    ],
  });

  const legacy = (extra: Record<string, string>, body: object) =>
    handler(
      new Request(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-protocol-version": "2025-11-25",
          ...extra,
        },
        body: JSON.stringify(body),
      })
    );

  // Mcp-Method says tools/list, the body calls a tool.
  const methodConfusion = await legacy(
    { "mcp-method": "tools/list" },
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_only" } }
  );
  assert.equal(methodConfusion.status, 400);
  assert.equal(((await methodConfusion.json()) as RpcResponse).error?.code, -32020);

  // Mcp-Name names a harmless tool, the body invokes the dangerous one.
  const toolConfusion = await legacy(
    { "mcp-method": "tools/call", "mcp-name": "read_only" },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "delete_everything", arguments: { region: "eu" } },
    }
  );
  assert.equal(toolConfusion.status, 400);
  assert.equal(((await toolConfusion.json()) as RpcResponse).error?.code, -32020);
  assert.equal(ran, null);

  // Mcp-Param-Region says sandbox, the arguments say production.
  const paramConfusion = await legacy(
    {
      "mcp-method": "tools/call",
      "mcp-name": "delete_everything",
      "mcp-param-region": "sandbox",
    },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "delete_everything", arguments: { region: "production" } },
    }
  );
  assert.equal(paramConfusion.status, 400);
  assert.equal(((await paramConfusion.json()) as RpcResponse).error?.code, -32020);
  assert.equal(ran, null);

  // A genuine legacy client sends none of these headers and is unaffected.
  const genuine = await legacy(
    {},
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "delete_everything", arguments: { region: "production" } },
    }
  );
  assert.equal(genuine.status, 200);
  assert.equal(((await genuine.json()) as RpcResponse).result.content[0].text, "destroyed");
  assert.deepEqual(ran, { region: "production" });
});

test("pinning protocolVersions refuses a downgrade outright", async () => {
  const handler = createMcpHandler({
    serverInfo: { name: "modern-only", version: "1.0.0" },
    protocolVersions: ["2026-07-28"],
  });
  const res = await handler(
    new Request(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "mcp-protocol-version": "2025-11-25" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
  );
  const json = (await res.json()) as RpcResponse;
  assert.equal(res.status, 400);
  assert.equal(json.error?.code, MCP_ERROR_CODES.unsupportedProtocolVersion);
  assert.deepEqual(json.error?.data.supported, ["2026-07-28"]);
});

test("session and resumability headers from older clients are ignored, never echoed", async () => {
  const handler = createTestHandler();
  const { res, json } = await modern(
    handler,
    { method: "tools/list" },
    { "mcp-session-id": "abc123", "last-event-id": "42" }
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("mcp-session-id"), null);
  assert.equal(json.result.resultType, "complete");
});

test("modern context exposes client identity, capabilities, and log level", async () => {
  let seen: Record<string, unknown> = {};
  const handler = createMcpHandler({
    serverInfo: { name: "ctx", version: "1.0.0" },
    tools: [
      {
        name: "peek",
        description: "Reports its context.",
        inputSchema: { type: "object", additionalProperties: false },
        handler: (_args, ctx) => {
          seen = {
            era: ctx.era,
            protocolVersion: ctx.protocolVersion,
            clientName: ctx.clientInfo?.name,
            capabilities: ctx.clientCapabilities,
            logLevel: ctx.logLevel,
          };
          return "ok";
        },
      },
    ],
  });

  await modern(handler, {
    method: "tools/call",
    params: {
      name: "peek",
      arguments: {},
      _meta: meta({
        [MCP_META_KEYS.clientCapabilities]: { elicitation: {} },
        [MCP_META_KEYS.logLevel]: "debug",
      }),
    },
  });

  assert.deepEqual(seen, {
    era: "modern",
    protocolVersion: VERSION,
    clientName: "test-client",
    capabilities: { elicitation: {} },
    logLevel: "debug",
  });
});

test("tool errors and unknown names keep their codes in the modern era", async () => {
  const handler = createMcpHandler({
    serverInfo: { name: "errors", version: "1.0.0" },
    tools: [
      {
        name: "boom",
        description: "Always fails.",
        inputSchema: { type: "object", additionalProperties: false },
        handler: () => {
          throw new McpToolError("nope");
        },
      },
    ],
  });

  const toolError = await modern(handler, {
    method: "tools/call",
    params: { name: "boom", arguments: {}, _meta: meta() },
  });
  assert.equal(toolError.json.result.resultType, "complete");
  assert.equal(toolError.json.result.isError, true);
  assert.equal(toolError.json.result.content[0].text, "nope");

  const unknownResource = await modern(handler, {
    method: "resources/read",
    params: { uri: "daloy://missing", _meta: meta() },
  });
  // 2026-07-28 moved resource-not-found from -32002 to -32602.
  assert.equal(unknownResource.json.error?.code, -32602);
});

test("GET and DELETE are refused now that the standalone stream is gone", async () => {
  const handler = createTestHandler();

  const get = await handler(new Request(ENDPOINT, { method: "GET" }));
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST, OPTIONS");

  const del = await handler(new Request(ENDPOINT, { method: "DELETE" }));
  assert.equal(del.status, 405);
});
