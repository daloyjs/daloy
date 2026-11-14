import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../../src/build-app.ts";

type App = ReturnType<typeof buildApp>;

function create(app: App, body: unknown): Promise<Response> {
  return app.request("/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("create then read a user", async () => {
  const app = buildApp();
  const res = await create(app, {
    name: "Gabriela Silang",
    email: "gabriela@example.com",
  });
  assert.equal(res.status, 201);
  const user = (await res.json()) as {
    id: unknown;
    name: string;
    email: string;
  };
  assert.equal(typeof user.id, "string");
  assert.equal(user.name, "Gabriela Silang");
  assert.equal(user.email, "gabriela@example.com");

  const got = await app.request(
    `/users/${encodeURIComponent(user.id as string)}`,
  );
  assert.equal(got.status, 200);
  assert.deepEqual(await got.json(), user);
});

test("invalid input is rejected (400 or 422)", async () => {
  const app = buildApp();
  for (const body of [
    { name: "x", email: "not-an-email" },
    { name: "", email: "a@example.com" },
    { name: "a".repeat(101), email: "a@example.com" },
    { email: "a@example.com" },
    { name: "x", email: "a@example.com", role: "admin" },
  ]) {
    const res = await create(app, body);
    assert.ok(
      res.status === 400 || res.status === 422,
      `expected 400/422 for ${JSON.stringify(body).slice(0, 60)}, got ${res.status}`,
    );
  }
});

test("unknown user is a 404", async () => {
  const res = await buildApp().request("/users/does-not-exist");
  assert.equal(res.status, 404);
});

test("both operations appear in the generated OpenAPI document", async () => {
  const res = await buildApp().request("/openapi.json");
  assert.equal(res.status, 200);
  const doc = (await res.json()) as {
    paths: Record<string, Record<string, unknown>>;
  };
  assert.ok(doc.paths["/users"]?.post, "POST /users missing from OpenAPI");
  assert.ok(
    doc.paths["/users/{id}"]?.get,
    "GET /users/{id} missing from OpenAPI",
  );
});
