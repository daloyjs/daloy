import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../../src/build-app.ts";

// DaloyJS answers schema-validation failures with 422; a hand-written 400 is also a rejection.
const INVALID = [400, 422];

function post(body: unknown): Promise<Response> {
  return buildApp().request("/books", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("utm_source is accepted", async () => {
  const res = await post({
    title: "Florante at Laura",
    utm_source: "newsletter",
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as { title: string };
  assert.equal(body.title, "Florante at Laura");
});

test("the request without utm_source still works", async () => {
  assert.equal((await post({ title: "Noli Me Tangere" })).status, 201);
});

test("other unknown fields are still rejected (strict schema)", async () => {
  assert.ok(
    INVALID.includes((await post({ title: "x", isAdmin: true })).status),
  );
  assert.ok(
    INVALID.includes(
      (await post({ title: "x", utm_source: "ads", role: "owner" })).status,
    ),
  );
});

test("utm_source must be a string and title is still required", async () => {
  assert.ok(
    INVALID.includes((await post({ title: "x", utm_source: 42 })).status),
  );
  assert.ok(
    INVALID.includes((await post({ utm_source: "newsletter" })).status),
  );
});
