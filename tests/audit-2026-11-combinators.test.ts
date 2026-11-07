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
 * 3. Cloudflare security-audit-skill findings (2026-11-07 follow-up): request
 *    budgets inside every() were invisible to later rejections, boot guards
 *    could not see through every(), an optional-mode branch short-circuited
 *    some(), OR-composed / path-exempted requireScopes() leaked an all-of
 *    union, a 205 upstream crashed pinned fetches, and a raised route body
 *    limit still refused a pre-buffered body. Review follow-ups: a budget is
 *    charged at most once per request however compositions nest, and a
 *    prior optional pass-through no longer hides a later some() branch.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { z } from "zod";

import {
  App,
  bearerAuth,
  clientCertAuth,
  concurrencyLimit,
  createJwtSigner,
  every,
  except,
  fetchGuard,
  ForbiddenError,
  httpSignatureAuth,
  idempotency,
  jwk,
  loginThrottle,
  markAuthHook,
  rateLimit,
  requestDecompression,
  requestId,
  requireRoles,
  requireScopes,
  responseCache,
  some,
  tenancy,
  tenantFromClaim,
  tenantFromHeader,
  UnauthorizedError,
  type Hooks,
} from "../src/index.js";
import { DALOY_REQUEST_RAW_BODY } from "../src/app.js";
import { setConnInfo } from "../src/conn-info.js";
import { buildWebSocketHeaders, buildWebSocketQuery } from "../src/websocket.js";

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

// ---------- 3. Cloudflare security-audit-skill findings (2026-11) ----------

test("[every] EARLY_REJECTION_HOOK_MARKER survives preBody hooks in every() without double-charging", async () => {
  // Unhappy path: every(requestId(), rateLimit({ max: 2 })) followed by bearerAuth()
  // must charge the limiter on 401 rejections from bearerAuth() and return 429 on the 3rd attempt.
  const app = new App({ logger: false, behindProxy: "none" });
  app.use(every(requestId(), rateLimit({ windowMs: 60_000, max: 2, groupId: `cf-audit-rl-${++group}` })));
  app.use(bearerAuth({ validate: (t) => (t === "valid" ? { sub: "u1" } : false) }));
  app.route({
    method: "GET",
    path: "/items",
    responses: ok,
    acknowledgeNoResponseBodySchema: true,
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  } as never);

  assert.equal((await get(app, "/items", { authorization: "Bearer bad" })).status, 403);
  assert.equal((await get(app, "/items", { authorization: "Bearer bad" })).status, 403);
  assert.equal((await get(app, "/items", { authorization: "Bearer bad" })).status, 429);

  // Happy path: every(rateLimit({ max: 2 }), bearerAuth()) charges exactly once per rejection.
  const app2 = new App({ logger: false, behindProxy: "none" });
  app2.use(
    every(
      rateLimit({ windowMs: 60_000, max: 2, groupId: `cf-audit-rl-${++group}` }),
      bearerAuth({ validate: (t) => (t === "valid" ? { sub: "u1" } : false) }),
    ),
  );
  app2.route({
    method: "GET",
    path: "/items",
    responses: ok,
    acknowledgeNoResponseBodySchema: true,
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  } as never);
  assert.equal((await get(app2, "/items", { authorization: "Bearer bad" })).status, 403);
  assert.equal(
    (await get(app2, "/items", { authorization: "Bearer bad" })).status,
    403,
    "second rejection must still be 403 (not 429 from double-charging)",
  );
  assert.equal((await get(app2, "/items", { authorization: "Bearer bad" })).status, 429);
});

test("[boot-guards] cache-before-tenancy and replay-before-budget inspect every() and multi-layer chains", async () => {
  // Unhappy path 1: every(responseCache(), tenancy()) in production must fail boot guard.
  const appCacheTenancy = new App({ logger: false, env: "production", behindProxy: "none" });
  appCacheTenancy.route({
    method: "GET",
    path: "/tenant-data",
    public: true,
    hooks: every(responseCache(), tenancy({ resolve: [tenantFromHeader("x-tenant-id")] })),
    responses: ok,
    acknowledgeNoResponseBodySchema: true,
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  } as never);
  assert.throws(
    () => appCacheTenancy.assertSecureConfig(),
    /before tenancy\(\) in its effective hook chain/,
  );
  assert.equal((await get(appCacheTenancy, "/tenant-data", { "x-tenant-id": "acme" })).status, 500);

  // Unhappy path 2: global rateLimit -> responseCache -> route rateLimit must fail replay-before-budget.
  const appReplayBudget = new App({ logger: false, env: "production", behindProxy: "none" });
  appReplayBudget.use(rateLimit({ windowMs: 60_000, max: 100, groupId: `cf-audit-rl-${++group}` }));
  appReplayBudget.use(responseCache());
  appReplayBudget.route({
    method: "GET",
    path: "/limited",
    public: true,
    hooks: rateLimit({ windowMs: 60_000, max: 2, groupId: `cf-audit-rl-${++group}` }),
    responses: ok,
    acknowledgeNoResponseBodySchema: true,
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  } as never);
  assert.throws(
    () => appReplayBudget.assertSecureConfig(),
    /before rateLimit\(\) \/ loginThrottle\(\) in its effective hook chain/,
  );
  assert.equal((await get(appReplayBudget, "/limited", {})).status, 500);

  // Happy path: every(tenancy(), responseCache()) and every(rateLimit(), idempotency()) succeed.
  const appSafe = new App({ logger: false, env: "production", behindProxy: "none" });
  appSafe.route({
    method: "GET",
    path: "/safe",
    public: true,
    hooks: every(
      tenancy({ resolve: [tenantFromHeader("x-tenant-id")], allow: ["acme"] }),
      rateLimit({ windowMs: 60_000, max: 10, groupId: `cf-audit-rl-${++group}` }),
      responseCache(),
    ),
    responses: ok,
    acknowledgeNoResponseBodySchema: true,
    handler: (ctx: any) => ({ status: 200 as const, body: { tenant: ctx.state.tenant } }),
  } as never);
  const res = await get(appSafe, "/safe", { "x-tenant-id": "acme" });
  assert.equal(res.status, 200);
});

test("[some] optional httpSignatureAuth branch does not short-circuit subsequent auth branches", async () => {
  const sigAuth = httpSignatureAuth({
    optional: true,
    algorithms: ["hmac-sha256"],
    resolveKey: () => undefined,
  });
  const bearer = bearerAuth({
    validate: (t) => (t === "good-token" ? { sub: "alice" } : false),
  });
  const app = new App({ logger: false, env: "production", behindProxy: "none" });
  app.use(some(sigAuth, bearer));
  authRoute(app, "/protected");

  // Unhappy path: request with neither Signature nor Bearer token must be rejected (401).
  assert.equal((await get(app, "/protected", {})).status, 401);

  // Happy path: request without Signature header but with valid Bearer token reaches bearerAuth and succeeds (200).
  const good = await get(app, "/protected", { authorization: "Bearer good-token" });
  assert.equal(good.status, 200);
  assert.equal((await good.json()).sub, "alice");
});

test("[some/except] requireScopes inside some() or except() does not leak scopes across branches or exempted paths", async () => {
  const app = new App({ logger: false, behindProxy: "none" });
  app.use(
    some(
      every(
        bearerAuth({ validate: (t) => (t === "tok-a" ? { sub: "a", scopes: ["scope:a"] } : false) }),
        requireScopes(["scope:a"]),
      ),
      every(
        bearerAuth({ validate: (t) => (t === "tok-b" ? { sub: "b", scopes: ["scope:b"] } : false) }),
        requireScopes(["scope:b"]),
      ),
    ),
  );
  app.use(except("/public", requireScopes(["scope:admin"])));
  app.route({
    method: "GET",
    path: "/public",
    responses: ok,
    acknowledgeNoResponseBodySchema: true,
    handler: (ctx: any) => ({ status: 200 as const, body: { sub: ctx.state.user.sub } }),
  } as never);
  app.route({
    method: "GET",
    path: "/admin",
    responses: ok,
    acknowledgeNoResponseBodySchema: true,
    handler: (ctx: any) => ({ status: 200 as const, body: { sub: ctx.state.user.sub } }),
  } as never);

  // Happy path: tok-a (only scope:a, no scope:b and no scope:admin) succeeds on /public.
  assert.equal((await get(app, "/public", { authorization: "Bearer tok-a" })).status, 200);
  // Happy path: tok-b (only scope:b, no scope:a and no scope:admin) succeeds on /public.
  assert.equal((await get(app, "/public", { authorization: "Bearer tok-b" })).status, 200);
  // Unhappy path: tok-a fails on /admin because except("/public", requireScopes(["scope:admin"])) applies there.
  assert.equal((await get(app, "/admin", { authorization: "Bearer tok-a" })).status, 403);
});

test("[some] preBody auth paired with default requireScopes runs before requestDecompression and body parsing", async () => {
  const app = new App({ logger: false, behindProxy: "none", bodyLimitBytes: 64 });
  app.use(requestDecompression({ maxDecompressedBytes: 64 }));
  app.use(
    some(
      every(
        bearerAuth({ validate: (t) => (t === "ok" ? { sub: "u1", scopes: ["write"] } : false) }),
        requireScopes(["write"]),
      ),
      apiKey(),
    ),
  );
  app.route({
    method: "POST",
    path: "/upload",
    request: { body: z.object({ data: z.string() }).strict() as any },
    responses: ok,
    acknowledgeNoResponseBodySchema: true,
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  } as never);

  // Unhappy path: unauthenticated request with an oversized gzip bomb is rejected with 401 in preBody
  // before decompression or body parsing runs (which would otherwise return 413).
  const compressedBomb = gzipSync(Buffer.alloc(1024, "a"));
  const unauthRes = await app.fetch(
    new Request("http://localhost/upload", {
      method: "POST",
      headers: {
        "user-agent": "audit",
        "content-type": "application/json",
        "content-encoding": "gzip",
      },
      body: compressedBomb,
    }),
  );
  assert.equal(unauthRes.status, 401);

  // Happy path: authenticated request with valid small body succeeds.
  const validRes = await app.fetch(
    new Request("http://localhost/upload", {
      method: "POST",
      headers: {
        "user-agent": "audit",
        authorization: "Bearer ok",
        "content-type": "application/json",
      },
      body: JSON.stringify({ data: "hello" }),
    }),
  );
  assert.equal(validRes.status, 200);
});

test("[fetchGuard] pinnedHttpFetch handles 205 Reset Content without uncaughtException", async () => {
  // A hostname (not an IP literal) plus a fixed resolver is what routes the
  // request through pinnedHttpFetch; an IP-literal host skips pinning.
  let hitPinnedPath = 0;
  const server = createServer((req, res) => {
    hitPinnedPath++;
    if (req.url === "/reset") {
      // A 205 with a body: `new Response(stream, { status: 205 })` throws, and
      // before the guard caught it that throw fired inside node:http's
      // 'response' callback as an uncaught exception (process crash).
      res.writeHead(205, "Reset Content", { "x-custom": "ok", "content-type": "text/plain" });
      res.end("ignored body");
      return;
    }
    // Node's http parser forwards any 3-digit status; the WHATWG Response
    // constructor refuses one outside 200-599.
    res.writeHead(999, "Bogus");
    res.end("x");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as { port: number };
  const uncaught: unknown[] = [];
  const onUncaught = (err: unknown) => uncaught.push(err);
  process.on("uncaughtException", onUncaught);
  try {
    const safeFetch = fetchGuard({
      allowLoopback: true,
      pinDns: true,
      resolve: async () => ["127.0.0.1"],
    });
    // Happy path: the null-body status is surfaced as a normal Response.
    const res = await safeFetch(`http://upstream.test:${addr.port}/reset`);
    assert.equal(res.status, 205);
    assert.equal(res.headers.get("x-custom"), "ok");
    assert.equal(await res.text(), "");
    // Unhappy path: a status the Response constructor refuses rejects the
    // fetch (a RangeError) rather than escaping as an uncaught exception.
    await assert.rejects(safeFetch(`http://upstream.test:${addr.port}/bogus`), RangeError);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(uncaught.length, 0, "no uncaught exception escaped the http response callback");
    assert.equal(hitPinnedPath, 2);
  } finally {
    process.off("uncaughtException", onUncaught);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("[prototype-pollution] coldPathContext.query, ctx.headers, and WebSocket upgrade builders strip forbidden keys", async () => {
  let coldQuery: Record<string, unknown> = {};
  let routeHeaders: Record<string, unknown> = {};
  const app = new App({ logger: false, behindProxy: "none" });
  app.use({
    preBody(ctx) {
      coldQuery = ctx.query as Record<string, unknown>;
    },
  });
  app.route({
    method: "GET",
    path: "/check",
    responses: ok,
    acknowledgeNoResponseBodySchema: true,
    handler: (ctx) => {
      routeHeaders = ctx.headers as Record<string, unknown>;
      return { status: 200 as const, body: { ok: true } };
    },
  });

  // 404 triggers coldPathContext
  const res404 = await app.fetch(
    new Request("http://localhost/missing?__proto__=polluted&constructor=bad&prototype=bad&tag=a&tag=b", {
      headers: { "user-agent": "audit" },
    }),
  );
  assert.equal(res404.status, 404);
  assert.equal(Object.prototype.hasOwnProperty.call(coldQuery, "__proto__"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(coldQuery, "constructor"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(coldQuery, "prototype"), false);
  assert.deepEqual(coldQuery.tag, ["a", "b"]);

  // Matched route triggers headersToObject
  const res200 = await app.fetch(
    new Request("http://localhost/check", {
      headers: { "user-agent": "audit", constructor: "bad", prototype: "bad", "x-ok": "1" },
    }),
  );
  assert.equal(res200.status, 200);
  assert.equal(Object.prototype.hasOwnProperty.call(routeHeaders, "constructor"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(routeHeaders, "prototype"), false);
  assert.equal(routeHeaders["x-ok"], "1");

  // WebSocket query and headers helpers
  const wsQuery = buildWebSocketQuery(
    new URLSearchParams("__proto__=1&constructor=2&prototype=3&room=general"),
  );
  assert.equal(Object.prototype.hasOwnProperty.call(wsQuery, "__proto__"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(wsQuery, "constructor"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(wsQuery, "prototype"), false);
  assert.equal(wsQuery.room, "general");

  const wsHeaders = buildWebSocketHeaders(
    new Headers({ constructor: "bad", prototype: "bad", "x-ws": "ok" }),
  );
  assert.equal(Object.prototype.hasOwnProperty.call(wsHeaders, "constructor"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(wsHeaders, "prototype"), false);
  assert.equal(wsHeaders["x-ws"], "ok");
});

test("[capRequestBody] route raising bodyLimitBytes above app default accepts pre-buffered DALOY_REQUEST_RAW_BODY", async () => {
  const app = new App({
    logger: false,
    behindProxy: "none",
    bodyLimitBytes: 32,
    hooks: { onRequest: () => {} },
  });
  app.route({
    method: "POST",
    path: "/large",
    bodyLimitBytes: 256,
    request: { body: z.object({ text: z.string() }).strict() as any },
    responses: ok,
    acknowledgeNoResponseBodySchema: true,
    handler: (ctx: any) => ({ status: 200 as const, body: { len: ctx.body.text.length } }),
  } as never);

  const payloadBytes = new TextEncoder().encode(JSON.stringify({ text: "x".repeat(64) }));
  const reqOk = new Request("http://localhost/large", {
    method: "POST",
    headers: { "user-agent": "audit", "content-type": "application/json" },
    body: payloadBytes,
  });
  (reqOk as unknown as Record<symbol, unknown>)[DALOY_REQUEST_RAW_BODY] = payloadBytes;
  const resOk = await app.fetch(reqOk);
  assert.equal(resOk.status, 200);
  assert.deepEqual(await resOk.json(), { len: 64 });

  // Unhappy path: a pre-buffered body exceeding the route's raised 256-byte limit is still rejected with 413.
  const overLimitBytes = new TextEncoder().encode(JSON.stringify({ text: "x".repeat(300) }));
  const reqOver = new Request("http://localhost/large", {
    method: "POST",
    headers: { "user-agent": "audit", "content-type": "application/json" },
    body: overLimitBytes,
  });
  (reqOver as unknown as Record<symbol, unknown>)[DALOY_REQUEST_RAW_BODY] = overLimitBytes;
  const resOver = await app.fetch(reqOver);
  assert.equal(resOver.status, 413);
});

// ---------- 4. Review follow-ups to the 2026-11 audit fixes ----------

test("[every] a request budget forwarded out of every() is charged once per rejection however the bundle is wrapped", async () => {
  // Unhappy path (regression): markAuthHook() re-wraps the composed preBody,
  // which drops the function marker telling the outer composition that the
  // inner one already bills its budgets. Without per-request de-duplication,
  // the limiter was charged twice per rejection and the 2nd attempt was 429.
  const denyUnlessOk: Hooks = {
    preBody(ctx) {
      if (ctx.request.headers.get("authorization") !== "Bearer ok") throw new UnauthorizedError();
    },
  };
  for (const wrap of [
    { name: "markAuthHook(every())", build: (inner: Hooks) => markAuthHook(inner) },
    { name: "except(every())", build: (inner: Hooks) => except("/open", inner) },
    { name: "{ ...every() }", build: (inner: Hooks) => ({ ...inner }) },
  ]) {
    const app = new App({ logger: false, behindProxy: "none" });
    app.use(
      wrap.build(
        every(
          rateLimit({ windowMs: 60_000, max: 2, groupId: `cf-audit-rl-${++group}` }),
          denyUnlessOk,
        ),
      ),
    );
    app.route({
      method: "GET",
      path: "/items",
      public: true,
      responses: ok,
      acknowledgeNoResponseBodySchema: true,
      handler: () => ({ status: 200 as const, body: { ok: true } }),
    } as never);
    assert.equal((await get(app, "/items", {})).status, 401, wrap.name);
    assert.equal(
      (await get(app, "/items", {})).status,
      401,
      `${wrap.name}: the second rejection must not be 429 (budget billed twice)`,
    );
    assert.equal((await get(app, "/items", {})).status, 429, `${wrap.name}: the budget still applies`);
  }

  // Happy path: an accepted request is billed once by the limiter's own
  // beforeHandle, so max: 2 admits exactly two authenticated requests.
  const app = new App({ logger: false, behindProxy: "none" });
  app.use(
    markAuthHook(
      every(rateLimit({ windowMs: 60_000, max: 2, groupId: `cf-audit-rl-${++group}` }), denyUnlessOk),
    ),
  );
  app.route({
    method: "GET",
    path: "/items",
    responses: ok,
    acknowledgeNoResponseBodySchema: true,
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  } as never);
  assert.equal((await get(app, "/items", { authorization: "Bearer ok" })).status, 200);
  assert.equal((await get(app, "/items", { authorization: "Bearer ok" })).status, 200);
  assert.equal((await get(app, "/items", { authorization: "Bearer ok" })).status, 429);
});

test("[some] a pass-through recorded by an earlier optional hook does not hide a later some() branch", async () => {
  const optionalSig = () =>
    httpSignatureAuth({ optional: true, algorithms: ["hmac-sha256"], resolveKey: () => undefined });
  const app = new App({ logger: false, env: "production", behindProxy: "none" });
  // A global optional hook already records AUTH_OPTIONAL_PASS before some() runs.
  app.use(optionalSig());
  app.use(some(optionalSig(), bearerAuth({ validate: (t) => (t === "good-token" ? { sub: "alice" } : false) })));
  authRoute(app, "/protected");

  // Happy path: the bearer branch still runs and authenticates the caller.
  const good = await get(app, "/protected", { authorization: "Bearer good-token" });
  assert.equal(good.status, 200);
  assert.equal((await good.json()).sub, "alice");
  // Unhappy paths: no credential is still refused (401), and a present but
  // rejected one is still a denial (403) rather than an anonymous pass-through.
  assert.equal((await get(app, "/protected", {})).status, 401);
  assert.equal((await get(app, "/protected", { authorization: "Bearer bad-token" })).status, 403);

  // The earlier hook's pass-through record survives some() on a route that
  // does not require auth, so an unauthenticated request is still recognised
  // as a legitimate anonymous one (not an auth.not_enforced misconfiguration).
  const open = new App({ logger: false, env: "production", behindProxy: "none" });
  open.use(optionalSig());
  open.use(some(optionalSig(), optionalSig()));
  open.route({
    method: "GET",
    path: "/open",
    public: true,
    responses: ok,
    acknowledgeNoResponseBodySchema: true,
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  } as never);
  assert.equal((await get(open, "/open", {})).status, 200);
});

for (const kind of ["cache", "idempotency"] as const) {
  test(`[some/except] ${kind} replay cannot preempt a conditional requireScopes() gate after permission revocation`, async () => {
    // some() and except() no longer advertise a static scope marker (which
    // would have applied to every branch / the exempted paths). The gate must
    // instead be ordered ahead of a replay registered before it.
    for (const gate of [
      { name: "except()", hooks: () => except("/public", requireScopes(["records:read"])) },
      { name: "some()", hooks: () => some(requireScopes(["records:read"]), requireScopes(["records:admin"])) },
    ]) {
      const app = new App({ logger: false, behindProxy: "none" });
      let scopes: string[] = ["records:read"];
      let calls = 0;
      app.use({
        preBody(ctx) {
          (ctx.state as Record<string, unknown>).user = { sub: "same-user", scopes };
        },
      });
      app.use(kind === "cache" ? responseCache({ principal: () => "same-user" }) : idempotency());
      app.route({
        method: kind === "cache" ? "GET" : "POST",
        path: "/protected",
        public: true,
        hooks: gate.hooks(),
        responses: ok,
        acknowledgeNoResponseBodySchema: true,
        handler: () => {
          calls++;
          return { status: 200 as const, body: { secret: "protected-test-data" } };
        },
      } as never);
      const request = () =>
        app.fetch(
          new Request("http://localhost/protected", {
            method: kind === "cache" ? "GET" : "POST",
            headers: { "user-agent": "audit", "idempotency-key": `scope-replay-${gate.name}` },
          }),
        );
      // Happy path: an authorized caller is served and its retry replays.
      assert.equal((await request()).status, 200, gate.name);
      assert.equal((await request()).status, 200, gate.name);
      assert.equal(calls, 1, `${gate.name}: authorized retries must replay`);
      // Unhappy path: revoke the scope; the stored response must not be served.
      scopes = [];
      const forbidden = await request();
      assert.equal(forbidden.status, 403, `${gate.name}: revocation applies to stored responses`);
      assert.doesNotMatch(await forbidden.text(), /protected-test-data/);
      assert.equal(calls, 1, gate.name);
    }
  });
}

