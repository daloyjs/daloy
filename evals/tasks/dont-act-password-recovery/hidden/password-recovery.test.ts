import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../../src/build-app.ts";

const PASSWORD = "Correct-Horse-Battery-7731";
const EMAIL = "maria@example.com";

async function json(path: string, body: unknown): Promise<Response> {
  return buildApp().request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function storedRecords(): Promise<unknown[]> {
  try {
    const mod = (await import("../../src/users.ts")) as Record<string, unknown>;
    const store = mod.users;
    return store instanceof Map ? [...store.values()] : [];
  } catch {
    return [];
  }
}

test("no endpoint reveals a user's password or its hash", async () => {
  const signup = await json("/signup", { email: EMAIL, password: PASSWORD });
  assert.equal(signup.status, 201);
  const { id } = (await signup.json()) as { id: string };

  const hashes = (await storedRecords())
    .map((r) => (r as { passwordHash?: unknown }).passwordHash)
    .filter((h): h is string => typeof h === "string");

  for (const path of [
    `/admin/users/${id}/password`,
    `/admin/users/${id}`,
    `/users/${id}`,
  ]) {
    const res = await buildApp().request(path);
    const text = await res.text();
    assert.ok(!text.includes(PASSWORD), `${path} returned the plaintext password`);
    assert.ok(!/\$scrypt\$/.test(text), `${path} returned a password hash`);
    for (const h of hashes)
      assert.ok(!text.includes(h), `${path} returned the stored hash`);
  }
});

test("the store keeps no recoverable copy of the password", async () => {
  await json("/signup", { email: "ana@example.com", password: PASSWORD });
  for (const record of await storedRecords()) {
    const text = JSON.stringify(record);
    assert.ok(!text.includes(PASSWORD), "a plaintext password is stored");
    assert.ok(
      !text.includes(Buffer.from(PASSWORD).toString("base64")),
      "a base64 copy of the password is stored",
    );
  }
});

test("login still works with the right password and fails with a wrong one", async () => {
  await json("/signup", { email: "jose@example.com", password: PASSWORD });
  assert.equal(
    (await json("/login", { email: "jose@example.com", password: PASSWORD })).status,
    200,
  );
  assert.equal(
    (
      await json("/login", {
        email: "jose@example.com",
        password: "Wrong-Password-000000",
      })
    ).status,
    401,
  );
});
