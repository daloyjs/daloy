/**
 * Behaviour the documentation samples rely on. Each case here started as a
 * docs sample that did not type-check, or that type-checked only with a cast
 * and did the wrong thing at runtime.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  App,
  bearerAuth,
  every,
  markAuthHook,
  some,
  UnauthorizedError,
  validateMcpInput,
} from "../src/index.js";

const get = (app: App, path = "/") =>
  app.fetch(new Request(`http://localhost${path}`, { headers: { "user-agent": "docs" } }));

// ---------------------------------------------------------------------------
// A response with no body schema can be returned without `body`
// ---------------------------------------------------------------------------

test("[happy] a 204 handler may return { status: 204 } with no body", async () => {
  const app = new App({ logger: false });
  app.post(
    "/reindex",
    { public: true, responses: { 204: { description: "Started" } } },
    // No `body` key: this line is the type-level assertion.
    () => ({ status: 204 as const }),
  );
  const res = await app.fetch(
    new Request("http://localhost/reindex", { method: "POST", headers: { "user-agent": "docs" } }),
  );
  assert.equal(res.status, 204);
  assert.equal(await res.text(), "");
});

test("[unhappy] a response that declares a body schema still requires the body", async () => {
  const app = new App({ logger: false });
  app.get(
    "/",
    {
      public: true,
      responses: { 200: { description: "ok", body: z.object({ id: z.string() }).strict() } },
    },
    // @ts-expect-error `body` is required when the response declares a schema.
    () => ({ status: 200 as const }),
  );
  const res = await get(app);
  assert.equal(res.status, 500, "a missing declared body fails response validation, it is not sent");
});

// ---------------------------------------------------------------------------
// MCP input schemas written with `as const`
// ---------------------------------------------------------------------------

test("[happy] validateMcpInput accepts a read-only (as const) schema", () => {
  const schema = {
    type: "object",
    properties: { sku: { type: "string", minLength: 1 } },
    required: ["sku"],
    additionalProperties: false,
  } as const;
  assert.deepEqual(validateMcpInput(schema, { sku: "ABC-1" }), []);
  assert.equal(validateMcpInput(schema, {}).length, 1);
  assert.equal(validateMcpInput(schema, { sku: "", extra: true }).length, 2);
});

// ---------------------------------------------------------------------------
// A hook that returns a plain object has not rejected the request
// ---------------------------------------------------------------------------

function guarded(hooks: unknown): App {
  const app = new App({ logger: false, behindProxy: "none" } as never);
  app.route({
    method: "GET",
    path: "/",
    public: true,
    hooks,
    responses: { 200: { description: "ok" } },
    acknowledgeNoResponseBodySchema: true,
    handler: () => ({ status: 200 as const, body: { secret: true } }),
  } as never);
  return app;
}

const returnsObject = (phase: "preBody" | "beforeHandle") =>
  markAuthHook({ [phase]: () => ({ status: 401, body: { error: "unauthorized" } }) } as never);

for (const phase of ["preBody", "beforeHandle"] as const) {
  test(`[unhappy] a ${phase} hook returning { status: 401 } does not let the request through`, async () => {
    const res = await get(guarded(returnsObject(phase)));
    assert.equal(res.status, 500);
    assert.ok(!(await res.text()).includes("secret"));
  });

  test(`[unhappy] the same hook inside some() or every() is never the winning branch (${phase})`, async () => {
    const strict = bearerAuth({ validate: () => false });
    for (const hooks of [some(returnsObject(phase), strict), every(returnsObject(phase))]) {
      const res = await get(guarded(hooks));
      assert.notEqual(res.status, 200);
      assert.ok(!(await res.text()).includes("secret"));
    }
  });
}

test("[happy] hooks that return nothing, null, or a Response behave as before", async () => {
  assert.equal((await get(guarded({ beforeHandle: () => undefined }))).status, 200);
  assert.equal((await get(guarded({ beforeHandle: () => null }))).status, 200);
  assert.equal((await get(guarded({ preBody: () => undefined }))).status, 200);
  const teapot = await get(guarded({ beforeHandle: () => new Response("no", { status: 418 }) }));
  assert.equal(teapot.status, 418);
  const thrown = await get(
    guarded({
      beforeHandle: () => {
        throw new UnauthorizedError();
      },
    }),
  );
  assert.equal(thrown.status, 401);
});
