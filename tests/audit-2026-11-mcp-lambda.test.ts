import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  MCP_META_KEYS,
  createMcpHandler,
  type McpHandler,
} from "../src/index.js";
import { toLambdaHandler } from "../src/adapters/lambda.js";
import { getConnInfo } from "../src/conn-info.js";

const VERSION = "2026-07-28";

function acctHandler(seen: number[]): McpHandler {
  return createMcpHandler({
    serverInfo: { name: "acct-mcp", version: "1.0.0" },
    tools: [
      {
        name: "acct_tool",
        description: "Read an account.",
        inputSchema: {
          type: "object",
          properties: { acct: { type: "integer", "x-mcp-header": "Acct" } },
          required: ["acct"],
          additionalProperties: false,
        },
        handler: (args) => {
          seen.push(args.acct as number);
          return `acct ${String(args.acct)}`;
        },
      },
    ],
  });
}

async function callAcct(handler: McpHandler, acct: number, header: string): Promise<number> {
  const res = await handler(
    new Request("http://test.local/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "mcp-protocol-version": VERSION,
        "mcp-method": "tools/call",
        "mcp-name": "acct_tool",
        "mcp-param-acct": header,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "acct_tool",
          arguments: { acct },
          _meta: {
            [MCP_META_KEYS.protocolVersion]: VERSION,
            [MCP_META_KEYS.clientInfo]: { name: "t", version: "1.0.0" },
            [MCP_META_KEYS.clientCapabilities]: {},
          },
        },
      }),
    }),
  );
  return res.status;
}

const b64 = (s: string) => `=?base64?${Buffer.from(s).toString("base64")}?=`;

test("integer Mcp-Param headers in canonical decimal form still match the body", async () => {
  const seen: number[] = [];
  const handler = acctHandler(seen);
  assert.equal(await callAcct(handler, 42, "42"), 200);
  assert.equal(await callAcct(handler, 42, "42.0"), 200);
  assert.equal(await callAcct(handler, -7, "-7"), 200);
  assert.equal(await callAcct(handler, 0, "0"), 200);
  assert.deepEqual(seen, [42, 42, -7, 0]);
});

test("integer Mcp-Param headers in non-decimal numeral forms are refused", async () => {
  const seen: number[] = [];
  const handler = acctHandler(seen);
  for (const header of ["0x2A", "0b101010", "0o52", "4.2e1", "+42", "042", b64(" 42 ")]) {
    assert.equal(await callAcct(handler, 42, header), 400, `header ${header}`);
  }
  assert.equal(await callAcct(handler, 0, b64("")), 400);
  assert.equal(await callAcct(handler, 0, b64("  ")), 400);
  assert.equal(await callAcct(handler, 42, "43"), 400);
  assert.deepEqual(seen, []);
});

function lambdaApp(): App {
  const app = new App({ logger: false });
  for (const path of ["/public/info", "/admin/secret"] as const) {
    app.route({
      method: "GET",
      path,
      acknowledgeNoResponseBodySchema: true,
      responses: { 200: { description: "ok" } },
      handler: (ctx) => {
        const peer = getConnInfo(ctx.request)?.remoteAddress ?? "none";
        return new Response(`${path} peer=${peer}`);
      },
    });
  }
  return app;
}

test("lambda adapter routes plain event paths and attaches a valid source IP", async () => {
  const handler = toLambdaHandler(lambdaApp());
  const v2 = await handler({
    version: "2.0",
    rawPath: "/public/info",
    requestContext: { http: { method: "GET", sourceIp: "198.51.100.7" }, domainName: "api.example.com" },
  });
  assert.equal(v2.statusCode, 200);
  assert.equal(v2.body, "/public/info peer=198.51.100.7");

  // An encoded slash stays opaque and is not refused (it simply does not route).
  const encodedSlash = await handler({
    version: "2.0",
    rawPath: "/public/..%2Fadmin/secret",
    requestContext: { http: { method: "GET" } },
  });
  assert.equal(encodedSlash.statusCode, 404);
});

test("lambda adapter refuses event paths the URL parser would re-route", async () => {
  const handler = toLambdaHandler(lambdaApp());
  const v2Paths = ["/public/%2e%2e/admin/secret", "/public/.%2E/admin/secret", "/public\\..\\admin\\secret", "/admin/secret#/public/info", "/public/./info"];
  for (const rawPath of v2Paths) {
    const res = await handler({ version: "2.0", rawPath, requestContext: { http: { method: "GET" } } });
    assert.equal(res.statusCode, 400, rawPath);
    assert.doesNotMatch(res.body, /\/admin\/secret peer/);
  }
  for (const path of ["/public/../admin/secret", "/admin/secret?x=1"]) {
    const res = await handler({ path, httpMethod: "GET", queryStringParameters: { y: "2" } });
    assert.equal(res.statusCode, 400, path);
  }
});

test("lambda adapter ignores a non-IP sourceIp instead of attaching it as the peer", async () => {
  const handler = toLambdaHandler(lambdaApp());
  const res = await handler({
    version: "2.0",
    rawPath: "/public/info",
    requestContext: { http: { method: "GET", sourceIp: "not-an-ip" } },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, "/public/info peer=none");
});
