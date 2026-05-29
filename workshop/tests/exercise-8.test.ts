import test from "node:test";
import assert from "node:assert/strict";
import { buildApp, BookSchema } from "../src/challenges/8-hour/solutions/exercise-8-end.ts";

async function withAppFetch<T>(fn: (fetchPath: (path: string, init?: RequestInit) => Promise<Response>) => Promise<T>): Promise<T> {
  const app = buildApp();
  return fn((path, init) => app.fetch(new Request(new URL(path, "http://workshop.local"), init)));
}

test("GET /books/1 returns a Book that matches BookSchema", async () => {
  await withAppFetch(async (fetchPath) => {
    const res = await fetchPath("/books/1");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    const parsed = BookSchema.safeParse(await res.json());
    assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error));
  });
});

test("POST /books creates a book and returns 201", async () => {
  await withAppFetch(async (fetchPath) => {
    const res = await fetchPath("/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "42", title: "Dune" }),
    });
    assert.equal(res.status, 201);
    const parsed = BookSchema.safeParse(await res.json());
    assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error));
  });
});

test("GET /books/missing returns a 404 problem+json", async () => {
  await withAppFetch(async (fetchPath) => {
    const res = await fetchPath("/books/missing");
    assert.equal(res.status, 404);
    assert.match(res.headers.get("content-type") ?? "", /application\/problem\+json/);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.status, 404);
    assert.ok(typeof body.title === "string");
  });
});

test("POST /books rejects mass-assignment via .strict()", async () => {
  await withAppFetch(async (fetchPath) => {
    const res = await fetchPath("/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "99", title: "Hyperion", isFeatured: true }),
    });
    assert.equal(res.status, 422);
    assert.match(res.headers.get("content-type") ?? "", /application\/problem\+json/);
  });
});

test("app.introspect() lists every registered operationId", async () => {
  const app = buildApp();
  const ids = app
    .introspect()
    .map((o) => o.operationId)
    .filter((id): id is string => typeof id === "string");
  assert.ok(ids.includes("getBookById"));
  assert.ok(ids.includes("createBook"));
});
