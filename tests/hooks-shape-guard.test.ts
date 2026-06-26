import { test } from "node:test";
import assert from "node:assert/strict";
import { App, bearerAuth, every } from "../src/index.js";

// Regression guard: an ARRAY (or an object with no recognized hook key) passed
// where a single Hooks object is expected used to be a SILENT no-op — the
// framework read `.beforeHandle` etc. off it, found undefined, and applied no
// hooks, so a route that looked guarded shipped wide open. The framework now
// refuses such shapes at registration and points at every(...) / some(...).

const denyAll = () => bearerAuth({ validate: () => false });

function buildRoute(app: App, hooks?: unknown) {
  app.route({
    method: "GET",
    path: "/x",
    operationId: "x",
    ...(hooks !== undefined ? { hooks: hooks as never } : {}),
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
}

test("route hooks: an ARRAY is refused at registration (the silent-no-op footgun)", () => {
  const app = new App({ logger: false });
  assert.throws(
    () => buildRoute(app, [denyAll()]),
    /must be a single Hooks object, not an array/,
  );
});

test("route hooks: an object with no recognized hook key is refused", () => {
  const app = new App({ logger: false });
  assert.throws(
    () => buildRoute(app, { foo: () => {} }),
    /none of the recognized hook keys/,
  );
});

test("route hooks: a single Hooks object is applied (auth denies, not 200)", async () => {
  const app = new App({ logger: false });
  buildRoute(app, denyAll());
  const res = await app.request("/x");
  assert.notEqual(res.status, 200, "guard ran and denied");
});

test("route hooks: every(...) composes and is applied", async () => {
  const app = new App({ logger: false });
  buildRoute(app, every(denyAll(), denyAll()));
  const res = await app.request("/x");
  assert.notEqual(res.status, 200, "composed guard ran and denied");
});

test("route hooks: omitted -> route registers and runs normally", async () => {
  const app = new App({ logger: false });
  buildRoute(app);
  const res = await app.request("/x");
  assert.equal(res.status, 200);
});

test("route hooks: an empty object {} is an explicit no-op and is allowed", async () => {
  const app = new App({ logger: false });
  buildRoute(app, {});
  const res = await app.request("/x");
  assert.equal(res.status, 200);
});

test("app.use(array) is refused (same footgun via use())", () => {
  const app = new App({ logger: false });
  assert.throws(
    () => app.use([denyAll()] as never),
    /must be a single Hooks object, not an array/,
  );
});

test("new App({ hooks: array }) is refused at construction", () => {
  assert.throws(
    () => new App({ logger: false, hooks: [denyAll()] as never }),
    /must be a single Hooks object, not an array/,
  );
});
