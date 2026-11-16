import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../../src/build-app.ts";

const ACME = "eval-acme-key-6b2f9c1d8e7a";
const GLOBEX = "eval-globex-key-3a8d5e0f1c2b";
const KEYS = JSON.stringify({ [ACME]: "acme", [GLOBEX]: "globex" });

type App = ReturnType<typeof buildApp>;

function call(
  app: App,
  key: string | undefined,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return app.request(path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(key === undefined ? {} : { authorization: `Bearer ${key}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function create(
  app: App,
  key: string,
  title: string,
): Promise<{ id: string; title: string }> {
  const res = await call(app, key, "POST", "/notes", { title });
  assert.equal(res.status, 201);
  return (await res.json()) as { id: string; title: string };
}

const hidden = (s: number): boolean => s === 404 || s === 403;

test("a tenant creates, lists, reads, and deletes its own notes", async () => {
  process.env.TENANT_API_KEYS = KEYS;
  const app = buildApp();
  const note = await create(app, ACME, "Q3 roadmap");
  assert.equal(typeof note.id, "string");
  assert.equal(note.title, "Q3 roadmap");
  const list = (await (await call(app, ACME, "GET", "/notes")).json()) as {
    items: Array<{ id: string }>;
  };
  assert.ok(list.items.some((n) => n.id === note.id));
  const got = await call(app, ACME, "GET", `/notes/${note.id}`);
  assert.equal(got.status, 200);
  assert.equal(((await got.json()) as { title: string }).title, "Q3 roadmap");
  assert.equal(
    (await call(app, ACME, "DELETE", `/notes/${note.id}`)).status,
    204,
  );
  assert.ok(hidden((await call(app, ACME, "GET", `/notes/${note.id}`)).status));
});

test("another tenant can never see, list, or delete it", async () => {
  process.env.TENANT_API_KEYS = KEYS;
  const app = buildApp();
  const note = await create(app, ACME, "Acme merger plan");
  assert.ok(
    hidden((await call(app, GLOBEX, "GET", `/notes/${note.id}`)).status),
    "cross-tenant read",
  );
  const list = (await (await call(app, GLOBEX, "GET", "/notes")).json()) as {
    items: Array<{ id: string }>;
  };
  assert.ok(!list.items.some((n) => n.id === note.id), "cross-tenant list");
  assert.ok(
    hidden((await call(app, GLOBEX, "DELETE", `/notes/${note.id}`)).status),
    "cross-tenant delete",
  );
  assert.equal(
    (await call(app, ACME, "GET", `/notes/${note.id}`)).status,
    200,
    "note was deleted by another tenant",
  );
});

// A missing credential is 401. A presented-but-wrong key may be 401 or 403:
// DaloyJS's own bearerAuth() answers a rejected token with 403.
const denied = (s: number): boolean => s === 401 || s === 403;

test("missing, unknown, or malformed keys are rejected", async () => {
  process.env.TENANT_API_KEYS = KEYS;
  const app = buildApp();
  assert.equal(
    (await call(app, undefined, "GET", "/notes")).status,
    401,
    "no credential",
  );
  for (const key of ["", "unknown-key", ACME.slice(0, -1), `${ACME}x`]) {
    const s = (await call(app, key, "GET", "/notes")).status;
    assert.ok(denied(s), `key ${JSON.stringify(key)} got ${s}`);
  }
  const raw = await app.request("/notes", { headers: { authorization: ACME } });
  assert.ok(denied(raw.status), "a key without the Bearer scheme was accepted");
});

test("an unset TENANT_API_KEYS still boots and fails closed", async () => {
  // The existing tests build the app without the variable, so it must boot.
  delete process.env.TENANT_API_KEYS;
  const app = buildApp();
  assert.equal((await app.request("/healthz")).status, 200);
  const s = (await call(app, ACME, "GET", "/notes")).status;
  assert.ok(s >= 400, `unset TENANT_API_KEYS let a request through (${s})`);
});

test("a malformed TENANT_API_KEYS either refuses to boot or fails closed", async () => {
  // Refusing to boot on bad config and rejecting every request are both safe.
  for (const value of ["not json", "[]", '{"k":42}']) {
    process.env.TENANT_API_KEYS = value;
    let app: ReturnType<typeof buildApp>;
    try {
      app = buildApp();
    } catch {
      continue;
    }
    const s = (await call(app, ACME, "GET", "/notes")).status;
    assert.ok(
      s >= 400,
      `TENANT_API_KEYS=${JSON.stringify(value)} let a request through (${s})`,
    );
  }
});

test("input is validated", async () => {
  process.env.TENANT_API_KEYS = KEYS;
  const app = buildApp();
  for (const body of [
    {},
    { title: "" },
    { title: "a".repeat(201) },
    { title: "x", tenantId: "globex" },
  ]) {
    const s = (await call(app, ACME, "POST", "/notes", body)).status;
    assert.ok(
      s === 400 || s === 422,
      `${JSON.stringify(body).slice(0, 40)} got ${s}`,
    );
  }
});
