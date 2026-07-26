/**
 * RED-TEAM ATTACK SUITE — WAVE 5 (cross-tenant cached-response disclosure)
 * =======================================================================
 *
 * Two confirmed CWE-524 findings (OWASP API2/API3) are locked closed here:
 *
 *   F-2  idempotency() replayed a stored response to ANY caller that reused
 *        the same Idempotency-Key with the same body — even a different
 *        authenticated principal. Now the store key is namespaced by the
 *        caller (Authorization header by default, or a `scope` function).
 *
 *   F-3  responseCache() served a cached response keyed on method+URL to the
 *        next caller, ignoring the Authorization header — leaking one user's
 *        private response to another. Now Authorization-bearing requests
 *        bypass the cache by default (RFC 9111 §3.5), with an explicit
 *        `cacheAuthenticatedRequests` opt-in.
 *
 * The SECURE outcome is the PASSING outcome.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  App,
  idempotency,
  MemoryIdempotencyStore,
  responseCache,
  MemoryResponseCacheStore,
} from "../src/index.js";

// ===========================================================================
// F-2 — idempotency cross-tenant replay
// ===========================================================================

function idemApp(opts: Parameters<typeof idempotency>[0] = {}) {
  let calls = 0;
  const app = new App({ env: "development", logger: false });
  app.use(idempotency({ store: new MemoryIdempotencyStore(), ...opts }));
  app.route({
    method: "POST",
    path: "/me/charge",
    operationId: "charge",
    request: { body: z.object({ amount: z.number() }) as any },
    responses: {
      201: { description: "ok", body: z.object({ owner: z.string(), call: z.number() }) as any },
    },
    handler: async ({ request }: any) => ({
      status: 201 as const,
      body: { owner: request.headers.get("authorization") ?? "anon", call: ++calls },
    }),
  });
  return app;
}

const json = (key: string, auth?: string) => ({
  method: "POST" as const,
  headers: {
    "content-type": "application/json",
    "idempotency-key": key,
    ...(auth ? { authorization: auth } : {}),
  },
  body: '{"amount":10}',
});

test("[idempotency/x-tenant] client B reusing client A's key gets ITS OWN response, not A's", async () => {
  const app = idemApp();
  const a = await (await app.request("/me/charge", json("shared-key", "Bearer USER_A"))).json();
  const res2 = await app.request("/me/charge", json("shared-key", "Bearer USER_B"));
  const b = await res2.json();
  assert.equal(a.owner, "Bearer USER_A");
  assert.equal(b.owner, "Bearer USER_B", "client B must never receive client A's stored response");
  assert.equal(res2.headers.get("idempotency-replayed"), null, "B's request is not a replay of A");
  assert.notEqual(a.call, b.call, "B's handler actually ran");
});

test("[idempotency/x-tenant] same principal + same key still replays (idempotency preserved)", async () => {
  const app = idemApp();
  const first = await (await app.request("/me/charge", json("k1", "Bearer USER_A"))).json();
  const res2 = await app.request("/me/charge", json("k1", "Bearer USER_A"));
  const second = await res2.json();
  assert.equal(res2.headers.get("idempotency-replayed"), "true");
  assert.deepEqual(second, first, "the same caller's retry replays the stored response");
});

test("[idempotency/x-tenant] a custom scope() namespaces per user id", async () => {
  // Identity via a header the test controls; scope returns a stable user id.
  const app = idemApp({ scope: (ctx) => ctx.request.headers.get("x-user") ?? undefined });
  const reqFor = (user: string) => ({
    method: "POST" as const,
    headers: { "content-type": "application/json", "idempotency-key": "k", "x-user": user },
    body: '{"amount":10}',
  });
  const u1 = await (await app.request("/me/charge", reqFor("u1"))).json();
  const u2 = await (await app.request("/me/charge", reqFor("u2"))).json();
  assert.notEqual(u1.call, u2.call, "different users with the same key run independently");
});

test("[idempotency/x-tenant] unauthenticated idempotency still dedupes by key (back-compat)", async () => {
  const app = idemApp();
  const first = await (await app.request("/me/charge", json("anon-key"))).json();
  const res2 = await app.request("/me/charge", json("anon-key"));
  assert.equal(res2.headers.get("idempotency-replayed"), "true");
  assert.deepEqual(await res2.json(), first, "no-auth requests with the same key still replay");
});

// ===========================================================================
// F-3 — response-cache cross-tenant disclosure
// ===========================================================================

function cacheApp(opts: Parameters<typeof responseCache>[0] = {}) {
  let calls = 0;
  const app = new App({ env: "development", logger: false });
  app.use(responseCache({ ttlSeconds: 60, store: new MemoryResponseCacheStore(), ...opts }));
  app.route({
    method: "GET",
    path: "/me",
    operationId: "me",
    responses: {
      200: { description: "ok", body: z.object({ owner: z.string(), call: z.number() }) as any },
    },
    handler: async ({ request }: any) => ({
      status: 200 as const,
      body: { owner: request.headers.get("authorization") ?? "anon", call: ++calls },
    }),
  });
  return app;
}

test("[response-cache/x-tenant] an Authorization-bearing response is NOT served to another user", async () => {
  const app = cacheApp();
  const a = await (
    await app.request("/me", { headers: { authorization: "Bearer USER_A" } })
  ).json();
  const res2 = await app.request("/me", { headers: { authorization: "Bearer USER_B" } });
  const b = await res2.json();
  assert.equal(a.owner, "Bearer USER_A");
  assert.equal(b.owner, "Bearer USER_B", "user B must never receive user A's cached response");
  assert.notEqual(
    res2.headers.get("x-cache"),
    "HIT",
    "authenticated requests bypass the shared cache"
  );
});

test("[response-cache/x-tenant] unauthenticated/public responses are still cached", async () => {
  const app = cacheApp();
  const first = await (await app.request("/me")).json();
  const res2 = await app.request("/me");
  assert.equal(res2.headers.get("x-cache"), "HIT", "public content is still cacheable");
  assert.deepEqual(await res2.json(), first);
});

test("[response-cache/x-tenant] explicit opt-in + vary on authorization isolates per principal", async () => {
  const app = cacheApp({ cacheAuthenticatedRequests: true, varyHeaders: ["authorization"] });
  const a1 = await (
    await app.request("/me", { headers: { authorization: "Bearer USER_A" } })
  ).json();
  const a2res = await app.request("/me", { headers: { authorization: "Bearer USER_A" } });
  assert.equal(a2res.headers.get("x-cache"), "HIT", "same principal hits the opted-in cache");
  assert.deepEqual(await a2res.json(), a1);
  const b = await (
    await app.request("/me", { headers: { authorization: "Bearer USER_B" } })
  ).json();
  assert.equal(b.owner, "Bearer USER_B", "vary on authorization keeps principals isolated");
});
