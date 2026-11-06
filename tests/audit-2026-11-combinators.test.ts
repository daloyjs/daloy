/**
 * Audit 2026-11: hook combinators.
 *
 * 1. `some()` let a denying branch leave state behind: a revoked bearer/JWT
 *    principal on `ctx.state.user` (read by requireScopes, requireRoles and
 *    tenantFromClaim), or the auth-ran record of an auth hook that passed
 *    before a later gate in the same branch denied. Each branch is now a
 *    transaction over ctx.state, and bearerAuth()/jwk() stamp `user` only
 *    after their revocation hook accepts.
 * 2. `every()` / `some()` kept only the first bundle's registration-time
 *    receivers (behindProxy, body limit), so a later rateLimit() /
 *    loginThrottle() keyed every client behind a proxy onto one bucket.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  App,
  bearerAuth,
  clientCertAuth,
  concurrencyLimit,
  createJwtSigner,
  every,
  ForbiddenError,
  idempotency,
  jwk,
  loginThrottle,
  markAuthHook,
  rateLimit,
  requireRoles,
  requireScopes,
  some,
  tenancy,
  tenantFromClaim,
  UnauthorizedError,
  type Hooks,
} from "../src/index.js";
import { setConnInfo } from "../src/conn-info.js";

const ok = { 200: { description: "ok" } } as const;

// ---------- 1. some() rolls back a denying branch's ctx.state ----------

test("[some] a denying branch's string and symbol state keys are rolled back", async () => {
  const marker = Symbol("branch");
  const hooks = some(
    {
      preBody(ctx) {
        const state = ctx.state as Record<PropertyKey, unknown>;
        state.user = { sub: "leaked" };
        state[marker] = true;
        state.existing = "overwritten";
        return new Response(null, { status: 401 });
      },
    },
    {
      preBody(ctx) {
        (ctx.state as Record<string, unknown>).other = 1;
        throw new Error("deny");
      },
    },
    {
      preBody(ctx) {
        (ctx.state as Record<string, unknown>).winner = "kept";
      },
    },
  );
  const state: Record<PropertyKey, unknown> = { existing: "original" };
  assert.equal(await hooks.preBody!({ state, request: new Request("http://x.test/") } as any), undefined);
  assert.equal(state.user, undefined);
  assert.equal(marker in state, false);
  assert.equal(state.other, undefined);
  assert.equal(state.existing, "original");
  assert.equal(state.winner, "kept", "the winning branch's mutations are preserved");
});

test("[some] when every branch denies, ctx.state is left as it was", async () => {
  const hooks = some(
    {
      preBody(ctx) {
        (ctx.state as Record<string, unknown>).user = { sub: "a" };
        return new Response(null, { status: 401 });
      },
    },
    {
      preBody(ctx) {
        (ctx.state as Record<string, unknown>).user = { sub: "b" };
        return new Response(null, { status: 403 });
      },
    },
  );
  const state: Record<PropertyKey, unknown> = {};
  const res = await hooks.preBody!({ state, request: new Request("http://x.test/") } as any);
  assert.equal((res as Response).status, 401, "the first denial still wins");
  assert.deepEqual(Reflect.ownKeys(state), []);
});

const apiKey = () =>
  markAuthHook({
    preBody(ctx) {
      if (ctx.request.headers.get("x-api-key") !== "k-low") {
        return new Response("no key", { status: 401 });
      }
      (ctx.state as Record<string, unknown>).service = "low-svc";
      return undefined;
    },
  });

function authRoute(app: App<any>, path: string, hooks?: Hooks) {
  app.route({
    method: "GET",
    path,
    auth: { scheme: "bearer" },
    hooks,
    responses: ok,
    acknowledgeNoResponseBodySchema: true,
    handler: (ctx: any) => ({
      status: 200 as const,
      body: { sub: ctx.state.user?.sub ?? null, service: ctx.state.service ?? null },
    }),
  } as never);
}

async function get(app: App<any>, path: string, headers: Record<string, string>) {
  return app.fetch(new Request(`http://localhost${path}`, { headers: { "user-agent": "audit", ...headers } }));
}

test("[some] a revoked bearer principal does not survive into the API-key branch", async () => {
  const users: Record<string, object> = {
    "tok-admin-revoked": { sub: "carol", scopes: ["admin"], claims: { roles: ["Admin"] } },
    "tok-admin": { sub: "dave", scopes: ["admin"], claims: { roles: ["Admin"] } },
  };
  const app = new App({ logger: false, env: "production", behindProxy: "none" });
  app.use(
    some(
      bearerAuth({ validate: (t) => users[t] ?? false, verify: (t) => t !== "tok-admin-revoked" }),
      apiKey(),
    ),
  );
  authRoute(app, "/s", requireScopes(["admin"]));
  authRoute(app, "/r", requireRoles(["Admin"]));
  for (const path of ["/s", "/r"]) {
    const revokedPlusKey = await get(app, path, { authorization: "Bearer tok-admin-revoked", "x-api-key": "k-low" });
    assert.equal(revokedPlusKey.status, 401, `${path}: revoked admin token + low key must not authorize`);
    assert.equal((await get(app, path, { authorization: "Bearer tok-admin-revoked" })).status, 403);
    const good = await get(app, path, { authorization: "Bearer tok-admin" });
    assert.equal(good.status, 200);
    assert.equal((await good.json()).sub, "dave");
  }
});

test("[bearerAuth] verify() rejecting leaves ctx.state.user unset", async () => {
  const hooks = bearerAuth({ validate: () => ({ sub: "x" }), verify: () => false });
  const state: Record<string, unknown> = {};
  const request = new Request("http://x.test/", { headers: { authorization: "Bearer t" } });
  await assert.rejects(async () => hooks.preBody!({ state, request } as any), { status: 403 });
  assert.equal(state.user, undefined);
  const accepted = bearerAuth({ validate: () => ({ sub: "x" }), verify: () => true });
  await accepted.preBody!({ state, request } as any);
  assert.deepEqual(state.user, { sub: "x" });
});

async function jwtFixture() {
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const pub = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid: "k1", alg: "ES256", use: "sig" };
  const signer = createJwtSigner({ alg: "ES256", key: kp.privateKey, maxLifetimeSeconds: 3600, header: { kid: "k1" } });
  const now = Math.floor(Date.now() / 1000);
  const sign = (jti: string, org = "acme") =>
    signer.sign({ sub: `admin-${jti}`, scope: "admin", org, jti, aud: "api", iss: "iss", iat: now, exp: now + 600 });
  const auth = () =>
    jwk({
      jwks: { keys: [pub as any] },
      algorithms: ["ES256"],
      audience: "api",
      issuer: "iss",
      verify: (p: any) => p.jti !== "rv",
    });
  return { sign, auth };
}

test("[some] a revoked JWT principal does not survive into the API-key branch", async () => {
  const { sign, auth } = await jwtFixture();
  const app = new App({ logger: false, env: "production", behindProxy: "none" });
  app.use(some(auth(), apiKey()));
  authRoute(app, "/s", requireScopes(["admin"]));
  const revoked = await sign("rv");
  assert.equal((await get(app, "/s", { authorization: `Bearer ${revoked}`, "x-api-key": "k-low" })).status, 401);
  const good = await get(app, "/s", { authorization: `Bearer ${await sign("ok")}` });
  assert.equal(good.status, 200);
  assert.equal((await good.json()).sub, "admin-ok");
});

test("[some] tenantFromClaim does not pick the revoked token's org", async () => {
  const { sign, auth } = await jwtFixture();
  const partner = { verified: true, subjectCN: "partner", issuerCN: "ca", subjectAltNames: [], fingerprint256: "AA" };
  const app = new App({ logger: false, env: "production", behindProxy: "none" });
  app.use(
    some(
      auth(),
      clientCertAuth({
        checkValidity: false,
        resolve: (ctx) => (ctx.request.headers.get("x-cert") === "p" ? (partner as any) : undefined),
      }),
    ),
  );
  app.use(
    tenancy({
      resolve: [
        tenantFromClaim("org", { strict: true }),
        (ctx: any) => ({ partner: "globex" } as Record<string, string>)[ctx.state.clientCertificate?.subjectCN ?? ""],
      ],
      allow: ["acme", "globex"],
    }),
  );
  app.route({
    method: "GET",
    path: "/t",
    responses: ok,
    acknowledgeNoResponseBodySchema: true,
    handler: (ctx: any) => ({ status: 200 as const, body: { tenant: ctx.state.tenant, sub: ctx.state.user?.sub ?? null } }),
  } as never);
  const attack = await get(app, "/t", { "x-cert": "p", authorization: `Bearer ${await sign("rv")}` });
  assert.equal(attack.status, 200);
  assert.deepEqual(await attack.json(), { tenant: "globex", sub: null });
  const valid = await get(app, "/t", { authorization: `Bearer ${await sign("ok")}` });
  assert.deepEqual(await valid.json(), { tenant: "acme", sub: "admin-ok" });
});

test("[some] an auth hook that passed in a denying branch does not mark the request authenticated", async () => {
  const users: Record<string, object> = { "tok-bob": { sub: "bob", scopes: ["read"] }, "tok-root": { sub: "root", scopes: ["admin"] } };
  const app = new App({ logger: false, env: "production", behindProxy: "none" });
  app.use(
    some(every(bearerAuth({ validate: (t) => users[t] ?? false }), requireScopes(["admin"])), {
      beforeHandle: () => undefined,
    }),
  );
  authRoute(app, "/a");
  // The permissive branch matched without any auth hook passing: the
  // request-time guard must still refuse the auth: route (500 in production).
  assert.equal((await get(app, "/a", { authorization: "Bearer tok-bob" })).status, 500);
  const root = await get(app, "/a", { authorization: "Bearer tok-root" });
  assert.equal(root.status, 200);
  assert.equal((await root.json()).sub, "root");
});

test("[some] a denying branch releases the concurrencyLimit slot it acquired", async () => {
  // Regression: the state rollback used to delete the slot bookkeeping and the
  // request finalizer along with the branch's other keys, so the slot stayed
  // taken forever and every later request on the bucket got 503.
  let calls = 0;
  const denyOnce: Hooks = {
    beforeHandle() {
      if (calls++ === 0) throw new ForbiddenError("first only");
      return undefined;
    },
  };
  const never: Hooks = {
    beforeHandle() {
      throw new UnauthorizedError("no");
    },
  };
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/slot",
    hooks: some(every(concurrencyLimit({ maxConcurrent: 1, maxQueue: 0, scope: "global" }), denyOnce), never),
    responses: ok,
    acknowledgeNoResponseBodySchema: true,
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  } as never);
  assert.equal((await get(app, "/slot", {})).status, 403);
  assert.equal((await get(app, "/slot", {})).status, 200);
  assert.equal((await get(app, "/slot", {})).status, 200);
});

test("[some] a denying branch releases its idempotency reservation", async () => {
  // Same shape for idempotency(): the rejected branch's reservation must be
  // released, or a legitimate retry of the same key answers 409 forever.
  let calls = 0;
  const denyOnce: Hooks = {
    beforeHandle() {
      if (calls++ === 0) throw new ForbiddenError("first only");
      return undefined;
    },
  };
  const never: Hooks = {
    beforeHandle() {
      throw new UnauthorizedError("no");
    },
  };
  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/pay",
    hooks: some(every(idempotency(), denyOnce), never),
    responses: ok,
    acknowledgeNoResponseBodySchema: true,
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  } as never);
  const post = () =>
    app.fetch(
      new Request("http://localhost/pay", {
        method: "POST",
        headers: { "user-agent": "audit", "idempotency-key": "k-1" },
      }),
    );
  assert.equal((await post()).status, 403);
  assert.equal((await post()).status, 200);
});

test("[some] finalizers registered before the branch ran are kept", async () => {
  // Only the rejected branch's own leases are rolled back; a slot taken by an
  // earlier hook outside some() stays held for the handler and is released
  // normally after the response.
  const app = new App({ logger: false });
  app.use(concurrencyLimit({ maxConcurrent: 1, maxQueue: 0, scope: "global" }));
  let inHandler = 0;
  let overlap = 0;
  app.route({
    method: "GET",
    path: "/outer",
    hooks: some(
      { beforeHandle() { throw new ForbiddenError("deny"); } },
      { beforeHandle: () => undefined },
    ),
    responses: ok,
    acknowledgeNoResponseBodySchema: true,
    handler: async () => {
      inHandler++;
      if (inHandler > 1) overlap++;
      await new Promise((r) => setTimeout(r, 20));
      inHandler--;
      return { status: 200 as const, body: { ok: true } };
    },
  } as never);
  const [a, b] = await Promise.all([get(app, "/outer", {}), get(app, "/outer", {})]);
  assert.deepEqual([a.status, b.status].sort(), [200, 503]);
  assert.equal(overlap, 0);
  assert.equal((await get(app, "/outer", {})).status, 200);
});

// ---------- 2. registration receivers chain across composed bundles ----------

function loginReq(peer: string, xff: string) {
  const r = new Request("http://app.test/login", {
    method: "POST",
    headers: { "user-agent": "audit", host: "app.test", "x-forwarded-for": xff },
  });
  setConnInfo(r, { remoteAddress: peer, remotePort: 5555 });
  return r;
}

let group = 0;
const lt = () => loginThrottle({ max: 2, delayAfter: 1000, groupId: `audit-lt-${++group}` });
const rl = () => rateLimit({ windowMs: 60_000, max: 1000, groupId: `audit-rl-${++group}` });

async function proxyIsolation(hooks: Hooks) {
  const app = new App({ logger: false, behindProxy: { cidrs: ["10.9.0.0/16"] }, allowedHosts: ["app.test"] } as any);
  app.route({
    method: "POST",
    path: "/login",
    hooks,
    public: true,
    acknowledgeNoResponseBodySchema: true,
    handler: () => new Response("ok"),
  } as never);
  const attacker: number[] = [];
  for (let i = 0; i < 3; i++) attacker.push((await app.fetch(loginReq("10.9.0.1", "198.51.100.7"))).status);
  const otherClient = (await app.fetch(loginReq("10.9.0.1", "203.0.113.9"))).status;
  const attackerViaOtherProxy = (await app.fetch(loginReq("10.9.0.2", "198.51.100.7"))).status;
  return { attacker, otherClient, attackerViaOtherProxy };
}

test("[every] rateLimit + loginThrottle key each client behind a trusted proxy separately", async () => {
  for (const hooks of [every(rl(), lt()), every(lt(), rl()), every(rl(), rl(), lt())]) {
    const r = await proxyIsolation(hooks);
    assert.deepEqual(r.attacker, [200, 200, 429]);
    assert.equal(r.otherClient, 200, "another client behind the same proxy must keep its own bucket");
    assert.equal(r.attackerViaOtherProxy, 429, "the bucket follows the client, not the proxy peer");
  }
});

test("[some] a later branch's loginThrottle also learns the App behindProxy posture", async () => {
  const deny: Hooks = { preBody: () => new Response(null, { status: 401 }) };
  const r = await proxyIsolation(some(every(rl(), deny), lt()));
  // Once loginThrottle denies, every branch has denied and the first denial
  // (the 401) is what the client sees.
  assert.deepEqual(r.attacker, [200, 200, 401]);
  assert.equal(r.otherClient, 200, "another client behind the same proxy must keep its own bucket");
  assert.equal(r.attackerViaOtherProxy, 401, "the bucket follows the client, not the proxy peer");
});

test("[every/some] every bundle's behindProxy and body-limit receivers are called", () => {
  const BEHIND = Symbol.for("daloyjs.hooks.appBehindProxy");
  const LIMIT = Symbol.for("daloyjs.hooks.appBodyLimit");
  for (const combine of [every, some]) {
    const proxyCfgs: unknown[] = [];
    const limits: unknown[] = [];
    const layer = (): Hooks => {
      const h: Record<PropertyKey, unknown> = { beforeHandle: () => undefined };
      h[BEHIND] = (cfg: unknown) => proxyCfgs.push(cfg);
      h[LIMIT] = (limit: unknown) => limits.push(limit);
      return h as Hooks;
    };
    const app = new App({ logger: false, behindProxy: { hops: 1 }, bodyLimitBytes: 4096 } as any);
    app.use(combine(layer(), { beforeHandle: () => undefined }, layer(), layer()));
    assert.equal(proxyCfgs.length, 3, `${combine.name}: every behindProxy receiver is called`);
    assert.deepEqual(proxyCfgs[2], { hops: 1 });
    assert.deepEqual(limits, [4096, 4096, 4096], `${combine.name}: every body-limit receiver is called`);
  }
});
