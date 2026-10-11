import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  MCP_DISCOVERY_METHODS,
  MCP_ERROR_CODES,
  MCP_META_KEYS,
  bearerAuth,
  createMcpHandler,
  every,
  idempotency,
  markAuthHook,
  mcpRoutes,
  rateLimit,
  requireScopes,
  some,
  timingSafeEqual,
  type McpHandler,
  type McpMethodAuthOptions,
} from "../src/index.js";

const VERSION = "2026-07-28";
const SERVICE_TOKEN = "service-token-for-discovery";
const USER_TOKEN = "delegated-user-token";

const serviceAuth = () => bearerAuth({ validate: (t) => timingSafeEqual(t, SERVICE_TOKEN) });
const userAuth = () => bearerAuth({ validate: (t) => timingSafeEqual(t, USER_TOKEN) });

/** A handler whose tool records every execution, so tests can prove it never ran. */
function createHandler(): { handler: McpHandler; calls: string[] } {
  const calls: string[] = [];
  const handler = createMcpHandler({
    serverInfo: { name: "method-auth-mcp", version: "1.0.0" },
    tools: [
      {
        name: "delete_account",
        description: "Side-effecting tool.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        handler: () => {
          calls.push("delete_account");
          return "deleted";
        },
      },
    ],
    resources: [
      {
        uri: "daloy://inventory",
        name: "inventory",
        read: () => ({ uri: "daloy://inventory", text: "{}" }),
      },
    ],
  });
  return { handler, calls };
}

function mount(
  methodAuth: McpMethodAuthOptions,
  handler: McpHandler = createHandler().handler,
  appOptions: ConstructorParameters<typeof App>[0] = {}
): App {
  const app = new App({ logger: false, env: "production", ...appOptions });
  for (const route of mcpRoutes("/mcp", handler, { methodAuth })) app.route(route);
  return app;
}

const defaultAuth = (): McpMethodAuthOptions => ({ discovery: serviceAuth(), call: userAuth() });

/**
 * Send a spec-compliant 2026-07-28 request. `headers` overrides (null deletes)
 * the mirrored standard headers to exercise spoofing.
 */
async function send(
  app: App,
  method: string,
  options: {
    token?: string;
    params?: Record<string, unknown>;
    headers?: Record<string, string | null>;
    legacy?: boolean;
  } = {}
): Promise<{ res: Response; json: any }> {
  const params: Record<string, unknown> = { ...(options.params ?? {}) };
  if (!options.legacy) {
    params._meta = {
      [MCP_META_KEYS.protocolVersion]: VERSION,
      [MCP_META_KEYS.clientInfo]: { name: "test", version: "1.0.0" },
      [MCP_META_KEYS.clientCapabilities]: {},
    };
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (!options.legacy) {
    headers["mcp-protocol-version"] = VERSION;
    headers["mcp-method"] = method;
    if (typeof params.name === "string") headers["mcp-name"] = params.name;
    if (typeof params.uri === "string") headers["mcp-name"] = params.uri;
  }
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
  for (const [key, value] of Object.entries(options.headers ?? {})) {
    if (value === null) delete headers[key];
    else headers[key] = value;
  }
  const res = await app.request("/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await res.text();
  return { res, json: text ? JSON.parse(text) : undefined };
}

// ---------- happy paths ----------

test("methodAuth boots in production and lets a service token list tools", async () => {
  const app = mount(defaultAuth());
  const { res, json } = await send(app, "tools/list", { token: SERVICE_TOKEN });
  assert.equal(res.status, 200);
  assert.deepEqual(
    json.result.tools.map((t: { name: string }) => t.name),
    ["delete_account"]
  );
});

test("methodAuth serves server/discover and every default discovery method to the discovery credential", async () => {
  const app = mount(defaultAuth());
  for (const method of MCP_DISCOVERY_METHODS) {
    const { res, json } = await send(app, method, { token: SERVICE_TOKEN });
    assert.equal(res.status, 200, method);
    assert.equal(json.error, undefined, method);
  }
});

test("methodAuth runs tools/call with the call credential", async () => {
  const { handler, calls } = createHandler();
  const app = mount(defaultAuth(), handler);
  const { res, json } = await send(app, "tools/call", {
    token: USER_TOKEN,
    params: { name: "delete_account", arguments: {} },
  });
  assert.equal(res.status, 200);
  assert.equal(json.result.content[0].text, "deleted");
  assert.deepEqual(calls, ["delete_account"]);
});

test('methodAuth discovery: "public" lists tools without credentials but still guards tools/call', async () => {
  const { handler, calls } = createHandler();
  const app = mount({ discovery: "public", call: userAuth() }, handler);
  const listed = await send(app, "tools/list");
  assert.equal(listed.res.status, 200);
  assert.equal(listed.json.result.tools.length, 1);

  const called = await send(app, "tools/call", {
    params: { name: "delete_account", arguments: {} },
  });
  assert.equal(called.res.status, 401);
  assert.deepEqual(calls, []);
});

test("methodAuth discovery accepts some() so either the service or the user token can list", async () => {
  const app = mount({ discovery: some(serviceAuth(), userAuth()), call: userAuth() });
  assert.equal((await send(app, "tools/list", { token: SERVICE_TOKEN })).res.status, 200);
  assert.equal((await send(app, "tools/list", { token: USER_TOKEN })).res.status, 200);
});

test("methodAuth accepts a custom beforeHandle gate wrapped with markAuthHook()", async () => {
  const call = markAuthHook({
    beforeHandle(ctx) {
      const auth = ctx.request.headers.get("authorization") ?? "";
      if (!timingSafeEqual(auth, `Bearer ${USER_TOKEN}`)) {
        return new Response(null, { status: 401 });
      }
      return undefined;
    },
  });
  const app = mount({ discovery: serviceAuth(), call });
  const ok = await send(app, "tools/call", {
    token: USER_TOKEN,
    params: { name: "delete_account", arguments: {} },
  });
  assert.equal(ok.res.status, 200);
  const denied = await send(app, "tools/call", {
    token: SERVICE_TOKEN,
    params: { name: "delete_account", arguments: {} },
  });
  assert.equal(denied.res.status, 401);
  assert.equal((await send(app, "tools/list", { token: SERVICE_TOKEN })).res.status, 200);
});

test("methodAuth satisfies app({ requireAuth: true }) and survives a route spread", async () => {
  const app = new App({ logger: false, env: "production", requireAuth: true });
  for (const route of mcpRoutes("/mcp", createHandler().handler, { methodAuth: defaultAuth() })) {
    app.route({ ...route });
  }
  assert.equal((await send(app, "tools/list", { token: SERVICE_TOKEN })).res.status, 200);
});

/** Auth hook that resolves a user with scopes, the shape jwk() writes to ctx.state.user. */
function scopedUserAuth() {
  const users: Record<string, string[]> = {
    "user-with-scope": ["mcp:call"],
    "user-without-scope": [],
    lister: ["mcp:list"],
  };
  return markAuthHook({
    preBody(ctx) {
      const token = (ctx.request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
      const scopes = Object.hasOwn(users, token) ? users[token] : undefined;
      if (scopes === undefined) return new Response(null, { status: 401 });
      ctx.state.user = { sub: token, scopes };
      return undefined;
    },
  });
}

test("methodAuth call accepts every(auth, requireScopes()) and enforces the scope per request", async () => {
  const { handler, calls } = createHandler();
  const app = mount(
    { discovery: serviceAuth(), call: every(scopedUserAuth(), requireScopes(["mcp:call"])) },
    handler
  );
  const params = { name: "delete_account", arguments: {} };
  assert.equal((await send(app, "tools/call", { token: "user-with-scope", params })).res.status, 200);
  assert.equal((await send(app, "tools/call", { token: "user-without-scope", params })).res.status, 403);
  assert.deepEqual(calls, ["delete_account"]);
  // Discovery is gated by its own bundle only, not by the call scopes.
  assert.equal((await send(app, "tools/list", { token: SERVICE_TOKEN })).res.status, 200);
});

test("methodAuth scopes each request by the selected bundle only (discovery does not inherit call scopes)", async () => {
  const { handler, calls } = createHandler();
  const app = mount(
    {
      discovery: every(scopedUserAuth(), requireScopes(["mcp:list"])),
      call: every(scopedUserAuth(), requireScopes(["mcp:call"])),
    },
    handler
  );
  // "lister" holds only mcp:list: it may list but not call.
  assert.equal((await send(app, "tools/list", { token: "lister" })).res.status, 200);
  const called = await send(app, "tools/call", {
    token: "lister",
    params: { name: "delete_account", arguments: {} },
  });
  assert.equal(called.res.status, 403);
  assert.deepEqual(calls, []);
  // "user-with-scope" holds only mcp:call: it may call but not list.
  assert.equal((await send(app, "tools/list", { token: "user-with-scope" })).res.status, 403);
});

test("methodAuth leaves GET and OPTIONS without hooks and adds no route-wide scope marker", () => {
  const [post, get, options] = mcpRoutes("/mcp", createHandler().handler, {
    methodAuth: { discovery: serviceAuth(), call: every(scopedUserAuth(), requireScopes(["mcp:call"])) },
  });
  assert.equal(get!.hooks, undefined);
  assert.equal(options!.hooks, undefined);
  // A route-wide marker would make the App demand the call scopes on discovery too.
  assert.equal(
    (post!.hooks as Record<PropertyKey, unknown>)[Symbol.for("daloyjs.middleware.requireScopes")],
    undefined
  );
});

test("[unhappy] idempotency() never replays a scoped tools/call result to a caller without the scope", async () => {
  const { handler, calls } = createHandler();
  const app = new App({ logger: false, env: "production" });
  // A coarse, shared namespace (e.g. per tenant) is exactly where the replay
  // scope check is the last line of defense.
  app.use(idempotency({ scope: () => "tenant-1" }));
  for (const route of mcpRoutes("/mcp", handler, {
    methodAuth: { discovery: serviceAuth(), call: every(scopedUserAuth(), requireScopes(["mcp:call"])) },
  })) {
    app.route(route);
  }
  const params = { name: "delete_account", arguments: {} };
  const key = { "idempotency-key": "same-key" };
  const first = await send(app, "tools/call", { token: "user-with-scope", params, headers: key });
  assert.equal(first.res.status, 200);
  const replayAttempt = await send(app, "tools/call", { token: "user-without-scope", params, headers: key });
  assert.equal(replayAttempt.res.status, 403);
  assert.equal(replayAttempt.res.headers.get("idempotency-replayed"), null);
  assert.deepEqual(calls, ["delete_account"]);
});

test("methodAuth composes with mcpRoutes { hooks }: a rate limit there counts every MCP request", async () => {
  const { handler, calls } = createHandler();
  const app = new App({ logger: false, env: "production" });
  for (const route of mcpRoutes("/mcp", handler, {
    hooks: rateLimit({ windowMs: 60_000, max: 2 }),
    methodAuth: defaultAuth(),
  })) {
    app.route(route);
  }
  // A discovery request and a rejected call both consume the budget.
  assert.equal((await send(app, "tools/list", { token: SERVICE_TOKEN })).res.status, 200);
  assert.equal(
    (await send(app, "tools/call", { token: SERVICE_TOKEN, params: { name: "delete_account", arguments: {} } }))
      .res.status,
    403
  );
  assert.equal((await send(app, "tools/list", { token: SERVICE_TOKEN })).res.status, 429);
  assert.deepEqual(calls, []);
});

test("methodAuth forwards the call bundle's verified principal to tools as ctx.state", async () => {
  let seen: unknown;
  const handler = createMcpHandler({
    serverInfo: { name: "whoami", version: "1.0.0" },
    tools: [
      {
        name: "whoami",
        description: "Return the caller.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        handler: (_args, ctx) => {
          seen = ctx.state.user;
          return "ok";
        },
      },
    ],
  });
  const app = mount({ discovery: serviceAuth(), call: scopedUserAuth() }, handler);
  const res = await send(app, "tools/call", {
    token: "user-with-scope",
    params: { name: "whoami", arguments: {} },
  });
  assert.equal(res.res.status, 200);
  assert.deepEqual(seen, { sub: "user-with-scope", scopes: ["mcp:call"] });
});

// ---------- unhappy paths ----------

test("[unhappy] an auth hook in mcpRoutes { hooks } next to methodAuth is refused", () => {
  assert.throws(
    () => mcpRoutes("/mcp", createHandler().handler, { hooks: userAuth(), methodAuth: defaultAuth() }),
    /hooks contains an authentication hook/
  );
  assert.throws(
    () =>
      mcpRoutes("/mcp", createHandler().handler, {
        hooks: every(rateLimit({ windowMs: 60_000, max: 5 }), userAuth()),
        methodAuth: defaultAuth(),
      }),
    /hooks contains an authentication hook/
  );
});

test("[unhappy] a notification sent with a discovery token and a spoofed header executes nothing", async () => {
  const { handler, calls } = createHandler();
  const app = mount(defaultAuth(), handler);
  const res = await app.request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${SERVICE_TOKEN}`,
      "mcp-protocol-version": VERSION,
      "mcp-method": "tools/list",
    },
    // No id: a notification. It must be acknowledged, never dispatched.
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "delete_account", arguments: {} },
    }),
  });
  assert.equal(res.status, 202);
  assert.deepEqual(calls, []);
});

test("[unhappy] a discovery token cannot call a tool", async () => {
  const { handler, calls } = createHandler();
  const app = mount(defaultAuth(), handler);
  const { res } = await send(app, "tools/call", {
    token: SERVICE_TOKEN,
    params: { name: "delete_account", arguments: {} },
  });
  assert.equal(res.status, 403);
  assert.deepEqual(calls, []);
});

test("[unhappy] a spoofed Mcp-Method: tools/list on a tools/call body is rejected with -32020", async () => {
  const { handler, calls } = createHandler();
  const app = mount(defaultAuth(), handler);
  const { res, json } = await send(app, "tools/call", {
    token: SERVICE_TOKEN,
    params: { name: "delete_account", arguments: {} },
    headers: { "mcp-method": "tools/list" },
  });
  assert.equal(res.status, 400);
  assert.equal(json.error.code, MCP_ERROR_CODES.headerMismatch);
  assert.deepEqual(calls, []);
});

test("[unhappy] the spoof also fails on a legacy-protocol request that sends the header", async () => {
  const { handler, calls } = createHandler();
  const app = mount(defaultAuth(), handler);
  const { res, json } = await send(app, "tools/call", {
    legacy: true,
    token: SERVICE_TOKEN,
    params: { name: "delete_account", arguments: {} },
    headers: { "mcp-method": "tools/list" },
  });
  assert.equal(res.status, 400);
  assert.equal(json.error.code, MCP_ERROR_CODES.headerMismatch);
  assert.deepEqual(calls, []);
});

test("[unhappy] a request without Mcp-Method needs the call credential (fails closed)", async () => {
  const { handler, calls } = createHandler();
  const app = mount(defaultAuth(), handler);
  const listed = await send(app, "tools/list", { legacy: true, token: SERVICE_TOKEN });
  assert.equal(listed.res.status, 403);
  const called = await send(app, "tools/call", {
    legacy: true,
    token: SERVICE_TOKEN,
    params: { name: "delete_account", arguments: {} },
  });
  assert.equal(called.res.status, 403);
  assert.deepEqual(calls, []);
  // The call credential still works for legacy clients.
  assert.equal((await send(app, "tools/list", { legacy: true, token: USER_TOKEN })).res.status, 200);
});

test("[unhappy] a non-canonical Mcp-Method value is not treated as discovery", async () => {
  const app = mount(defaultAuth());
  // Exact match only: each of these falls through to the call credential,
  // which refuses the service token before the handler ever sees the body.
  for (const value of ["Tools/List", "tools/list, tools/call", "tools/listx", "tools/call"]) {
    const { res } = await send(app, "tools/list", {
      token: SERVICE_TOKEN,
      headers: { "mcp-method": value },
    });
    assert.equal(res.status, 403, value);
  }
});

test("[unhappy] no credential is refused for both discovery and call when discovery is not public", async () => {
  const app = mount(defaultAuth());
  assert.equal((await send(app, "tools/list")).res.status, 401);
  assert.equal(
    (await send(app, "tools/call", { params: { name: "delete_account", arguments: {} } })).res.status,
    401
  );
});

test("[unhappy] discoveryMethods narrows which methods take the discovery credential", async () => {
  const app = mount({ ...defaultAuth(), discoveryMethods: ["tools/list"] });
  assert.equal((await send(app, "tools/list", { token: SERVICE_TOKEN })).res.status, 200);
  assert.equal((await send(app, "resources/list", { token: SERVICE_TOKEN })).res.status, 403);
  assert.equal((await send(app, "resources/list", { token: USER_TOKEN })).res.status, 200);
});

test("[unhappy] methodAuth refuses unsafe configurations at construction", () => {
  const { handler } = createHandler();
  const build = (methodAuth: unknown, extra: Record<string, unknown> = {}, h: McpHandler = handler) =>
    () => mcpRoutes("/mcp", h, { methodAuth: methodAuth as McpMethodAuthOptions, ...extra });

  assert.throws(build(defaultAuth(), { public: true }), /cannot be combined/);
  assert.throws(
    build(defaultAuth(), {}, async () => new Response(null)),
    /requires a handler from createMcpHandler/
  );
  assert.throws(build(null), /must be an object/);
  assert.throws(build({ discovery: serviceAuth() }), /methodAuth\.call must be a Hooks bundle/);
  assert.throws(build({ discovery: serviceAuth(), call: [userAuth()] }), /must be a Hooks bundle/);
  // A plain, unmarked hook is not an authentication hook.
  assert.throws(
    build({ discovery: { preBody: () => undefined }, call: userAuth() }),
    /methodAuth\.discovery must be an authentication hook/
  );
  assert.throws(build({ discovery: "PUBLIC", call: userAuth() }), /must be a Hooks bundle/);
  // Non-gate phases and non-auth middleware would be silently scoped or dropped.
  assert.throws(
    build({ discovery: serviceAuth(), call: markAuthHook({ preBody() {}, onSend: (r) => r }) }),
    /has a "onSend" hook/
  );
  assert.throws(
    build({
      discovery: serviceAuth(),
      call: every(rateLimit({ windowMs: 60_000, max: 5 }), userAuth()),
    }),
    /carries middleware other than authentication/
  );
  // A non-gate phase inherited from a prototype is refused too.
  const inherited = markAuthHook(
    Object.assign(Object.create({ onResponse: () => undefined }), { preBody() {} })
  );
  assert.throws(build({ discovery: serviceAuth(), call: inherited }), /has a "onResponse" hook/);
  assert.throws(
    build({ discovery: serviceAuth(), call: markAuthHook({ preBody: "nope" as never }) }),
    /call\.preBody must be a function/
  );
  assert.throws(build({ discovery: serviceAuth(), call: markAuthHook({}) }), /no preBody or beforeHandle/);
  // tools/call can never be promoted to discovery.
  assert.throws(
    build({ ...defaultAuth(), discoveryMethods: ["tools/call"] }),
    /"tools\/call", which is not a discovery method/
  );
  assert.throws(build({ ...defaultAuth(), discoveryMethods: [] }), /non-empty array/);
});

test("[unhappy] production-only refusals of a methodAuth bundle still fire at registration", () => {
  const productionKey = Symbol.for("daloyjs.hooks.appProduction");
  const strict = markAuthHook({ preBody() {} });
  (strict as Record<PropertyKey, unknown>)[productionKey] = (production: boolean) => {
    if (production) throw new Error("misconfigured for production");
  };
  assert.throws(() => mount({ discovery: strict, call: userAuth() }), /misconfigured for production/);
  assert.throws(() => mount({ discovery: serviceAuth(), call: strict }), /misconfigured for production/);
  // Development: the same bundle registers fine.
  assert.doesNotThrow(() =>
    mount({ discovery: strict, call: userAuth() }, createHandler().handler, { env: "development" })
  );
});

test("[unhappy] without methodAuth, mcpRoutes still refuses to serve unauthenticated MCP in production", async () => {
  const app = new App({ logger: false, env: "production" });
  for (const route of mcpRoutes("/mcp", createHandler().handler)) app.route(route);
  assert.equal((await send(app, "tools/list")).res.status, 500);
});
