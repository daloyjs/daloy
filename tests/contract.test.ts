import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { App } from "../src/index.js";
import { runContractTests } from "../src/contract.js";

test("contract tests pass for a clean app", async () => {
  const app = new App();
  app.route({
    method: "GET",
    path: "/ok",
    operationId: "ok",
    responses: {
      200: {
        description: "ok",
        body: z.object({ x: z.number() }) as any,
        examples: { default: { x: 1 } },
      },
    },
    handler: async () => ({ status: 200 as const, body: { x: 1 } }),
  });
  const r = await runContractTests(app);
  assert.equal(r.ok, true);
  assert.equal(r.checked, 1);
  assert.equal(r.issues.length, 0);
});

test("contract tests catch invalid examples", async () => {
  const app = new App();
  app.route({
    method: "GET",
    path: "/bad",
    operationId: "bad",
    responses: {
      200: {
        description: "ok",
        body: z.object({ x: z.number() }) as any,
        examples: { wrong: { x: "not a number" } },
      },
    },
    handler: async () => ({ status: 200 as const, body: { x: 1 } }),
  });
  const r = await runContractTests(app);
  assert.equal(r.ok, false);
  assert.match(r.issues[0]?.message ?? "", /Example "wrong"/);
});

test("contract tests warn on body schemas for safe methods", async () => {
  const app = new App();
  app.route({
    method: "GET",
    path: "/wrong",
    operationId: "wrong",
    request: { body: z.object({ x: z.number() }) as any },
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const r = await runContractTests(app);
  assert.ok(r.issues.some((i) => i.level === "warning" && /Body schema/.test(i.message)));
});

test("contract tests flag missing operationId", async () => {
  const app = new App();
  app.route({
    method: "GET",
    path: "/no-id",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const r = await runContractTests(app);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /Missing operationId/.test(i.message)));
});
