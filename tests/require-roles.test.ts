import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  App,
  basicAuth,
  bearerAuth,
  createJwtSigner,
  idempotency,
  jwk,
  requireRoles,
  requireScopes,
  type JwkSet,
} from "../src/index.js";

// Real ES256 tokens verified by jwk(): requireRoles() reads the claims jwk()
// stamps on ctx.state.user, so the tests go through the actual auth chain.
async function issuer(): Promise<{
  jwks: JwkSet;
  sign: (claims: Record<string, unknown>) => Promise<string>;
}> {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey(
    "jwk",
    pair.publicKey,
  )) as JsonWebKey;
  const priv = (await crypto.subtle.exportKey(
    "jwk",
    pair.privateKey,
  )) as JsonWebKey;
  const signer = createJwtSigner({
    alg: "ES256",
    key: priv,
    maxLifetimeSeconds: 3600,
    header: { kid: "roles-key" },
  });
  return {
    jwks: {
      keys: [
        { ...pub, kid: "roles-key", alg: "ES256", use: "sig" } as JsonWebKey,
      ],
    } as unknown as JwkSet,
    sign: (claims) => {
      const now = Math.floor(Date.now() / 1000);
      return signer.sign({
        sub: "user-1",
        iss: "https://issuer",
        aud: "books",
        iat: now,
        exp: now + 300,
        ...claims,
      });
    },
  };
}

function appWith(jwks: JwkSet, guard: ReturnType<typeof requireRoles>): App {
  const app = new App({ logger: false });
  app.use(
    jwk({
      jwks,
      algorithms: ["ES256"],
      issuer: "https://issuer",
      audience: "books",
    }),
  );
  app.route({
    method: "POST",
    path: "/admin",
    hooks: guard,
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  return app;
}

function call(app: App, token?: string, body = "{}"): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return app.request(
    new Request("http://x/admin", { method: "POST", headers, body }),
  );
}

test("requireRoles: default 'roles' claim, all-of match", async () => {
  const { jwks, sign } = await issuer();
  const app = appWith(jwks, requireRoles(["Books.Admin", "Books.Write"]));

  assert.equal(
    (await call(app, await sign({ roles: ["Books.Write", "Books.Admin"] })))
      .status,
    200,
  );

  const partial = await call(app, await sign({ roles: ["Books.Write"] }));
  assert.equal(partial.status, 403);
  const problem = (await partial.json()) as { detail?: string };
  assert.doesNotMatch(
    JSON.stringify(problem),
    /Books\.Admin/,
    "403 must not name the missing role",
  );
});

test("requireRoles: match 'any' accepts one of the listed roles", async () => {
  const { jwks, sign } = await issuer();
  const app = appWith(
    jwks,
    requireRoles(["editor", "admin"], { match: "any" }),
  );
  assert.equal(
    (await call(app, await sign({ roles: ["editor"] }))).status,
    200,
  );
  assert.equal(
    (await call(app, await sign({ roles: ["viewer"] }))).status,
    403,
  );
});

test("requireRoles: named claim reads namespaced keys and space-delimited strings", async () => {
  const { jwks, sign } = await issuer();
  const cognito = appWith(
    jwks,
    requireRoles(["admins"], { claim: "cognito:groups" }),
  );
  assert.equal(
    (await call(cognito, await sign({ "cognito:groups": ["admins"] }))).status,
    200,
  );

  const auth0 = appWith(
    jwks,
    requireRoles(["delete:books"], { claim: "permissions" }),
  );
  assert.equal(
    (await call(auth0, await sign({ permissions: "read:books delete:books" })))
      .status,
    200,
  );

  const namespaced = appWith(
    jwks,
    requireRoles(["admin"], { claim: "https://example.com/roles" }),
  );
  assert.equal(
    (
      await call(
        namespaced,
        await sign({ "https://example.com/roles": ["admin"] }),
      )
    ).status,
    200,
  );
});

test("requireRoles: reader function handles nested and object-shaped claims", async () => {
  const { jwks, sign } = await issuer();
  const keycloak = appWith(
    jwks,
    requireRoles(["admin"], {
      claim: (c) => (c.realm_access as { roles?: unknown } | undefined)?.roles,
    }),
  );
  assert.equal(
    (await call(keycloak, await sign({ realm_access: { roles: ["admin"] } })))
      .status,
    200,
  );
  assert.equal(
    (await call(keycloak, await sign({ realm_access: { roles: ["user"] } })))
      .status,
    403,
  );

  const zitadel = appWith(
    jwks,
    requireRoles(["admin"], {
      claim: (c) =>
        Object.keys(
          (c["urn:zitadel:iam:org:project:roles"] as object | undefined) ?? {},
        ),
    }),
  );
  assert.equal(
    (
      await call(
        zitadel,
        await sign({
          "urn:zitadel:iam:org:project:roles": { admin: { "1": "acme" } },
        }),
      )
    ).status,
    200,
  );
});

test("requireRoles: fails closed on missing, malformed, or throwing claims", async () => {
  const { jwks, sign } = await issuer();
  const app = appWith(jwks, requireRoles(["admin"]));
  assert.equal((await call(app, await sign({}))).status, 403, "missing claim");
  assert.equal(
    (await call(app, await sign({ roles: { admin: true } }))).status,
    403,
    "object value",
  );
  assert.equal(
    (await call(app, await sign({ roles: [42, null] }))).status,
    403,
    "non-string entries",
  );

  const throwing = appWith(
    jwks,
    requireRoles(["admin"], {
      claim: () => {
        throw new Error("boom");
      },
    }),
  );
  assert.equal(
    (await call(throwing, await sign({ roles: ["admin"] }))).status,
    403,
  );
});

test("requireRoles: does not read roles from the prototype chain", async () => {
  const { jwks, sign } = await issuer();
  // `toString` exists on every object's prototype; only own claims count.
  const app = appWith(jwks, requireRoles(["admin"], { claim: "toString" }));
  assert.equal((await call(app, await sign({}))).status, 403);
});

test("requireRoles: no authenticated caller is a 401 challenge", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/admin",
    hooks: requireRoles(["admin"]),
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await call(app);
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("www-authenticate"), "Bearer");
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("requireRoles: refuses before the body is read", async () => {
  const { jwks, sign } = await issuer();
  const app = new App({ logger: false });
  app.use(
    jwk({
      jwks,
      algorithms: ["ES256"],
      issuer: "https://issuer",
      audience: "books",
    }),
  );
  app.route({
    method: "POST",
    path: "/admin",
    hooks: requireRoles(["admin"]),
    request: { body: z.object({ title: z.string() }) },
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  // The body is malformed for this schema: parsed, it would be a 400/422.
  const bad = "{not json";
  const admin = await call(app, await sign({ roles: ["admin"] }), bad);
  assert.ok(
    admin.status === 400 || admin.status === 422,
    `admin gets a body error, got ${admin.status}`,
  );
  // The under-privileged caller is refused before the body is touched.
  assert.equal(
    (await call(app, await sign({ roles: ["user"] }), bad)).status,
    403,
  );
});

test("requireRoles: runs before idempotency replays a stored response", async () => {
  const { jwks, sign } = await issuer();
  const app = new App({ logger: false });
  app.use(
    jwk({
      jwks,
      algorithms: ["ES256"],
      issuer: "https://issuer",
      audience: "books",
    }),
  );
  app.use(idempotency());
  app.route({
    method: "POST",
    path: "/admin",
    hooks: requireRoles(["admin"]),
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { secret: "admin-only" } }),
  });
  const send = async (roles: string[]) =>
    app.request(
      new Request("http://x/admin", {
        method: "POST",
        headers: {
          authorization: `Bearer ${await sign({ roles })}`,
          "content-type": "application/json",
          "idempotency-key": "same-key-1",
        },
        body: "{}",
      }),
    );
  assert.equal((await send(["admin"])).status, 200);
  const replayAttempt = await send(["user"]);
  assert.equal(replayAttempt.status, 403);
  assert.doesNotMatch(await replayAttempt.text(), /admin-only/);
});

test("requireRoles: works with basicAuth's plain user object", async () => {
  const app = new App({ logger: false });
  app.use(
    basicAuth({
      verify: (user) =>
        user === "ops" ? { name: "ops", roles: ["ops"] } : false,
    }),
  );
  app.route({
    method: "GET",
    path: "/ops",
    hooks: requireRoles(["ops"]),
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const auth = (user: string) => `Basic ${btoa(`${user}:pw`)}`;
  assert.equal(
    (
      await app.request(
        new Request("http://x/ops", {
          headers: { authorization: auth("ops") },
        }),
      )
    ).status,
    200,
  );
});

test("requireRoles: rejects bad configuration at construction", () => {
  assert.throws(() => requireRoles([]), /non-empty array/);
  assert.throws(
    () => requireRoles("admin" as unknown as string[]),
    /non-empty array/,
  );
  assert.throws(() => requireRoles([""]), /non-empty string/);
  assert.throws(() => requireRoles(["ad\nmin"]), /control characters/);
  assert.throws(
    () => requireRoles(["a"], { claim: "" }),
    /non-reserved claim name/,
  );
  for (const reserved of ["__proto__", "constructor", "prototype"]) {
    assert.throws(
      () => requireRoles(["a"], { claim: reserved }),
      /non-reserved claim name/,
    );
  }
  assert.throws(
    () => requireRoles(["a"], { claim: 42 as unknown as string }),
    /claim name or a reader/,
  );
  assert.throws(
    () => requireRoles(["a"], { match: "some" as "all" }),
    /match must be/,
  );
  assert.throws(
    () => requireRoles(["a"], null as unknown as object),
    /options must be an object/,
  );
});

test("bearerAuth: a user object from validate feeds requireScopes and requireRoles", async () => {
  // Stand-in for a provider SDK (aws-jwt-verify, loginradius-sdk, ...).
  const sdk: Record<string, { sub: string; scope: string; groups: string[] }> =
    {
      "tok-admin": { sub: "u1", scope: "items:read", groups: ["admins"] },
      "tok-user": { sub: "u2", scope: "items:read", groups: ["users"] },
    };
  const app = new App({ logger: false });
  app.use(
    bearerAuth({
      validate: (token) => {
        const claims = sdk[token];
        if (!claims) return false;
        return { sub: claims.sub, scopes: claims.scope.split(" "), claims };
      },
    }),
  );
  app.route({
    method: "GET",
    path: "/admin",
    hooks: { ...requireScopes(["items:read"], { phase: "preBody" }) },
    responses: { 200: { description: "ok" } },
    handler: (ctx) => ({
      status: 200 as const,
      body: { sub: (ctx.state.user as { sub: string }).sub },
    }),
  });
  app.route({
    method: "GET",
    path: "/admins-only",
    hooks: requireRoles(["admins"], { claim: "groups" }),
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const get = (path: string, token: string) =>
    app.request(
      new Request(`http://x${path}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );

  const scoped = await get("/admin", "tok-user");
  assert.equal(scoped.status, 200);
  assert.deepEqual(await scoped.json(), { sub: "u2" });
  assert.equal((await get("/admins-only", "tok-admin")).status, 200);
  assert.equal((await get("/admins-only", "tok-user")).status, 403);
  assert.equal(
    (await get("/admins-only", "tok-unknown")).status,
    403,
    "rejected token",
  );
});

test("bearerAuth: validate returning true leaves ctx.state.user unset", async () => {
  const app = new App({ logger: false });
  app.use(bearerAuth({ validate: () => true }));
  app.route({
    method: "GET",
    path: "/admin",
    hooks: requireRoles(["admin"]),
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.request(
    new Request("http://x/admin", {
      headers: { authorization: "Bearer anything" },
    }),
  );
  // Authenticated but with no user object, so there are no roles to read.
  assert.equal(res.status, 401);
});
