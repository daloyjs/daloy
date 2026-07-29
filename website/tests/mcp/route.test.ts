import { test, mock } from "node:test";
import assert from "node:assert/strict";

/**
 * The MCP route transitively imports `next/cache` (via `lib/docs-content`),
 * whose `cacheLife()` throws when called outside the Next.js runtime. Stub the
 * module so the handler runs under the plain `node:test` + tsx harness. This
 * must run before the dynamic import of the route below.
 *
 * Node 26 renamed this option to `exports` (and warns that `namedExports` is
 * deprecated), but the pinned `@types/node` only types `namedExports`, so it is
 * the one key that both typechecks and works today. Switch to `exports` once
 * the types catch up.
 */
mock.module("next/cache", {
  namedExports: { cacheLife: () => {}, cacheTag: () => {} },
});

const { POST, GET, OPTIONS } = await import("../../app/mcp/route");

const ENDPOINT = "http://localhost/mcp";

/** A single tool descriptor from `tools/list`. */
interface RpcTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

/** A content block inside a `tools/call` result. */
interface RpcContent {
  type: string;
  text: string;
}

/**
 * The `result` payload of a JSON-RPC response. Fields are method-specific; this
 * is a permissive test view listing every field the assertions below read.
 */
interface RpcResult {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo: { name: string; title: string; version: string };
  instructions: string;
  tools: RpcTool[];
  content: RpcContent[];
  isError: boolean;
  resources: unknown[];
  prompts: unknown[];
  resultType: string;
  supportedVersions: string[];
  ttlMs: number;
  cacheScope: string;
  _meta: Record<string, { name: string; version: string }>;
}

/** The `error` payload of a failed JSON-RPC response. */
interface RpcError {
  code: number;
  message: string;
  data: { supported?: string[] };
}

/**
 * A decoded JSON-RPC response. A real message carries either `result` or
 * `error`; the test view types both as present and each test reads only the
 * one it expects (a missing field surfaces as a loud assertion failure).
 */
interface RpcResponse {
  jsonrpc: string;
  id: string | number | null;
  result: RpcResult;
  error: RpcError;
}

/** Build and dispatch a POST to the MCP handler with sensible default headers. */
function post(
  body: string | object,
  headers: Record<string, string> = {}
): Promise<Response> {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return POST(
    new Request(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: raw,
    })
  );
}

/** Dispatch a JSON-RPC message and decode the JSON body. */
async function rpc(
  body: object,
  headers?: Record<string, string>
): Promise<{ res: Response; json: RpcResponse }> {
  const res = await post(body, headers);
  const json = (await res.json()) as RpcResponse;
  return { res, json };
}

/** Pull the text payload out of a `tools/call` result. */
function toolText(json: RpcResponse): string {
  return json.result.content[0].text;
}

// ─────────────────────────── Happy paths ───────────────────────────

test("initialize echoes a supported protocol version and advertises tools", async () => {
  const { res, json } = await rpc({
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
  assert.deepEqual(json.result.capabilities, { tools: {} });
  assert.equal(json.result.serverInfo.name, "daloyjs-docs");
  assert.equal(typeof json.result.instructions, "string");
  assert.ok(json.result.instructions.length > 0);
});

test("initialize echoes an older known protocol version when requested", async () => {
  const { json } = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {} },
  });

  assert.equal(json.result.protocolVersion, "2024-11-05");
});

test("initialize falls back to the preferred version for an unknown request", async () => {
  const { json } = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "1.0.0", capabilities: {} },
  });

  assert.equal(json.result.protocolVersion, "2025-11-25");
});

test("ping returns an empty result", async () => {
  const { res, json } = await rpc({ jsonrpc: "2.0", id: 9, method: "ping" });
  assert.equal(res.status, 200);
  assert.deepEqual(json.result, {});
});

test("tools/list returns the three documentation tools with input schemas", async () => {
  const { json } = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const names = json.result.tools.map((t) => t.name);

  assert.deepEqual(names, ["search_docs", "get_doc", "list_docs"]);
  for (const tool of json.result.tools) {
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  const search = json.result.tools.find((t) => t.name === "search_docs");
  assert.ok(search);
  assert.deepEqual(search.inputSchema.required, ["query"]);
});

test("search_docs returns ranked results for a real query", async () => {
  const { json } = await rpc({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "search_docs",
      arguments: { query: "rate limit", limit: 3 },
    },
  });

  assert.notEqual(json.result.isError, true);
  const text = toolText(json);
  assert.match(text, /Found \d+ result/);
  assert.match(text, /https:\/\/daloyjs\.dev\/docs\//);
});

test("search_docs clamps an oversized limit to the maximum of 25", async () => {
  const { json } = await rpc({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "search_docs", arguments: { query: "api", limit: 999 } },
  });

  const text = toolText(json);
  const count = Number(text.match(/Found (\d+) result/)?.[1] ?? "0");
  assert.ok(count > 0 && count <= 25, `expected 1..25 results, got ${count}`);
});

test("get_doc returns the full text of a page by bare slug", async () => {
  const { json } = await rpc({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "get_doc", arguments: { path: "routing" } },
  });

  assert.notEqual(json.result.isError, true);
  const text = toolText(json);
  assert.match(text, /Route: \/docs\/routing/);
  assert.match(text, /URL: https:\/\/daloyjs\.dev\/docs\/routing/);
});

test("get_doc accepts a /docs-prefixed route and a full URL", async () => {
  for (const path of [
    "/docs/routing",
    "https://daloyjs.dev/docs/routing?x=1#y",
  ]) {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "get_doc", arguments: { path } },
    });
    assert.notEqual(json.result.isError, true, `path ${path} should resolve`);
    assert.match(toolText(json), /Route: \/docs\/routing/);
  }
});

test("get_doc serves the full Express migration guide without truncation", async () => {
  // The Express migration guide is the longest docs page. Agents querying the
  // MCP must receive all of it, not a truncated first slice, so this guards
  // MAX_DOC_BODY_CHARS against regressing below the longest page.
  const { json } = await rpc({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "get_doc", arguments: { path: "migrating/express" } },
  });

  assert.notEqual(json.result.isError, true);
  const text = toolText(json);
  assert.match(text, /Route: \/docs\/migrating\/express/);
  // A phrase from a late section (the strangler-fig steps) proves the tail
  // survived; the truncation marker proves it did not get cut short.
  assert.match(text, /Repeat until Express is empty, then delete it\./);
  assert.doesNotMatch(text, /\[truncated;/);
  assert.ok(
    text.length > 20_000,
    `expected the full guide, got ${text.length} chars`
  );
});

test("list_docs enumerates the available pages", async () => {
  const { json } = await rpc({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: { name: "list_docs", arguments: {} },
  });

  assert.notEqual(json.result.isError, true);
  const text = toolText(json);
  assert.match(text, /DaloyJS has \d+ documentation pages/);
  assert.match(text, /\(\/docs\/routing\)/);
});

test("a notification (no id) is acknowledged with 202 and no body", async () => {
  const res = await post({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  assert.equal(res.status, 202);
  assert.equal(await res.text(), "");
});

test("a JSON-RPC response (no method) is acknowledged with 202", async () => {
  const res = await post({ jsonrpc: "2.0", id: 5, result: {} });
  assert.equal(res.status, 202);
});

test("a JSON-RPC object without method, result, or error is rejected", async () => {
  const res = await post({ jsonrpc: "2.0", id: 5 });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error.code, -32600);
});

test("resources/list and prompts/list return empty collections", async () => {
  const resources = await rpc({
    jsonrpc: "2.0",
    id: 7,
    method: "resources/list",
  });
  assert.deepEqual(resources.json.result, { resources: [] });

  const prompts = await rpc({ jsonrpc: "2.0", id: 8, method: "prompts/list" });
  assert.deepEqual(prompts.json.result, { prompts: [] });
});

test("GET returns 405 with usage metadata and an Allow header", async () => {
  const res = GET();
  assert.equal(res.status, 405);
  assert.match(res.headers.get("allow") ?? "", /POST/);
  const json = await res.json();
  assert.equal(json.transport, "streamable-http");
  assert.deepEqual(json.tools, ["search_docs", "get_doc", "list_docs"]);
});

test("OPTIONS returns 204 with permissive CORS headers", () => {
  const res = OPTIONS();
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.match(res.headers.get("access-control-allow-methods") ?? "", /POST/);
});

// ─────────────────────────── Unhappy paths ───────────────────────────

test("malformed JSON yields a -32700 parse error with HTTP 400", async () => {
  const res = await post("{not valid json");
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error.code, -32700);
});

test("a JSON-RPC batch array is rejected with HTTP 400", async () => {
  const res = await post([{ jsonrpc: "2.0", id: 1, method: "ping" }]);
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error.code, -32600);
  assert.match(json.error.message, /batch/i);
});

test("a non-2.0 message is rejected with -32600 and HTTP 400", async () => {
  const res = await post({ jsonrpc: "1.0", id: 1, method: "ping" });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error.code, -32600);
});

test("a non-string JSON-RPC method is rejected with -32600 and HTTP 400", async () => {
  const res = await post({ jsonrpc: "2.0", id: 1, method: null });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error.code, -32600);
});

test("a JSON-RPC message with an invalid id is rejected with -32600 and HTTP 400", async () => {
  const res = await post({
    jsonrpc: "2.0",
    id: { nested: true },
    method: "ping",
  });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error.code, -32600);
});

test("an unknown method yields -32601 method not found", async () => {
  const { json } = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "does/notExist",
  });
  assert.equal(json.error.code, -32601);
});

test("tools/call without a name yields -32602 invalid params", async () => {
  const { json } = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { arguments: {} },
  });
  assert.equal(json.error.code, -32602);
});

test("tools/call for an unknown tool yields -32602 invalid params", async () => {
  const { json } = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "delete_everything", arguments: {} },
  });
  assert.equal(json.error.code, -32602);
  assert.match(json.error.message, /Unknown tool/);
});

test("search_docs without a query returns an isError result", async () => {
  const { json } = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "search_docs", arguments: {} },
  });
  assert.equal(json.result.isError, true);
  assert.match(toolText(json), /query/i);
});

test("search_docs with no alphanumeric terms returns an isError result", async () => {
  const { json } = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "search_docs", arguments: { query: "!!!  ---" } },
  });
  assert.equal(json.result.isError, true);
});

test("search_docs with a non-numeric limit returns an isError result", async () => {
  const { json } = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "search_docs",
      arguments: { query: "routing", limit: "lots" },
    },
  });
  assert.equal(json.result.isError, true);
});

test("get_doc without a path returns an isError result", async () => {
  const { json } = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "get_doc", arguments: {} },
  });
  assert.equal(json.result.isError, true);
});

test("get_doc for a missing page returns an isError result", async () => {
  const { json } = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "get_doc",
      arguments: { path: "this-page-does-not-exist" },
    },
  });
  assert.equal(json.result.isError, true);
  assert.match(toolText(json), /No documentation page found/);
});

test("get_doc rejects path traversal attempts", async () => {
  for (const path of [
    "../../../etc/passwd",
    "/docs/../../secret",
    "routing/../../etc",
  ]) {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_doc", arguments: { path } },
    });
    assert.equal(
      json.result.isError,
      true,
      `traversal ${path} must not resolve`
    );
  }
});

test("an unsupported MCP-Protocol-Version header yields HTTP 400", async () => {
  const res = await post(
    { jsonrpc: "2.0", id: 1, method: "ping" },
    { "mcp-protocol-version": "1999-01-01" }
  );
  assert.equal(res.status, 400);
  const json = await res.json();
  // 2026-07-28: UnsupportedProtocolVersionError, naming what we do speak.
  assert.equal(json.error.code, -32022);
  assert.ok(json.error.data.supported.includes("2026-07-28"));
  assert.equal(json.error.data.requested, "1999-01-01");
});

test("a supported MCP-Protocol-Version header is accepted", async () => {
  const res = await post(
    { jsonrpc: "2.0", id: 1, method: "ping" },
    { "mcp-protocol-version": "2025-06-18" }
  );
  assert.equal(res.status, 200);
});

test("an oversized request body yields HTTP 413", async () => {
  const huge = "A".repeat(300_000);
  const res = await post({
    jsonrpc: "2.0",
    id: 1,
    method: "ping",
    params: { huge },
  });
  assert.equal(res.status, 413);
});

test("an oversized multibyte request body is measured in bytes", async () => {
  const huge = "é".repeat(150_000);
  const res = await post({
    jsonrpc: "2.0",
    id: 1,
    method: "ping",
    params: { huge },
  });
  assert.equal(res.status, 413);
});

// ──────────────────── MCP 2026-07-28 (stateless era) ────────────────────

const V = "2026-07-28";
const PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
const CLIENT_CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities";
const SERVER_INFO_KEY = "io.modelcontextprotocol/serverInfo";

/** The `_meta` block every modern request must carry. */
function modernMeta(extra: Record<string, unknown> = {}) {
  return {
    [PROTOCOL_VERSION_KEY]: V,
    "io.modelcontextprotocol/clientInfo": {
      name: "test-client",
      version: "1.0.0",
    },
    [CLIENT_CAPABILITIES_KEY]: {},
    ...extra,
  };
}

/** Dispatch a spec-compliant modern request, mirroring `_meta` into headers. */
async function modern(
  body: { id?: number; method: string; params?: Record<string, unknown> },
  headerOverrides: Record<string, string | null> = {}
): Promise<{ res: Response; json: RpcResponse }> {
  const params = body.params ?? {};
  if (params._meta === undefined) params._meta = modernMeta();

  const headers: Record<string, string> = {
    "mcp-protocol-version": V,
    "mcp-method": body.method,
  };
  if (typeof params.name === "string") headers["mcp-name"] = params.name;
  for (const [key, value] of Object.entries(headerOverrides)) {
    if (value === null) delete headers[key];
    else headers[key] = value;
  }

  const res = await post(
    { jsonrpc: "2.0", id: body.id ?? 1, method: body.method, params },
    headers
  );
  return { res, json: (await res.json()) as RpcResponse };
}

test("server/discover advertises versions, capabilities, identity, and cache hints", async () => {
  const { res, json } = await modern({ method: "server/discover" });

  assert.equal(res.status, 200);
  assert.equal(json.result.resultType, "complete");
  assert.ok(json.result.supportedVersions.includes(V));
  assert.ok(json.result.supportedVersions.includes("2025-11-25"));
  assert.deepEqual(json.result.capabilities, { tools: {} });
  assert.equal(json.result._meta[SERVER_INFO_KEY].name, "daloyjs-docs");
  // Public, unauthenticated, identical for every caller — so a shared cache is safe here.
  assert.equal(json.result.cacheScope, "public");
  assert.ok(json.result.ttlMs > 0);
});

test("modern results carry resultType and server identity", async () => {
  const list = await modern({ method: "tools/list" });
  assert.equal(list.json.result.resultType, "complete");
  assert.equal(list.json.result.tools.length, 3);
  assert.equal(list.json.result._meta[SERVER_INFO_KEY].name, "daloyjs-docs");

  const call = await modern({
    method: "tools/call",
    params: {
      name: "search_docs",
      arguments: { query: "routing" },
      _meta: modernMeta(),
    },
  });
  assert.equal(call.json.result.resultType, "complete");
  assert.match(call.json.result.content[0].text, /result\(s\) for "routing"/);
});

test("a modern request missing required _meta fields is rejected", async () => {
  const noVersion = await modern({
    method: "tools/list",
    params: { _meta: { [CLIENT_CAPABILITIES_KEY]: {} } },
  });
  assert.equal(noVersion.res.status, 400);
  assert.equal(noVersion.json.error?.code, -32602);

  const noCapabilities = await modern({
    method: "tools/list",
    params: { _meta: { [PROTOCOL_VERSION_KEY]: V } },
  });
  assert.equal(noCapabilities.res.status, 400);
  assert.equal(noCapabilities.json.error?.code, -32602);
});

test("a modern request with missing or mismatched headers is rejected", async () => {
  const noMethod = await modern(
    { method: "tools/list" },
    { "mcp-method": null }
  );
  assert.equal(noMethod.res.status, 400);
  assert.equal(noMethod.json.error?.code, -32020);

  const wrongMethod = await modern(
    { method: "tools/list" },
    { "mcp-method": "prompts/list" }
  );
  assert.equal(wrongMethod.res.status, 400);
  assert.equal(wrongMethod.json.error?.code, -32020);

  const wrongName = await modern(
    {
      method: "tools/call",
      params: {
        name: "search_docs",
        arguments: { query: "x" },
        _meta: modernMeta(),
      },
    },
    { "mcp-name": "get_doc" }
  );
  assert.equal(wrongName.res.status, 400);
  assert.equal(wrongName.json.error?.code, -32020);

  const versionSkew = await modern({
    method: "tools/list",
    params: { _meta: modernMeta({ [PROTOCOL_VERSION_KEY]: "2025-11-25" }) },
  });
  assert.equal(versionSkew.res.status, 400);
  assert.equal(versionSkew.json.error?.code, -32020);
});

test("the Base64 sentinel form of Mcp-Name is decoded before comparison", async () => {
  const encoded = `=?base64?${Buffer.from("search_docs", "utf8").toString("base64")}?=`;
  const { res, json } = await modern(
    {
      method: "tools/call",
      params: {
        name: "search_docs",
        arguments: { query: "routing" },
        _meta: modernMeta(),
      },
    },
    { "mcp-name": encoded }
  );
  assert.equal(res.status, 200);
  assert.equal(json.result.resultType, "complete");

  const broken = await modern(
    {
      method: "tools/call",
      params: {
        name: "search_docs",
        arguments: { query: "routing" },
        _meta: modernMeta(),
      },
    },
    { "mcp-name": "=?base64?!!!not-base64!!!?=" }
  );
  assert.equal(broken.res.status, 400);
  assert.equal(broken.json.error?.code, -32020);
});

test("declaring a legacy version does not bypass header/body agreement", async () => {
  // The downgrade an attacker would reach for: keep the gateway-satisfying
  // header, change the body. Legacy requests may omit these headers, but any
  // they send must still match.
  const methodConfusion = await post(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "search_docs" },
    },
    { "mcp-protocol-version": "2025-11-25", "mcp-method": "tools/list" }
  );
  assert.equal(methodConfusion.status, 400);
  assert.equal(
    ((await methodConfusion.json()) as RpcResponse).error?.code,
    -32020
  );

  const toolConfusion = await post(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_doc", arguments: { path: "routing" } },
    },
    {
      "mcp-protocol-version": "2025-11-25",
      "mcp-method": "tools/call",
      "mcp-name": "search_docs",
    }
  );
  assert.equal(toolConfusion.status, 400);
  assert.equal(
    ((await toolConfusion.json()) as RpcResponse).error?.code,
    -32020
  );

  // A genuine legacy client sends none of these headers and is unaffected.
  const genuine = await rpc({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "get_doc", arguments: { path: "routing" } },
  });
  assert.equal(genuine.res.status, 200);
  assert.equal(genuine.json.result.resultType, undefined);
  assert.ok(genuine.json.result.content[0].text.length > 0);
});

test("removed methods answer 404 in the modern era; server/discover is modern-only", async () => {
  for (const method of ["initialize", "ping", "logging/setLevel"]) {
    const { res, json } = await modern({ method });
    assert.equal(res.status, 404, method);
    assert.equal(json.error?.code, -32601, method);
  }

  const legacyDiscover = await rpc(
    { jsonrpc: "2.0", id: 1, method: "server/discover" },
    { "mcp-protocol-version": "2025-11-25" }
  );
  assert.equal(legacyDiscover.res.status, 200);
  assert.equal(legacyDiscover.json.error?.code, -32601);
});

test("a legacy handshake is never answered with a modern revision", async () => {
  // Answering 2026-07-28 here would leave the client expected to send per-request
  // _meta it knows nothing about.
  const { json } = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: V, capabilities: {} },
  });
  assert.equal(json.result.protocolVersion, "2025-11-25");
  assert.equal(json.result.resultType, undefined);
});

test("legacy list results stay free of modern-only envelope fields", async () => {
  const { json } = await rpc(
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    { "mcp-protocol-version": "2025-11-25" }
  );
  assert.equal(json.result.resultType, undefined);
  assert.equal(json.result.ttlMs, undefined);
  assert.equal(json.result._meta, undefined);
});

test("preflight advertises the headers 2026-07-28 requires", () => {
  const res = OPTIONS();
  const allowed = res.headers.get("access-control-allow-headers") ?? "";
  assert.match(allowed, /Mcp-Method/i);
  assert.match(allowed, /Mcp-Name/i);
});

// ─────────────── Untrusted-body parsing posture ───────────────

test("prototype-pollution keys are stripped from the parsed body", async () => {
  // Hand-written JSON: a JS object literal's `__proto__` sets the prototype and
  // is dropped by JSON.stringify, so the raw string is required to prove the
  // parser strips the sink keys rather than materializing them.
  const raw =
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":' +
    '{"name":"search_docs","arguments":' +
    '{"__proto__":{"polluted":true},"constructor":"x","prototype":"y","query":"routing"}}}';

  const res = await post(raw);
  const json = (await res.json()) as RpcResponse;

  assert.equal(res.status, 200);
  assert.notEqual(json.result.isError, true);
  // The global prototype must be untouched regardless of the payload.
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("an excessively nested body is rejected before it is parsed", async () => {
  const deep = `${"[".repeat(200)}${"]".repeat(200)}`;
  const res = await post(
    `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"deep":${deep}}}`
  );
  assert.equal(res.status, 400);
  const json = (await res.json()) as RpcResponse;
  assert.equal(json.error.code, -32600);
  assert.match(json.error.message, /depth/i);
});

test("a body with too many keys is rejected before it is parsed", async () => {
  const wide = Array.from({ length: 10_050 }, (_, i) => `"k${i}":1`).join(",");
  const res = await post(
    `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{${wide}}}`
  );
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as RpcResponse).error.code, -32600);
});

test("braces and colons inside strings do not count toward the structural caps", async () => {
  // A query full of JSON-looking punctuation must still be accepted.
  const noisy = "{".repeat(80) + ":".repeat(80);
  const { res, json } = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "search_docs", arguments: { query: noisy } },
  });
  assert.equal(res.status, 200);
  // No structural rejection; the tool itself decides what to do with the query.
  assert.equal(json.error, undefined);
});
