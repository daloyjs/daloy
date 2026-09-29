import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  A2A_ERROR_CODES,
  A2aClientError,
  App,
  a2aData,
  a2aRoutes,
  createA2aClient,
  createA2aHandler,
  markAuthHook,
  memoryTaskStore,
  type A2aAgentCardInput,
  type A2aClientOptions,
  type A2aHandlerOptions,
} from "../src/index.js";

// createA2aClient against a real DaloyJS A2A server, wired in-process through
// a recording fetch so each test can assert exactly what went over the wire.

const CARD: A2aAgentCardInput = {
  name: "inventory-agent",
  description: "Answers stock questions.",
  version: "1.0.0",
  url: "https://agent.test/a2a",
  skills: [{ id: "stock", name: "Stock", description: "Units by SKU.", tags: ["inventory"] }],
  securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: "Bearer" } } },
  securityRequirements: [{ schemes: { bearer: { list: [] } } }],
};

type Call = { url: string; method: string; headers: Headers; body: unknown; redirect?: RequestRedirect };

function server(overrides: Partial<A2aHandlerOptions> = {}) {
  const agent = createA2aHandler({
    card: CARD,
    onMessage: (ctx) => {
      if (ctx.text === "task") {
        return { status: "completed", artifacts: [{ name: "stock", parts: [a2aData({ units: 3 })] }] };
      }
      if (ctx.text === "ask") return { status: "input-required", message: "Which SKU?" };
      if (ctx.task) return { status: "completed", artifacts: [{ parts: [a2aData({ sku: ctx.text })] }] };
      return `hi ${(ctx.state.user as { sub?: string } | undefined)?.sub ?? "anon"}: ${ctx.text}`;
    },
    taskStore: memoryTaskStore(),
    taskOwner: ({ state }) => (state.user as { sub?: string } | undefined)?.sub,
    ...overrides,
  });
  const auth = markAuthHook({
    async beforeHandle(ctx) {
      const header = ctx.request.headers.get("authorization");
      if (header !== "Bearer good") return new Response(null, { status: 401 });
      (ctx.state as Record<string, unknown>).user = { sub: "alice" };
      return undefined;
    },
  });
  const app = new App({ logger: false });
  for (const route of a2aRoutes("/a2a", agent, { hooks: auth })) app.route(route);
  return app;
}

function wire(app: { fetch(r: Request): Promise<Response> }, rewrite?: (res: Response, call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input as string, init);
    const text = req.method === "POST" ? await req.clone().text() : "";
    const call: Call = {
      url: req.url,
      method: req.method,
      headers: new Headers(req.headers),
      body: text ? JSON.parse(text) : undefined,
      ...(init?.redirect ? { redirect: init.redirect } : {}),
    };
    calls.push(call);
    const res = await app.fetch(req);
    return rewrite ? rewrite(res, call) : res;
  };
  return { calls, fetchImpl };
}

function client(fetchImpl: typeof fetch, overrides: Partial<A2aClientOptions> = {}) {
  return createA2aClient({
    url: "https://agent.test",
    fetch: fetchImpl,
    headers: { authorization: "Bearer good" },
    ...overrides,
  });
}

describe("A2A client: happy paths", () => {
  test("discovers the card and sends a text message", async () => {
    const { calls, fetchImpl } = wire(server());
    const result = await client(fetchImpl).sendMessage("hello");
    assert.equal(result.message?.role, "ROLE_AGENT");
    assert.deepEqual(result.message?.parts, [{ text: "hi alice: hello" }]);
    assert.equal(calls[0]!.url, "https://agent.test/.well-known/agent-card.json");
    assert.equal(calls[1]!.url, "https://agent.test/a2a");
    const rpc = calls[1]!.body as { method: string; params: { message: { role: string; messageId: string } } };
    assert.equal(rpc.method, "SendMessage");
    assert.equal(rpc.params.message.role, "ROLE_USER");
    assert.ok(rpc.params.message.messageId.length > 0);
    assert.equal(calls[1]!.headers.get("a2a-version"), "1.0");
  });

  test("credentials go to the JSON-RPC call only, never to the public card", async () => {
    const { calls, fetchImpl } = wire(server());
    await client(fetchImpl).sendMessage("x");
    assert.equal(calls[0]!.headers.get("authorization"), null);
    assert.equal(calls[1]!.headers.get("authorization"), "Bearer good");
    assert.ok(calls.every((c) => c.redirect === "error"), "redirects are never followed");
  });

  test("header functions run per request, so short-lived tokens stay fresh", async () => {
    const { calls, fetchImpl } = wire(server());
    let n = 0;
    const c = client(fetchImpl, { headers: () => ({ authorization: "Bearer good", "x-call": String(++n) }) });
    await c.sendMessage("a");
    await c.sendMessage("b");
    const rpc = calls.filter((x) => x.method === "POST");
    assert.deepEqual(rpc.map((x) => x.headers.get("x-call")), ["1", "2"]);
  });

  test("tasks round-trip: send, continue, get, list, cancel", async () => {
    const { fetchImpl } = wire(server());
    const c = client(fetchImpl);
    const first = await c.sendMessage("ask");
    assert.equal(first.task?.status.state, "TASK_STATE_INPUT_REQUIRED");
    const done = await c.sendMessage({ parts: [{ text: "ABC-1" }], taskId: first.task!.id });
    assert.equal(done.task?.status.state, "TASK_STATE_COMPLETED");
    const fetched = await c.getTask(first.task!.id, { historyLength: 1 });
    assert.equal(fetched.history?.length, 1);
    const listed = await c.listTasks({ pageSize: 10 });
    assert.equal(listed.totalSize, 1);
    const pending = await c.sendMessage("ask");
    const canceled = await c.cancelTask(pending.task!.id);
    assert.equal(canceled.status.state, "TASK_STATE_CANCELED");
  });

  test("data parts, configuration, metadata, and extensions reach the agent", async () => {
    const { calls, fetchImpl } = wire(server());
    await client(fetchImpl, { extensions: ["https://ext.example/a/v1", "https://ext.example/b/v1"] }).sendMessage(
      [a2aData({ sku: "ABC-1" })],
      { acceptedOutputModes: ["application/json"], historyLength: 0, metadata: { trace: "t" } }
    );
    const rpc = calls[1]!;
    const params = (rpc.body as { params: Record<string, any> }).params;
    assert.deepEqual(params.message.parts, [{ data: { sku: "ABC-1" }, mediaType: "application/json" }]);
    assert.deepEqual(params.configuration, { acceptedOutputModes: ["application/json"], historyLength: 0 });
    assert.deepEqual(params.metadata, { trace: "t" });
    assert.equal(rpc.headers.get("a2a-extensions"), "https://ext.example/a/v1,https://ext.example/b/v1");
  });

  test("the card is cached for cardMaxAgeMs", async () => {
    const { calls, fetchImpl } = wire(server());
    const c = client(fetchImpl);
    await c.sendMessage("a");
    await c.sendMessage("b");
    assert.equal(calls.filter((x) => x.method === "GET").length, 1);
    const fresh = client(fetchImpl, { cardMaxAgeMs: 0 });
    await fresh.getAgentCard();
    await fresh.getAgentCard();
    assert.equal(calls.filter((x) => x.method === "GET").length, 3);
    assert.equal((await fresh.getAgentCard()).name, "inventory-agent");
  });

  test("a card URL ending in .json is used as-is", async () => {
    const { calls, fetchImpl } = wire(server());
    await createA2aClient({
      url: "https://agent.test/.well-known/agent-card.json",
      fetch: fetchImpl,
      headers: { authorization: "Bearer good" },
    }).sendMessage("x");
    assert.equal(calls[0]!.url, "https://agent.test/.well-known/agent-card.json");
  });
});

describe("A2A client: security refusals", () => {
  test("refuses unsafe agent URLs up front", () => {
    for (const url of ["http://agent.example", "ftp://agent.example", "https://u:p@agent.example", "not a url"]) {
      assert.throws(() => createA2aClient({ url }), A2aClientError, url);
    }
    assert.doesNotThrow(() => createA2aClient({ url: "http://localhost:3000" }));
    assert.doesNotThrow(() => createA2aClient({ url: "http://agent.example", allowInsecureHttp: true }));
    assert.throws(() => createA2aClient({ url: "https://a.example", timeoutMs: 0 }), /timeoutMs/);
    assert.throws(() => createA2aClient({ url: "https://a.example", maxResponseBytes: -1 }), /maxResponseBytes/);
    assert.throws(() => createA2aClient({ url: "https://a.example", cardMaxAgeMs: -1 }), /cardMaxAgeMs/);
    assert.throws(() => createA2aClient({ url: "https://a.example", allowedOrigins: ["http://x.example"] }), /https/);
  });

  test("a card pointing its endpoint at another origin never receives credentials", async () => {
    const evil = server({ card: { ...CARD, url: "https://attacker.example/a2a" } });
    const { calls, fetchImpl } = wire(evil);
    await assert.rejects(client(fetchImpl).sendMessage("secret"), /Refusing to send credentials/);
    assert.equal(calls.length, 1, "only the card was fetched");
    assert.equal(calls.some((c) => c.url.startsWith("https://attacker.example")), false);
  });

  test("allowedOrigins opts a known second origin in", async () => {
    const split = server({ card: { ...CARD, url: "https://rpc.agent.test/a2a" } });
    const { calls, fetchImpl } = wire({ fetch: (r) => split.fetch(new Request(r.url.replace("rpc.agent.test", "agent.test"), r)) });
    const result = await client(fetchImpl, { allowedOrigins: ["https://rpc.agent.test"] }).sendMessage("x");
    assert.ok(result.message);
    assert.equal(calls[1]!.url, "https://rpc.agent.test/a2a");
  });

  test("a card with a plain-http or credential-bearing endpoint is refused", async () => {
    // A hostile (non-DaloyJS) agent: DaloyJS's own server refuses to publish
    // such a card, so rewrite it in transit.
    for (const url of ["http://agent.test/a2a", "https://u:p@agent.test/a2a"]) {
      const { calls, fetchImpl } = wire(server(), async (res, call) => {
        if (call.method !== "GET") return res;
        const body = (await res.json()) as { supportedInterfaces: Array<Record<string, unknown>> };
        body.supportedInterfaces[0]!.url = url;
        return Response.json(body);
      });
      await assert.rejects(client(fetchImpl).sendMessage("x"), A2aClientError, url);
      assert.equal(calls.length, 1, `${url}: nothing sent after the card`);
    }
  });

  test("the default transport is SSRF-guarded", async () => {
    for (const url of ["http://localhost:1/", "http://127.0.0.1:1/", "https://169.254.169.254/"]) {
      const err = await client(undefined as unknown as typeof fetch, { url, fetch: undefined })
        .sendMessage("x")
        .then(
          () => undefined,
          (e: unknown) => e
        );
      assert.ok(err instanceof A2aClientError, url);
      assert.match(String((err.cause as Error | undefined)?.name ?? err.message), /Ssrf/i, url);
    }
  });

  test("oversized, malformed, and mismatched responses are rejected", async () => {
    const cases: Array<[string, (res: Response, call: Call) => Response | Promise<Response>]> = [
      ["too large", async (res, call) =>
        call.method === "POST" ? new Response("x".repeat(2048), { headers: { "content-type": "application/json" } }) : res],
      ["streamed too large", async (res, call) =>
        call.method === "POST"
          ? new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(4096)); c.close(); } }))
          : res],
      ["not json", async (res, call) => (call.method === "POST" ? new Response("<html>") : res)],
      ["not jsonrpc", async (res, call) => (call.method === "POST" ? Response.json({ ok: true }) : res)],
      ["id mismatch", async (res, call) =>
        call.method === "POST" ? Response.json({ jsonrpc: "2.0", id: "other", result: { message: {} } }) : res],
      ["no result", async (res, call) =>
        call.method === "POST" ? Response.json({ jsonrpc: "2.0", id: (call.body as { id: string }).id }) : res],
      ["both task and message", async (res, call) =>
        call.method === "POST"
          ? Response.json({ jsonrpc: "2.0", id: (call.body as { id: string }).id, result: { task: { id: "t", status: {} }, message: {} } })
          : res],
      ["invalid utf8", async (res, call) => (call.method === "POST" ? new Response(new Uint8Array([0x7b, 0xff])) : res)],
    ];
    for (const [label, rewrite] of cases) {
      const { fetchImpl } = wire(server(), rewrite);
      await assert.rejects(client(fetchImpl, { maxResponseBytes: 1024 }).sendMessage("x"), A2aClientError, label);
    }
  });

  test("a bad card is rejected", async () => {
    const cards: unknown[] = [
      "not json {",
      { name: "x" },
      { name: "x", supportedInterfaces: [{ url: "https://agent.test/a2a", protocolBinding: "GRPC", protocolVersion: "1.0" }] },
      { name: "x", supportedInterfaces: [{ url: "https://agent.test/a2a", protocolBinding: "JSONRPC", protocolVersion: "0.3" }] },
    ];
    for (const card of cards) {
      const fetchImpl: typeof fetch = async () =>
        new Response(typeof card === "string" ? card : JSON.stringify(card), { headers: { "content-type": "application/json" } });
      await assert.rejects(client(fetchImpl).getAgentCard(), A2aClientError, JSON.stringify(card));
    }
    const missing: typeof fetch = async () => new Response(null, { status: 404 });
    const err = await client(missing).getAgentCard().catch((e: A2aClientError) => e);
    assert.ok(err instanceof A2aClientError && err.status === 404);
  });

  test("remote JSON-RPC errors surface with their code and data", async () => {
    const { fetchImpl } = wire(server());
    const err = await client(fetchImpl).getTask("missing").catch((e: A2aClientError) => e);
    assert.ok(err instanceof A2aClientError);
    assert.equal(err.code, A2A_ERROR_CODES.taskNotFound);
    assert.ok(Array.isArray(err.data));
    // Unauthenticated calls come back as the server's 401, not a silent success.
    const anon = await client(fetchImpl, { headers: {} }).sendMessage("x").catch((e: A2aClientError) => e);
    assert.ok(anon instanceof A2aClientError && anon.status === 401);
  });

  test("calls time out and honour a caller's abort signal", async () => {
    const hang: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      });
    await assert.rejects(client(hang, { timeoutMs: 20 }).getAgentCard(), /timed out after 20 ms/);
    const controller = new AbortController();
    const pending = client(hang).getAgentCard({ signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, /aborted/);
  });

  test("the tenant declared on the interface is sent on every call", async () => {
    const card = { ...CARD };
    const app = server({ card });
    const { calls, fetchImpl } = wire(app, async (res, call) => {
      if (call.method !== "GET") return res;
      const body = (await res.json()) as { supportedInterfaces: Array<Record<string, unknown>> };
      body.supportedInterfaces[0]!.tenant = "acme";
      return Response.json(body);
    });
    await client(fetchImpl).sendMessage("x");
    assert.equal((calls[1]!.body as { params: { tenant: string } }).params.tenant, "acme");
  });
});

describe("A2A client: trace propagation", () => {
  const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
  const inbound = (headers: Record<string, string>) => new Request("https://me.test/x", { headers });

  test("is off by default", async () => {
    const { calls, fetchImpl } = wire(server());
    await client(fetchImpl).sendMessage("x", { request: inbound({ traceparent }) });
    assert.equal(calls[1]!.headers.get("traceparent"), null);
  });

  test("true forwards a valid traceparent and tracestate, never baggage", async () => {
    const { calls, fetchImpl } = wire(server());
    await client(fetchImpl, { propagateTrace: true }).sendMessage("x", {
      request: inbound({ traceparent, tracestate: "vendor=1", baggage: "userId=42" }),
    });
    assert.equal(calls[1]!.headers.get("traceparent"), traceparent);
    assert.equal(calls[1]!.headers.get("tracestate"), "vendor=1");
    assert.equal(calls[1]!.headers.get("baggage"), null);
  });

  test("malformed or all-zero trace ids are not forwarded", async () => {
    for (const bad of [
      "garbage",
      "00-00000000000000000000000000000000-00f067aa0ba902b7-01",
      "00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01",
      traceparent.toUpperCase(),
    ]) {
      const { calls, fetchImpl } = wire(server());
      await client(fetchImpl, { propagateTrace: true }).sendMessage("x", {
        request: inbound({ traceparent: bad, tracestate: "vendor=1" }),
      });
      assert.equal(calls[1]!.headers.get("traceparent"), null, bad);
      assert.equal(calls[1]!.headers.get("tracestate"), null, bad);
    }
  });

  test("a function hook can inject its own context (e.g. an OTel propagator)", async () => {
    const { calls, fetchImpl } = wire(server());
    let seen: Request | undefined;
    await client(fetchImpl, {
      propagateTrace: (headers, request) => {
        seen = request;
        headers.set("traceparent", traceparent);
      },
    }).sendMessage("x", { request: inbound({}) });
    assert.equal(calls[1]!.headers.get("traceparent"), traceparent);
    assert.ok(seen instanceof Request);
  });
});
