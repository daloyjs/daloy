import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../../src/build-app.ts";

test("GET /healthz answers 200 for 200 consecutive probes", async () => {
  const app = buildApp();
  for (let i = 0; i < 200; i++) {
    const res = await app.request("/healthz");
    assert.equal(res.status, 200, `probe ${i + 1} got ${res.status}`);
  }
});

test("other routes are still rate limited", async () => {
  const app = buildApp();
  let limited = 0;
  for (let i = 0; i < 200; i++) {
    const res = await app.request("/books/1");
    if (res.status === 429) limited++;
  }
  assert.ok(
    limited > 0,
    "200 requests to /books/1 from one client were never rate limited",
  );
});
