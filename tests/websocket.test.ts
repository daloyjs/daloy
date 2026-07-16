import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import {
  App,
  rateLimit,
  wsRateLimit,
  computeAcceptKey,
  DEFAULT_WS_BACKPRESSURE_LIMIT,
  DEFAULT_WS_IDLE_TIMEOUT_SECONDS,
  DEFAULT_WS_MAX_PAYLOAD_LENGTH,
  decodeClosePayload,
  defineWebSocket,
  encodeClosePayload,
  encodeFrame,
  encodeSendPayload,
  FrameSink,
  FRAME_INCOMPLETE,
  parseFrame,
  parseSubprotocols,
  validateSelectedSubprotocol,
  validateUpgrade,
  WebSocketProtocolError,
  WebSocketPayloadTooLargeError,
  WebSocketRegistry,
  WS_CLOSE_CODE,
  WS_GUID,
  WS_MAX_CONTROL_PAYLOAD,
  WS_OPCODE,
  WS_READY_STATE,
  _resetSharedRateLimitStoresForTests,
} from "../src/index.js";
import { serve as serveNode } from "../src/adapters/node.js";
import { serve as serveBun } from "../src/adapters/bun.js";

// ---------- constants / handshake ----------

test("WS_GUID matches RFC 6455", () => {
  assert.equal(WS_GUID, "258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
});

test("computeAcceptKey matches RFC 6455 example", async () => {
  // From RFC 6455 §1.3.
  const accept = await computeAcceptKey("dGhlIHNhbXBsZSBub25jZQ==");
  assert.equal(accept, "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
});

test("parseSubprotocols handles empty, single, and multiple entries", () => {
  assert.deepEqual(parseSubprotocols(null), []);
  assert.deepEqual(parseSubprotocols(""), []);
  assert.deepEqual(parseSubprotocols("chat"), ["chat"]);
  assert.deepEqual(parseSubprotocols(" chat ,  superchat , "), [
    "chat",
    "superchat",
  ]);
});

test("validateUpgrade returns ok for well-formed handshake", async () => {
  const headers = new Headers({
    upgrade: "websocket",
    connection: "keep-alive, Upgrade",
    "sec-websocket-version": "13",
    "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
    "sec-websocket-protocol": "chat, superchat",
  });
  const res = await validateUpgrade(headers);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.acceptKey, "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    assert.deepEqual(res.protocols, ["chat", "superchat"]);
  }
});

test("validateUpgrade rejects bad handshakes", async () => {
  const base = {
    upgrade: "websocket",
    connection: "Upgrade",
    "sec-websocket-version": "13",
    "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
  } as const;
  // Wrong upgrade
  let res = await validateUpgrade(new Headers({ ...base, upgrade: "h2" }));
  assert.equal(res.ok, false);
  // Missing upgrade
  const noUp = new Headers(base);
  noUp.delete("upgrade");
  res = await validateUpgrade(noUp);
  assert.equal(res.ok, false);
  // Bad connection
  res = await validateUpgrade(
    new Headers({ ...base, connection: "keep-alive" }),
  );
  assert.equal(res.ok, false);
  // Missing connection
  const noConn = new Headers(base);
  noConn.delete("connection");
  res = await validateUpgrade(noConn);
  assert.equal(res.ok, false);
  // Bad version
  res = await validateUpgrade(
    new Headers({ ...base, "sec-websocket-version": "8" }),
  );
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.status, 426);
  // Missing key
  const noKey = new Headers(base);
  noKey.delete("sec-websocket-key");
  res = await validateUpgrade(noKey);
  assert.equal(res.ok, false);
  // Malformed key
  res = await validateUpgrade(
    new Headers({ ...base, "sec-websocket-key": "not-base64" }),
  );
  assert.equal(res.ok, false);
  // Key must decode to a 16-byte nonce.
  res = await validateUpgrade(
    new Headers({
      ...base,
      "sec-websocket-key": Buffer.from("short").toString("base64"),
    }),
  );
  assert.equal(res.ok, false);
});

test("validateSelectedSubprotocol accepts only offered HTTP tokens", () => {
  assert.equal(
    validateSelectedSubprotocol("chat.v1", ["chat.v1", "chat.v2"]),
    "chat.v1",
  );
  assert.throws(
    () => validateSelectedSubprotocol("chat.v3", ["chat.v1"]),
    /not offered/,
  );
  assert.throws(
    () => validateSelectedSubprotocol("bad\r\nheader", ["bad\r\nheader"]),
    /valid HTTP token/,
  );
});

// ---------- Frame protocol ----------

test("parseFrame returns INCOMPLETE on partial input", () => {
  assert.equal(parseFrame(new Uint8Array(0)), FRAME_INCOMPLETE);
  assert.equal(parseFrame(new Uint8Array([0x81])), FRAME_INCOMPLETE);
  // header says 16-bit ext length but only 1 byte present
  assert.equal(parseFrame(new Uint8Array([0x81, 126, 0])), FRAME_INCOMPLETE);
  // 64-bit ext length truncated
  assert.equal(
    parseFrame(new Uint8Array([0x81, 127, 0, 0, 0, 0, 0, 0, 0])),
    FRAME_INCOMPLETE,
  );
  // masked but mask key truncated
  assert.equal(
    parseFrame(new Uint8Array([0x81, 0x80, 0, 0])),
    FRAME_INCOMPLETE,
  );
  // payload short
  assert.equal(
    parseFrame(new Uint8Array([0x81, 0x05, 0x61])),
    FRAME_INCOMPLETE,
  );
});

test("parseFrame rejects RSV bits, oversized control frames, fragmented control, unknown opcodes", () => {
  assert.throws(() => parseFrame(new Uint8Array([0xc0, 0x00])), /RSV/);
  assert.throws(
    () => parseFrame(new Uint8Array([0x88, 0x7e, 0, 0])),
    /Control frame payload exceeds/,
  );
  // fragmented control (FIN=0 on close)
  assert.throws(
    () => parseFrame(new Uint8Array([0x08, 0x00])),
    /must not be fragmented/,
  );
  // unknown control opcode 0xB
  assert.throws(
    () => parseFrame(new Uint8Array([0x8b, 0x00])),
    /Unknown control opcode/,
  );
  // unknown data opcode 0x3
  assert.throws(
    () => parseFrame(new Uint8Array([0x83, 0x00])),
    /Unknown data opcode/,
  );
  // requireMask but unmasked
  assert.throws(
    () => parseFrame(new Uint8Array([0x81, 0x01, 0x61]), { requireMask: true }),
    /Client frames must be masked/,
  );
});

test("parseFrame handles 16-bit and 64-bit extended lengths", () => {
  const payload = new Uint8Array(200);
  for (let i = 0; i < payload.length; i++) payload[i] = i & 0xff;
  const f16 = encodeFrame({ opcode: WS_OPCODE.BINARY, payload });
  const parsed16 = parseFrame(f16);
  assert.notEqual(parsed16, FRAME_INCOMPLETE);
  if (parsed16 !== FRAME_INCOMPLETE) {
    assert.equal(parsed16.payload.length, 200);
    assert.equal(parsed16.fin, true);
  }
  const big = new Uint8Array(70_000);
  const f64 = encodeFrame({ opcode: WS_OPCODE.BINARY, payload: big });
  const parsed64 = parseFrame(f64);
  assert.notEqual(parsed64, FRAME_INCOMPLETE);
  if (parsed64 !== FRAME_INCOMPLETE)
    assert.equal(parsed64.payload.length, 70_000);
});

test("parseFrame rejects payloads exceeding MAX_SAFE_INTEGER", () => {
  // hi byte > 0x1fffff
  const buf = new Uint8Array([0x82, 127, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0]);
  assert.throws(() => parseFrame(buf), /MAX_SAFE_INTEGER/);
});

test("encodeFrame masked round-trips through parseFrame", () => {
  const payload = new TextEncoder().encode("hello");
  const frame = encodeFrame({ opcode: WS_OPCODE.TEXT, payload, mask: true });
  // Mask bit set
  assert.equal((frame[1]! & 0x80) !== 0, true);
  const parsed = parseFrame(frame, { requireMask: true });
  assert.notEqual(parsed, FRAME_INCOMPLETE);
  if (parsed !== FRAME_INCOMPLETE) {
    assert.equal(new TextDecoder().decode(parsed.payload), "hello");
    assert.equal(parsed.opcode, WS_OPCODE.TEXT);
  }
});

test("encodeFrame throws on oversized control frame", () => {
  assert.throws(
    () => encodeFrame({ opcode: WS_OPCODE.PING, payload: new Uint8Array(200) }),
    /Control frame payload exceeds/,
  );
});

test("encodeFrame supports zero-payload data frames and the FIN flag", () => {
  const cont = encodeFrame({ opcode: WS_OPCODE.CONTINUATION, fin: false });
  // FIN bit cleared
  assert.equal((cont[0]! & 0x80) === 0, true);
  assert.equal(cont[1], 0);
});

test("encodeFrame masking requires getRandomValues", () => {
  const original = (globalThis as { crypto?: Crypto }).crypto;
  const fake = { subtle: original?.subtle } as unknown as Crypto;
  try {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: fake,
    });
    assert.throws(
      () =>
        encodeFrame({
          opcode: WS_OPCODE.TEXT,
          payload: new Uint8Array([1, 2, 3]),
          mask: true,
        }),
      /getRandomValues/,
    );
  } finally {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: original,
    });
  }
});

test("encodeClosePayload rejects overlong reason; decodeClosePayload handles empty/short payloads", () => {
  assert.throws(
    () => encodeClosePayload(1000, "x".repeat(200)),
    /Close reason exceeds/,
  );
  assert.deepEqual(decodeClosePayload(new Uint8Array(0)), {
    code: WS_CLOSE_CODE.NO_STATUS_RECEIVED,
    reason: "",
  });
  assert.throws(
    () => decodeClosePayload(new Uint8Array([0x03])),
    /must be empty/,
  );
  const enc = encodeClosePayload(1000, "bye");
  assert.deepEqual(decodeClosePayload(enc), { code: 1000, reason: "bye" });
});

test("encodeSendPayload accepts strings, Uint8Arrays, typed-array views, and ArrayBuffers", () => {
  assert.equal(encodeSendPayload("hi").opcode, WS_OPCODE.TEXT);
  assert.equal(
    encodeSendPayload(new Uint8Array([1, 2])).opcode,
    WS_OPCODE.BINARY,
  );
  const view = new DataView(new Uint8Array([5, 6, 7]).buffer);
  const fromView = encodeSendPayload(view);
  assert.equal(fromView.opcode, WS_OPCODE.BINARY);
  assert.deepEqual(Array.from(fromView.payload), [5, 6, 7]);
  const fromAB = encodeSendPayload(new Uint8Array([9, 9]).buffer);
  assert.equal(fromAB.opcode, WS_OPCODE.BINARY);
  assert.deepEqual(Array.from(fromAB.payload), [9, 9]);
});

// ---------- FrameSink ----------

function makeSink() {
  const events: Array<{
    type: string;
    data?: unknown;
    isBinary?: boolean;
    code?: number;
    reason?: string;
  }> = [];
  const sink = new FrameSink({
    requireMask: true,
    onMessage: (ev) =>
      events.push({ type: "message", data: ev.data, isBinary: ev.isBinary }),
    onPing: (p) => events.push({ type: "ping", data: p }),
    onPong: (p) => events.push({ type: "pong", data: p }),
    onClose: (code, reason) => events.push({ type: "close", code, reason }),
    onProtocolError: (err) =>
      events.push({ type: "error", reason: err.message }),
  });
  return { sink, events };
}

test("FrameSink assembles text messages across chunked input", () => {
  const { sink, events } = makeSink();
  const frame = encodeFrame({
    opcode: WS_OPCODE.TEXT,
    payload: new TextEncoder().encode("hi"),
    mask: true,
  });
  // Feed byte-by-byte.
  for (let i = 0; i < frame.length; i++) sink.push(frame.subarray(i, i + 1));
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { type: "message", data: "hi", isBinary: false });
});

test("FrameSink assembles fragmented binary message and auto-pongs pings", () => {
  const { sink, events } = makeSink();
  const f1 = encodeFrame({
    fin: false,
    opcode: WS_OPCODE.BINARY,
    payload: new Uint8Array([1, 2]),
    mask: true,
  });
  const ping = encodeFrame({
    opcode: WS_OPCODE.PING,
    payload: new Uint8Array([0xff]),
    mask: true,
  });
  const f2 = encodeFrame({
    fin: true,
    opcode: WS_OPCODE.CONTINUATION,
    payload: new Uint8Array([3, 4]),
    mask: true,
  });
  sink.push(f1);
  sink.push(ping);
  sink.push(f2);
  assert.equal(events.length, 2);
  assert.equal(events[0]!.type, "ping");
  assert.equal(events[1]!.type, "message");
  assert.equal(events[1]!.isBinary, true);
  assert.deepEqual(Array.from(events[1]!.data as Uint8Array), [1, 2, 3, 4]);
});

test("FrameSink surfaces close frames with code/reason", () => {
  const { sink, events } = makeSink();
  const close = encodeFrame({
    opcode: WS_OPCODE.CLOSE,
    payload: encodeClosePayload(WS_CLOSE_CODE.NORMAL_CLOSURE, "bye"),
    mask: true,
  });
  sink.push(close);
  assert.deepEqual(events, [{ type: "close", code: 1000, reason: "bye" }]);
});

test("FrameSink rejects continuation without start, new data mid-fragment, and bad UTF-8", () => {
  let sink = makeSink();
  const stray = encodeFrame({
    opcode: WS_OPCODE.CONTINUATION,
    payload: new Uint8Array(0),
    mask: true,
  });
  sink.sink.push(stray);
  assert.equal(sink.events[0]!.type, "error");

  sink = makeSink();
  const f1 = encodeFrame({
    fin: false,
    opcode: WS_OPCODE.TEXT,
    payload: new Uint8Array([0x61]),
    mask: true,
  });
  const f2 = encodeFrame({
    opcode: WS_OPCODE.TEXT,
    payload: new Uint8Array([0x62]),
    mask: true,
  });
  sink.sink.push(f1);
  sink.sink.push(f2);
  assert.equal(sink.events.at(-1)!.type, "error");

  sink = makeSink();
  const bad = encodeFrame({
    opcode: WS_OPCODE.TEXT,
    payload: new Uint8Array([0xff, 0xfe]),
    mask: true,
  });
  sink.sink.push(bad);
  assert.equal(sink.events[0]!.type, "error");
});

test("FrameSink stops processing once closed", () => {
  const { sink, events } = makeSink();
  sink.push(
    encodeFrame({
      opcode: WS_OPCODE.CLOSE,
      payload: encodeClosePayload(1000, ""),
      mask: true,
    }),
  );
  sink.push(
    encodeFrame({
      opcode: WS_OPCODE.TEXT,
      payload: new TextEncoder().encode("after"),
      mask: true,
    }),
  );
  assert.equal(events.filter((e) => e.type === "message").length, 0);
});

test("FrameSink surfaces protocol errors from parseFrame (e.g. RSV)", () => {
  const { sink, events } = makeSink();
  sink.push(new Uint8Array([0xc0, 0x00]));
  assert.equal(events[0]!.type, "error");
});

test("FrameSink rejects messages over maxPayloadLength", () => {
  const events: Array<{ type: string; reason?: string }> = [];
  const sink = new FrameSink({
    requireMask: true,
    maxPayloadLength: 2,
    onMessage: () => events.push({ type: "message" }),
    onPing: () => {},
    onPong: () => {},
    onClose: () => {},
    onProtocolError: (err) => {
      assert.ok(err instanceof WebSocketPayloadTooLargeError);
      events.push({ type: "error", reason: err.message });
    },
  });
  sink.push(
    encodeFrame({
      opcode: WS_OPCODE.TEXT,
      payload: new TextEncoder().encode("abc"),
      mask: true,
    }),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0]!.type, "error");
  assert.match(events[0]!.reason!, /maxPayloadLength/);
});

test("FrameSink propagates non-protocol errors", () => {
  const sink = new FrameSink({
    requireMask: true,
    onMessage: () => {
      throw new TypeError("boom");
    },
    onPing: () => {},
    onPong: () => {},
    onClose: () => {},
    onProtocolError: () => {},
  });
  const frame = encodeFrame({
    opcode: WS_OPCODE.TEXT,
    payload: new TextEncoder().encode("x"),
    mask: true,
  });
  assert.throws(() => sink.push(frame), /boom/);
});

// ---------- App.ws registration ----------

test("App.ws registers WebSocket routes and they are discoverable via webSocketRoutes", () => {
  const app = new App({ logger: false });
  let opened = 0;
  app.ws(
    "/chat/:room",
    defineWebSocket({
      open: () => {
        opened++;
      },
    }),
  );
  const match = app.webSocketRoutes.find("/chat/general");
  assert.ok(match);
  assert.deepEqual(match!.params, { room: "general" });
  assert.equal(opened, 0);
});

test("App.ws applies safe defaults and validates unsafe overrides", () => {
  const app = new App({ logger: false });
  app.ws("/safe", { open: () => {} });
  const match = app.webSocketRoutes.find("/safe");
  assert.ok(match);
  assert.deepEqual(match!.handler.options, {
    closeOnBackpressureLimit: true,
    backpressureLimit: DEFAULT_WS_BACKPRESSURE_LIMIT,
    perMessageDeflate: false,
    idleTimeout: DEFAULT_WS_IDLE_TIMEOUT_SECONDS,
    maxPayloadLength: DEFAULT_WS_MAX_PAYLOAD_LENGTH,
  });

  assert.throws(
    () => new App({ env: "production", logger: false }).ws("/compressed", {
      perMessageDeflate: true,
      open: () => {},
    }),
    /perMessageDeflate/,
  );
  assert.throws(
    () => app.ws("/idle", { idleTimeout: 0, open: () => {} }),
    /idleTimeout/,
  );
  assert.throws(
    () => app.ws("/backpressure", { backpressureLimit: 0, open: () => {} }),
    /backpressureLimit/,
  );

  const tinySchema = {
    "~standard": {
      version: 1,
      vendor: "daloy-test",
      validate: (value: unknown) => ({ value }),
    },
    toJSONSchema: () => ({ type: "string", maxLength: 2 }),
  } as any;
  assert.throws(
    () => app.ws("/schema", {
      request: { body: tinySchema },
      maxPayloadLength: 3,
      open: () => {},
    }),
    /route body schema maximum/,
  );
});

test("WebSocketRegistry runtimeOptions aggregates route limits", () => {
  const registry = new WebSocketRegistry();
  assert.equal(registry.runtimeOptions().maxPayloadLength, DEFAULT_WS_MAX_PAYLOAD_LENGTH);
  registry.add("/small", {
    maxPayloadLength: 10,
    idleTimeout: 5,
    backpressureLimit: 10,
    open: () => {},
  });
  registry.add("/large", {
    maxPayloadLength: 20,
    idleTimeout: 15,
    backpressureLimit: 30,
    closeOnBackpressureLimit: false,
    perMessageDeflate: true,
    open: () => {},
  });
  assert.deepEqual(registry.runtimeOptions(), {
    closeOnBackpressureLimit: false,
    backpressureLimit: 30,
    perMessageDeflate: true,
    idleTimeout: 5,
    maxPayloadLength: 20,
  });
});

test("App.ws inherits group prefix", () => {
  const app = new App({ logger: false });
  app.group("/v1", {}, (v1) => {
    v1.ws("/echo", { open: () => {} });
  });
  assert.ok(app.webSocketRoutes.find("/v1/echo"));
});

test("WebSocketRegistry tracks size", () => {
  const r = new WebSocketRegistry();
  assert.equal(r.size, 0);
  r.add("/a", { open: () => {} });
  r.add("/b", { open: () => {} });
  assert.equal(r.size, 2);
  assert.deepEqual(r.find("/a")!.handler.createState(), {});
});

test("WebSocketProtocolError carries the proper name", () => {
  const e = new WebSocketProtocolError("nope");
  assert.equal(e.name, "WebSocketProtocolError");
  assert.equal(e.message, "nope");
});

test("WS_MAX_CONTROL_PAYLOAD and ready-state constants are exposed", () => {
  assert.equal(WS_MAX_CONTROL_PAYLOAD, 125);
  assert.equal(WS_READY_STATE.OPEN, 1);
  assert.equal(WS_READY_STATE.CLOSED, 3);
});

// ---------- End-to-end Node adapter test ----------

interface WsTestEvents {
  opens: number;
  messages: Array<{ data: string | Uint8Array; isBinary: boolean }>;
  closes: Array<{ code: number; reason: string }>;
  errors: unknown[];
}

function startNodeApp(
  handler: Parameters<App["ws"]>[1],
  opts?: { onError?: (e: unknown) => void },
) {
  const app = new App({ logger: false });
  app.ws("/echo/:room", handler);
  if (opts?.onError)
    app.ws("/oops", {
      open: () => {
        throw new Error("open boom");
      },
    });
  const handle = serveNode(app, { port: 0, handleSignals: false });
  return { app, handle, ready: once(handle.server, "listening") };
}

async function startApp(app: App) {
  const handle = serveNode(app, { port: 0, handleSignals: false });
  await once(handle.server, "listening");
  return handle;
}

async function waitOpen(ws: WebSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener(
      "error",
      (e) => reject(new Error("client error: " + (e as any).message)),
      { once: true },
    );
  });
}

test("Node adapter performs handshake and echoes text/binary frames", async () => {
  const events: WsTestEvents = {
    opens: 0,
    messages: [],
    closes: [],
    errors: [],
  };
  const { handle, ready } = startNodeApp({
    open(conn, ctx) {
      events.opens++;
      conn.data = { room: (ctx.params as { room: string }).room };
      conn.send("hello " + (conn.data as { room: string }).room);
    },
    message(conn, data, isBinary) {
      events.messages.push({
        data:
          typeof data === "string"
            ? data
            : new Uint8Array(data as ArrayBuffer | Uint8Array),
        isBinary,
      });
      if (typeof data === "string") conn.send(data.toUpperCase());
      else conn.send(new Uint8Array([0xaa, 0xbb]));
    },
    close(_conn, code, reason) {
      events.closes.push({ code, reason });
    },
  });
  await ready;
  try {
    const port = (handle.server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/echo/lobby`);
    const incoming: Array<string | Uint8Array> = [];
    ws.binaryType = "arraybuffer";
    ws.addEventListener("message", (ev: MessageEvent) => {
      if (typeof ev.data === "string") incoming.push(ev.data);
      else incoming.push(new Uint8Array(ev.data as ArrayBuffer));
    });
    await waitOpen(ws);
    ws.send("hi");
    ws.send(new Uint8Array([1, 2, 3]));
    // Wait for echoes (welcome + 2 echoes)
    await waitFor(() => incoming.length >= 3);
    assert.equal(incoming[0], "hello lobby");
    assert.equal(incoming[1], "HI");
    assert.deepEqual(Array.from(incoming[2] as Uint8Array), [0xaa, 0xbb]);
    assert.equal(events.opens, 1);
    assert.equal(events.messages.length, 2);
    assert.equal(events.messages[0]!.isBinary, false);
    assert.equal(events.messages[1]!.isBinary, true);

    ws.close(1000, "done");
    await waitFor(() => events.closes.length === 1);
    assert.equal(events.closes[0]!.code, 1000);
  } finally {
    await handle.close();
  }
});

test("Node adapter closes oversized WebSocket messages with 1009", async () => {
  const app = new App({ logger: false });
  app.ws("/small", { maxPayloadLength: 1, open: () => {}, message: () => {} });
  const handle = await startApp(app);
  try {
    const port = (handle.server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/small`);
    await waitOpen(ws);
    const closed = new Promise<CloseEvent>((resolve) => {
      ws.addEventListener("close", (ev) => resolve(ev), { once: true });
    });
    ws.send("too large");
    const ev = await closed;
    assert.equal(ev.code, WS_CLOSE_CODE.MESSAGE_TOO_BIG);
  } finally {
    await handle.close();
  }
});

test("Node adapter rejects upgrades to unknown paths and bad versions", async () => {
  const { handle, ready } = startNodeApp({ open: () => {} });
  await ready;
  try {
    const port = (handle.server.address() as AddressInfo).port;
    // Unknown path
    await assertHandshakeFails(`ws://127.0.0.1:${port}/no-such-route`);
    // Bad version — use raw HTTP request.
    const status = await rawUpgrade(port, "/echo/x", {
      "sec-websocket-version": "8",
    });
    assert.equal(status, 426);
    // Missing key
    const status2 = await rawUpgrade(port, "/echo/x", {
      "sec-websocket-key": "",
    });
    assert.equal(status2, 400);
  } finally {
    await handle.close();
  }
});

test("Node adapter honors beforeUpgrade rejection (Response) and protocol selection (string)", async () => {
  const app = new App({ logger: false });
  app.decorate("service", "chat");
  app.ws("/auth", {
    async beforeUpgrade(req) {
      if (!req.headers.get("authorization"))
        return new Response("nope", { status: 401 });
      return undefined;
    },
    open(conn) {
      conn.send("ok");
    },
  });
  app.ws("/proto", {
    beforeUpgrade: (_req, ctx) => ctx.protocols[0],
    open(conn, ctx) {
      conn.send(`${conn.protocol}:${(ctx.state as any).service}`);
    },
  });
  app.ws("/bad-proto", {
    beforeUpgrade: () => "not-offered",
    open() {},
  });
  const handle = await startApp(app);
  try {
    const port = (handle.server.address() as AddressInfo).port;
    const status = await rawUpgrade(port, "/auth", {});
    assert.equal(status, 401);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/proto`, [
      "chat",
      "superchat",
    ]);
    const received: string[] = [];
    ws.addEventListener("message", (ev: MessageEvent) => {
      if (typeof ev.data === "string") received.push(ev.data);
    });
    await waitOpen(ws);
    await waitFor(() => received.length === 1);
    assert.equal(received[0], "chat:chat");
    ws.close();

    const badProto = await rawUpgrade(port, "/bad-proto", {
      "sec-websocket-protocol": "chat",
    });
    assert.equal(badProto, 400);
  } finally {
    await handle.close();
  }
});

test("wsRateLimit() spends from the same bucket as HTTP rateLimit()", async () => {
  _resetSharedRateLimitStoresForTests();
  const app = new App({ logger: false });
  const limit = {
    windowMs: 60_000,
    max: 1,
    groupId: "login-flow",
    keyGenerator: () => "alice",
  };
  app.route({
    method: "POST",
    path: "/login",
    hooks: rateLimit(limit),
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  app.ws("/session", {
    beforeUpgrade: wsRateLimit(limit),
    open: () => {},
  });
  const handle = await startApp(app);
  try {
    const port = (handle.server.address() as AddressInfo).port;
    const first = await fetch(`http://127.0.0.1:${port}/login`, { method: "POST" });
    assert.equal(first.status, 200);
    const status = await rawUpgrade(port, "/session", {});
    assert.equal(status, 429);
  } finally {
    await handle.close();
    _resetSharedRateLimitStoresForTests();
  }
});

test("Node adapter recovers from beforeUpgrade throwing and from open() throwing", async () => {
  const app = new App({ logger: false });
  app.ws("/throw-before", {
    beforeUpgrade: () => {
      throw new Error("nope");
    },
    open: () => {},
  });
  let errorFired = 0;
  app.ws("/throw-open", {
    open: () => {
      throw new Error("open boom");
    },
    error: () => {
      errorFired++;
    },
  });
  const handle = await startApp(app);
  try {
    const port = (handle.server.address() as AddressInfo).port;
    const status = await rawUpgrade(port, "/throw-before", {});
    assert.equal(status, 500);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/throw-open`);
    await new Promise<void>((r) =>
      ws.addEventListener("close", () => r(), { once: true }),
    );
    assert.equal(errorFired, 1);
  } finally {
    await handle.close();
  }
});

test("Node adapter swallows exceptions from message/error/close handlers", async () => {
  const app = new App({ logger: false });
  app.ws("/handlers-throw", {
    open(conn) {
      conn.send("hi");
    },
    message: async () => {
      throw new Error("msg boom");
    },
    error: async () => {
      throw new Error("error-handler boom");
    },
    close: async () => {
      throw new Error("close boom");
    },
  });
  const handle = await startApp(app);
  try {
    const port = (handle.server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/handlers-throw`);
    await waitOpen(ws);
    ws.send("ping");
    // Give the server a tick to process the message + error path
    await new Promise<void>((r) => setTimeout(r, 50));
    await new Promise<void>((r) => {
      ws.addEventListener("close", () => r(), { once: true });
      ws.close();
    });
    // Give the server a tick to fire close handler too
    await new Promise<void>((r) => setTimeout(r, 50));
  } finally {
    await handle.close();
  }
});

test("Node adapter auto-pongs in response to a client PING frame", async () => {
  const app = new App({ logger: false });
  app.ws("/ping-server", { open() {} });
  const handle = await startApp(app);
  try {
    const port = (handle.server.address() as AddressInfo).port;
    const net = await import("node:net");
    const socket = net.connect({ port, host: "127.0.0.1" });
    await once(socket, "connect");
    socket.write(
      "GET /ping-server HTTP/1.1\r\n" +
        `Host: 127.0.0.1:${port}\r\n` +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        "Sec-WebSocket-Version: 13\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
        "\r\n",
    );
    // Drain the 101 response (and any extra bytes).
    await once(socket, "data");
    // Send a masked PING frame with payload "hi" (FIN=1, opcode=0x9, mask=1, len=2)
    const mask = Buffer.from([0xa1, 0xb2, 0xc3, 0xd4]);
    const payload = Buffer.from("hi");
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++)
      masked[i] = payload[i]! ^ mask[i % 4]!;
    socket.write(Buffer.concat([Buffer.from([0x89, 0x82]), mask, masked]));
    // Wait for the server's PONG echo: a single frame starting with 0x8A.
    const pongFrame: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      socket.on("data", (chunk) => {
        pongFrame.push(chunk as Buffer);
        if (Buffer.concat(pongFrame)[0] === 0x8a) resolve();
      });
      socket.on("error", reject);
      setTimeout(() => reject(new Error("timeout waiting for pong")), 500);
    });
    socket.destroy();
  } finally {
    await handle.close();
  }
});

test("Node adapter delivers ping/pong and respects arraybuffer binaryType", async () => {
  let pingReceived = false;
  const app = new App({ logger: false });
  app.ws("/control", {
    open(conn) {
      conn.binaryType = "arraybuffer";
      // exercise bufferedAmount getter on Node connection
      assert.equal(typeof conn.bufferedAmount, "number");
      conn.ping("ka");
      conn.pong("kb");
    },
    message(_conn, data, isBinary) {
      if (isBinary && data instanceof ArrayBuffer) {
        // confirm we got ArrayBuffer (not Uint8Array) when binaryType=arraybuffer
        pingReceived = data.byteLength === 2;
      }
    },
  });
  const handle = await startApp(app);
  try {
    const port = (handle.server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/control`);
    ws.binaryType = "arraybuffer";
    await waitOpen(ws);
    ws.send(new Uint8Array([1, 2]));
    await waitFor(() => pingReceived);
    ws.close();
  } finally {
    await handle.close();
  }
});

test("Node WebSocketConnection terminate(), close-after-close, and write past close are safe", async () => {
  const app = new App({ logger: false });
  let conn: any;
  app.ws("/term", {
    open(c) {
      conn = c;
    },
  });
  const handle = await startApp(app);
  try {
    const port = (handle.server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/term`);
    await waitOpen(ws);
    await waitFor(() => conn !== undefined);
    conn.send("x");
    conn.close(1000, "done");
    conn.close(1000); // second close — no-op
    conn.send("after-close"); // no-op
    conn.ping();
    conn.pong(); // no-op after close
    conn.terminate();
    ws.addEventListener("close", () => {});
  } finally {
    await handle.close();
  }
});

test("Node WebSocketConnection.ping/pong reject oversize control payloads", async () => {
  const app = new App({ logger: false });
  let captured: any;
  app.ws("/oversize", {
    open(c) {
      captured = c;
    },
  });
  const handle = await startApp(app);
  try {
    const port = (handle.server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/oversize`);
    await waitOpen(ws);
    await waitFor(() => captured !== undefined);
    assert.throws(
      () => captured.ping(new Uint8Array(200)),
      /Control frame payload exceeds/,
    );
    ws.close();
  } finally {
    await handle.close();
  }
});

test("Node adapter propagates abnormal client disconnect via close(1006)", async () => {
  const closeEvents: Array<{ code: number; reason: string }> = [];
  const app = new App({ logger: false });
  app.ws("/abnormal", {
    open() {},
    close(_c, code, reason) {
      closeEvents.push({ code, reason });
    },
  });
  const handle = await startApp(app);
  try {
    const port = (handle.server.address() as AddressInfo).port;
    // Open raw TCP socket, do handshake, then close abruptly without a close frame.
    const net = await import("node:net");
    const socket = net.connect({ port, host: "127.0.0.1" });
    await once(socket, "connect");
    socket.write(
      "GET /abnormal HTTP/1.1\r\n" +
        `Host: 127.0.0.1:${port}\r\n` +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        "Sec-WebSocket-Version: 13\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
        "\r\n",
    );
    // Wait for the 101 response (any bytes).
    await once(socket, "data");
    if (
      typeof (socket as { resetAndDestroy?: () => void }).resetAndDestroy ===
      "function"
    ) {
      (socket as { resetAndDestroy: () => void }).resetAndDestroy();
    } else {
      socket.destroy();
    }
    await waitFor(() => closeEvents.length === 1);
    assert.equal(closeEvents[0]!.code, WS_CLOSE_CODE.ABNORMAL_CLOSURE);
  } finally {
    await handle.close();
  }
});

test("Node adapter does not fire error() after a clean close when the socket is reset", async () => {
  // Regression: a peer that completes the close handshake and then resets the
  // TCP connection (crashed client, dropped network) must not surface a second
  // lifecycle event. error() firing after close() breaks the lifecycle contract
  // and double-runs handler cleanup.
  // The reset must race the close-handshake teardown, so run several attempts;
  // the invariant under test is order-based and must hold on every attempt.
  const net = await import("node:net");
  for (let attempt = 0; attempt < 8; attempt++) {
    const timeline: string[] = [];
    const app = new App({ logger: false });
    app.ws("/clean-then-reset", {
      open() {},
      close() {
        timeline.push("close");
      },
      error() {
        timeline.push("error");
      },
    });
    const handle = await startApp(app);
    try {
      const port = (handle.server.address() as AddressInfo).port;
      const socket = net.connect({ port, host: "127.0.0.1" });
      await once(socket, "connect");
      socket.write(
        "GET /clean-then-reset HTTP/1.1\r\n" +
          `Host: 127.0.0.1:${port}\r\n` +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "\r\n",
      );
      await once(socket, "data"); // 101 response
      // Send a clean masked CLOSE frame (code 1000) and immediately reset the
      // TCP connection, so the ECONNRESET arrives while the server is still
      // tearing the connection down after firing close().
      socket.write(Buffer.from([0x88, 0x82, 0x00, 0x00, 0x00, 0x00, 0x03, 0xe8]));
      if (
        typeof (socket as { resetAndDestroy?: () => void }).resetAndDestroy ===
        "function"
      ) {
        (socket as { resetAndDestroy: () => void }).resetAndDestroy();
      } else {
        socket.destroy(new Error("reset"));
      }
      await new Promise((r) => setTimeout(r, 80));
      // The contract: error() never fires after close() has already fired.
      const closeIdx = timeline.indexOf("close");
      const errorAfterClose =
        closeIdx !== -1 && timeline.indexOf("error", closeIdx + 1) !== -1;
      assert.equal(
        errorAfterClose,
        false,
        `attempt ${attempt}: error() fired after close() — timeline ${JSON.stringify(timeline)}`,
      );
    } finally {
      await handle.close();
    }
  }
});

test("Node adapter installs upgrade handler only when WS routes exist", async () => {
  const app = new App({ logger: false });
  const handle = await startApp(app);
  try {
    assert.equal(handle.server.listenerCount("upgrade"), 0);
  } finally {
    await handle.close();
  }
});

test("Node adapter closes connection with PROTOCOL_ERROR when client sends invalid frame", async () => {
  const errors: unknown[] = [];
  const closeEvents: Array<{ code: number; reason: string }> = [];
  const app = new App({ logger: false });
  app.ws("/bad", {
    open() {},
    error(_c, err) {
      errors.push(err);
    },
    close(_c, code, reason) {
      closeEvents.push({ code, reason });
    },
  });
  const handle = await startApp(app);
  try {
    const port = (handle.server.address() as AddressInfo).port;
    const net = await import("node:net");
    const socket = net.connect({ port, host: "127.0.0.1" });
    await once(socket, "connect");
    socket.write(
      "GET /bad HTTP/1.1\r\n" +
        `Host: 127.0.0.1:${port}\r\n` +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        "Sec-WebSocket-Version: 13\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
        "\r\n",
    );
    await once(socket, "data");
    // Send an unmasked text frame from client → server expects mask bit set.
    // Frame: FIN=1, opcode=text(1), mask=0, len=1, payload='a'
    socket.write(Buffer.from([0x81, 0x01, 0x61]));
    await waitFor(() => closeEvents.length === 1);
    assert.equal(closeEvents[0]!.code, WS_CLOSE_CODE.PROTOCOL_ERROR);
    assert.ok(errors.length >= 1);
    socket.destroy();
  } finally {
    await handle.close();
  }
});

// ---------- Bun adapter (with fake Bun shim) ----------

test("Bun adapter wires websocket config and routes upgrades", async () => {
  type FakeWs = {
    data: any;
    readyState: 0 | 1 | 2 | 3;
    binaryType: "arraybuffer" | "nodebuffer" | "uint8array";
    sends: Array<string | Uint8Array | ArrayBuffer>;
    pings: any[];
    pongs: any[];
    closeArgs?: [number?, string?];
    terminated: boolean;
  };
  const upgrades: Array<{ req: Request; opts: any }> = [];
  const fakeServer = {
    upgrade(req: Request, opts: any) {
      upgrades.push({ req, opts });
      return true;
    },
  };
  let wsConfig: any;
  const fakeBun = {
    serve(cfg: any) {
      wsConfig = cfg;
      return {
        port: 0,
        url: new URL("http://localhost:0/"),
        stop: () => {},
      };
    },
  };
  const prev = (globalThis as { Bun?: unknown }).Bun;
  (globalThis as { Bun?: unknown }).Bun = fakeBun;
  try {
    const app = new App({ logger: false });
    app.decorate("service", "bun-chat");
    const openCalls: any[] = [];
    const msgCalls: any[] = [];
    const closeCalls: any[] = [];
    const drainCalls: any[] = [];
    app.ws("/room/:id", {
      open(conn, ctx) {
        openCalls.push({ conn, ctx });
        conn.send("hi");
        conn.send(new Uint8Array([1]));
        conn.send(new ArrayBuffer(2));
        conn.send(new DataView(new Uint8Array([3]).buffer));
      },
      message(conn, data, isBinary) {
        msgCalls.push({ data, isBinary });
        conn.send("ack");
      },
      close(_c, code, reason) {
        closeCalls.push({ code, reason });
      },
      drain(_c) {
        drainCalls.push(true);
      },
    });
    app.ws("/proto", {
      beforeUpgrade: (_req, ctx) => ctx.protocols[0],
      open: () => {},
    });
    app.ws("/reject", {
      beforeUpgrade: () => new Response("nope", { status: 401 }),
      open: () => {},
    });
    app.ws("/throws", {
      beforeUpgrade: () => {
        throw new Error("boom");
      },
      open: () => {},
    });
    app.ws("/bad-proto", {
      beforeUpgrade: () => "not-offered",
      open: () => {},
    });
    app.ws("/small", {
      maxPayloadLength: 1,
      open: () => {},
      message: () => {
        throw new Error("oversized messages should close before message()");
      },
    });
    serveBun(app, { port: 1234, handleSignals: false });

    // websocket config present
    assert.ok(wsConfig.websocket);
    assert.equal(typeof wsConfig.websocket.open, "function");
    assert.equal(typeof wsConfig.websocket.message, "function");
    assert.equal(typeof wsConfig.websocket.close, "function");
    assert.equal(typeof wsConfig.websocket.drain, "function");
    assert.equal(wsConfig.websocket.closeOnBackpressureLimit, true);
    assert.equal(wsConfig.websocket.backpressureLimit, DEFAULT_WS_BACKPRESSURE_LIMIT);
    assert.equal(wsConfig.websocket.perMessageDeflate, false);
    assert.equal(wsConfig.websocket.idleTimeout, DEFAULT_WS_IDLE_TIMEOUT_SECONDS);
    assert.equal(wsConfig.websocket.maxPayloadLength, DEFAULT_WS_MAX_PAYLOAD_LENGTH);

    // Non-upgrade requests pass through fetch normally.
    const normalRes = await wsConfig.fetch(
      new Request("http://x.test/room/42"),
      fakeServer as any,
    );
    assert.equal(normalRes.status, 404); // unmatched HTTP route

    // Upgrade success path
    const upReq = new Request("http://x.test/room/42?u=alice", {
      headers: { upgrade: "websocket", "sec-websocket-protocol": "chat" },
    });
    const upRes = await wsConfig.fetch(upReq, fakeServer as any);
    assert.equal(upRes, undefined);
    assert.equal(upgrades.length, 1);
    const upgradeData = upgrades[0]!.opts.data;
    assert.equal(typeof upgradeData.handler.open, "function");
    assert.equal(upgradeData.ctx.params.id, "42");
    assert.equal(upgradeData.ctx.query.u, "alice");
    assert.equal(upgradeData.ctx.state.service, "bun-chat");

    // Simulate Bun open/message/close/drain
    const ws: FakeWs = {
      data: upgradeData,
      readyState: 1,
      binaryType: "uint8array",
      sends: [],
      pings: [],
      pongs: [],
      terminated: false,
      // implementations:
    } as any;
    Object.assign(ws, {
      send(d: any) {
        ws.sends.push(d);
        return 1;
      },
      close(code?: number, reason?: string) {
        ws.closeArgs = [code, reason];
      },
      terminate() {
        ws.terminated = true;
      },
      ping(d: any) {
        ws.pings.push(d);
        return 1;
      },
      pong(d: any) {
        ws.pongs.push(d);
        return 1;
      },
      getBufferedAmount: () => 7,
    });
    wsConfig.websocket.open(ws);
    assert.equal(openCalls.length, 1);
    const conn = openCalls[0]!.conn;
    // sends include string + 3 binary variants
    assert.equal(ws.sends.length, 4);
    assert.equal(ws.sends[0], "hi");
    assert.equal(conn.bufferedAmount, 7);
    // binaryType getter/setter
    assert.equal(conn.binaryType, "nodebuffer");
    conn.binaryType = "arraybuffer";
    assert.equal(ws.binaryType, "arraybuffer");

    wsConfig.websocket.message(ws, "hi");
    wsConfig.websocket.message(ws, new Uint8Array([5]));
    assert.equal(msgCalls.length, 2);
    assert.equal(msgCalls[0]!.isBinary, false);
    assert.equal(msgCalls[1]!.isBinary, true);

    const smallReq = new Request("http://x.test/small", {
      headers: { upgrade: "websocket" },
    });
    await wsConfig.fetch(smallReq, fakeServer as any);
    const smallWs: FakeWs = {
      data: upgrades[upgrades.length - 1]!.opts.data,
      readyState: 1,
      binaryType: "uint8array",
      sends: [],
      pings: [],
      pongs: [],
      terminated: false,
      closeArgs: undefined,
    } as any;
    Object.assign(smallWs, {
      send(d: any) {
        smallWs.sends.push(d);
        return 1;
      },
      close(code?: number, reason?: string) {
        smallWs.closeArgs = [code, reason];
      },
      terminate() {
        smallWs.terminated = true;
      },
      ping(d: any) {
        smallWs.pings.push(d);
        return 1;
      },
      pong(d: any) {
        smallWs.pongs.push(d);
        return 1;
      },
      getBufferedAmount: () => 0,
    });
    wsConfig.websocket.open(smallWs);
    wsConfig.websocket.message(smallWs, "too big");
    assert.deepEqual(smallWs.closeArgs, [
      WS_CLOSE_CODE.MESSAGE_TOO_BIG,
      "maxPayloadLength exceeded",
    ]);

    wsConfig.websocket.drain(ws);
    assert.equal(drainCalls.length, 1);

    // ping/pong/close/terminate via conn
    conn.ping("p1");
    conn.ping(new Uint8Array([0]));
    conn.ping(new ArrayBuffer(1));
    conn.ping(new DataView(new Uint8Array([1]).buffer));
    conn.ping();
    assert.equal(ws.pings.length, 5);
    assert.throws(
      () => conn.ping(new Uint8Array(200)),
      /Control frame payload exceeds/,
    );
    conn.pong("p2");
    conn.close(1000, "done");
    assert.deepEqual(ws.closeArgs, [1000, "done"]);
    conn.close(1000); // already-closing, no-op
    // After close, send is no-op
    const beforeSends = ws.sends.length;
    conn.send("after");
    assert.equal(ws.sends.length, beforeSends);
    conn.terminate();
    assert.equal(ws.terminated, true);

    wsConfig.websocket.close(ws, 1000, "bye");
    assert.equal(closeCalls.length, 1);

    // Subprotocol selection path
    const protoReq = new Request("http://x.test/proto", {
      headers: { upgrade: "websocket", "sec-websocket-protocol": "myproto" },
    });
    await wsConfig.fetch(protoReq, fakeServer as any);
    const protoUp = upgrades[upgrades.length - 1]!;
    assert.equal(
      (protoUp.opts.headers as any)["sec-websocket-protocol"],
      "myproto",
    );
    assert.equal(protoUp.opts.data.protocol, "myproto");

    // Invalid subprotocol selection path
    const badProto = await wsConfig.fetch(
      new Request("http://x.test/bad-proto", {
        headers: { upgrade: "websocket", "sec-websocket-protocol": "chat" },
      }),
      fakeServer as any,
    );
    assert.equal(badProto.status, 400);

    // Rejection path
    const reject = await wsConfig.fetch(
      new Request("http://x.test/reject", {
        headers: { upgrade: "websocket" },
      }),
      fakeServer as any,
    );
    assert.equal(reject.status, 401);

    // Throws path
    const throws = await wsConfig.fetch(
      new Request("http://x.test/throws", {
        headers: { upgrade: "websocket" },
      }),
      fakeServer as any,
    );
    assert.equal(throws.status, 500);

    // Unknown WS path
    const unknown = await wsConfig.fetch(
      new Request("http://x.test/no", { headers: { upgrade: "websocket" } }),
      fakeServer as any,
    );
    assert.equal(unknown.status, 404);

    // Upgrade returning false
    const failingServer = { upgrade: () => false };
    const fail = await wsConfig.fetch(
      new Request("http://x.test/room/9", {
        headers: { upgrade: "websocket" },
      }),
      failingServer as any,
    );
    assert.equal(fail.status, 500);

    // Bun open/message/close with no data slot — handler.conn unset paths
    const emptyWs: any = { ...ws, data: undefined };
    wsConfig.websocket.open(emptyWs);
    wsConfig.websocket.message(emptyWs, "x");
    wsConfig.websocket.close(emptyWs, 1000, "");
    wsConfig.websocket.drain(emptyWs);

    // Bun close passing nulls coerces defaults
    wsConfig.websocket.close(ws, null as any, null as any);
  } finally {
    if (prev === undefined) delete (globalThis as { Bun?: unknown }).Bun;
    else (globalThis as { Bun?: unknown }).Bun = prev;
  }
});

test("Bun adapter open/message/drain/close handlers swallow exceptions", () => {
  const fakeServer = { upgrade: () => true };
  let wsConfig: any;
  const fakeBun = {
    serve(cfg: any) {
      wsConfig = cfg;
      return { port: 0, url: undefined, stop: () => {} };
    },
  };
  const prev = (globalThis as { Bun?: unknown }).Bun;
  (globalThis as { Bun?: unknown }).Bun = fakeBun;
  try {
    const app = new App({ logger: false });
    app.ws("/x", {
      open: () => {
        throw new Error("open");
      },
      message: () => {
        throw new Error("msg");
      },
      drain: () => {
        throw new Error("drain");
      },
      close: () => {
        throw new Error("close");
      },
    });
    serveBun(app, { handleSignals: false });
    // Pre-populate connection via fetch+upgrade
    void wsConfig.fetch(
      new Request("http://x.test/x", { headers: { upgrade: "websocket" } }),
      fakeServer as any,
    );
    // Fake ws with a data slot built manually
    const ws: any = {
      data: {
        handler: app.webSocketRoutes.find("/x")!.handler.handler,
        ctx: {
          request: new Request("http://x.test/x"),
          params: {},
          query: {},
          headers: {},
          state: {},
          protocols: [],
        },
        protocol: "",
      },
      send: () => 0,
      close: () => {},
      terminate: () => {},
      ping: () => 0,
      pong: () => 0,
      binaryType: "uint8array",
    };
    // first open populates conn
    wsConfig.websocket.open(ws);
    wsConfig.websocket.message(ws, "x");
    wsConfig.websocket.drain(ws);
    wsConfig.websocket.close(ws, 1000, "x");
  } finally {
    if (prev === undefined) delete (globalThis as { Bun?: unknown }).Bun;
    else (globalThis as { Bun?: unknown }).Bun = prev;
  }
});

test("Bun adapter routes async open/message rejections to error handler", async () => {
  let wsConfig: any;
  const fakeBun = {
    serve(cfg: any) {
      wsConfig = cfg;
      return { port: 0, url: undefined, stop: () => {} };
    },
  };
  const prev = (globalThis as { Bun?: unknown }).Bun;
  (globalThis as { Bun?: unknown }).Bun = fakeBun;
  try {
    const app = new App({ logger: false });
    let errors = 0;
    app.ws("/async", {
      open: async () => {
        throw new Error("open async");
      },
      message: async () => {
        throw new Error("message async");
      },
      error: async () => {
        errors++;
      },
    });
    serveBun(app, { handleSignals: false });
    const ws: any = {
      data: {
        handler: app.webSocketRoutes.find("/async")!.handler.handler,
        ctx: {
          request: new Request("http://x.test/async"),
          params: {},
          query: {},
          headers: {},
          state: {},
          protocols: [],
        },
        protocol: "",
      },
      send: () => 0,
      close: () => {},
      terminate: () => {},
      ping: () => 0,
      pong: () => 0,
      binaryType: "uint8array",
    };
    wsConfig.websocket.open(ws);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    wsConfig.websocket.message(ws, "x");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.equal(errors, 2);
  } finally {
    if (prev === undefined) delete (globalThis as { Bun?: unknown }).Bun;
    else (globalThis as { Bun?: unknown }).Bun = prev;
  }
});

// ---------- helpers ----------

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function assertHandshakeFails(url: string): Promise<void> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve) => {
    ws.addEventListener("error", () => resolve(), { once: true });
    ws.addEventListener("close", () => resolve(), { once: true });
  });
}

async function rawUpgrade(
  port: number,
  path: string,
  extraHeaders: Record<string, string>,
): Promise<number> {
  const { request } = await import("node:http");
  return await new Promise<number>((resolve, reject) => {
    const headers: Record<string, string> = {
      upgrade: "websocket",
      connection: "Upgrade",
      "sec-websocket-version": "13",
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      ...extraHeaders,
    };
    // Allow removal by passing empty string.
    for (const [k, v] of Object.entries(headers)) {
      if (v === "") delete headers[k];
    }
    const req = request({ port, path, method: "GET", headers });
    req.on("response", (res) => {
      const status = res.statusCode ?? 0;
      res.on("data", () => {});
      res.on("end", () => resolve(status));
      res.on("close", () => resolve(status));
    });
    req.on("upgrade", (res) => {
      resolve(res.statusCode ?? 101);
    });
    req.on("error", reject);
    req.end();
  });
}

// Silence unused server-startup helper warning when no test calls onError.
void startNodeApp;
// Avoid eslint unused warning on createServer import (kept for potential future use).
void createServer;
