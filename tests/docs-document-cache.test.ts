import { test } from "node:test";
import assert from "node:assert/strict";

import { App } from "../src/index.js";

// The OpenAPI / AsyncAPI documents are generated once and rebuilt only when a
// route (or WebSocket route) is registered afterwards. These tests pin both
// halves: repeated GETs do not re-walk the schemas, and a late route still
// shows up. Each response is a copy, so a hook mutating it cannot poison the
// cache for the next caller.

/** Standard Schema whose JSON Schema conversion counts how often it runs. */
function countingSchema() {
  const counter = { calls: 0 };
  const schema = {
    "~standard": {
      version: 1 as const,
      vendor: "test",
      validate: (value: unknown) => ({ value: value as { ok: boolean } }),
    },
    toJSONSchema() {
      counter.calls++;
      return { type: "object", properties: { ok: { type: "boolean" } } };
    },
  };
  return { schema, counter };
}

function docsApp() {
  const { schema, counter } = countingSchema();
  const app = new App({ logger: false, docs: true });
  app.route({
    method: "GET",
    path: "/ping",
    operationId: "ping",
    responses: { 200: { description: "ok", body: schema } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  return { app, counter };
}

const json = async (app: App<any>, path: string) => {
  const res = await app.request(path);
  assert.equal(res.status, 200, path);
  return (await res.json()) as { paths: Record<string, unknown>; info: { title: string } };
};

test("openapi: repeated requests reuse one generated document", async () => {
  const { app, counter } = docsApp();
  const first = await json(app, "/openapi.json");
  const afterFirst = counter.calls;
  assert.ok(afterFirst > 0, "schema converted on first request");
  for (let i = 0; i < 5; i++) assert.deepEqual(await json(app, "/openapi.json"), first);
  const yaml = await (await app.request("/openapi.yaml")).text();
  assert.match(yaml, /\/ping/);
  await app.request("/openapi.yaml");
  assert.equal(counter.calls, afterFirst, "no re-generation for JSON or YAML");
});

test("openapi: a route registered after the first request appears in the next document", async () => {
  const { app, counter } = docsApp();
  assert.equal("/late" in (await json(app, "/openapi.json")).paths, false);
  const before = counter.calls;
  app.route({
    method: "GET",
    path: "/late",
    operationId: "late",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });
  assert.ok("/late" in (await json(app, "/openapi.json")).paths);
  assert.match(await (await app.request("/openapi.yaml")).text(), /\/late/);
  assert.ok(counter.calls > before, "document regenerated after the new route");
});

test("openapi: a hook mutating the document cannot change what the next caller gets", async () => {
  let poisoned = false;
  const app = new App({
    logger: false,
    docs: true,
    openapi: { info: { title: "Real", version: "1" } },
    // Constructor hooks are the ones that also wrap the framework's docs routes.
    hooks: {
      afterHandle(_ctx: unknown, result: any) {
        if (!poisoned && result?.body?.openapi) {
          poisoned = true;
          result.body.info.title = "Poisoned";
        }
        return undefined;
      },
    },
  } as any);
  assert.equal((await json(app, "/openapi.json")).info.title, "Poisoned");
  assert.equal((await json(app, "/openapi.json")).info.title, "Real");
});

test("asyncapi: the document is cached and rebuilt after a new ws() route", async () => {
  const app = new App({ logger: false, asyncapi: true });
  const ws = (path: `/${string}`) =>
    app.ws(path, {
      acknowledgeUnauthenticated: true,
      allowedOrigins: "same-origin",
      message(conn, data) {
        conn.send(data as string);
      },
    });
  ws("/chat");
  const channels = async () =>
    Object.keys(((await (await app.request("/asyncapi.json")).json()) as { channels: object }).channels);
  const first = await channels();
  assert.equal(first.length, 1);
  assert.deepEqual(await channels(), first);
  ws("/feed");
  assert.equal((await channels()).length, 2);
  assert.match(await (await app.request("/asyncapi.yaml")).text(), /feed/);
});
