import assert from "node:assert/strict";
import { test } from "node:test";
import { App, secureHeaders } from "../src/index.js";

function appWithRoute(options: ConstructorParameters<typeof App>[0] = {}) {
  const app = new App({ logger: false, ...options });
  app.route({
    method: "GET", path: "/known",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  return app;
}

test("secure headers cover missing routes, method errors, and early origin rejection", async () => {
  const app = appWithRoute();
  for (const [path, init, status] of [
    ["/missing", {}, 404],
    ["/known", { method: "PUT" }, 405],
    ["/known", { method: "POST", headers: { origin: "https://other.example" } }, 403],
    ["/known", {}, 200],
  ] as const) {
    const response = await app.request(path, init);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.ok(response.headers.has("content-security-policy"));
    await response.text();
  }
});

test("early response headers respect explicit opt-out and later custom header hooks", async () => {
  const disabled = appWithRoute({ secureHeaders: false });
  assert.equal((await disabled.request("/missing")).headers.get("x-content-type-options"), null);
  const app = appWithRoute();
  await app.request("/missing");
  app.use(secureHeaders({ frameOptions: "DENY" }));
  assert.equal((await app.request("/missing")).headers.get("x-frame-options"), "DENY");
});