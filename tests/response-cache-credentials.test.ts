/**
 * Regression coverage for `responseCache()`'s credential handling — the CWE-524
 * (cross-principal cached-response disclosure) protection.
 *
 * This is the property that makes a `responseCache()` mounted *ahead of* auth
 * safe. Both run in `beforeHandle`, so a cache hit returned from there ends the
 * hook chain and the auth layer never executes; the reason an anonymous caller
 * still cannot collect an authenticated body is that the cache declines to store
 * or serve credentialed requests in the first place. Nothing pinned that down,
 * so an optimization that made the cache "just cache everything" would have
 * turned the documented mount order into an authentication bypass with no test
 * failing. The composition case is asserted here directly rather than left
 * implicit in the unit behaviour.
 *
 * The sibling file `access-control-cache-composition.test.ts` covers the same
 * mount-order hazard for the five network-identity gates, which are immune for a
 * different reason: they enforce from `preBody`, which always precedes
 * `beforeHandle`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { App, bearerAuth, responseCache } from "../src/index.js";

/**
 * App whose handler echoes the caller's own bearer identity, so any reuse
 * across principals is unambiguous: Bob receiving `"alice"` is a disclosure,
 * not a coincidence. `calls` proves whether the handler ran at all.
 */
function makeIdentityApp(opts: Record<string, unknown> = {}, withAuth = false) {
  const app = new App({ logger: false });
  const state = { calls: 0 };
  app.use(responseCache({ ttlMs: 60_000, ...opts } as never));
  if (withAuth) app.use(bearerAuth({ validate: (t) => t === "alice" || t === "bob" }));
  app.route({
    method: "GET",
    path: "/me",
    operationId: "me",
    responses: { 200: { description: "ok", body: z.object({ you: z.string() }) as any } },
    handler: async ({ request }) => {
      state.calls++;
      return {
        status: 200 as const,
        body: { you: (request.headers.get("authorization") ?? "anon").replace("Bearer ", "") },
      };
    },
  });
  const get = async (headers: Record<string, string>) => {
    const res = await app.fetch(new Request("http://t/me", { headers }));
    return {
      status: res.status,
      cache: res.headers.get("x-cache"),
      body: res.status === 200 ? ((await res.json()) as { you: string }) : null,
    };
  };
  return { get, state };
}

test("a request carrying Authorization is neither served from nor stored in the cache", async () => {
  // RFC 9111 §3.5: a shared cache must not reuse an `Authorization`-bearing
  // response unless explicitly permitted. The key is the URI, which does not
  // include the credential, so storing one would hand it to the next caller.
  const { get, state } = makeIdentityApp();
  const alice = await get({ authorization: "Bearer alice" });
  const bob = await get({ authorization: "Bearer bob" });

  assert.equal(alice.body?.you, "alice");
  assert.equal(bob.body?.you, "bob", "bob must not receive alice's body");
  assert.equal(state.calls, 2, "the handler must run for both callers — nothing was cached");
});

test("a request carrying Cookie is neither served from nor stored in the cache", async () => {
  // A session cookie is the most common way a response becomes private, so it
  // is treated exactly like `Authorization`. This is also the blind spot that
  // bit `idempotency()`, whose default scope read only `Authorization` and so
  // collapsed every cookie-authenticated caller into one namespace.
  const { get, state } = makeIdentityApp();
  const first = await get({ cookie: "sid=alice-session" });
  const second = await get({ cookie: "sid=bob-session" });

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(state.calls, 2, "cookie-bearing requests must not be cached");
});

test("[unhappy] a cache mounted ahead of bearerAuth cannot serve an authenticated body to an anonymous caller", async () => {
  // The mount order the response-cache quick-start documents. `responseCache()`
  // and `bearerAuth()` share `beforeHandle`, so a hit would end the chain before
  // auth ran; the credential bypass above is what keeps this safe.
  const { get, state } = makeIdentityApp({}, true);
  const authed = await get({ authorization: "Bearer alice" });
  assert.equal(authed.status, 200);
  assert.equal(authed.body?.you, "alice");

  const anon = await get({});
  assert.equal(anon.status, 401, "an anonymous caller must still be challenged");
  assert.equal(anon.body, null);
  assert.equal(state.calls, 1, "the handler must never have run for the anonymous caller");
});

test("the credential opt-in partitions by Authorization when the header is declared in varyHeaders", async () => {
  const { get, state } = makeIdentityApp({
    cacheAuthenticatedRequests: true,
    varyHeaders: ["authorization"],
  });
  const alice = await get({ authorization: "Bearer alice" });
  const bob = await get({ authorization: "Bearer bob" });

  assert.equal(alice.body?.you, "alice");
  assert.equal(bob.body?.you, "bob", "the credential must partition the key");
  assert.equal(state.calls, 2);

  // Alice again: now a hit, from her own partition.
  const aliceAgain = await get({ authorization: "Bearer alice" });
  assert.equal(aliceAgain.body?.you, "alice");
  assert.equal(state.calls, 2, "alice's second request must be served from her own partition");
});

test("[unhappy] the credential opt-in without partitioning reuses across principals — pinned deliberately", async () => {
  // NOT a defect to be "fixed" by widening the default. `cacheAuthenticatedRequests`
  // is an explicit opt-in whose TSDoc documents this exact consequence and offers
  // two safe pairings (`principal`, or the credential header in `varyHeaders`).
  // It exists for responses that are genuinely shareable across principals, e.g.
  // public reference data sitting behind a bearer gate.
  //
  // This test pins the behaviour so the blast radius of the opt-in stays visible
  // and measured: if someone ever makes it partition automatically, this failing
  // is the prompt to update the docs and the safe-pairing guidance rather than a
  // silent change in what the option means.
  const { get } = makeIdentityApp({ cacheAuthenticatedRequests: true });
  const alice = await get({ authorization: "Bearer alice" });
  const bob = await get({ authorization: "Bearer bob" });

  assert.equal(alice.body?.you, "alice");
  assert.equal(alice.cache, "MISS");
  assert.equal(bob.cache, "HIT", "unpartitioned opt-in serves the stored entry");
  assert.equal(
    bob.body?.you,
    "alice",
    "documented consequence of enabling the opt-in without a partitioning key"
  );
});

test("the credential opt-in is per-dimension: enabling cookie does not enable authorization", async () => {
  // A public endpoint receiving unrelated analytics cookies is the motivating
  // case for the object form. Enabling that dimension must not quietly also
  // permit caching bearer-authenticated responses.
  const { get, state } = makeIdentityApp({ cacheAuthenticatedRequests: { cookie: true } });

  const alice = await get({ authorization: "Bearer alice" });
  const bob = await get({ authorization: "Bearer bob" });
  assert.equal(bob.body?.you, "bob", "authorization must still bypass the cache");
  assert.equal(state.calls, 2);
  void alice;

  // The cookie dimension, meanwhile, is now cacheable.
  const c1 = await get({ cookie: "ga=1" });
  const c2 = await get({ cookie: "ga=2" });
  assert.equal(c1.cache, "MISS");
  assert.equal(c2.cache, "HIT", "the enabled cookie dimension caches");
});
