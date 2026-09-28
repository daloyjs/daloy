import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  A2A_AGENT_CARD_PATH,
  A2A_ERROR_CODES,
  A2A_PROTOCOL_VERSION,
  A2aError,
  App,
  a2aData,
  a2aRoutes,
  a2aText,
  bearerAuth,
  createA2aHandler,
  markAuthHook,
  memoryTaskStore,
  type A2aAgentCardInput,
  type A2aHandler,
  type A2aHandlerOptions,
  type A2aMessageContext,
  type A2aTask,
} from "../src/index.js";

const ENDPOINT = "http://agent.test/a2a";

const BASE_CARD: A2aAgentCardInput = {
  name: "inventory-agent",
  description: "Answers stock questions for Acme products.",
  version: "1.2.0",
  url: "https://agent.example/a2a",
  provider: { organization: "Acme", url: "https://acme.example" },
  skills: [
    {
      id: "stock",
      name: "Stock lookup",
      description: "Units on hand by SKU.",
      tags: ["inventory"],
      examples: ['{"sku":"ABC-1"}'],
    },
  ],
  securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: "Bearer" } } },
  securityRequirements: [{ schemes: { bearer: { list: [] } } }],
};

interface Rpc {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

function agent(overrides: Partial<A2aHandlerOptions> = {}): A2aHandler {
  return createA2aHandler({
    card: BASE_CARD,
    onMessage: ({ text }) => `echo: ${text}`,
    ...overrides,
  });
}

function userMessage(parts: unknown[] = [{ text: "hello" }], extra: Record<string, unknown> = {}) {
  return { messageId: "m-1", role: "ROLE_USER", parts, ...extra };
}

async function call(
  handler: A2aHandler,
  method: string,
  params: unknown,
  opts: { headers?: Record<string, string>; state?: Record<string, unknown>; id?: unknown } = {}
): Promise<{ status: number; body: Rpc }> {
  const res = await handler.handleRpc(
    new Request(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "a2a-version": "1.0", ...(opts.headers ?? {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: "id" in opts ? opts.id : 1, method, params }),
    }),
    opts.state ? { state: opts.state } : undefined
  );
  return { status: res.status, body: (await res.json()) as Rpc };
}

function send(handler: A2aHandler, message: unknown, opts: Parameters<typeof call>[3] = {}, rest = {}) {
  return call(handler, "SendMessage", { message, ...rest }, opts);
}

// ---------------------------------------------------------------------------
// Agent Card
// ---------------------------------------------------------------------------

describe("A2A Agent Card", () => {
  test("serves an A2A 1.0 card with derived interface and capabilities", async () => {
    const res = await agent().handleCard(new Request(`http://agent.test${A2A_AGENT_CARD_PATH}`));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control")!, /^public, max-age=300$/);
    assert.match(res.headers.get("etag")!, /^"[0-9a-f]{32}"$/);
    const card = await res.json();
    assert.deepEqual(card.supportedInterfaces, [
      { url: "https://agent.example/a2a", protocolBinding: "JSONRPC", protocolVersion: "1.0" },
    ]);
    assert.deepEqual(card.capabilities, {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
    });
    // 1.0 moved protocolVersion onto each interface; there is no top-level field.
    assert.equal("protocolVersion" in card, false);
    assert.deepEqual(card.defaultInputModes, ["text/plain", "application/json"]);
    assert.equal(card.skills[0].id, "stock");
    assert.deepEqual(card.securityRequirements, [{ schemes: { bearer: { list: [] } } }]);
  });

  test("honors If-None-Match with 304, supports HEAD, and rejects other methods", async () => {
    const handler = agent({ cardMaxAgeSeconds: 60 });
    const first = await handler.handleCard(new Request("http://agent.test/card"));
    const etag = first.headers.get("etag")!;
    const cached = await handler.handleCard(
      new Request("http://agent.test/card", { headers: { "if-none-match": `W/${etag}, "other"` } })
    );
    assert.equal(cached.status, 304);
    assert.equal(cached.headers.get("cache-control"), "public, max-age=60");
    const star = await handler.handleCard(
      new Request("http://agent.test/card", { headers: { "if-none-match": "*" } })
    );
    assert.equal(star.status, 304);
    const stale = await handler.handleCard(
      new Request("http://agent.test/card", { headers: { "if-none-match": '"nope"' } })
    );
    assert.equal(stale.status, 200);
    const head = await handler.handleCard(new Request("http://agent.test/card", { method: "HEAD" }));
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    const post = await handler.handleCard(new Request("http://agent.test/card", { method: "POST" }));
    assert.equal(post.status, 405);
  });

  test("the card object is frozen and copies caller input", () => {
    const skills = [{ ...BASE_CARD.skills[0]!, tags: ["inventory"] }];
    const handler = agent({ card: { ...BASE_CARD, skills } });
    skills[0]!.tags.push("mutated");
    assert.deepEqual(handler.agentCard.skills[0]!.tags, ["inventory"]);
    assert.throws(() => {
      (handler.agentCard as any).name = "x";
    });
  });

  test("declares optional fields and extensions only when provided", () => {
    const handler = agent({
      card: {
        ...BASE_CARD,
        documentationUrl: "https://docs.acme.example",
        iconUrl: "https://acme.example/icon.png",
        defaultOutputModes: ["application/json"],
        extensions: [{ uri: "https://ext.example/geo/v1", description: "geo" }],
      },
    });
    assert.equal(handler.agentCard.documentationUrl, "https://docs.acme.example");
    assert.equal(handler.agentCard.iconUrl, "https://acme.example/icon.png");
    assert.deepEqual(handler.agentCard.defaultOutputModes, ["application/json"]);
    assert.equal(handler.agentCard.capabilities.extensions?.[0]?.uri, "https://ext.example/geo/v1");
  });

  test("rejects invalid cards at construction", () => {
    const bad: Array<[Partial<A2aAgentCardInput>, RegExp]> = [
      [{ name: " " }, /name is required/],
      [{ description: "" }, /description is required/],
      [{ version: "" }, /version is required/],
      [{ url: "" }, /url is required/],
      [{ url: "/a2a" }, /absolute URL/],
      [{ url: "ftp://agent.example/a2a" }, /http: or https:/],
      [{ url: "https://user:pw@agent.example/a2a" }, /credentials/],
      [{ documentationUrl: "javascript:alert(1)" }, /http: or https:/],
      [{ provider: { organization: "", url: "https://acme.example" } }, /organization/],
      [{ skills: [] }, /at least one skill/],
      [{ skills: [BASE_CARD.skills[0]!, BASE_CARD.skills[0]!] }, /not unique/],
      [{ skills: [{ ...BASE_CARD.skills[0]!, id: "" }] }, /skill id is required/],
      [{ skills: [{ ...BASE_CARD.skills[0]!, name: "" }] }, /needs a name/],
      [{ skills: [{ ...BASE_CARD.skills[0]!, description: "" }] }, /needs a description/],
      [{ skills: [{ ...BASE_CARD.skills[0]!, tags: [] }] }, /at least one tag/],
      [
        { securitySchemes: { two: { mtlsSecurityScheme: {}, httpAuthSecurityScheme: { scheme: "Bearer" } } } },
        /exactly one scheme member/,
      ],
      [{ securityRequirements: [{ schemes: { ghost: { list: [] } } }] }, /undeclared scheme "ghost"/],
      [
        { skills: [{ ...BASE_CARD.skills[0]!, securityRequirements: [{ schemes: { ghost: { list: [] } } }] }] },
        /undeclared scheme/,
      ],
      [{ extensions: [{ uri: "" }] }, /extension uri/],
    ];
    for (const [patch, pattern] of bad) {
      assert.throws(() => agent({ card: { ...BASE_CARD, ...patch } }), pattern, JSON.stringify(patch));
    }
  });

  test("rejects invalid handler options", () => {
    assert.throws(() => createA2aHandler({ card: BASE_CARD } as any), /onMessage/);
    assert.throws(() => agent({ maxBodyBytes: 0 }), /maxBodyBytes/);
    assert.throws(() => agent({ maxHistory: -1 }), /maxHistory/);
    assert.throws(() => agent({ cardMaxAgeSeconds: 1.5 }), /cardMaxAgeSeconds/);
    assert.throws(() => agent({ allowedOrigins: ["https://app.example/path"] }), /A2A allowedOrigins/);
    assert.throws(() => agent({ taskStore: memoryTaskStore() }), /requires taskOwner/);
  });
});

// ---------------------------------------------------------------------------
// SendMessage
// ---------------------------------------------------------------------------

describe("A2A SendMessage", () => {
  test("a string reply becomes a direct agent Message with a generated contextId", async () => {
    const { status, body } = await send(agent(), userMessage([{ text: "hi" }, { text: "there" }]));
    assert.equal(status, 200);
    const message = body.result.message;
    assert.equal(message.role, "ROLE_AGENT");
    assert.deepEqual(message.parts, [{ text: "echo: hi\nthere" }]);
    assert.equal(typeof message.contextId, "string");
    assert.equal(typeof message.messageId, "string");
    assert.equal("taskId" in message, false);
    assert.equal("task" in body.result, false);
  });

  test("a { reply } result keeps parts and metadata and preserves a client contextId", async () => {
    const handler = agent({
      onMessage: () => ({ reply: [a2aText("**ok**", "text/markdown"), a2aData({ n: 1 })], metadata: { a: 1 } }),
    });
    const { body } = await send(handler, userMessage(undefined, { contextId: "ctx-9" }));
    assert.deepEqual(body.result.message.parts, [
      { text: "**ok**", mediaType: "text/markdown" },
      { data: { n: 1 }, mediaType: "application/json" },
    ]);
    assert.deepEqual(body.result.message.metadata, { a: 1 });
    assert.equal(body.result.message.contextId, "ctx-9");
  });

  test("a { status } result becomes a Task with artifacts and history", async () => {
    const handler = agent({
      onMessage: () => ({
        status: "completed",
        message: "Done.",
        artifacts: [
          { name: "stock", description: "units", parts: [a2aData({ units: 12 })], metadata: { src: "db" } },
          { artifactId: "fixed", parts: [a2aText("plain")] },
        ],
        metadata: { run: 1 },
      }),
    });
    const { body } = await send(handler, userMessage());
    const task: A2aTask = body.result.task;
    assert.equal(task.status.state, "TASK_STATE_COMPLETED");
    assert.equal(task.status.message?.role, "ROLE_AGENT");
    assert.equal(task.status.message?.taskId, task.id);
    assert.match(task.status.timestamp!, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    assert.equal(task.artifacts?.length, 2);
    assert.equal(task.artifacts?.[0]?.name, "stock");
    assert.equal(typeof task.artifacts?.[0]?.artifactId, "string");
    assert.equal(task.artifacts?.[1]?.artifactId, "fixed");
    assert.deepEqual(task.metadata, { run: 1 });
    assert.equal(task.history?.length, 2);
    assert.equal(task.history?.[0]?.taskId, task.id);
    assert.equal(task.history?.[0]?.contextId, task.contextId);
  });

  test("historyLength and maxHistory bound the returned history", async () => {
    const handler = agent({ onMessage: () => ({ status: "rejected", message: "no" }) });
    const none = await send(handler, userMessage(), {}, { configuration: { historyLength: 0 } });
    assert.equal("history" in none.body.result.task, false);
    const one = await send(handler, userMessage(), {}, { configuration: { historyLength: 1 } });
    assert.equal(one.body.result.task.history.length, 1);
    assert.equal(one.body.result.task.history[0].role, "ROLE_AGENT");
    const zero = agent({ maxHistory: 0, onMessage: () => ({ status: "failed" }) });
    const r = await send(zero, userMessage());
    assert.equal(r.body.result.task.status.state, "TASK_STATE_FAILED");
    assert.equal("history" in r.body.result.task, false);
    const bad = await send(handler, userMessage(), {}, { configuration: { historyLength: -1 } });
    assert.equal(bad.body.error?.code, A2A_ERROR_CODES.invalidParams);
  });

  test("the handler context carries message, state, metadata, output modes, and signal", async () => {
    let seen: A2aMessageContext | undefined;
    const handler = agent({
      onMessage: (ctx) => {
        seen = ctx;
        return "ok";
      },
    });
    await send(
      handler,
      userMessage([{ text: "a" }, { data: { sku: "X" } }]),
      { state: { user: { sub: "u1" } } },
      { configuration: { acceptedOutputModes: ["application/json"] }, metadata: { trace: "t" } }
    );
    assert.ok(seen);
    assert.equal(seen.text, "a");
    assert.deepEqual(seen.state, { user: { sub: "u1" } });
    assert.deepEqual(seen.acceptedOutputModes, ["application/json"]);
    assert.deepEqual(seen.metadata, { trace: "t" });
    assert.deepEqual(seen.extensions, []);
    assert.ok(seen.signal instanceof AbortSignal);
    assert.equal(seen.task, undefined);
    assert.equal(seen.owner, undefined);
  });

  test("rejects malformed messages with -32602 and google.rpc.BadRequest details", async () => {
    const cases: Array<[unknown, string]> = [
      [undefined, "message"],
      [{ ...userMessage(), messageId: "" }, "message.messageId"],
      [{ ...userMessage(), role: "ROLE_AGENT" }, "message.role"],
      [{ ...userMessage(), contextId: 5 }, "message.contextId"],
      [userMessage([]), "message.parts"],
      [userMessage(Array.from({ length: 65 }, () => ({ text: "x" }))), "message.parts"],
      [userMessage(["text"]), "message.parts[0]"],
      // A 0.3-style part: `kind` is not a 1.0 member, so it carries no content.
      [userMessage([{ kind: "text", text: undefined }]), "message.parts[0]"],
      [userMessage([{ text: "a", data: 1 }]), "message.parts[0]"],
      [userMessage([{ text: 1 }]), "message.parts[0].text"],
      [userMessage([{ raw: "not base64!" }]), "message.parts[0].raw"],
      [userMessage([{ url: "file:///etc/passwd" }]), "message.parts[0].url"],
      [userMessage([{ url: "https://u:p@evil.example/x" }]), "message.parts[0].url"],
      [userMessage([{ url: "not a url" }]), "message.parts[0].url"],
      [userMessage([{ text: "a", mediaType: 1 }]), "message.parts[0].mediaType"],
      [userMessage([{ text: "a", filename: 1 }]), "message.parts[0].filename"],
      [userMessage([{ text: "a", metadata: [] }]), "message.parts[0].metadata"],
      [{ ...userMessage(), metadata: "x" }, "message.metadata"],
      [{ ...userMessage(), referenceTaskIds: [1] }, "message.referenceTaskIds"],
    ];
    for (const [message, field] of cases) {
      const { status, body } = await send(agent(), message);
      assert.equal(status, 200);
      assert.equal(body.error?.code, A2A_ERROR_CODES.invalidParams, field);
      const violations = body.error?.data?.[0]?.fieldViolations as Array<{ field: string }>;
      assert.equal(body.error?.data?.[0]?.["@type"], "type.googleapis.com/google.rpc.BadRequest");
      assert.ok(violations.some((v) => v.field === field), `${field}: ${JSON.stringify(violations)}`);
    }
    const badConfig = await call(agent(), "SendMessage", { message: userMessage(), configuration: [] });
    assert.equal(badConfig.body.error?.code, A2A_ERROR_CODES.invalidParams);
    const badMeta = await call(agent(), "SendMessage", { message: userMessage(), metadata: 1 });
    assert.equal(badMeta.body.error?.code, A2A_ERROR_CODES.invalidParams);
    const badModes = await call(agent(), "SendMessage", {
      message: userMessage(),
      configuration: { acceptedOutputModes: "json" },
    });
    assert.equal(badModes.body.error?.code, A2A_ERROR_CODES.invalidParams);
  });

  test("accepts ProtoJSON enum integers and empty-string defaults on messages", async () => {
    let seen: A2aMessageContext | undefined;
    const handler = agent({
      onMessage: (ctx) => {
        seen = ctx;
        return "ok";
      },
    });
    const { body } = await send(handler, { ...userMessage(), role: 1, contextId: "", taskId: "" });
    assert.equal(body.error, undefined);
    assert.equal(seen?.message.role, "ROLE_USER");
    assert.equal(seen?.task, undefined);
    assert.notEqual(seen?.contextId, "");
    const agentRole = await send(handler, { ...userMessage(), role: 2 });
    assert.equal(agentRole.body.error?.code, A2A_ERROR_CODES.invalidParams);
  });

  test("accepts raw base64 and http(s) file parts without fetching them", async () => {
    let parts: unknown;
    const handler = agent({
      card: { ...BASE_CARD, defaultInputModes: ["text/plain", "application/pdf"] },
      onMessage: (ctx) => {
        parts = ctx.message.parts;
        return "ok";
      },
    });
    const { body } = await send(
      handler,
      userMessage([
        { raw: "aGVsbG8=", mediaType: "application/pdf", filename: "a.pdf" },
        { url: "https://files.example/a.pdf", mediaType: "application/pdf; name=a" },
      ])
    );
    assert.equal(body.result.message.role, "ROLE_AGENT");
    assert.equal((parts as unknown[]).length, 2);
  });

  test("refuses media types outside the declared input modes with -32005", async () => {
    const { body } = await send(agent(), userMessage([{ raw: "AA==", mediaType: "image/png" }]));
    assert.equal(body.error?.code, A2A_ERROR_CODES.contentTypeNotSupported);
    assert.equal(body.error?.data?.[0]?.reason, "CONTENT_TYPE_NOT_SUPPORTED");
    // Per-skill input modes widen the accepted set.
    const skillModes = agent({
      card: { ...BASE_CARD, skills: [{ ...BASE_CARD.skills[0]!, inputModes: ["image/png"] }] },
    });
    assert.equal((await send(skillModes, userMessage([{ raw: "AA==", mediaType: "image/png" }]))).body.error, undefined);
    const any = agent({ card: { ...BASE_CARD, defaultInputModes: ["*/*"] } });
    assert.equal((await send(any, userMessage([{ raw: "AA==", mediaType: "image/png" }]))).body.error, undefined);
  });

  test("push notification config in SendMessage is refused with -32003", async () => {
    const { body } = await send(agent(), userMessage(), {}, {
      configuration: { taskPushNotificationConfig: { url: "https://hook.example" } },
    });
    assert.equal(body.error?.code, A2A_ERROR_CODES.pushNotificationNotSupported);
  });

  test("required extensions must be activated through A2A-Extensions", async () => {
    let extensions: readonly string[] = [];
    const handler = agent({
      card: {
        ...BASE_CARD,
        extensions: [
          { uri: "https://ext.example/required/v1", required: true },
          { uri: "https://ext.example/optional/v1" },
        ],
      },
      onMessage: (ctx) => {
        extensions = ctx.extensions;
        return "ok";
      },
    });
    const missing = await send(handler, userMessage());
    assert.equal(missing.body.error?.code, A2A_ERROR_CODES.extensionSupportRequired);
    const ok = await send(handler, userMessage(), {
      headers: { "a2a-extensions": " https://ext.example/required/v1 , ,https://ext.example/optional/v1" },
    });
    assert.equal(ok.body.error, undefined);
    assert.deepEqual(extensions, ["https://ext.example/required/v1", "https://ext.example/optional/v1"]);
  });

  test("A2aError from the handler becomes a caller-visible JSON-RPC error", async () => {
    const handler = agent({
      onMessage: () => {
        throw new A2aError(A2A_ERROR_CODES.invalidParams, "Missing SKU");
      },
    });
    const { body } = await send(handler, userMessage());
    assert.deepEqual(body.error, { code: -32602, message: "Missing SKU" });
    const custom = agent({
      onMessage: () => {
        throw new A2aError(A2A_ERROR_CODES.contentTypeNotSupported, "PDF only");
      },
    });
    const r = await send(custom, userMessage());
    assert.equal(r.body.error?.code, -32005);
    assert.equal(r.body.error?.data?.[0]?.reason, "CONTENT_TYPE_NOT_SUPPORTED");
    assert.throws(() => new A2aError(-32603, "x"), /A2aError code/);
    assert.throws(() => new A2aError(-32000, "x"), /A2aError code/);
    assert.equal(new A2aError(-32099, "edge").code, -32099);
  });

  test("unexpected throws are redacted unless exposeInternalErrors is set", async () => {
    const boom = () => {
      throw new Error("db password is hunter2");
    };
    const hidden = await send(agent({ onMessage: boom, exposeInternalErrors: false }), userMessage());
    assert.equal(hidden.status, 500);
    assert.deepEqual(hidden.body.error, { code: -32603, message: "Internal error" });
    const shown = await send(agent({ onMessage: boom, exposeInternalErrors: true }), userMessage());
    assert.equal(shown.body.error?.data?.detail, "db password is hunter2");
    const nonError = await send(
      agent({
        onMessage: () => {
          throw "plain";
        },
        exposeInternalErrors: true,
      }),
      userMessage()
    );
    assert.equal(nonError.body.error?.data?.detail, "plain");
  });

  test("invalid handler results surface as internal errors", async () => {
    const results: unknown[] = [
      42,
      { status: "canceled" },
      { status: "working" },
      { reply: [] },
      { reply: [{ text: "a", data: 1 }] },
      { status: "completed", artifacts: [{ parts: [] }] },
      // Interrupted states need a task store, or the client could never continue.
      { status: "input-required", message: "Which SKU?" },
    ];
    for (const result of results) {
      const { status, body } = await send(
        agent({ onMessage: () => result as never, exposeInternalErrors: true }),
        userMessage()
      );
      assert.equal(status, 500, JSON.stringify(result));
      assert.equal(body.error?.code, A2A_ERROR_CODES.internalError);
    }
  });
});

// ---------------------------------------------------------------------------
// Transport, envelope, versioning, unsupported methods
// ---------------------------------------------------------------------------

describe("A2A JSON-RPC transport", () => {
  async function raw(
    handler: A2aHandler,
    init: RequestInit & { headers?: Record<string, string> }
  ): Promise<Response> {
    return handler.handleRpc(
      new Request(ENDPOINT, {
        ...init,
        headers: { "content-type": "application/json", "a2a-version": "1.0", ...(init.headers ?? {}) },
      })
    );
  }

  test("GET returns a 405 hint and OPTIONS a 204", async () => {
    const get = await agent({ headers: { "x-agent": "inv" } }).handleRpc(new Request(ENDPOINT));
    assert.equal(get.status, 405);
    assert.equal(get.headers.get("allow"), "POST, OPTIONS");
    assert.equal(get.headers.get("x-agent"), "inv");
    assert.equal((await get.json()).agentCard, A2A_AGENT_CARD_PATH);
    const options = await agent().handleRpc(new Request(ENDPOINT, { method: "OPTIONS" }));
    assert.equal(options.status, 204);
  });

  test("rejects foreign browser origins and allows listed or loopback ones", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "SendMessage", params: { message: userMessage() } });
    const evil = await raw(agent(), { method: "POST", body, headers: { origin: "https://evil.example" } });
    assert.equal(evil.status, 403);
    const nullOrigin = await raw(agent(), { method: "POST", body, headers: { origin: "null" } });
    assert.equal(nullOrigin.status, 403);
    const garbage = await raw(agent(), { method: "POST", body, headers: { origin: "::::" } });
    assert.equal(garbage.status, 403);
    const listed = await raw(agent({ allowedOrigins: ["https://partner.example", "null"] }), {
      method: "POST",
      body,
      headers: { origin: "https://PARTNER.example" },
    });
    assert.equal(listed.status, 200);
    const local = await raw(agent(), { method: "POST", body, headers: { origin: "http://app.localhost:3000" } });
    assert.equal(local.status, 200);
  });

  test("enforces content type, body size, UTF-8, and JSON", async () => {
    const text = await raw(agent(), { method: "POST", body: "{}", headers: { "content-type": "text/plain" } });
    assert.equal(text.status, 415);
    const smuggled = await raw(agent(), {
      method: "POST",
      body: "{}",
      headers: { "content-type": "text/plain; charset=application/json" },
    });
    assert.equal(smuggled.status, 415);
    const a2aJson = await raw(agent(), {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "SendMessage", params: { message: userMessage() } }),
      headers: { "content-type": "application/a2a+json" },
    });
    assert.equal(a2aJson.status, 200);
    const big = await raw(agent({ maxBodyBytes: 64 }), { method: "POST", body: "x".repeat(65) });
    assert.equal(big.status, 413);
    const declared = await raw(agent({ maxBodyBytes: 64 }), {
      method: "POST",
      body: "{}",
      headers: { "content-length": "1000000" },
    });
    assert.equal(declared.status, 413);
    const badUtf8 = await agent().handleRpc(
      new Request(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: new Uint8Array([0x7b, 0xff, 0x7d]),
      })
    );
    assert.equal(badUtf8.status, 400);
    assert.equal(((await badUtf8.json()) as Rpc).error?.code, A2A_ERROR_CODES.parseError);
    const badJson = await raw(agent(), { method: "POST", body: "{nope" });
    assert.equal(((await badJson.json()) as Rpc).error?.code, A2A_ERROR_CODES.parseError);
  });

  test("rejects batches, bad envelopes, missing ids, and non-object params", async () => {
    const expectations: Array<[string, number, number]> = [
      ["[]", 400, A2A_ERROR_CODES.invalidRequest],
      ["1", 400, A2A_ERROR_CODES.invalidRequest],
      [JSON.stringify({ jsonrpc: "1.0", id: 1, method: "SendMessage" }), 400, A2A_ERROR_CODES.invalidRequest],
      [JSON.stringify({ jsonrpc: "2.0", method: "SendMessage" }), 400, A2A_ERROR_CODES.invalidRequest],
      [JSON.stringify({ jsonrpc: "2.0", id: {}, method: "SendMessage" }), 400, A2A_ERROR_CODES.invalidRequest],
      [JSON.stringify({ jsonrpc: "2.0", id: 1, method: 5 }), 400, A2A_ERROR_CODES.invalidRequest],
      [JSON.stringify({ jsonrpc: "2.0", id: 1, method: "SendMessage", params: [] }), 200, A2A_ERROR_CODES.invalidParams],
    ];
    for (const [body, status, code] of expectations) {
      const res = await raw(agent(), { method: "POST", body });
      assert.equal(res.status, status, body);
      assert.equal(((await res.json()) as Rpc).error?.code, code, body);
    }
    const nullId = await call(agent(), "SendMessage", { message: userMessage() }, { id: null });
    assert.equal(nullId.body.id, null);
    assert.equal(nullId.body.result.message.role, "ROLE_AGENT");
  });

  test("strips prototype-pollution keys from the envelope", async () => {
    let metadata: unknown;
    const handler = agent({
      onMessage: (ctx) => {
        metadata = ctx.message.metadata;
        return "ok";
      },
    });
    const res = await raw(handler, {
      method: "POST",
      body: `{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{"message":{"messageId":"m","role":"ROLE_USER","parts":[{"text":"a"}],"metadata":{"__proto__":{"polluted":true},"ok":1}}}}`,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(metadata, { ok: 1 });
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });

  test("negotiates A2A-Version: empty means 0.3 and is refused with -32009", async () => {
    const versions: Array<[string | undefined, boolean]> = [
      [undefined, false],
      ["", false],
      ["0.3", false],
      ["2.0", false],
      ["banana", false],
      ["1.0", true],
      ["1.0.3", true],
      [" 1.0 ", true],
    ];
    for (const [version, ok] of versions) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (version !== undefined) headers["a2a-version"] = version;
      const res = await agent().handleRpc(
        new Request(ENDPOINT, {
          method: "POST",
          headers,
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "SendMessage", params: { message: userMessage() } }),
        })
      );
      const body = (await res.json()) as Rpc;
      assert.equal(res.status, 200);
      if (ok) {
        assert.equal(body.error, undefined, String(version));
      } else {
        assert.equal(body.error?.code, A2A_ERROR_CODES.versionNotSupported, String(version));
        assert.equal(body.error?.data?.[0]?.metadata?.supportedVersions, A2A_PROTOCOL_VERSION);
      }
    }
  });

  test("answers unsupported and unknown methods with the spec's codes", async () => {
    const expected: Array<[string, number]> = [
      ["SendStreamingMessage", A2A_ERROR_CODES.unsupportedOperation],
      ["SubscribeToTask", A2A_ERROR_CODES.unsupportedOperation],
      ["GetExtendedAgentCard", A2A_ERROR_CODES.unsupportedOperation],
      ["CreateTaskPushNotificationConfig", A2A_ERROR_CODES.pushNotificationNotSupported],
      ["GetTaskPushNotificationConfig", A2A_ERROR_CODES.pushNotificationNotSupported],
      ["ListTaskPushNotificationConfigs", A2A_ERROR_CODES.pushNotificationNotSupported],
      ["DeleteTaskPushNotificationConfig", A2A_ERROR_CODES.pushNotificationNotSupported],
      // 0.3 method names are not 1.0 methods.
      ["message/send", A2A_ERROR_CODES.methodNotFound],
      ["tasks/get", A2A_ERROR_CODES.methodNotFound],
    ];
    for (const [method, code] of expected) {
      const { status, body } = await call(agent(), method, {});
      assert.equal(status, 200);
      assert.equal(body.error?.code, code, method);
    }
  });
});

// ---------------------------------------------------------------------------
// Stateless task methods
// ---------------------------------------------------------------------------

describe("A2A without a task store", () => {
  test("task lookups fail as not found and ListTasks is unsupported", async () => {
    assert.equal((await call(agent(), "GetTask", { id: "t" })).body.error?.code, A2A_ERROR_CODES.taskNotFound);
    assert.equal((await call(agent(), "CancelTask", { id: "t" })).body.error?.code, A2A_ERROR_CODES.taskNotFound);
    assert.equal((await call(agent(), "ListTasks", {})).body.error?.code, A2A_ERROR_CODES.unsupportedOperation);
    const cont = await send(agent(), userMessage(undefined, { taskId: "t" }));
    assert.equal(cont.body.error?.code, A2A_ERROR_CODES.taskNotFound);
    assert.equal(cont.body.error?.data?.[0]?.metadata?.taskId, "t");
    const noId = await call(agent(), "GetTask", {});
    assert.equal(noId.body.error?.code, A2A_ERROR_CODES.invalidParams);
    const badHistory = await call(agent(), "GetTask", { id: "t", historyLength: "3" });
    assert.equal(badHistory.body.error?.code, A2A_ERROR_CODES.invalidParams);
  });
});

// ---------------------------------------------------------------------------
// Task store: multi-turn, ownership, cancel, list
// ---------------------------------------------------------------------------

describe("A2A with a task store", () => {
  const owner = ({ state }: { state: Record<string, unknown> }) =>
    (state.user as { sub?: string } | undefined)?.sub;

  function stateful(overrides: Partial<A2aHandlerOptions> = {}) {
    return agent({
      taskStore: memoryTaskStore(),
      taskOwner: owner,
      onMessage: (ctx) => {
        if (!ctx.task) return { status: "input-required", message: "Which SKU?" };
        return {
          status: "completed",
          artifacts: [{ name: "stock", parts: [a2aData({ sku: ctx.text, units: 3 })] }],
        };
      },
      ...overrides,
    });
  }
  const alice = { state: { user: { sub: "alice" } } };
  const bob = { state: { user: { sub: "bob" } } };

  test("an input-required task can be continued to completion", async () => {
    const handler = stateful();
    const first = (await send(handler, userMessage([{ text: "stock please" }]), alice)).body.result.task;
    assert.equal(first.status.state, "TASK_STATE_INPUT_REQUIRED");
    const second = (
      await send(handler, userMessage([{ text: "ABC-1" }], { messageId: "m-2", taskId: first.id }), alice)
    ).body.result.task;
    assert.equal(second.id, first.id);
    assert.equal(second.contextId, first.contextId);
    assert.equal(second.status.state, "TASK_STATE_COMPLETED");
    assert.deepEqual(second.artifacts[0].parts[0].data, { sku: "ABC-1", units: 3 });
    assert.equal(second.history.length, 3);
    const fetched = (await call(handler, "GetTask", { id: first.id, historyLength: 1 }, alice)).body.result;
    assert.equal(fetched.status.state, "TASK_STATE_COMPLETED");
    assert.equal(fetched.history.length, 1);
  });

  test("the handler sees the owner and a copy of the existing task", async () => {
    let seen: A2aMessageContext | undefined;
    const handler = stateful({
      onMessage: (ctx) => {
        seen = ctx;
        if (ctx.task) ctx.task.status.state = "TASK_STATE_COMPLETED";
        return { status: "input-required", message: "more" };
      },
    });
    const t = (await send(handler, userMessage(), alice)).body.result.task;
    await send(handler, userMessage(undefined, { taskId: t.id }), alice);
    assert.equal(seen?.owner, "alice");
    assert.equal(seen?.task?.id, t.id);
    // Mutating ctx.task did not leak into the stored task.
    const stored = (await call(handler, "GetTask", { id: t.id }, alice)).body.result;
    assert.equal(stored.status.state, "TASK_STATE_INPUT_REQUIRED");
  });

  test("tasks are scoped to their owner (no IDOR)", async () => {
    const handler = stateful();
    const t = (await send(handler, userMessage(), alice)).body.result.task;
    assert.equal((await call(handler, "GetTask", { id: t.id }, bob)).body.error?.code, A2A_ERROR_CODES.taskNotFound);
    assert.equal((await call(handler, "CancelTask", { id: t.id }, bob)).body.error?.code, A2A_ERROR_CODES.taskNotFound);
    const hijack = await send(handler, userMessage(undefined, { taskId: t.id }), bob);
    assert.equal(hijack.body.error?.code, A2A_ERROR_CODES.taskNotFound);
    const listed = (await call(handler, "ListTasks", {}, bob)).body.result;
    assert.equal(listed.totalSize, 0);
  });

  test("an unresolved owner fails closed with 401 before touching the store", async () => {
    let called = false;
    const handler = stateful({
      onMessage: () => {
        called = true;
        return "x";
      },
    });
    for (const state of [{}, { user: { sub: "" } }]) {
      const res = await send(handler, userMessage(), { state });
      assert.equal(res.status, 401);
      assert.equal(res.body.error?.code, A2A_ERROR_CODES.invalidRequest);
    }
    assert.equal(called, false);
    assert.equal((await call(handler, "GetTask", { id: "x" })).status, 401);
    assert.equal((await call(handler, "ListTasks", {})).status, 401);
  });

  test("continuing requires a live, matching task", async () => {
    const handler = stateful();
    const t = (await send(handler, userMessage(), alice)).body.result.task;
    const mismatch = await send(handler, userMessage(undefined, { taskId: t.id, contextId: "other" }), alice);
    assert.equal(mismatch.body.error?.code, A2A_ERROR_CODES.invalidParams);
    await send(handler, userMessage([{ text: "SKU" }], { taskId: t.id }), alice);
    const afterDone = await send(handler, userMessage(undefined, { taskId: t.id }), alice);
    assert.equal(afterDone.body.error?.code, A2A_ERROR_CODES.unsupportedOperation);
    const unknown = await send(handler, userMessage(undefined, { taskId: "nope" }), alice);
    assert.equal(unknown.body.error?.code, A2A_ERROR_CODES.taskNotFound);
  });

  test("a direct reply while continuing a task is an internal error", async () => {
    const handler = stateful({
      exposeInternalErrors: true,
      onMessage: (ctx) => (ctx.task ? "plain reply" : { status: "auth-required", message: "log in" }),
    });
    const t = (await send(handler, userMessage(), alice)).body.result.task;
    assert.equal(t.status.state, "TASK_STATE_AUTH_REQUIRED");
    const res = await send(handler, userMessage(undefined, { taskId: t.id }), alice);
    assert.equal(res.status, 500);
    assert.match(res.body.error?.data?.detail, /task result/);
  });

  test("CancelTask cancels an interrupted task once", async () => {
    const handler = stateful();
    const t = (await send(handler, userMessage(), alice)).body.result.task;
    const canceled = (await call(handler, "CancelTask", { id: t.id }, alice)).body.result;
    assert.equal(canceled.status.state, "TASK_STATE_CANCELED");
    const again = await call(handler, "CancelTask", { id: t.id }, alice);
    assert.equal(again.body.error?.code, A2A_ERROR_CODES.taskNotCancelable);
    const send2 = await send(handler, userMessage(undefined, { taskId: t.id }), alice);
    assert.equal(send2.body.error?.code, A2A_ERROR_CODES.unsupportedOperation);
  });

  test("ListTasks filters, paginates, and omits artifacts by default", async () => {
    const handler = stateful({
      onMessage: (ctx) =>
        ctx.text === "done"
          ? { status: "completed", artifacts: [{ parts: [a2aText("r")] }] }
          : { status: "input-required", message: "?" },
    });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push((await send(handler, userMessage([{ text: "done" }], { contextId: "c1" }), alice)).body.result.task.id);
    }
    await send(handler, userMessage([{ text: "wait" }], { contextId: "c2" }), alice);
    await send(handler, userMessage([{ text: "done" }]), bob);

    const all = (await call(handler, "ListTasks", {}, alice)).body.result;
    assert.equal(all.totalSize, 4);
    assert.equal(all.pageSize, 50);
    assert.equal(all.nextPageToken, "");
    assert.ok(all.tasks.every((t: A2aTask) => !("artifacts" in t)));

    const page1 = (await call(handler, "ListTasks", { contextId: "c1", pageSize: 2 }, alice)).body.result;
    assert.equal(page1.tasks.length, 2);
    assert.equal(page1.totalSize, 3);
    assert.notEqual(page1.nextPageToken, "");
    const page2 = (
      await call(handler, "ListTasks", { contextId: "c1", pageSize: 2, pageToken: page1.nextPageToken }, alice)
    ).body.result;
    assert.equal(page2.tasks.length, 1);
    assert.equal(page2.nextPageToken, "");
    const seen = [...page1.tasks, ...page2.tasks].map((t: A2aTask) => t.id).sort();
    assert.deepEqual(seen, [...ids].sort());

    const waiting = (
      await call(handler, "ListTasks", { status: "TASK_STATE_INPUT_REQUIRED", includeArtifacts: true, historyLength: 0 }, alice)
    ).body.result;
    assert.equal(waiting.totalSize, 1);
    assert.deepEqual(waiting.tasks[0].artifacts, []);
    assert.equal("history" in waiting.tasks[0], false);
    const withArtifacts = (await call(handler, "ListTasks", { contextId: "c1", includeArtifacts: true }, alice)).body
      .result;
    assert.equal(withArtifacts.tasks[0].artifacts.length, 1);

    const future = (
      await call(handler, "ListTasks", { statusTimestampAfter: new Date(Date.now() + 60_000).toISOString() }, alice)
    ).body.result;
    assert.equal(future.totalSize, 0);
    const emptyToken = (await call(handler, "ListTasks", { pageToken: "" }, alice)).body.result;
    assert.equal(emptyToken.totalSize, 4);
  });

  test("ListTasks accepts ProtoJSON defaults and enum integers", async () => {
    const handler = stateful();
    await send(handler, userMessage(), alice);
    for (const params of [{ status: "TASK_STATE_UNSPECIFIED" }, { status: 0 }, { contextId: "" }]) {
      const res = await call(handler, "ListTasks", params, alice);
      assert.equal(res.body.result?.totalSize, 1, JSON.stringify(params));
    }
    const byNumber = await call(handler, "ListTasks", { status: 6 }, alice);
    assert.equal(byNumber.body.result.totalSize, 1);
    const other = await call(handler, "ListTasks", { status: 3 }, alice);
    assert.equal(other.body.result.totalSize, 0);
    for (const status of ["UNRECOGNIZED", 99, 1.5]) {
      const res = await call(handler, "ListTasks", { status }, alice);
      assert.equal(res.body.error?.code, A2A_ERROR_CODES.invalidParams, String(status));
    }
  });

  test("ListTasks rejects invalid parameters", async () => {
    const handler = stateful();
    const bad: unknown[] = [
      { pageSize: 0 },
      { pageSize: 101 },
      { status: "working" },
      { contextId: 5 },
      { pageToken: 5 },
      { pageToken: "../../etc" },
      { statusTimestampAfter: "yesterday" },
      { statusTimestampAfter: 5 },
      { includeArtifacts: "yes" },
      { historyLength: -1 },
    ];
    for (const params of bad) {
      const res = await call(handler, "ListTasks", params, alice);
      assert.equal(res.body.error?.code, A2A_ERROR_CODES.invalidParams, JSON.stringify(params));
    }
  });

  test("a store without list() answers ListTasks with -32004", async () => {
    const base = memoryTaskStore();
    const handler = stateful({ taskStore: { get: base.get, set: base.set } });
    assert.equal((await call(handler, "ListTasks", {}, alice)).body.error?.code, A2A_ERROR_CODES.unsupportedOperation);
  });
});

describe("memoryTaskStore", () => {
  const task = (id: string, timestamp = new Date().toISOString()): A2aTask => ({
    id,
    contextId: "c",
    status: { state: "TASK_STATE_COMPLETED", timestamp },
  });
  const query = { pageSize: 50 };

  test("evicts the oldest write beyond maxTasks", async () => {
    const store = memoryTaskStore({ maxTasks: 2 });
    await store.set("o", task("a"));
    await store.set("o", task("b"));
    await store.set("o", task("a")); // rewrite refreshes "a"
    await store.set("o", task("c"));
    assert.equal(await store.get("o", "b"), undefined);
    assert.ok(await store.get("o", "a"));
    assert.ok(await store.get("o", "c"));
  });

  test("expires entries after ttlMs on get and list", async () => {
    const store = memoryTaskStore({ ttlMs: 1 });
    await store.set("o", task("a"));
    await store.set("o", task("b"));
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(await store.get("o", "a"), undefined);
    assert.equal((await store.list!("o", query)).totalSize, 0);
  });

  test("keeps owners apart even when strings look like delimiters", async () => {
    const store = memoryTaskStore();
    await store.set('a","b', task("x"));
    assert.equal(await store.get("a", 'b","x'), undefined);
    assert.ok(await store.get('a","b', "x"));
  });

  test("copies on read and write and sorts by status time", async () => {
    const store = memoryTaskStore();
    const t = task("a", "2026-01-01T00:00:00.000Z");
    await store.set("o", t);
    t.contextId = "mutated";
    const read = (await store.get("o", "a"))!;
    assert.equal(read.contextId, "c");
    read.contextId = "mutated";
    assert.equal((await store.get("o", "a"))!.contextId, "c");
    await store.set("o", task("b", "2026-02-01T00:00:00.000Z"));
    await store.set("o", { ...task("n"), status: { state: "TASK_STATE_COMPLETED" } });
    const page = await store.list!("o", query);
    assert.deepEqual(page.tasks.map((x) => x.id), ["b", "a", "n"]);
  });

  test("rejects bad options", () => {
    assert.throws(() => memoryTaskStore({ maxTasks: 0 }), /maxTasks/);
    assert.throws(() => memoryTaskStore({ ttlMs: 0 }), /ttlMs/);
  });
});

// ---------------------------------------------------------------------------
// Daloy integration: routes, state forwarding, boot guard, production rules
// ---------------------------------------------------------------------------

describe("a2aRoutes", () => {
  const rpcBody = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "SendMessage", params: { message: userMessage() } });
  const rpcInit = (token?: string): RequestInit => ({
    method: "POST",
    headers: {
      "content-type": "application/json",
      "a2a-version": "1.0",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: rpcBody,
  });

  test("mounts the card and JSON-RPC routes and forwards ctx.state", async () => {
    const app = new App({ logger: false });
    const handler = agent({
      onMessage: ({ state }) => `hi ${(state.user as { sub: string } | undefined)?.sub ?? "anon"}`,
    });
    const auth = markAuthHook({
      async beforeHandle(ctx) {
        if (ctx.request.headers.get("authorization") !== "Bearer good") {
          return new Response(null, { status: 401 });
        }
        (ctx.state as Record<string, unknown>).user = { sub: "carol" };
        return undefined;
      },
    });
    for (const route of a2aRoutes("/a2a", handler, { hooks: auth })) app.route(route);

    const card = await app.request(A2A_AGENT_CARD_PATH);
    assert.equal(card.status, 200);
    assert.equal((await card.json()).name, "inventory-agent");
    assert.equal((await app.request("/a2a", rpcInit())).status, 401);
    const ok = await app.request("/a2a", rpcInit("good"));
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as Rpc).result.message.parts[0].text, "hi carol");
    assert.equal((await app.request("/a2a")).status, 405);
    assert.equal((await app.request("/a2a", { method: "OPTIONS" })).status, 204);
  });

  test("custom cardPath and cardPath: false", async () => {
    const custom = new App({ logger: false });
    for (const route of a2aRoutes("/a2a", agent(), { public: true, cardPath: "/agents/inventory.json" })) {
      custom.route(route);
    }
    assert.equal((await custom.request("/agents/inventory.json")).status, 200);
    const none = a2aRoutes("/a2a", agent(), { public: true, cardPath: false });
    assert.equal(none.length, 3);
    assert.ok(none.every((r) => r.path === "/a2a"));
  });

  test("requires securitySchemes on the card unless public", () => {
    const noAuthCard = agent({ card: { ...BASE_CARD, securitySchemes: undefined, securityRequirements: undefined } });
    assert.throws(() => a2aRoutes("/a2a", noAuthCard), /securitySchemes/);
    assert.equal(a2aRoutes("/a2a", noAuthCard, { public: true }).length, 4);
  });

  test("production refuses to boot without auth on the JSON-RPC route", async () => {
    const app = new App({ logger: false, env: "production" });
    for (const route of a2aRoutes("/a2a", agent())) app.route(route);
    const res = await app.request("/a2a", rpcInit());
    assert.equal(res.status, 500);
  });

  test("production boots with route hooks and the card stays public", async () => {
    const app = new App({ logger: false, env: "production" });
    const auth = bearerAuth({ validate: (t) => t === "good" });
    for (const route of a2aRoutes("/a2a", agent(), { hooks: auth })) app.route(route);
    assert.equal((await app.request(A2A_AGENT_CARD_PATH)).status, 200);
    assert.equal((await app.request("/a2a", rpcInit())).status, 401);
    assert.equal((await app.request("/a2a", rpcInit("good"))).status, 200);
  });

  test("production boots with a global auth hook and with { public: true }", async () => {
    const global = new App({ logger: false, env: "production" });
    global.use(bearerAuth({ validate: () => true }));
    for (const route of a2aRoutes("/a2a", agent())) global.route(route);
    assert.equal((await global.request("/a2a", rpcInit())).status, 401);
    const open = new App({ logger: false, env: "production" });
    for (const route of a2aRoutes("/a2a", agent(), { public: true })) open.route(route);
    assert.equal((await open.request("/a2a", rpcInit())).status, 200);
  });

  test("development allows an unauthenticated agent", async () => {
    const app = new App({ logger: false, env: "development" });
    for (const route of a2aRoutes("/a2a", agent())) app.route(route);
    assert.equal((await app.request("/a2a", rpcInit())).status, 200);
  });

  test("production requires an https card url unless loopback", () => {
    const http = agent({ card: { ...BASE_CARD, url: "http://agent.example/a2a" } });
    const prod = new App({ logger: false, env: "production" });
    const [post] = a2aRoutes("/a2a", http, { public: true });
    assert.throws(() => prod.route(post!), /must use https: in production/);
    const loop = agent({ card: { ...BASE_CARD, url: "http://localhost:3000/a2a" } });
    for (const route of a2aRoutes("/a2a", loop, { public: true })) {
      new App({ logger: false, env: "production" }).route(route);
    }
    const dev = new App({ logger: false, env: "development" });
    for (const route of a2aRoutes("/a2a", http, { public: true })) dev.route(route);
  });

  test("a production App redacts internal errors even when NODE_ENV is test", async () => {
    const boom = agent({
      onMessage: () => {
        throw new Error("secret detail");
      },
    });
    const prod = new App({ logger: false, env: "production" });
    for (const route of a2aRoutes("/a2a", boom, { public: true })) prod.route(route);
    const body = (await (await prod.request("/a2a", rpcInit())).json()) as Rpc;
    assert.deepEqual(body.error, { code: -32603, message: "Internal error" });
    const explicit = agent({
      exposeInternalErrors: true,
      onMessage: () => {
        throw new Error("secret detail");
      },
    });
    const prod2 = new App({ logger: false, env: "production" });
    for (const route of a2aRoutes("/a2a", explicit, { public: true })) prod2.route(route);
    const body2 = (await (await prod2.request("/a2a", rpcInit())).json()) as Rpc;
    assert.equal(body2.error?.data?.detail, "secret detail");
  });

  test("routes document their envelope in OpenAPI", async () => {
    const app = new App({ logger: false, openapi: { info: { title: "t", version: "1" } } } as any);
    for (const route of a2aRoutes("/a2a", agent(), { public: true })) app.route(route);
    const routes = a2aRoutes("/a2a", agent(), { public: true });
    const schema = (routes[0]!.responses as any)[200].body;
    assert.equal(schema.toJSONSchema().properties.jsonrpc.const, "2.0");
    assert.deepEqual(schema["~standard"].validate({ a: 1 }), { value: { a: 1 } });
    const cardSchema = (routes[3]!.responses as any)[200].body;
    assert.ok(cardSchema.toJSONSchema().required.includes("supportedInterfaces"));
  });
});
