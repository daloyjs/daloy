/**
 * Regression tests for three idempotency defects found reviewing the
 * cookie-scoping work in `tests/access-control-cache-composition.test.ts`
 * ("Finding 3"). That change stopped the *default* cookie-only namespace
 * collapse; these cover what it did not:
 *
 *  1. **Shared `Authorization` + cookie (high).** The guard fired only when the
 *     default resolver produced *no* scope. With a shared tenant/API key the
 *     scope resolved — to a value every user of that tenant sends — so the
 *     namespace partitioned per tenant while every user inside it shared one.
 *     Client B still replayed client A's stored response. The guard now keys off
 *     the cookie's presence rather than the scope's absence.
 *
 *  2. **`Set-Cookie` replay (critical).** `captureResponse()` stored every
 *     response header and replayed them verbatim, so a `Set-Cookie` issued to the
 *     first caller was re-issued to whoever replayed the record. With any coarse
 *     namespace that promotes a body disclosure into handing over a live session.
 *     It is also wrong for a legitimate same-caller retry, which would resurrect
 *     a cookie the handler set once and roll back a session rotation.
 *
 *  3. **Unbounded `MemoryIdempotencyStore` (medium).** Its TSDoc claimed the map
 *     "cannot grow without bound", but the sweep only dropped *expired* records
 *     and only ran past 10 000 entries, so unique keys inside the TTL grew it
 *     linearly — each pinning a stored response body up to `maxResponseBytes`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { App, idempotency, MemoryIdempotencyStore } from "../src/index.js";

/** An order endpoint that identifies its caller and rotates a session cookie. */
function orderApp(idemOpts: Record<string, unknown> = {}): App {
  const app = new App({ env: "production", logger: false });
  let counter = 0;
  app.route({
    method: "POST",
    path: "/orders",
    operationId: "createOrder",
    hooks: idempotency({ store: new MemoryIdempotencyStore(), ...idemOpts }),
    request: { body: z.object({ item: z.string() }).strict() as any },
    responses: {
      201: { description: "created", body: z.object({ orderId: z.string() }) as any },
    },
    handler: async (ctx: any) => {
      const owner = /session=(\w+)/.exec(ctx.request.headers.get("cookie") ?? "")?.[1] ?? "anon";
      counter += 1;
      // A rotated session cookie — the thing that must never be replayed.
      ctx.set.headers.set("set-cookie", `session=${owner}-rotated; Path=/; HttpOnly`);
      ctx.set.headers.set("x-request-id", `req-for-${owner}`);
      ctx.set.headers.set("x-order-kind", "widget");
      return { status: 201 as const, body: { orderId: `ord-${counter}-for-${owner}` } };
    },
  });
  return app;
}

const placeOrder = (app: App, key: string, headers: Record<string, string>) =>
  app.fetch(
    new Request("https://shop.test/orders", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key, ...headers },
      body: JSON.stringify({ item: "widget" }),
    })
  );

// ---------------------------------------------------------------------------
// 1. The guard's boundary: where it fires, and where scoping is the app's job
// ---------------------------------------------------------------------------

test("a per-user bearer token with incidental cookies is NOT refused", async () => {
  // The guard was briefly widened to fire on any cookie-bearing request, to catch
  // a shared `Authorization` (below). That broke the most common shape there is:
  // a per-user bearer token plus the cookies a browser always attaches
  // (analytics, consent, CSRF). The default scope is already correct there, so
  // rejecting it traded a narrow disclosure for a 500 on ordinary traffic. The
  // guard stays where the default is provably useless, not merely possibly
  // coarse.
  const app = orderApp();
  const incidental = "_ga=GA1.2.99; cookie_consent=all";
  const alice = await placeOrder(app, "k", {
    authorization: "Bearer per-user-jwt-alice",
    cookie: incidental,
  });
  const bob = await placeOrder(app, "k", {
    authorization: "Bearer per-user-jwt-bob",
    cookie: incidental,
  });
  assert.equal(alice.status, 201, "a per-user bearer must not be rejected for carrying cookies");
  assert.equal(bob.status, 201);
  assert.notEqual(await alice.text(), await bob.text(), "and it must still partition per user");
});

test("a shared Authorization is the app's job to scope, and cannot leak a session", async () => {
  // Documented residual: a per-tenant key with cookie-identified users resolves a
  // scope, so the guard cannot see that it is too coarse — it is indistinguishable
  // from the per-user case above. `scope` is the fix (asserted below). What is
  // guaranteed regardless is that the replay carries no credential, so this stays
  // a body disclosure and never becomes a session handover.
  const app = orderApp();
  const shared = { authorization: "Bearer SHARED-TENANT-KEY" };
  await placeOrder(app, "shared-key", { ...shared, cookie: "session=alice" });
  const bob = await placeOrder(app, "shared-key", { ...shared, cookie: "session=bob" });
  assert.equal(bob.headers.get("idempotency-replayed"), "true", "the coarse namespace is shared");
  assert.equal(bob.headers.get("set-cookie"), null, "but no credential is ever replayed");
});

test("supplying scope resolves the shared-Authorization case", async () => {
  const app = orderApp({
    scope: (ctx: any) => /session=(\w+)/.exec(ctx.request.headers.get("cookie") ?? "")?.[1],
  });
  const shared = { authorization: "Bearer SHARED-TENANT-KEY" };
  const alice = await placeOrder(app, "shared-key", { ...shared, cookie: "session=alice" });
  const bob = await placeOrder(app, "shared-key", { ...shared, cookie: "session=bob" });
  assert.match(await alice.text(), /for-alice/);
  const bobBody = await bob.text();
  assert.match(bobBody, /for-bob/);
  assert.doesNotMatch(bobBody, /for-alice/, "bob must never receive alice's order");
});

test("a bearer-only caller is still scoped by Authorization with no cookie present", async () => {
  const app = orderApp();
  const alice = await placeOrder(app, "k", { authorization: "Bearer alice-token" });
  const bob = await placeOrder(app, "k", { authorization: "Bearer bob-token" });
  assert.equal(alice.status, 201);
  assert.equal(bob.status, 201);
  assert.notEqual(await alice.text(), await bob.text());
});

// ---------------------------------------------------------------------------
// 2. Set-Cookie must never be stored or replayed
// ---------------------------------------------------------------------------

test("a replayed response never carries the original caller's Set-Cookie", async () => {
  // `allowUnscopedCallers` is the explicit opt-in to a shared namespace, so the
  // shared *body* is expected. Handing over a session cookie is not: the option's
  // documented trade-off is interchangeable bodies, never a credential.
  const app = orderApp({ allowUnscopedCallers: true });
  const alice = await placeOrder(app, "shared-key", { cookie: "session=alice" });
  assert.equal(alice.status, 201);
  assert.match(alice.headers.get("set-cookie") ?? "", /alice-rotated/, "original still sets it");

  const bob = await placeOrder(app, "shared-key", { cookie: "session=bob" });
  assert.equal(bob.headers.get("idempotency-replayed"), "true", "this must be a replay");
  assert.equal(bob.headers.get("set-cookie"), null, "a replay must not issue a session cookie");
  assert.doesNotMatch(JSON.stringify([...bob.headers]), /alice-rotated/);
});

test("a genuine same-caller retry does not resurrect a rotated session cookie", async () => {
  const app = orderApp({
    scope: (ctx: any) => /session=(\w+)/.exec(ctx.request.headers.get("cookie") ?? "")?.[1],
  });
  const first = await placeOrder(app, "same-key", { cookie: "session=alice" });
  assert.match(first.headers.get("set-cookie") ?? "", /alice-rotated/);

  const retry = await placeOrder(app, "same-key", { cookie: "session=alice" });
  assert.equal(retry.headers.get("idempotency-replayed"), "true");
  assert.equal(retry.headers.get("set-cookie"), null, "replay must not re-issue the cookie");
  // The point of the middleware still holds: same body, no second order.
  assert.equal(await retry.text(), await first.text());
});

test("a replay drops per-request correlation headers but keeps application ones", async () => {
  const app = orderApp({ allowUnscopedCallers: true });
  await placeOrder(app, "hdr-key", { cookie: "session=alice" });
  const replay = await placeOrder(app, "hdr-key", { cookie: "session=bob" });
  assert.equal(replay.headers.get("idempotency-replayed"), "true");
  assert.notEqual(
    replay.headers.get("x-request-id"),
    "req-for-alice",
    "replaying the populating request's id hands every caller someone else's trace"
  );
  assert.equal(replay.headers.get("x-order-kind"), "widget", "application headers still replay");
});

// ---------------------------------------------------------------------------
// 3. The in-memory store is actually bounded
// ---------------------------------------------------------------------------

test("MemoryIdempotencyStore evicts live records at the cap instead of growing", () => {
  const store = new MemoryIdempotencyStore(50);
  const far = Date.now() + 60_000; // nothing expires during the test
  for (let i = 0; i < 500; i++) {
    store.reserve(`k-${i}`, {
      fingerprint: `f-${i}`,
      status: "in-flight",
      createdAt: Date.now(),
      expiresAt: far,
    });
  }
  assert.ok(store.size() <= 50, `store grew past its cap: ${store.size()}`);
  // FIFO: the oldest keys went first, the newest survived.
  assert.equal(
    store.reserve("k-0", {
      fingerprint: "x",
      status: "in-flight",
      createdAt: Date.now(),
      expiresAt: far,
    }),
    null,
    "the oldest key was evicted, so reserving it again is a fresh reservation"
  );
  assert.notEqual(
    store.reserve("k-499", {
      fingerprint: "x",
      status: "in-flight",
      createdAt: Date.now(),
      expiresAt: far,
    }),
    null,
    "the newest key must still be held"
  );
});

test("MemoryIdempotencyStore still prefers dropping expired records over live ones", () => {
  const store = new MemoryIdempotencyStore(10);
  const now = Date.now();
  // Fill with already-expired records.
  for (let i = 0; i < 10; i++) {
    store.reserve(`old-${i}`, {
      fingerprint: `f`,
      status: "in-flight",
      createdAt: now - 1000,
      expiresAt: now - 1,
    });
  }
  // One more reservation sweeps the expired set rather than evicting anything live.
  assert.equal(
    store.reserve("fresh", {
      fingerprint: "f",
      status: "in-flight",
      createdAt: now,
      expiresAt: now + 60_000,
    }),
    null
  );
  assert.equal(store.size(), 1, "the expiry sweep should have reclaimed every stale slot");
});

test("MemoryIdempotencyStore rejects a non-positive-integer cap", () => {
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => new MemoryIdempotencyStore(bad), /maxEntries must be a positive integer/);
  }
});
