/**
 * Inbound WebSocket message validation: when an `app.ws()` route declares
 * `request.body`, every inbound message is JSON-parsed (prototype-pollution
 * safe, structure-bounded) and validated before `message()` runs. Rejected
 * messages close the socket with 1003 (binary) or 1007 (bad JSON / schema)
 * and never reach the handler. Routes without a schema are unchanged.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { z } from "zod";

import {
  App,
  WS_CLOSE_CODE,
  defineWebSocket,
  validateWebSocketMessage,
  type StandardSchemaV1,
} from "../src/index.js";
import { serve as serveNode } from "../src/adapters/node.js";
import { serve as serveBun } from "../src/adapters/bun.js";
import { WebSocketMessageGate } from "../src/websocket.js";

const ChatMessage = z.object({ text: z.string().max(100) }).strict();

async function startApp(app: App) {
  const handle = serveNode(app, { port: 0, handleSignals: false });
  await once(handle.server, "listening");
  return { handle, port: (handle.server.address() as AddressInfo).port };
}

async function openClient(url: string): Promise<WebSocket> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("client error")), { once: true });
  });
  return ws;
}

function nextClose(ws: WebSocket): Promise<CloseEvent> {
  return new Promise((resolve) => ws.addEventListener("close", (ev) => resolve(ev), { once: true }));
}

function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) =>
    ws.addEventListener("message", (ev) => resolve(String(ev.data)), { once: true })
  );
}

/** A Standard Schema whose validation resolves asynchronously. */
function asyncSchema(delayFor: (v: unknown) => number): StandardSchemaV1<unknown, { n: number }> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) =>
        new Promise((resolve) => {
          const n = (value as { n?: unknown } | null)?.n;
          setTimeout(
            () =>
              resolve(
                typeof n === "number" ? { value: { n } } : { issues: [{ message: "n required" }] }
              ),
            delayFor(value)
          );
        }),
    },
  };
}

// ---------- unit: validateWebSocketMessage ----------

test("validateWebSocketMessage returns the parsed, validated value for a valid text message", () => {
  const result = validateWebSocketMessage(ChatMessage, '{"text":"hi"}', false);
  assert.deepEqual(result, { ok: true, value: { text: "hi" } });
});

test("validateWebSocketMessage rejects invalid JSON, schema failures, and binary with fixed reasons", () => {
  assert.deepEqual(validateWebSocketMessage(ChatMessage, "{nope", false), {
    ok: false,
    code: WS_CLOSE_CODE.INVALID_PAYLOAD,
    reason: "invalid JSON message",
  });
  const failed = validateWebSocketMessage(ChatMessage, '{"text":42}', false);
  assert.deepEqual(failed, {
    ok: false,
    code: WS_CLOSE_CODE.INVALID_PAYLOAD,
    reason: "message failed schema validation",
  });
  // Unknown keys are refused by the .strict() schema.
  assert.equal(
    (validateWebSocketMessage(ChatMessage, '{"text":"a","admin":true}', false) as { ok: boolean }).ok,
    false
  );
  assert.deepEqual(validateWebSocketMessage(ChatMessage, new Uint8Array([1]), true), {
    ok: false,
    code: WS_CLOSE_CODE.UNSUPPORTED_DATA,
    reason: "binary messages are not accepted",
  });
});

test("validateWebSocketMessage strips prototype-pollution keys and bounds JSON depth", () => {
  const loose = z.object({}).passthrough();
  const result = validateWebSocketMessage(loose, '{"__proto__":{"polluted":true},"a":1}', false);
  assert.equal((result as { ok: boolean }).ok, true);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(Object.hasOwn((result as { value: object }).value, "__proto__"), false);

  const deep = "[".repeat(200) + "]".repeat(200);
  assert.equal(
    (validateWebSocketMessage(z.any(), deep, false) as { reason: string }).reason,
    "invalid JSON message"
  );
});

test("validateWebSocketMessage treats a throwing or rejecting validator as a schema failure", async () => {
  const throwing: StandardSchemaV1 = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: () => {
        throw new Error("validator exploded with internal detail");
      },
    },
  };
  const rejecting: StandardSchemaV1 = {
    "~standard": { version: 1, vendor: "test", validate: () => Promise.reject(new Error("x")) },
  };
  assert.equal(
    (validateWebSocketMessage(throwing, "{}", false) as { reason: string }).reason,
    "message failed schema validation"
  );
  const async = await validateWebSocketMessage(rejecting, "{}", false);
  assert.equal((async as { reason: string }).reason, "message failed schema validation");
});

test("WebSocketMessageGate keeps arrival order when validation is async", async () => {
  const delivered: number[] = [];
  // The first message validates slowest; it must still be delivered first.
  const gate = new WebSocketMessageGate(
    asyncSchema((v) => 30 - ((v as { n: number }).n ?? 0) * 10),
    (result) => {
      if (result.ok) delivered.push((result.value as { n: number }).n);
    }
  );
  gate.push('{"n":0}', false);
  gate.push('{"n":1}', false);
  gate.push('{"n":2}', false);
  await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(delivered, [0, 1, 2]);
  // Once drained, sync-failing input is delivered inline again.
  let inline = false;
  const sync = new WebSocketMessageGate(ChatMessage, () => (inline = true));
  sync.push("{bad", false);
  assert.equal(inline, true);
});

// ---------- Node adapter end to end ----------

test("Node: a valid message reaches message() with the validated body", async () => {
  const app = new App({ logger: false });
  const bodies: unknown[] = [];
  app.ws("/chat", {
    request: { body: ChatMessage },
    message(conn, data, _isBinary, body) {
      // `body` is typed from the schema output.
      const text: string = body.text;
      bodies.push(body);
      conn.send(`${text}|${typeof data}`);
    },
  });
  const { handle, port } = await startApp(app);
  try {
    const ws = await openClient(`ws://127.0.0.1:${port}/chat`);
    const reply = nextMessage(ws);
    ws.send(JSON.stringify({ text: "hello" }));
    assert.equal(await reply, "hello|string");
    assert.deepEqual(bodies, [{ text: "hello" }]);
    ws.close(1000);
  } finally {
    await handle.close();
  }
});

for (const [name, payload, code] of [
  ["a schema-violating message", JSON.stringify({ text: 123 }), WS_CLOSE_CODE.INVALID_PAYLOAD],
  ["non-JSON text", "not json", WS_CLOSE_CODE.INVALID_PAYLOAD],
  ["an extra key on a strict schema", JSON.stringify({ text: "a", role: "admin" }), WS_CLOSE_CODE.INVALID_PAYLOAD],
  ["a binary frame", new Uint8Array([1, 2, 3]), WS_CLOSE_CODE.UNSUPPORTED_DATA],
] as const) {
  test(`Node: ${name} closes the socket and never reaches message()`, async () => {
    const app = new App({ logger: false });
    let calls = 0;
    app.ws("/chat", {
      request: { body: ChatMessage },
      message() {
        calls++;
      },
    });
    const { handle, port } = await startApp(app);
    try {
      const ws = await openClient(`ws://127.0.0.1:${port}/chat`);
      const closed = nextClose(ws);
      ws.send(payload);
      // A valid message queued right behind the bad one must be dropped too.
      ws.send(JSON.stringify({ text: "after" }));
      const ev = await closed;
      assert.equal(ev.code, code);
      assert.equal(calls, 0);
    } finally {
      await handle.close();
    }
  });
}

test("Node: routes without request.body keep raw delivery, including binary", async () => {
  const app = new App({ logger: false });
  const seen: Array<[unknown, boolean, unknown]> = [];
  app.ws("/raw", {
    message(conn, data, isBinary, body) {
      seen.push([typeof data === "string" ? data : "bytes", isBinary, body]);
      if (seen.length === 2) conn.send("ok");
    },
  });
  const { handle, port } = await startApp(app);
  try {
    const ws = await openClient(`ws://127.0.0.1:${port}/raw`);
    const reply = nextMessage(ws);
    ws.send("not json");
    ws.send(new Uint8Array([9]));
    assert.equal(await reply, "ok");
    assert.deepEqual(seen, [
      ["not json", false, undefined],
      ["bytes", true, undefined],
    ]);
    ws.close(1000);
  } finally {
    await handle.close();
  }
});

test("Node: async schemas deliver messages in arrival order", async () => {
  const app = new App({ logger: false });
  const order: number[] = [];
  app.ws("/ordered", {
    request: { body: asyncSchema((v) => ((v as { n: number }).n === 0 ? 40 : 0)) },
    message(conn, _data, _isBinary, body) {
      order.push(body.n);
      if (order.length === 2) conn.send(order.join(","));
    },
  });
  const { handle, port } = await startApp(app);
  try {
    const ws = await openClient(`ws://127.0.0.1:${port}/ordered`);
    const reply = nextMessage(ws);
    ws.send('{"n":0}');
    ws.send('{"n":1}');
    assert.equal(await reply, "0,1");
    ws.close(1000);
  } finally {
    await handle.close();
  }
});

// ---------- Bun adapter ----------

function fakeBunSocket(handler: unknown) {
  const closes: Array<[number, string]> = [];
  const ws: any = {
    data: {
      handler,
      ctx: {
        request: new Request("http://x.test/chat"),
        params: {},
        query: {},
        headers: {},
        state: {},
        protocols: [],
      },
      protocol: "",
    },
    send: () => 0,
    close: (code: number, reason: string) => closes.push([code, reason]),
    terminate: () => {},
    ping: () => 0,
    pong: () => 0,
    binaryType: "uint8array",
  };
  return { ws, closes };
}

test("Bun: valid messages arrive validated; invalid ones close with 1007/1003", async () => {
  let wsConfig: any;
  const prev = (globalThis as { Bun?: unknown }).Bun;
  (globalThis as { Bun?: unknown }).Bun = {
    serve(cfg: any) {
      wsConfig = cfg;
      return { port: 0, url: undefined, stop: () => {} };
    },
  };
  try {
    const app = new App({ logger: false });
    const bodies: unknown[] = [];
    app.ws("/chat", {
      request: { body: ChatMessage },
      message(_conn, _data, _isBinary, body) {
        bodies.push(body);
      },
    });
    serveBun(app, { handleSignals: false });
    const handler = app.webSocketRoutes.find("/chat")!.handler.handler;

    const good = fakeBunSocket(handler);
    wsConfig.websocket.open(good.ws);
    wsConfig.websocket.message(good.ws, '{"text":"hi"}');
    assert.deepEqual(bodies, [{ text: "hi" }]);
    assert.deepEqual(good.closes, []);

    const bad = fakeBunSocket(handler);
    wsConfig.websocket.open(bad.ws);
    wsConfig.websocket.message(bad.ws, '{"text":1}');
    wsConfig.websocket.message(bad.ws, '{"text":"dropped"}');
    assert.deepEqual(bad.closes, [[1007, "message failed schema validation"]]);

    const binary = fakeBunSocket(handler);
    wsConfig.websocket.open(binary.ws);
    wsConfig.websocket.message(binary.ws, new Uint8Array([1]));
    assert.deepEqual(binary.closes, [[1003, "binary messages are not accepted"]]);
    assert.equal(bodies.length, 1);
  } finally {
    if (prev === undefined) delete (globalThis as { Bun?: unknown }).Bun;
    else (globalThis as { Bun?: unknown }).Bun = prev;
  }
});

// ---------- types ----------

test("defineWebSocket infers the message body type from request.body", () => {
  const handler = defineWebSocket({
    request: { body: ChatMessage },
    message(_conn, _data, _isBinary, body) {
      const text: string = body.text;
      void text;
    },
  });
  const untyped = defineWebSocket({
    message(_conn, _data, _isBinary, body) {
      const none: undefined = body;
      void none;
    },
  });
  assert.ok(handler.request?.body);
  assert.equal(untyped.request, undefined);
});
