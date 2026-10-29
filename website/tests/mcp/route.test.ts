import { test, mock } from "node:test";
import assert from "node:assert/strict";

/**
 * Integration tests for the `/mcp` route, which is built on Vercel's
 * `mcp-handler` (2.x) + MCP TypeScript SDK v2. The wire protocol (JSON-RPC
 * envelopes, era negotiation, `_meta` validation) is owned by the library;
 * these tests pin the behavior this site depends on: the tool catalog, the
 * tool results, the dual-era serving, and the guards kept in front of the
 * library (body-size cap, CORS, friendly GET).
 *
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

/** Required `_meta` keys for a 2026-07-28 ("modern") request. */
const MODERN_META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
};

/** A single tool descriptor from `tools/list`. */
interface RpcTool {
  name: string;
  title: string;
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
  capabilities: { tools?: Record<string, unknown> };
  serverInfo: { name: string; version: string };
  instructions: string;
  tools: RpcTool[];
  content: RpcContent[];
  isError: boolean;
  resultType: string;
  supportedVersions: string[];
  _meta: Record<string, { name: string; version: string }>;
}

/** The `error` payload of a failed JSON-RPC response. */
interface RpcError {
  code: number;
  message: string;
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

/**
 * Decode a JSON-RPC response body. Legacy (2025-era) requests are answered as
 * a single-message SSE stream (`text/event-stream`); modern requests and
 * transport-level errors are plain JSON. This helper accepts both.
 */
async function decode(res: Response): Promise<RpcResponse> {
  const text = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const data = text
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice("data: ".length))
      .join("");
    return JSON.parse(data) as RpcResponse;
  }
  return JSON.parse(text) as RpcResponse;
}

/** Dispatch a JSON-RPC message and decode the body (SSE or JSON). */
async function rpc(
  body: object,
  headers?: Record<string, string>
): Promise<{ res: Response; json: RpcResponse }> {
  const res = await post(body, headers);
  const json = await decode(res);
  return { res, json };
}

/** Dispatch a legacy (2025-06-18) JSON-RPC request. */
function legacyRpc(
  id: number,
  method: string,
  params: object = {}
): Promise<{ res: Response; json: RpcResponse }> {
  return rpc(
    { jsonrpc: "2.0", id, method, params },
    { "mcp-protocol-version": "2025-06-18" }
  );
}

/** Dispatch a modern (2026-07-28) JSON-RPC request with the required envelope. */
function modernRpc(
  id: number,
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {}
): Promise<{ res: Response; json: RpcResponse }> {
  return rpc(
    { jsonrpc: "2.0", id, method, params: { ...params, _meta: MODERN_META } },
    {
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      ...headers,
    }
  );
}

/** Pull the text payload out of a `tools/call` result. */
function toolText(json: RpcResponse): string {
  return json.result.content[0].text;
}

// ─────────────────────────── Happy paths: legacy era ───────────────────────────

test("legacy initialize completes the 2025-era handshake", async () => {
  const { res, json } = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.0.0" },
    },
  });

  assert.equal(res.status, 200);
  assert.equal(json.id, 1);
  assert.equal(json.result.protocolVersion, "2025-06-18");
  assert.equal(json.result.serverInfo.name, "daloyjs-docs");
  assert.ok(json.result.capabilities.tools, "advertises the tools capability");
  assert.match(json.result.instructions, /daloyjs\.dev\/docs/);
});

test("legacy tools/list returns the three-tool catalog with strict schemas", async () => {
  const { res, json } = await legacyRpc(2, "tools/list");

  assert.equal(res.status, 200);
  const names = json.result.tools.map((tool) => tool.name);
  assert.deepEqual(names, ["search_docs", "get_doc", "list_docs"]);

  for (const tool of json.result.tools) {
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(
      tool.inputSchema.additionalProperties,
      false,
      `${tool.name} schema must reject unknown keys`
    );
    assert.ok(tool.description.length > 0);
  }

  const search = json.result.tools[0];
  assert.deepEqual(search.inputSchema.required, ["query"]);
  const getDoc = json.result.tools[1];
  assert.deepEqual(getDoc.inputSchema.required, ["path"]);
});

test("legacy tools/call search_docs returns ranked hits with absolute URLs", async () => {
  const { res, json } = await legacyRpc(3, "tools/call", {
    name: "search_docs",
    arguments: { query: "routing" },
  });

  assert.equal(res.status, 200);
  assert.notEqual(json.result.isError, true);
  const text = toolText(json);
  assert.match(text, /Found \d+ result\(s\) for "routing"/);
  assert.match(text, /https:\/\/daloyjs\.dev\/docs\//);
});

test("legacy tools/call search_docs honors the limit argument", async () => {
  const { json } = await legacyRpc(4, "tools/call", {
    name: "search_docs",
    arguments: { query: "routing", limit: 1 },
  });

  assert.match(toolText(json), /Found 1 result\(s\)/);
});

test("legacy tools/call get_doc returns the full page body", async () => {
  const { json } = await legacyRpc(5, "tools/call", {
    name: "get_doc",
    arguments: { path: "routing" },
  });

  assert.notEqual(json.result.isError, true);
  const text = toolText(json);
  assert.match(text, /^# Routing\n/);
  assert.match(text, /Route: \/docs\/routing/);
  assert.match(text, /URL: https:\/\/daloyjs\.dev\/docs\/routing/);
});

test("legacy tools/call get_doc accepts a /docs/... route form", async () => {
  const { json } = await legacyRpc(6, "tools/call", {
    name: "get_doc",
    arguments: { path: "/docs/routing" },
  });

  assert.notEqual(json.result.isError, true);
  assert.match(toolText(json), /^# Routing\n/);
});

/** Replace global fetch for one test, recording every requested URL. */
function stubFetch(
  t: { after: (fn: () => void) => void },
  respond: (url: string) => Response
): string[] {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    return respond(url);
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

test("[happy] get_doc returns the same Markdown as the .md route, code intact", async (t) => {
  const code = 'app.get("/users/:id", { params: z.object({ id: z.string() }) }, (ctx) => ({ ok: true }));';
  const html =
    "<html><body><main><div data-docs-content><h1>Routing</h1><p>Intro.</p>" +
    `<div class="code-editor" data-language="ts"><pre><code>${code.replace(/>/g, "&gt;")}\n</code></pre></div>` +
    "</div></main></body></html>";
  const calls = stubFetch(t, () =>
    new Response(html, { status: 200, headers: { "content-type": "text/html" } })
  );

  const { json } = await legacyRpc(8, "tools/call", {
    name: "get_doc",
    arguments: { path: "routing" },
  });

  assert.notEqual(json.result.isError, true);
  const text = toolText(json);
  assert.match(text, /^# Routing\n/);
  assert.match(text, /Markdown: https:\/\/daloyjs\.dev\/docs\/routing\.md/);
  assert.ok(text.includes("```ts"), "code fence is preserved");
  assert.ok(text.includes(code), "code sample keeps braces and arrows");
  assert.equal(text.match(/^# Routing$/gm)?.length, 1, "H1 is not duplicated");
  // Self-fetch targets the request's loopback origin, never a forged host.
  assert.deepEqual(calls, ["http://localhost/docs/routing"]);
});

test("[unhappy] get_doc falls back to plain text when Markdown rendering fails", async (t) => {
  stubFetch(t, () => new Response("boom", { status: 500 }));

  const { json } = await legacyRpc(9, "tools/call", {
    name: "get_doc",
    arguments: { path: "/docs/security" },
  });

  assert.notEqual(json.result.isError, true);
  const text = toolText(json);
  assert.match(text, /Route: \/docs\/security/);
  assert.match(text, /plain-text fallback/);
  assert.match(text, /https:\/\/daloyjs\.dev\/docs\/security\.md/);
});

test("[unhappy] get_doc never self-fetches for an unknown page", async (t) => {
  const calls = stubFetch(t, () => new Response("", { status: 200 }));

  const { json } = await legacyRpc(10, "tools/call", {
    name: "get_doc",
    arguments: { path: "does-not-exist" },
  });

  assert.equal(json.result.isError, true);
  assert.match(toolText(json), /No documentation page found/);
  assert.deepEqual(calls, []);
});

test("legacy tools/call list_docs enumerates every page", async () => {
  const { json } = await legacyRpc(7, "tools/call", {
    name: "list_docs",
    arguments: {},
  });

  assert.notEqual(json.result.isError, true);
  const text = toolText(json);
  assert.match(text, /DaloyJS has \d+ documentation pages:/);
  assert.match(text, /- .+ \(\/docs\/routing\):/);
});

test("legacy notification is acknowledged with 202 and no body", async () => {
  const res = await post(
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { "mcp-protocol-version": "2025-06-18" }
  );

  assert.equal(res.status, 202);
  assert.equal(await res.text(), "");
});

// ─────────────────────────── Happy paths: modern era ───────────────────────────

test("modern server/discover advertises 2026-07-28 with the result envelope", async () => {
  const { res, json } = await modernRpc(10, "server/discover");

  assert.equal(res.status, 200);
  assert.ok(json.result.supportedVersions.includes("2026-07-28"));
  assert.ok(json.result.capabilities.tools, "advertises the tools capability");
  assert.equal(json.result.resultType, "complete");
  assert.equal(
    json.result._meta["io.modelcontextprotocol/serverInfo"].name,
    "daloyjs-docs"
  );
});

test("modern tools/list returns the same catalog as the legacy era", async () => {
  const { res, json } = await modernRpc(11, "tools/list");

  assert.equal(res.status, 200);
  assert.deepEqual(
    json.result.tools.map((tool) => tool.name),
    ["search_docs", "get_doc", "list_docs"]
  );
  assert.equal(json.result.resultType, "complete");
});

test("modern tools/call executes a tool with per-request metadata", async () => {
  const { res, json } = await modernRpc(
    12,
    "tools/call",
    { name: "search_docs", arguments: { query: "routing" } },
    { "mcp-name": "search_docs" }
  );

  assert.equal(res.status, 200);
  assert.notEqual(json.result.isError, true);
  assert.match(toolText(json), /Found \d+ result\(s\) for "routing"/);
});

// ─────────────────────────── Unhappy paths: tools ───────────────────────────

test("tools/call with an unknown tool is a JSON-RPC invalid-params error", async () => {
  const { json } = await legacyRpc(20, "tools/call", {
    name: "nope",
    arguments: {},
  });

  assert.equal(json.error.code, -32602);
  assert.match(json.error.message, /nope/);
});

test("tools/call with an unknown argument key is rejected by the strict schema", async () => {
  const { json } = await legacyRpc(21, "tools/call", {
    name: "search_docs",
    arguments: { query: "routing", bogus: true },
  });

  assert.equal(json.result.isError, true);
  assert.match(toolText(json), /Input validation error/);
  assert.match(toolText(json), /bogus/);
});

test("search_docs without a query is rejected by schema validation", async () => {
  const { json } = await legacyRpc(22, "tools/call", {
    name: "search_docs",
    arguments: {},
  });

  assert.equal(json.result.isError, true);
  assert.match(toolText(json), /Input validation error/);
});

test("search_docs with a punctuation-only query returns a tool error", async () => {
  const { json } = await legacyRpc(23, "tools/call", {
    name: "search_docs",
    arguments: { query: "!!!" },
  });

  assert.equal(json.result.isError, true);
  assert.match(toolText(json), /alphanumeric term/);
});

test("search_docs with an out-of-range limit is rejected by schema validation", async () => {
  const { json } = await legacyRpc(24, "tools/call", {
    name: "search_docs",
    arguments: { query: "routing", limit: 9999 },
  });

  assert.equal(json.result.isError, true);
  assert.match(toolText(json), /Input validation error/);
});

test("get_doc for a nonexistent page returns a recoverable tool error", async () => {
  const { json } = await legacyRpc(25, "tools/call", {
    name: "get_doc",
    arguments: { path: "no-such-page" },
  });

  assert.equal(json.result.isError, true);
  assert.match(toolText(json), /No documentation page found for "no-such-page"/);
  assert.match(toolText(json), /list_docs or search_docs/);
});

// ─────────────────────────── Unhappy paths: transport ───────────────────────────

test("an unsupported MCP-Protocol-Version header is refused with HTTP 400", async () => {
  const { res, json } = await rpc(
    { jsonrpc: "2.0", id: 30, method: "tools/list", params: {} },
    { "mcp-protocol-version": "1999-01-01" }
  );

  assert.equal(res.status, 400);
  assert.match(json.error.message, /[Uu]nsupported protocol version/);
});

test("a modern request without the _meta envelope is refused with HTTP 400", async () => {
  const { res, json } = await rpc(
    { jsonrpc: "2.0", id: 31, method: "tools/list", params: {} },
    { "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/list" }
  );

  assert.equal(res.status, 400);
  assert.equal(json.error.code, -32602);
  assert.match(json.error.message, /_meta/);
});

test("malformed JSON is a -32700 parse error with HTTP 400", async () => {
  const res = await post("{oops");
  const json = await decode(res);

  assert.equal(res.status, 400);
  assert.equal(json.error.code, -32700);
});

test("a body larger than the declared-length cap is refused with HTTP 413", async () => {
  const res = await post(
    { jsonrpc: "2.0", id: 32, method: "tools/list" },
    { "content-length": String(1 << 20) }
  );

  assert.equal(res.status, 413);
  const json = (await res.json()) as RpcResponse;
  assert.match(json.error.message, /too large/);
});

test("an actually oversized body is refused with HTTP 413", async () => {
  const res = await post(`{"pad":"${"x".repeat(1 << 18)}"}`);

  assert.equal(res.status, 413);
  const json = (await res.json()) as RpcResponse;
  assert.match(json.error.message, /too large/);
});

// ─────────────────────────── HTTP surface ───────────────────────────

test("GET answers 405 with a human-friendly hint and CORS headers", async () => {
  const res = GET();

  assert.equal(res.status, 405);
  assert.equal(res.headers.get("allow"), "POST, OPTIONS");
  assert.equal(res.headers.get("access-control-allow-origin"), "*");

  const body = (await res.json()) as {
    endpoint: string;
    tools: string[];
  };
  assert.equal(body.endpoint, "https://daloyjs.dev/mcp");
  assert.deepEqual(body.tools, ["search_docs", "get_doc", "list_docs"]);
});

test("OPTIONS preflight answers 204 with permissive CORS headers", async () => {
  const res = OPTIONS();

  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.match(
    res.headers.get("access-control-allow-headers") ?? "",
    /Mcp-Method/
  );
  assert.match(
    res.headers.get("access-control-allow-headers") ?? "",
    /MCP-Protocol-Version/
  );
});

test("POST responses carry CORS headers for browser-based clients", async () => {
  const { res } = await legacyRpc(40, "tools/list");

  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.ok(res.headers.get("ratelimit"));
  assert.ok(res.headers.get("ratelimit-policy"));
});

test("[unhappy] POST enforces the shared site API rate limit with 429 problem+json", async () => {
  const ip = "203.0.113.199";
  let last: Response | undefined;
  for (let i = 0; i <= 120; i++) {
    last = await post(
      { jsonrpc: "2.0", id: 100 + i, method: "tools/list", params: {} },
      { "mcp-protocol-version": "2025-06-18", "x-forwarded-for": ip }
    );
  }
  assert.equal(last?.status, 429);
  assert.equal(last?.headers.get("access-control-allow-origin"), "*");
  assert.ok(last?.headers.get("retry-after"));
  assert.equal(last?.headers.get("ratelimit-remaining"), "0");
});

test("search_docs maps a Chinese query to English and also lists the Chinese page", async () => {
  const { json } = await legacyRpc(70, "tools/call", {
    name: "search_docs",
    arguments: { query: "安装" },
  });

  assert.notEqual(json.result.isError, true);
  const text = toolText(json);
  assert.match(text, /Searched the English docs for: installation \(from 安装\)\./);
  assert.match(text, /\(\/docs\/installation\)/);
  assert.match(text, /\/zh\/docs\/installation, zh-CN translation of \/docs\/installation/);
});

test("search_docs reaches an untranslated English page from a Chinese term", async () => {
  const { json } = await legacyRpc(79, "tools/call", {
    name: "search_docs",
    arguments: { query: "如何配置限流" },
  });

  const text = toolText(json);
  // "how to configure rate limiting": both terms map, and the rate-limit
  // page ranks first.
  assert.match(text, /Searched the English docs for: rate limit, config \(from 限流, 配置\)/);
  assert.match(text, /1\. [^\n]*\(\/docs\/security\/rate-limit-redis\)/);
});

test("search_docs maps unaccented Spanish terms too", async () => {
  const { json } = await legacyRpc(80, "tools/call", {
    name: "search_docs",
    arguments: { query: "pruebas de contrato" },
  });

  assert.match(toolText(json), /Searched the English docs for: contract tests \(from pruebas de contrato\)/);
  assert.match(toolText(json), /1\. [^\n]*\(\/docs\/testing\)/);
});

test("search_docs gives the English hint when nothing matches in any language", async () => {
  const { json } = await legacyRpc(81, "tools/call", {
    name: "search_docs",
    arguments: { query: "量子纠缠" },
  });

  assert.notEqual(json.result.isError, true);
  assert.match(toolText(json), /English docs are the complete reference/);
});

test("search_docs with a Spanish query reaches the Spanish pages", async () => {
  const { json } = await legacyRpc(71, "tools/call", {
    name: "search_docs",
    arguments: { query: "instalación" },
  });

  assert.match(toolText(json), /\/es\/docs\/installation, es-ES translation of \/docs\/installation/);
});

test("search_docs keeps English queries English-only", async () => {
  const { json } = await legacyRpc(72, "tools/call", {
    name: "search_docs",
    arguments: { query: "installation" },
  });

  const text = toolText(json);
  assert.match(text, /\/docs\/installation/);
  assert.doesNotMatch(text, /Translated pages/);
});

test("search_docs bounds a huge multi-term query instead of scanning every term", async () => {
  const { json } = await legacyRpc(73, "tools/call", {
    name: "search_docs",
    arguments: { query: "安装教程快速开始".repeat(30).slice(0, 256) },
  });

  assert.notEqual(json.result.isError, true);
});

test("get_doc reads a translated route and names the authoritative English page", async () => {
  const { json } = await legacyRpc(74, "tools/call", {
    name: "get_doc",
    arguments: { path: "https://daloyjs.dev/zh/docs/installation.md" },
  });

  assert.notEqual(json.result.isError, true);
  const text = toolText(json);
  assert.match(text, /^# 安装/);
  assert.match(text, /Language: zh-CN \(translation of \/docs\/installation; the English page is authoritative/);
});

test("get_doc refuses traversal and untranslated routes under a locale prefix", async () => {
  for (const [id, path] of [
    [75, "/zh/docs/../../docs/installation"],
    [76, "/zh/docs/routing"],
    [77, "/de/docs/installation"],
  ] as const) {
    const { json } = await legacyRpc(id, "tools/call", { name: "get_doc", arguments: { path } });
    assert.equal(json.result.isError, true, path);
    assert.match(toolText(json), /No documentation page found/, path);
  }
});

test("list_docs lists translated pages after the English ones", async () => {
  const { json } = await legacyRpc(78, "tools/call", { name: "list_docs", arguments: {} });
  const text = toolText(json);
  const english = text.indexOf("(/docs/installation)");
  const translated = text.indexOf("Translated pages");
  assert.ok(english > -1 && translated > english);
  assert.match(text, /\/es\/docs\/tutorials\/bookstore, es-ES translation of \/docs\/tutorials\/bookstore/);
});

test("get_doc reads a French route too", async () => {
  const { json } = await legacyRpc(82, "tools/call", {
    name: "get_doc",
    arguments: { path: "/fr/docs/tutorials/bookstore" },
  });

  assert.notEqual(json.result.isError, true);
  assert.match(toolText(json), /Language: fr-FR \(translation of \/docs\/tutorials\/bookstore; the English page is authoritative/);
});

test("search_docs maps French terms to English and lists the French page", async () => {
  const { json } = await legacyRpc(83, "tools/call", {
    name: "search_docs",
    arguments: { query: "journalisation des requêtes" },
  });

  const text = toolText(json);
  assert.match(text, /Searched the English docs for: logging \(from journalisation\)/);
  assert.match(text, /1\. [^\n]*\(\/docs\/logging\)/);
});
