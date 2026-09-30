import { test, mock } from "node:test";
import assert from "node:assert/strict";

/**
 * Tests for the MCP Server Card at `/.well-known/mcp/server-card.json`
 * (draft MCP Server Cards proposal, SEP-1649). The card must describe exactly
 * what `/mcp` serves, so these tests compare it with a live `tools/list` and
 * `server/discover` from the real route handler.
 *
 * `next/cache` is stubbed for the same reason as tests/mcp/route.test.ts.
 */
mock.module("next/cache", {
  namedExports: { cacheLife: () => {}, cacheTag: () => {} },
});

const { GET, OPTIONS } = await import("../../app/.well-known/mcp/server-card.json/route");
const { POST: mcpPost } = await import("../../app/mcp/route");
const { GET: getApiCatalog } = await import("../../app/.well-known/api-catalog/route");
const { buildSiteOpenApiDocument } = await import("../../lib/site-openapi");
const { SERVER_CARD_PATH, buildServerCard } = await import("../../lib/site-mcp");
const { SITE_API_RATE_LIMIT } = await import("../../lib/site-api");

type Card = {
  $schema: string;
  version: string;
  protocolVersion: string;
  serverInfo: { name: string; title?: string; version: string };
  transport: { type: string; endpoint: string };
  capabilities: Record<string, unknown>;
  authentication: { required: boolean; schemes: string[] };
  instructions: string;
  tools: Array<{ name: string; title: string; description: string; inputSchema: Record<string, unknown> }>;
};

const MODERN_META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
};

async function modern(method: string, id: number): Promise<any> {
  const res = await mcpPost(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": method,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params: { _meta: MODERN_META } }),
    }),
  );
  return res.json();
}

function stripSchemaKeyword(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = schema;
  return rest;
}

function cardRequest(ip: string): Request {
  return new Request(`http://localhost${SERVER_CARD_PATH}`, { headers: { "x-forwarded-for": ip } });
}

test("server card is served at the draft well-known path with the draft headers", async () => {
  assert.equal(SERVER_CARD_PATH, "/.well-known/mcp/server-card.json");
  const res = GET(cardRequest("198.51.100.1"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.match(res.headers.get("access-control-allow-methods") ?? "", /GET/);
  assert.equal(res.headers.get("cache-control"), "public, max-age=3600");
  assert.ok(res.headers.get("ratelimit-limit"), "shares the advertised site API quota");
  const preflight = OPTIONS();
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
});

test("server card carries every field the draft marks required", async () => {
  const card = (await GET(cardRequest("198.51.100.2")).json()) as Card;
  for (const key of ["$schema", "version", "protocolVersion", "serverInfo", "transport", "capabilities"]) {
    assert.ok(key in card, `missing required field ${key}`);
  }
  assert.ok(card.serverInfo.name && card.serverInfo.version);
  assert.deepEqual(card.transport, { type: "streamable-http", endpoint: "https://daloyjs.dev/mcp" });
  assert.equal(card.authentication.required, false);
  assert.ok(Array.isArray(card.authentication.schemes));
});

test("server card matches what /mcp actually serves (identity, version, capabilities, tools)", async () => {
  const card = buildServerCard() as Card;
  const discover = await modern("server/discover", 1);
  assert.ok(discover.result.supportedVersions.includes(card.protocolVersion), "card version is one /mcp serves");
  assert.deepEqual(card.capabilities, discover.result.capabilities);
  assert.equal(card.instructions, discover.result.instructions);
  assert.equal(card.serverInfo.name, discover.result._meta["io.modelcontextprotocol/serverInfo"].name);
  assert.equal(card.serverInfo.version, discover.result._meta["io.modelcontextprotocol/serverInfo"].version);

  const listed = (await modern("tools/list", 2)).result.tools as Card["tools"];
  assert.deepEqual(card.tools.map((tool) => tool.name), listed.map((tool) => tool.name));
  for (const tool of card.tools) {
    const live = listed.find((entry) => entry.name === tool.name)!;
    assert.equal(tool.title, live.title);
    assert.equal(tool.description, live.description);
    assert.deepEqual(stripSchemaKeyword(tool.inputSchema), stripSchemaKeyword(live.inputSchema), `${tool.name} inputSchema drifted`);
  }
});

test("server card advertises no secrets and only absolute https URLs", () => {
  const json = JSON.stringify(buildServerCard());
  assert.doesNotMatch(json, /secret|password|token"\s*:/i);
  for (const url of json.match(/https?:\/\/[^"]+/g) ?? []) {
    // Schema identifiers (the draft card schema, JSON Schema's meta-schema) are
    // names, not endpoints; everything else must point at this site.
    if (url.startsWith("https://static.modelcontextprotocol.io/") || url.startsWith("https://json-schema.org/")) continue;
    assert.match(url, /^https:\/\/daloyjs\.dev\//, `unexpected URL ${url}`);
  }
});

test("[unhappy] server card enforces the shared rate limit", async () => {
  let limited: Response | null = null;
  for (let attempt = 0; attempt <= SITE_API_RATE_LIMIT; attempt += 1) {
    const res = GET(cardRequest("198.51.100.99"));
    if (res.status === 429) {
      limited = res;
      break;
    }
  }
  assert.ok(limited, "the card must not be an unmetered endpoint");
  assert.equal(limited.headers.get("content-type"), "application/problem+json; charset=utf-8");
});

test("api-catalog links the server card", async () => {
  const catalog = (await getApiCatalog(new Request("http://localhost/.well-known/api-catalog", { headers: { "x-forwarded-for": "198.51.100.3" } })).json()) as any;
  const describedby = catalog.linkset[0].describedby as Array<{ href: string; type: string }>;
  assert.ok(describedby.some((link) => link.href === `https://daloyjs.dev${SERVER_CARD_PATH}` && link.type === "application/json"));
});

test("OpenAPI documents the card, and every response body in the spec declares a schema", () => {
  const spec = buildSiteOpenApiDocument() as any;
  const op = spec.paths[SERVER_CARD_PATH]?.get;
  assert.equal(op?.operationId, "getMcpServerCard");
  assert.ok(op.responses["200"].content["application/json"].schema.required.includes("transport"));

  const bodiless: string[] = [];
  for (const [path, item] of Object.entries<any>(spec.paths)) {
    for (const [method, operation] of Object.entries<any>(item)) {
      for (const [status, response] of Object.entries<any>(operation.responses ?? {})) {
        for (const [type, media] of Object.entries<any>(response.content ?? {})) {
          assert.ok(media.schema, `${method.toUpperCase()} ${path} ${status} ${type} has no schema`);
        }
      }
      const has2xxBody = Object.entries<any>(operation.responses ?? {}).some(([s, r]) => s.startsWith("2") && r.content);
      if (!has2xxBody) bodiless.push(`${method.toUpperCase()} ${path}`);
    }
  }
  // Only the redirect alias and the error-only authorize endpoint have no 2xx
  // body, both by design. Anything else here is a missing response schema.
  assert.deepEqual(bodiless.sort(), ["GET /api", "GET /oauth/authorize"]);
});
