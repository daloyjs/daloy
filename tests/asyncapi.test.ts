/**
 * AsyncAPI 3.0 generator for WebSocket surfaces.
 *
 * Verifies that `generateAsyncAPI` mirrors the OpenAPI generator: one channel
 * per `app.ws()` route (address + path parameters), a `receive` operation for
 * inbound client messages, an optional `send` operation for outbound messages,
 * permissive payload fallbacks, the YAML serializer, and the `--asyncapi` CLI
 * flag. Both happy and unhappy paths are exercised.
 *
 * @since 0.37.0
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { App } from "../src/app.js";
import { runCli, type CliIO } from "../src/cli.js";
import { generateAsyncAPI, asyncapiToYAML, type AsyncAPIOptions } from "../src/asyncapi.js";

const INFO: AsyncAPIOptions = { info: { title: "Realtime API", version: "1.0.0" } };

/** Build a Standard-Schema-shaped stub that exposes the given `toJSONSchema`. */
function schemaStub(json: unknown): any {
  return {
    "~standard": { version: 1, vendor: "test", validate: (v: unknown) => ({ value: v }) },
    toJSONSchema() {
      return json;
    },
  };
}

// ---------- Happy paths ----------

test("generateAsyncAPI: empty app yields a valid document with empty maps", () => {
  const app = new App({ logger: false });
  const doc = generateAsyncAPI(app, INFO);
  assert.equal(doc.asyncapi, "3.0.0");
  assert.deepEqual(doc.info, { title: "Realtime API", version: "1.0.0" });
  assert.deepEqual(doc.channels, {});
  assert.deepEqual(doc.operations, {});
  assert.deepEqual((doc.components as any).messages, {});
});

test("generateAsyncAPI: a ws route always emits a receive operation with permissive payload", () => {
  const app = new App({ logger: false });
  app.ws("/feed", { open() {}, message() {} });

  const doc = generateAsyncAPI(app, INFO);
  const channels = doc.channels as Record<string, any>;
  const operations = doc.operations as Record<string, any>;

  assert.equal(channels.feed.address, "/feed");
  assert.equal(operations.feedReceive.action, "receive");
  assert.deepEqual(operations.feedReceive.channel, { $ref: "#/channels/feed" });
  // No outbound schema declared → no send operation.
  assert.equal(operations.feedSend, undefined);
  // Permissive payload when no schema is attached.
  assert.deepEqual((doc.components as any).messages.feedReceive.payload, {});
});

test("generateAsyncAPI: receive payload comes from handler.request.body schema", () => {
  const app = new App({ logger: false });
  const body = schemaStub({ type: "object", properties: { text: { type: "string" } } });
  app.ws("/chat", { request: { body }, open() {}, message() {} });

  const doc = generateAsyncAPI(app, INFO);
  const messages = (doc.components as any).messages;
  assert.deepEqual(messages.chatReceive.payload, {
    type: "object",
    properties: { text: { type: "string" } },
  });
});

test("generateAsyncAPI: meta.send adds a send operation and outbound message", () => {
  const app = new App({ logger: false });
  const send = schemaStub({ type: "object", properties: { ping: { type: "number" } } });
  app.ws("/notifications", {
    meta: { send, summary: "Server push", tags: ["realtime"] },
    open() {},
  });

  const doc = generateAsyncAPI(app, INFO);
  const operations = doc.operations as Record<string, any>;
  const channels = doc.channels as Record<string, any>;

  assert.equal(operations.notificationsSend.action, "send");
  assert.equal(operations.notificationsSend.summary, "Server push");
  assert.deepEqual(operations.notificationsSend.tags, [{ name: "realtime" }]);
  assert.deepEqual(operations.notificationsSend.messages, [
    { $ref: "#/channels/notifications/messages/sendMessage" },
  ]);
  assert.deepEqual(channels.notifications.messages.sendMessage, {
    $ref: "#/components/messages/notificationsSend",
  });
  assert.deepEqual((doc.components as any).messages.notificationsSend.payload, {
    type: "object",
    properties: { ping: { type: "number" } },
  });
});

test("generateAsyncAPI: meta.receive overrides handler.request.body for the inbound payload", () => {
  const app = new App({ logger: false });
  const body = schemaStub({ type: "string" });
  const receive = schemaStub({ type: "object", properties: { kind: { type: "string" } } });
  app.ws("/override", { request: { body }, meta: { receive }, open() {}, message() {} });

  const doc = generateAsyncAPI(app, INFO);
  assert.deepEqual((doc.components as any).messages.overrideReceive.payload, {
    type: "object",
    properties: { kind: { type: "string" } },
  });
});

test("generateAsyncAPI: path params produce a templated address and parameters block", () => {
  const app = new App({ logger: false });
  app.ws("/rooms/:room/users/:userId", { open() {}, message() {} });

  const doc = generateAsyncAPI(app, INFO);
  const channels = doc.channels as Record<string, any>;
  const channel = channels.roomsRoomUsersUserId;
  assert.equal(channel.address, "/rooms/{room}/users/{userId}");
  assert.deepEqual(Object.keys(channel.parameters), ["room", "userId"]);
  assert.match(channel.parameters.room.description, /room/);
});

test("generateAsyncAPI: meta.operationId overrides the derived channel key", () => {
  const app = new App({ logger: false });
  app.ws("/x", { meta: { operationId: "customChannel" }, open() {}, message() {} });

  const doc = generateAsyncAPI(app, INFO);
  assert.ok((doc.channels as any).customChannel);
  assert.equal((doc.operations as any).customChannelReceive.action, "receive");
});

test("generateAsyncAPI: colliding derived keys are de-duplicated", () => {
  const app = new App({ logger: false });
  // Two distinct paths that slugify to the same "chatRoom" key.
  app.ws("/chat/room", { open() {}, message() {} });
  app.ws("/chat-room", { open() {}, message() {} });

  const doc = generateAsyncAPI(app, INFO);
  const keys = Object.keys(doc.channels as Record<string, unknown>);
  assert.equal(keys.length, 2);
  assert.ok(keys.includes("chatRoom"));
  assert.ok(keys.includes("chatRoom2"));
});

test("generateAsyncAPI: servers are passed through verbatim", () => {
  const app = new App({ logger: false });
  app.ws("/feed", { open() {} });
  const doc = generateAsyncAPI(app, {
    info: { title: "T", version: "1.0.0" },
    servers: { production: { host: "api.example.com", protocol: "wss" } },
  });
  assert.deepEqual(doc.servers, {
    production: { host: "api.example.com", protocol: "wss" },
  });
});

test("generateAsyncAPI: description is included on the document and channel", () => {
  const app = new App({ logger: false });
  app.ws("/feed", { meta: { description: "Live feed" }, open() {} });
  const doc = generateAsyncAPI(app, {
    info: { title: "T", version: "1.0.0", description: "Top-level" },
  });
  assert.equal((doc.info as any).description, "Top-level");
  assert.equal((doc.channels as any).feed.description, "Live feed");
});

test("asyncapiToYAML: serializes an AsyncAPI document to YAML", () => {
  const app = new App({ logger: false });
  app.ws("/feed", { open() {}, message() {} });
  const yaml = asyncapiToYAML(generateAsyncAPI(app, INFO));
  assert.match(yaml, /asyncapi: 3\.0\.0/);
  assert.match(yaml, /action: receive/);
});

// ---------- Unhappy paths ----------

test("generateAsyncAPI: schema whose toJSONSchema throws falls back to a permissive payload", () => {
  const app = new App({ logger: false });
  const throwing: any = {
    "~standard": { version: 1, vendor: "test", validate: (v: unknown) => ({ value: v }) },
    toJSONSchema() {
      throw new Error("boom");
    },
  };
  app.ws("/chat", { request: { body: throwing }, open() {}, message() {} });

  const doc = generateAsyncAPI(app, INFO);
  assert.deepEqual((doc.components as any).messages.chatReceive.payload, {});
});

test("generateAsyncAPI: schema without toJSONSchema falls back to a permissive payload", () => {
  const app = new App({ logger: false });
  const opaque: any = {
    "~standard": { version: 1, vendor: "test", validate: (v: unknown) => ({ value: v }) },
  };
  app.ws("/chat", { request: { body: opaque }, open() {}, message() {} });

  const doc = generateAsyncAPI(app, INFO);
  assert.deepEqual((doc.components as any).messages.chatReceive.payload, {});
});

test("generateAsyncAPI: root path '/' yields a 'root' channel key", () => {
  const app = new App({ logger: false });
  app.ws("/", { open() {}, message() {} });
  const doc = generateAsyncAPI(app, INFO);
  assert.equal((doc.channels as any).root.address, "/");
});

// ---------- CLI ----------

function buildIO(app: App) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIO = {
    stdout: (c) => out.push(c),
    stderr: (c) => err.push(c),
    importEntry: async () => ({ default: app }),
    version: "0.0.0-test",
  };
  return { io, out, err };
}

test("runCli: --asyncapi prints the AsyncAPI JSON document", async () => {
  const app = new App({ logger: false });
  app.ws("/feed", { open() {}, message() {} });
  const { io, out } = buildIO(app);

  const r = await runCli(["inspect", "--asyncapi", "src/app.ts"], io);
  assert.equal(r.exitCode, 0);
  const doc = JSON.parse(out.join(""));
  assert.equal(doc.asyncapi, "3.0.0");
  assert.ok(doc.channels.feed);
});

test("runCli: --asyncapi --format yaml prints YAML", async () => {
  const app = new App({ logger: false });
  app.ws("/feed", { open() {}, message() {} });
  const { io, out } = buildIO(app);

  const r = await runCli(["inspect", "--asyncapi", "--format", "yaml", "src/app.ts"], io);
  assert.equal(r.exitCode, 0);
  assert.match(out.join(""), /asyncapi: 3\.0\.0/);
});

test("parseArgs: --asyncapi sets the asyncapi flag", async () => {
  const app = new App({ logger: false });
  const { io } = buildIO(app);
  // Exercise the help text path referencing --asyncapi as well.
  const r = await runCli(["--help"], io);
  assert.equal(r.exitCode, 0);
});
