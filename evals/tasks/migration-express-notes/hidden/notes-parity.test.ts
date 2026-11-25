import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../../src/build-app.ts";

type App = ReturnType<typeof buildApp>;

function json(
  app: App,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

// DaloyJS answers schema-validation failures with 422; a hand-written 400 is also a rejection.
const INVALID = [400, 422];

const SEED = { id: "1", title: "Welcome", done: false };

test("GET /notes lists the seeded note", async () => {
  const res = await buildApp().request("/notes");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { items: unknown[] };
  assert.ok(Array.isArray(body.items));
  assert.ok(
    body.items.some((n) => JSON.stringify(n) === JSON.stringify(SEED)),
    "seed note missing",
  );
});

test("GET /notes/:id returns the note or a problem+json 404", async () => {
  const app = buildApp();
  const found = await app.request("/notes/1");
  assert.equal(found.status, 200);
  assert.deepEqual(await found.json(), SEED);
  const missing = await app.request("/notes/999");
  assert.equal(missing.status, 404);
  assert.match(
    missing.headers.get("content-type") ?? "",
    /application\/problem\+json/,
  );
});

test("POST /notes creates with 201 and validates title", async () => {
  const app = buildApp();
  const res = await json(app, "POST", "/notes", { title: "Buy milk" });
  assert.equal(res.status, 201);
  const note = (await res.json()) as {
    id: unknown;
    title: string;
    done: boolean;
  };
  assert.equal(typeof note.id, "string");
  assert.equal(note.title, "Buy milk");
  assert.equal(note.done, false);
  assert.equal((await app.request(`/notes/${note.id}`)).status, 200);

  for (const bad of [
    {},
    { title: "" },
    { title: "a".repeat(201) },
    { title: 7 },
  ]) {
    assert.ok(
      INVALID.includes((await json(app, "POST", "/notes", bad)).status),
      JSON.stringify(bad).slice(0, 40),
    );
  }
});

test("PATCH /notes/:id toggles done and validates input", async () => {
  const app = buildApp();
  const created = (await (
    await json(app, "POST", "/notes", { title: "Patch me" })
  ).json()) as { id: string };
  const res = await json(app, "PATCH", `/notes/${created.id}`, { done: true });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { done: boolean }).done, true);
  assert.ok(
    INVALID.includes(
      (await json(app, "PATCH", `/notes/${created.id}`, { done: "yes" }))
        .status,
    ),
  );
  assert.equal(
    (await json(app, "PATCH", "/notes/999", { done: true })).status,
    404,
  );
});

test("DELETE /notes/:id answers 204, then 404", async () => {
  const app = buildApp();
  const created = (await (
    await json(app, "POST", "/notes", { title: "Delete me" })
  ).json()) as { id: string };
  assert.equal(
    (await app.request(`/notes/${created.id}`, { method: "DELETE" })).status,
    204,
  );
  assert.equal((await app.request(`/notes/${created.id}`)).status, 404);
  assert.equal(
    (await app.request(`/notes/${created.id}`, { method: "DELETE" })).status,
    404,
  );
});

test("the template routes were kept", async () => {
  const app = buildApp();
  assert.equal((await app.request("/healthz")).status, 200);
  assert.equal((await app.request("/books/1")).status, 200);
});
