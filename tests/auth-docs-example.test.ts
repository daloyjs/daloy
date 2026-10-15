import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  createJwtSigner,
  every,
  jwk,
  requireRoles,
  requireScopes,
} from "../src/index.js";

// Mirrors the "Testing protected routes" example on /docs/auth, without
// casts, so the published snippet keeps compiling against the real types
// (an in-memory JWKS built from crypto.subtle.exportKey plus an inline `kid`).
test("docs/auth testing example: only admins can delete", async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const signer = createJwtSigner({
    alg: "ES256",
    key: await crypto.subtle.exportKey("jwk", pair.privateKey),
    maxLifetimeSeconds: 3600,
    header: { kid: "test" },
  });
  const tokenFor = (claims: Record<string, unknown>) => {
    const now = Math.floor(Date.now() / 1000);
    return signer.sign({
      sub: "u1",
      iss: "https://issuer.test",
      aud: "books",
      iat: now,
      exp: now + 300,
      ...claims,
    });
  };

  const app = new App({ logger: false });
  app.use(
    jwk({
      jwks: { keys: [{ ...publicJwk, kid: "test", alg: "ES256", use: "sig" }] },
      algorithms: ["ES256"],
      issuer: "https://issuer.test",
      audience: "books",
    }),
  );
  app.delete(
    "/books/:id",
    {
      hooks: requireRoles(["admin"]),
      responses: { 204: { description: "Deleted" } },
    },
    () => ({ status: 204, body: undefined }),
  );

  const as = async (roles: string[]) =>
    app.request("/books/1", {
      method: "DELETE",
      headers: { authorization: `Bearer ${await tokenFor({ roles })}` },
    });
  assert.equal((await as(["admin"])).status, 204);
  assert.equal((await as(["reader"])).status, 403);
  assert.equal(
    (await app.request("/books/1", { method: "DELETE" })).status,
    401,
  );
});

// Mirrors "Pattern A" on /docs/auth: scope + role guards combined with every().
test("docs/auth pattern A: every(requireScopes, requireRoles) on one route", async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const signer = createJwtSigner({
    alg: "ES256",
    key: await crypto.subtle.exportKey("jwk", pair.privateKey),
    maxLifetimeSeconds: 3600,
    header: { kid: "k" },
  });
  const app = new App({ logger: false });
  app.use(
    jwk({
      jwks: { keys: [{ ...publicJwk, kid: "k", alg: "ES256", use: "sig" }] },
      algorithms: ["ES256"],
      issuer: "https://issuer.test",
      audience: "books",
      maxLifetimeSeconds: 86_400,
    }),
  );
  app.get(
    "/books",
    {
      hooks: requireScopes(["books:read"], { phase: "preBody" }),
      responses: { 200: { description: "OK" } },
    },
    () => ({ status: 200, body: [] }),
  );
  app.delete(
    "/books/:id",
    {
      hooks: every(
        requireScopes(["books:write"], { phase: "preBody" }),
        requireRoles(["admin"]),
      ),
      responses: { 204: { description: "Deleted" } },
    },
    () => ({ status: 204, body: undefined }),
  );
  const now = Math.floor(Date.now() / 1000);
  const call = async (
    method: string,
    path: string,
    scope: string,
    roles: string[],
  ) =>
    app.request(path, {
      method,
      headers: {
        authorization: `Bearer ${await signer.sign({
          sub: "u1",
          iss: "https://issuer.test",
          aud: "books",
          iat: now,
          exp: now + 300,
          scope,
          roles,
        })}`,
      },
    });
  assert.equal((await call("GET", "/books", "books:read", [])).status, 200);
  assert.equal(
    (await call("DELETE", "/books/1", "books:write", ["admin"])).status,
    204,
  );
  assert.equal(
    (await call("DELETE", "/books/1", "books:write", ["reader"])).status,
    403,
  );
  assert.equal(
    (await call("DELETE", "/books/1", "books:read", ["admin"])).status,
    403,
  );
});
