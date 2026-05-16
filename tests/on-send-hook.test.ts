import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { App, NotFoundError } from "../src/index.js";

function makeApp(opts?: ConstructorParameters<typeof App>[0]) {
  const app = new App(opts);
  app.route({
    method: "GET",
    path: "/ok",
    operationId: "ok",
    responses: {
      200: { description: "ok", body: z.object({ ok: z.boolean() }) as any },
    },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  app.route({
    method: "GET",
    path: "/boom",
    operationId: "boom",
    responses: { 404: { description: "no" } },
    handler: async () => {
      throw new NotFoundError("nope");
    },
  });
  return app;
}

test("onSend mutates headers in-place when returning void", async () => {
  const app = makeApp({
    hooks: {
      onSend(res) {
        res.headers.set("x-sent", "1");
      },
    },
  });
  const res = await app.request("/ok");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-sent"), "1");
});

test("onSend can replace the response by returning a new Response", async () => {
  const app = makeApp({
    hooks: {
      onSend(res) {
        return new Response(JSON.stringify({ replaced: true }), {
          status: 202,
          headers: { "content-type": "application/json", "x-replaced": "yes" },
        });
      },
    },
  });
  const res = await app.request("/ok");
  assert.equal(res.status, 202);
  assert.equal(res.headers.get("x-replaced"), "yes");
  assert.deepEqual(await res.json(), { replaced: true });
});

test("multiple onSend hooks compose pipeline-style", async () => {
  const order: string[] = [];
  const app = new App({
    hooks: {
      onSend(res) {
        order.push("global");
        res.headers.set("x-global", "1");
      },
    },
  });
  app.use({
    onSend(res) {
      order.push("group");
      res.headers.set("x-group", "1");
    },
  });
  app.route({
    method: "GET",
    path: "/r",
    operationId: "r",
    hooks: {
      onSend(res) {
        order.push("route");
        res.headers.set("x-route", "1");
      },
    },
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: null }),
  });

  const res = await app.request("/r");
  assert.deepEqual(order, ["global", "group", "route"]);
  assert.equal(res.headers.get("x-global"), "1");
  assert.equal(res.headers.get("x-group"), "1");
  assert.equal(res.headers.get("x-route"), "1");
});

test("onSend runs on the error path and can replace error responses", async () => {
  let observed: number | undefined;
  const app = makeApp({
    hooks: {
      onSend(res) {
        observed = res.status;
        res.headers.set("x-error-touched", "1");
      },
    },
  });
  const res = await app.request("/boom");
  assert.equal(res.status, 404);
  assert.equal(observed, 404);
  assert.equal(res.headers.get("x-error-touched"), "1");
});

test("onSend runs after a beforeHandle short-circuit", async () => {
  const app = new App({
    hooks: {
      onSend(res) {
        res.headers.set("x-sent", "via-onsend");
      },
    },
  });
  app.route({
    method: "GET",
    path: "/short",
    operationId: "short",
    hooks: {
      beforeHandle: () =>
        new Response("blocked", { status: 403, headers: { "content-type": "text/plain" } }),
    },
    responses: { 200: { description: "ok" }, 403: { description: "blocked" } },
    handler: async () => ({ status: 200 as const, body: null }),
  });

  const res = await app.request("/short");
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("x-sent"), "via-onsend");
});

test("onSend runs on OPTIONS preflight responses", async () => {
  const app = new App({
    hooks: {
      onSend(res) {
        res.headers.set("x-preflight", "yes");
      },
    },
  });
  app.route({
    method: "GET",
    path: "/cors",
    operationId: "cors",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: null }),
  });

  const res = await app.request("/cors", { method: "OPTIONS" });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("allow"), "GET");
  assert.equal(res.headers.get("x-preflight"), "yes");
});

test("onSend runs after onError replaces the error", async () => {
  const order: string[] = [];
  const app = new App({
    hooks: {
      onError(err) {
        order.push("onError");
        return new Response(JSON.stringify({ handled: true }), {
          status: 418,
          headers: { "content-type": "application/json" },
        });
      },
      onSend(res) {
        order.push("onSend");
        res.headers.set("x-final", "1");
      },
      onResponse() {
        order.push("onResponse");
      },
    },
  });
  app.route({
    method: "GET",
    path: "/throw",
    operationId: "throw",
    responses: { 418: { description: "teapot" } },
    handler: async () => {
      throw new Error("kaboom");
    },
  });

  const res = await app.request("/throw");
  assert.equal(res.status, 418);
  assert.equal(res.headers.get("x-final"), "1");
  assert.deepEqual(await res.json(), { handled: true });
  assert.deepEqual(order, ["onError", "onSend", "onResponse"]);
});

test("onSend failures flow through onError before the final response", async () => {
  const order: string[] = [];
  let firstSend = true;
  const app = new App({
    hooks: {
      onError(err) {
        order.push(`onError:${err instanceof Error ? err.message : "unknown"}`);
        return new Response(JSON.stringify({ recovered: true }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      },
      onSend(res) {
        order.push("onSend");
        if (firstSend) {
          firstSend = false;
          throw new Error("send failed");
        }
        res.headers.set("x-recovered", "1");
      },
      onResponse() {
        order.push("onResponse");
      },
    },
  });
  app.route({
    method: "GET",
    path: "/recover",
    operationId: "recover",
    responses: { 200: { description: "ok" }, 500: { description: "recovered" } },
    handler: async () => ({ status: 200 as const, body: null }),
  });

  const res = await app.request("/recover");
  assert.equal(res.status, 500);
  assert.equal(res.headers.get("x-recovered"), "1");
  assert.deepEqual(await res.json(), { recovered: true });
  assert.deepEqual(order, ["onSend", "onError:send failed", "onSend", "onResponse"]);
});

test("onSend on an OPTIONS preflight whose beforeHandle short-circuits", async () => {
  const app = new App({
    hooks: {
      beforeHandle() {
        return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*" } });
      },
      onSend(res) {
        res.headers.set("x-pf", "1");
      },
    },
  });
  app.route({
    method: "GET",
    path: "/x",
    operationId: "x",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: null }),
  });

  const res = await app.request("/x", { method: "OPTIONS" });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("x-pf"), "1");
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
});

test("returning a non-Response from onSend keeps the original response", async () => {
  const app = makeApp({
    hooks: {
      // @ts-expect-error — exercise the runtime guard for non-Response returns
      onSend() {
        return "not a response";
      },
    },
  });
  const res = await app.request("/ok");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});
