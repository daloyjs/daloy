import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { App } from "../src/app.js";
import { basicAuth, bearerAuth, rateLimit, requestId } from "../src/middleware.js";

function protectedBodyApp() {
  const app = new App({ logger: false });
  app.use(bearerAuth({ validate: (token) => token === "good" }));
  app.route({
    method: "POST",
    path: "/messages",
    operationId: "createMessage",
    request: { body: z.object({ message: z.string() }) },
    responses: { 200: { description: "OK" } },
    handler: ({ body }) => ({ status: 200, body }),
  });
  return app;
}

test("header auth rejects before reading a declared request body", async () => {
  const app = protectedBodyApp();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new TextEncoder().encode('{"message":"hello"}'));
      controller.close();
    },
  });
  const request = new Request("http://app.local/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  const response = await app.request(request);

  assert.equal(response.status, 401);
  assert.equal(request.bodyUsed, false);
});

test("request ids are established before an early auth rejection", async () => {
  const app = new App({ logger: false });
  app.use(requestId({ generator: () => "early-request-id" }));
  app.use(bearerAuth({ validate: () => false }));
  app.route({
    method: "GET",
    path: "/private",
    responses: { 200: { description: "OK" } },
    handler: () => ({ status: 200, body: undefined }),
  });

  const response = await app.request("/private");

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("x-request-id"), "early-request-id");
});

test("a rate limiter registered before auth counts early failures without reading bodies", async () => {
  const app = new App({ logger: false });
  app.use(rateLimit({ windowMs: 60_000, max: 1, keyGenerator: () => "attacker" }));
  app.use(basicAuth({ verify: () => false }));
  app.route({
    method: "POST",
    path: "/login",
    request: { body: z.object({ payload: z.string() }) },
    responses: { 200: {} },
    handler: () => ({ status: 200, body: undefined }),
  });
  const attempt = () =>
    new Request("http://app.local/login", {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa("alice:wrong")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ payload: "large upload placeholder" }),
    });
  const first = attempt();
  const second = attempt();

  assert.equal((await app.request(first)).status, 401);
  assert.equal(first.bodyUsed, false);
  assert.equal((await app.request(second)).status, 429);
  assert.equal(second.bodyUsed, false);
});

test("authorized requests still read and validate the declared body", async () => {
  const app = protectedBodyApp();
  const response = await app.request("/messages", {
    method: "POST",
    headers: {
      authorization: "Bearer good",
      "content-type": "application/json",
    },
    body: JSON.stringify({ message: "hello" }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { message: "hello" });
});

test("preBody runs before validation while beforeHandle keeps validated context", async () => {
  const phases: string[] = [];
  const app = new App({ logger: false });
  app.use({
    preBody(ctx) {
      phases.push(`pre:${String(ctx.body)}`);
    },
    beforeHandle(ctx) {
      phases.push(`validated:${String((ctx.body as { value: string }).value)}`);
    },
  });
  app.route({
    method: "POST",
    path: "/phase",
    request: { body: z.object({ value: z.string() }) },
    responses: { 204: { description: "Done" } },
    handler: () => ({ status: 204, body: undefined }),
  });

  const response = await app.request("/phase", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: "ok" }),
  });

  assert.equal(response.status, 204);
  assert.deepEqual(phases, ["pre:undefined", "validated:ok"]);
});
