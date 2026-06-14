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
function post(body: string | object, headers: Record<string, string> = {}): Promise<Response> {
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
    }),
  );
}

/** Dispatch a JSON-RPC message and decode the JSON body. */
async function rpc(
  body: object,
  headers?: Record<string, string>,
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

  assert.equal(json.result.protocolVersion, "2025-06-18");
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
    params: { name: "search_docs", arguments: { query: "rate limit", limit: 3 } },
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
  for (const path of ["/docs/routing", "https://daloyjs.dev/docs/routing?x=1#y"]) {
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
  const res = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(res.status, 202);
  assert.equal(await res.text(), "");
});

test("a JSON-RPC response (no method) is acknowledged with 202", async () => {
  const res = await post({ jsonrpc: "2.0", id: 5, result: {} });
  assert.equal(res.status, 202);
});

test("resources/list and prompts/list return empty collections", async () => {
  const resources = await rpc({ jsonrpc: "2.0", id: 7, method: "resources/list" });
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

test("an unknown method yields -32601 method not found", async () => {
  const { json } = await rpc({ jsonrpc: "2.0", id: 1, method: "does/notExist" });
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

test("tools/call for an unknown tool returns an isError result", async () => {
  const { json } = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "delete_everything", arguments: {} },
  });
  assert.equal(json.result.isError, true);
  assert.match(toolText(json), /Unknown tool/);
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
    params: { name: "search_docs", arguments: { query: "routing", limit: "lots" } },
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
    params: { name: "get_doc", arguments: { path: "this-page-does-not-exist" } },
  });
  assert.equal(json.result.isError, true);
  assert.match(toolText(json), /No documentation page found/);
});

test("get_doc rejects path traversal attempts", async () => {
  for (const path of ["../../../etc/passwd", "/docs/../../secret", "routing/../../etc"]) {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_doc", arguments: { path } },
    });
    assert.equal(json.result.isError, true, `traversal ${path} must not resolve`);
  }
});

test("an unsupported MCP-Protocol-Version header yields HTTP 400", async () => {
  const res = await post(
    { jsonrpc: "2.0", id: 1, method: "ping" },
    { "mcp-protocol-version": "1999-01-01" },
  );
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error.code, -32600);
  assert.ok(Array.isArray(json.error.data.supported));
});

test("a supported MCP-Protocol-Version header is accepted", async () => {
  const res = await post(
    { jsonrpc: "2.0", id: 1, method: "ping" },
    { "mcp-protocol-version": "2025-06-18" },
  );
  assert.equal(res.status, 200);
});

test("an oversized request body yields HTTP 413", async () => {
  const huge = "A".repeat(300_000);
  const res = await post({ jsonrpc: "2.0", id: 1, method: "ping", params: { huge } });
  assert.equal(res.status, 413);
});
