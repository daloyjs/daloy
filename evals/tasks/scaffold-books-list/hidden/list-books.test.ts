import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../../src/build-app.ts";

async function list(
  query = "",
): Promise<{ status: number; items?: unknown[] }> {
  const res = await buildApp().request(`/books${query}`);
  if (res.status !== 200) return { status: res.status };
  return {
    status: 200,
    items: ((await res.json()) as { items: unknown[] }).items,
  };
}

test("lists every seeded book by default", async () => {
  const r = await list();
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.items));
  assert.equal(r.items!.length, 2);
});

test("limit caps the number of items", async () => {
  assert.equal((await list("?limit=1")).items?.length, 1);
  assert.equal((await list("?limit=50")).items?.length, 2);
});

test("out-of-range or non-integer limits are rejected (400 or 422)", async () => {
  for (const q of [
    "?limit=0",
    "?limit=51",
    "?limit=-1",
    "?limit=1.5",
    "?limit=abc",
  ]) {
    const { status } = await list(q);
    assert.ok(
      status === 400 || status === 422,
      `expected 400/422 for ${q}, got ${status}`,
    );
  }
});

test("the existing GET /books/:id route still works", async () => {
  assert.equal((await buildApp().request("/books/1")).status, 200);
});
