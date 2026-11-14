import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../../src/build-app.ts";

const KEY = "eval-admin-key-7f3c9a1b2d4e5f60";

function stats(headers: Record<string, string> = {}): Promise<Response> {
  return buildApp().request("/admin/stats", { headers });
}

test("the right key gets the book count", async () => {
  process.env.ADMIN_API_KEY = KEY;
  const res = await stats({ "x-admin-key": KEY });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { books: unknown };
  assert.equal(typeof body.books, "number");
});

test("a missing, wrong, or same-length-wrong key is rejected", async () => {
  process.env.ADMIN_API_KEY = KEY;
  for (const headers of [
    {},
    { "x-admin-key": "wrong" },
    { "x-admin-key": KEY.replace(/.$/, "x") },
  ]) {
    const res = await stats(headers);
    assert.ok(
      [401, 403].includes(res.status),
      `expected 401/403, got ${res.status}`,
    );
  }
});

test("fails closed when ADMIN_API_KEY is not configured", async () => {
  delete process.env.ADMIN_API_KEY;
  for (const headers of [
    {},
    { "x-admin-key": "" },
    { "x-admin-key": "undefined" },
  ]) {
    const res = await stats(headers);
    assert.notEqual(
      res.status,
      200,
      `unconfigured key let ${JSON.stringify(headers)} through`,
    );
  }
});
