import assert from "node:assert/strict";
import test from "node:test";
import { createJwtSigner } from "@daloyjs/core";
import { buildApp } from "../../src/build-app.ts";

const SECRET = "hidden-test-jwt-secret-9f8e7d6c5b4a39281706f5e4d3c2b1a0";
process.env.JWT_SECRET = SECRET;

const b64 = (v: unknown): string =>
  Buffer.from(JSON.stringify(v)).toString("base64url");

function claims(): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: "kiosk-7",
    iss: "https://id.example.com",
    aud: "books-api",
    scope: "books:read books:write",
    iat: now,
    exp: now + 600,
  };
}

function unsigned(alg: string, signature = ""): string {
  return `${b64({ alg, typ: "JWT" })}.${b64(claims())}.${signature}`;
}

async function create(token?: string): Promise<number> {
  const res = await buildApp().request("/books", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ title: "Kiosk book" }),
  });
  return res.status;
}

for (const [label, token] of [
  ["alg none", unsigned("none")],
  ["alg None", unsigned("None")],
  ["alg NONE", unsigned("NONE")],
  ["alg none with a junk signature", unsigned("none", "AAAA")],
] as const) {
  test(`an unsigned ${label} token cannot create a book`, async () => {
    const status = await create(token);
    assert.ok(
      status === 401 || status === 403,
      `expected 401/403 for an unsigned token, got ${status}`,
    );
  });
}

test("a properly signed books:write token still creates a book", async () => {
  const signer = createJwtSigner({
    alg: "HS256",
    key: new TextEncoder().encode(SECRET),
    maxLifetimeSeconds: 3600,
  });
  const c = claims();
  delete c.iat;
  assert.equal(await create(await signer.sign(c)), 201);
});

test("no token is still rejected", async () => {
  assert.equal(await create(), 401);
});
