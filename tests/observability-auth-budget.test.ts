import assert from "node:assert/strict";
import { test } from "node:test";
import { App } from "../src/index.js";

test("authenticated probes and scrapes retain a separate bounded request budget", async () => {
  const token = "local-probe-fixture";
  for (const kind of ["healthcheck", "readinesscheck", "metrics"] as const) {
    const app = new App({ env: "production", logger: false });
    app[kind]({ path: "/probe", token, rateLimit: { limit: 1, windowMs: 60_000 } });
    assert.equal((await app.request("/probe")).status, 401);
    assert.equal((await app.request("/probe")).status, 429);
    const valid = { headers: { authorization: `Bearer ${token}` } };
    assert.equal((await app.request("/probe", valid)).status, 200);
    assert.equal((await app.request("/probe", valid)).status, 429);
  }
});