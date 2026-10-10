import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  HttpError,
  createMcpHandler,
  markAuthHook,
  mcpRoutes,
  type McpHandler,
  type McpRequestContext,
} from "../src/index.js";

// A custom API-key hook that stores the verified principal on ctx.state.
const apiKeyAuth = markAuthHook({
  beforeHandle: (ctx: any) => {
    const key = ctx.request.headers.get("authorization");
    if (key === "Bearer alice-key") ctx.state.user = { sub: "alice" };
    else throw new HttpError(401, { title: "Unauthorized" });
  },
});

function whoamiHandler(seen: { ctx?: McpRequestContext }): McpHandler {
  return createMcpHandler({
    serverInfo: { name: "state-test", version: "1.0.0" },
    tools: [
      {
        name: "whoami",
        description: "Return the verified caller.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        handler: (_args, ctx) => {
          seen.ctx = ctx;
          const user = ctx.state.user as { sub?: string } | undefined;
          return user?.sub ?? "anonymous";
        },
      },
    ],
  });
}

function call(headers: Record<string, string> = {}) {
  return new Request("http://test.local/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "mcp-protocol-version": "2025-11-25",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "whoami", arguments: {} },
    }),
  });
}

test("mcpRoutes forwards the verified ctx.state to tool handlers", async () => {
  const seen: { ctx?: McpRequestContext } = {};
  const app = new App({ logger: false, env: "production", behindProxy: "none" });
  app.use(apiKeyAuth);
  for (const route of mcpRoutes("/mcp", whoamiHandler(seen))) app.route(route);

  // A spoofed identity header must not influence the principal the tool sees.
  const res = await app.fetch(call({ authorization: "Bearer alice-key", "x-user-id": "bob" }));
  const json = (await res.json()) as any;
  assert.equal(res.status, 200);
  assert.equal(json.result.content[0].text, "alice");
  assert.deepEqual(seen.ctx?.state.user, { sub: "alice" });
});

test("mcpRoutes { hooks } scopes auth to the POST transport and satisfies the boot guard", async () => {
  const seen: { ctx?: McpRequestContext } = {};
  const app = new App({ logger: false, env: "production", behindProxy: "none" });
  for (const route of mcpRoutes("/mcp", whoamiHandler(seen), { hooks: apiKeyAuth })) {
    app.route(route);
  }
  assert.doesNotThrow(() => app.assertSecureConfig());

  const ok = await app.fetch(call({ authorization: "Bearer alice-key" }));
  assert.equal(((await ok.json()) as any).result.content[0].text, "alice");

  // Unhappy path: no credential is refused before the tool runs.
  seen.ctx = undefined;
  const denied = await app.fetch(call());
  assert.equal(denied.status, 401);
  assert.equal(seen.ctx, undefined);

  // The GET hint and OPTIONS preflight stay credential-free.
  const hint = await app.fetch(new Request("http://test.local/mcp", { method: "GET" }));
  assert.notEqual(hint.status, 401);
});

test("mcpRoutes without hooks or middleware still refuses to boot in production", () => {
  const app = new App({ logger: false, env: "production", behindProxy: "none" });
  for (const route of mcpRoutes("/mcp", whoamiHandler({}))) app.route(route);
  assert.throws(() => app.assertSecureConfig());
});

test("a direct handler call without options exposes an empty state", async () => {
  const seen: { ctx?: McpRequestContext } = {};
  const handler = whoamiHandler(seen);
  const res = await handler(call({ "x-user-id": "bob" }));
  assert.equal(((await res.json()) as any).result.content[0].text, "anonymous");
  assert.deepEqual(seen.ctx?.state, {});
});

test("a hand-rolled MCP route that declares auth fails closed without an auth hook", async () => {
  const handler = whoamiHandler({});
  const app = new App({ logger: false, env: "production", behindProxy: "none" });
  app.post(
    "/mcp",
    {
      operationId: "mcpStreamableHttp",
      auth: { scheme: "bearer" },
      acknowledgeNoResponseBodySchema: true,
      responses: { 200: { description: "MCP JSON-RPC response" } },
    } as any,
    (({ request, state }: any) => handler(request, { state })) as any,
  );
  assert.throws(() => app.assertSecureConfig(), /auth/);
});

test("a hand-rolled MCP route forwards state when it passes it explicitly", async () => {
  const seen: { ctx?: McpRequestContext } = {};
  const handler = whoamiHandler(seen);
  const app = new App({ logger: false, env: "production", behindProxy: "none" });
  app.use(apiKeyAuth);
  app.post(
    "/mcp",
    {
      operationId: "mcpStreamableHttp",
      auth: { scheme: "bearer" },
      acknowledgeNoResponseBodySchema: true,
      responses: { 200: { description: "MCP JSON-RPC response" } },
    } as any,
    (({ request, state }: any) => handler(request, { state })) as any,
  );
  assert.doesNotThrow(() => app.assertSecureConfig());
  const res = await app.fetch(call({ authorization: "Bearer alice-key" }));
  assert.equal(((await res.json()) as any).result.content[0].text, "alice");
});
