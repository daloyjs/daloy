import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  bearerAuth,
  basicAuth,
  clientCertAuth,
  markAuthHook,
  AUTH_HOOK_MARKER,
  createMcpHandler,
  mcpRoutes,
} from "../src/index.js";

// ---------- AUTH_HOOK_MARKER stamping ----------

test("built-in auth middlewares and markAuthHook stamp AUTH_HOOK_MARKER", () => {
  const bearer = bearerAuth({ validate: () => true }) as unknown as Record<PropertyKey, unknown>;
  const basic = basicAuth({ verify: () => true }) as unknown as Record<PropertyKey, unknown>;
  const mtls = clientCertAuth() as unknown as Record<PropertyKey, unknown>;
  const custom = markAuthHook({ async beforeHandle() { return undefined; } }) as unknown as Record<
    PropertyKey,
    unknown
  >;
  assert.equal(bearer[AUTH_HOOK_MARKER], true);
  assert.equal(basic[AUTH_HOOK_MARKER], true);
  assert.equal(mtls[AUTH_HOOK_MARKER], true);
  assert.equal(custom[AUTH_HOOK_MARKER], true);
});

// ---------- Guard 1: route declares auth: but nothing enforces it ----------

test("route declaring auth: without an auth hook returns 500 in production", async () => {
  const app = new App({ logger: false, env: "production" });
  app.route({
    method: "GET",
    path: "/secret",
    auth: { scheme: "bearerAuth" },
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/secret");
  assert.equal(res.status, 500);
});

test("route declaring auth: with a matching bearerAuth hook boots and enforces", async () => {
  const app = new App({ logger: false, env: "production" });
  app.route({
    method: "GET",
    path: "/secret",
    auth: { scheme: "bearerAuth" },
    hooks: bearerAuth({ validate: (t) => t === "good" }),
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });
  // Boot guard is satisfied; the hook still rejects a missing/invalid token.
  const unauth = await app.request("/secret");
  assert.equal(unauth.status, 401);
  const ok = await app.request("/secret", { headers: { authorization: "Bearer good" } });
  assert.equal(ok.status, 200);
});

test("route declaring auth: satisfied by a global markAuthHook boots", async () => {
  const app = new App({ logger: false, env: "production" });
  app.use(markAuthHook({ async beforeHandle() { return undefined; } }));
  app.route({
    method: "GET",
    path: "/secret",
    auth: { scheme: "custom" },
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/secret");
  assert.equal(res.status, 200);
});

test("route declaring auth: without a hook is allowed in development", async () => {
  const app = new App({ logger: false, env: "development" });
  app.route({
    method: "GET",
    path: "/secret",
    auth: { scheme: "bearerAuth" },
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/secret");
  assert.equal(res.status, 200);
});

test("route declaring auth: without a hook is allowed when secureDefaults is off", async () => {
  const app = new App({
    logger: false,
    env: "production",
    secureDefaults: false,
    acknowledgeInsecureDefaults: true,
  });
  app.route({
    method: "GET",
    path: "/secret",
    auth: { scheme: "bearerAuth" },
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/secret");
  assert.equal(res.status, 200);
});

// ---------- Guard 2: mcpRoutes without auth ----------

const mcp = () =>
  createMcpHandler({
    serverInfo: { name: "guard-mcp", version: "1.0.0" },
    tools: [
      {
        name: "noop",
        description: "does nothing",
        inputSchema: { type: "object", additionalProperties: true },
        handler: () => ({ content: [{ type: "text", text: "ok" }] }),
      },
    ],
  });

test("mcpRoutes without an auth hook returns 500 in production", async () => {
  const app = new App({ logger: false, env: "production" });
  for (const route of mcpRoutes("/mcp", mcp())) app.route(route);
  const res = await app.request("/mcp", { method: "POST" });
  assert.equal(res.status, 500);
});

test("mcpRoutes covered by a global bearerAuth hook boots in production", async () => {
  const app = new App({ logger: false, env: "production" });
  app.use(bearerAuth({ validate: () => true }));
  for (const route of mcpRoutes("/mcp", mcp())) app.route(route);
  // Guard satisfied -> not the guard's 500. (Missing token -> 401 from bearerAuth.)
  const res = await app.request("/mcp", { method: "POST" });
  assert.notEqual(res.status, 500);
  assert.equal(res.status, 401);
});

test("mcpRoutes({ public: true }) boots without auth in production", async () => {
  const app = new App({ logger: false, env: "production" });
  for (const route of mcpRoutes("/mcp", mcp(), { public: true })) app.route(route);
  const res = await app.request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });
  assert.notEqual(res.status, 500);
});

test("mcpRoutes without auth is allowed in development", async () => {
  const app = new App({ logger: false, env: "development" });
  for (const route of mcpRoutes("/mcp", mcp())) app.route(route);
  const res = await app.request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });
  assert.notEqual(res.status, 500);
});
