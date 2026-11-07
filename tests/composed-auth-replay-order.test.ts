import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { App } from "../src/app.js";
import { every, except, some } from "../src/combine.js";
import { UnauthorizedError } from "../src/errors.js";
import { idempotency } from "../src/idempotency.js";
import { bearerAuth, markAuthHook, _orderBeforeHandleForReplay } from "../src/middleware.js";
import { responseCache } from "../src/response-cache.js";
import type { Hooks } from "../src/types.js";

const variants: Record<string, (gate: Hooks) => Hooks> = {
  bare: gate => gate,
  every: gate => every(gate, idempotency()),
  nested: gate => every(every(gate, idempotency())),
  some: gate => some(every(gate, idempotency())),
  except: gate => except("/public", every(gate, idempotency())),
  marked: gate => markAuthHook(every(gate, idempotency())),
  spread: gate => {
    const inner = every(gate, idempotency());
    return { ...inner, beforeHandle: ctx => inner.beforeHandle!(ctx) };
  },
};

for (const [name, compose] of Object.entries(variants)) {
  test(`composed auth replay: ${name} requires proof before a principal cache hit`, async () => {
    let proofChecks = 0;
    let handlerCalls = 0;
    const app = new App({ env: "production", logger: false, behindProxy: "none" });
    app.use(bearerAuth({
      validate: token => token === "dummy-baseline" ? { sub: "dummy-owner" } : false,
    }));
    app.use(responseCache({
      principal: ctx => {
        const user = ctx.state.user;
        if (!user || typeof user !== "object" || !("sub" in user) || typeof user.sub !== "string") {
          throw new UnauthorizedError();
        }
        return user.sub;
      },
    }));
    const gate = markAuthHook({
      beforeHandle(ctx) {
        proofChecks++;
        if (ctx.request.headers.get("x-dummy-proof") !== "owner-proof") {
          throw new UnauthorizedError("Additional proof required");
        }
      },
    });
    app.route({
      method: "GET", path: "/protected", operationId: "protected",
      hooks: compose(gate),
      responses: { 200: { description: "ok", body: z.object({ marker: z.literal("protected") }) } },
      handler: () => {
        handlerCalls++;
        return { status: 200 as const, body: { marker: "protected" as const } };
      },
    });
    const headers = { authorization: "Bearer dummy-baseline", "x-dummy-proof": "owner-proof" };
    assert.equal((await app.request("/protected", { headers })).status, 200);
    const hit = await app.request("/protected", { headers });
    assert.equal(hit.status, 200);
    assert.equal(hit.headers.get("x-cache"), "HIT");
    assert.equal(handlerCalls, 1);
    assert.equal(proofChecks, 2);
    const denied = await app.request("/protected", { headers: { authorization: headers.authorization } });
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get("x-cache"), null);
    assert.equal(handlerCalls, 1);
    assert.equal(proofChecks, 3);
    assert.equal((await app.request("/protected", { headers: { ...headers, authorization: "Bearer invalid" } })).status, 403);
    assert.equal(proofChecks, 3);
  });
}

test("composed auth replay: separate all-of replay stacks cannot hide a later proof", async () => {
  let handlerCalls = 0;
  const app = new App({ logger: false });
  app.use(responseCache());
  const gate = (header: string) => markAuthHook({
    beforeHandle(ctx) {
      if (ctx.request.headers.get(header) !== "proof") throw new UnauthorizedError();
    },
  });
  app.route({
    method: "GET", path: "/protected", operationId: "protected",
    hooks: every(every(gate("x-first-proof"), idempotency()), every(gate("x-second-proof"), idempotency())),
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) } },
    handler: () => { handlerCalls++; return { status: 200 as const, body: { ok: true } }; },
  });
  const headers = { "x-first-proof": "proof", "x-second-proof": "proof" };
  assert.equal((await app.request("/protected", { headers })).status, 200);
  assert.equal((await app.request("/protected", { headers })).headers.get("x-cache"), "HIT");
  assert.equal((await app.request("/protected", { headers: { "x-first-proof": "proof" } })).status, 401);
  assert.equal(handlerCalls, 1);
});

test("composed auth replay: markAuthHook(every(...)) keeps its wrapper, records the pass, and still gates a cache hit", async () => {
  let handlerCalls = 0;
  let proofChecks = 0;
  const app = new App({ env: "production", logger: false, behindProxy: "none" });
  app.use(responseCache());
  // The inner gate is deliberately unmarked: only the outer markAuthHook()
  // wrapper records the auth pass the `auth:` route requires in production.
  const stack = markAuthHook(every(
    {
      beforeHandle(ctx) {
        proofChecks++;
        if (ctx.request.headers.get("x-dummy-proof") !== "owner-proof") {
          throw new UnauthorizedError("Additional proof required");
        }
        (ctx.state as Record<string, unknown>).user = { sub: "dummy-owner" };
      },
    },
    { beforeHandle() { /* unrelated all-of layer */ } },
  ));
  app.route({
    method: "GET", path: "/protected", operationId: "protected",
    auth: { scheme: "bearerAuth" },
    hooks: stack,
    responses: { 200: { description: "ok", body: z.object({ marker: z.literal("protected") }) } },
    handler: () => {
      handlerCalls++;
      return { status: 200 as const, body: { marker: "protected" as const } };
    },
  });
  const headers = { "x-dummy-proof": "owner-proof" };
  const first = await app.request("/protected", { headers });
  assert.equal(first.status, 200, await first.text());
  const hit = await app.request("/protected", { headers });
  assert.equal(hit.status, 200);
  assert.equal(hit.headers.get("x-cache"), "HIT");
  assert.equal(handlerCalls, 1);
  const denied = await app.request("/protected");
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get("x-cache"), null);
  assert.equal(handlerCalls, 1);
  assert.equal(proofChecks, 3);
});

test("composed auth replay: a bundle whose beforeHandle was replaced is ordered as one opaque hook", () => {
  const order: string[] = [];
  const gate = markAuthHook({ beforeHandle() { order.push("gate"); } });
  const inner = every(gate, idempotency());
  const replaced: Hooks = { ...inner, beforeHandle() { order.push("wrapper"); } };
  const fns = _orderBeforeHandleForReplay([responseCache(), replaced]);
  assert.equal(fns.length, 2);
  assert.equal(fns[0], replaced.beforeHandle, "the wrapper runs, not the snapshot layers");
  const expanded = _orderBeforeHandleForReplay([responseCache(), inner]);
  assert.equal(expanded.length, 3, "an untouched every() bundle is expanded");
});
