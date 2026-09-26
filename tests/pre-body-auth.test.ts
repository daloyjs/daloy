import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { App } from "../src/app.js";
import {
  basicAuth,
  bearerAuth,
  loginThrottle,
  markAuthHook,
  rateLimit,
  requestId,
} from "../src/middleware.js";
import { UnauthorizedError } from "../src/errors.js";

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

function throwingAuthApp(limiter: Parameters<App["use"]>[0], auth: Parameters<App["use"]>[0]) {
  const app = new App({ logger: false });
  app.use(limiter);
  app.use(auth);
  app.route({
    method: "GET",
    path: "/secret",
    responses: { 200: { description: "OK" } },
    handler: () => ({ status: 200, body: undefined }),
  });
  return app;
}

async function statuses(app: App, n: number, authorization: string): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push((await app.request("/secret", { headers: { authorization } })).status);
  }
  return out;
}

test("a rate limiter before bearerAuth counts thrown invalid-token rejections (403 -> 429)", async () => {
  const app = throwingAuthApp(
    rateLimit({ windowMs: 60_000, max: 2, keyGenerator: () => "attacker" }),
    bearerAuth({ validate: () => false })
  );
  assert.deepEqual(await statuses(app, 4, "Bearer guess"), [403, 403, 429, 429]);
});

test("a rate limiter before a throwing markAuthHook counts failures and rethrows under budget", async () => {
  const app = throwingAuthApp(
    rateLimit({ windowMs: 60_000, max: 2, keyGenerator: () => "attacker" }),
    markAuthHook({
      preBody() {
        throw new UnauthorizedError();
      },
    })
  );
  const first = await app.request("/secret");
  assert.equal(first.status, 401);
  assert.equal(first.headers.get("x-ratelimit-remaining"), "1");
  assert.deepEqual(await statuses(app, 2, "Bearer guess"), [401, 429]);
});

test("loginThrottle before a throwing auth hook hard-limits thrown rejections", async () => {
  const app = throwingAuthApp(
    loginThrottle({
      groupId: "pre-body-throw-test",
      max: 2,
      delayMs: 0,
      keyGenerator: () => "attacker",
    }),
    bearerAuth({ validate: () => false })
  );
  assert.deepEqual(await statuses(app, 3, "Bearer guess"), [403, 403, 429]);
});

test("valid bearer tokens still pass once and are charged only once per request", async () => {
  const app = throwingAuthApp(
    rateLimit({ windowMs: 60_000, max: 2, keyGenerator: () => "user" }),
    bearerAuth({ validate: (token) => token === "good" })
  );
  const ok = await app.request("/secret", { headers: { authorization: "Bearer good" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("x-ratelimit-remaining"), "1");
  // A later failure is still counted, and the original 403 surfaces while under budget.
  assert.deepEqual(await statuses(app, 2, "Bearer bad"), [403, 429]);
});
