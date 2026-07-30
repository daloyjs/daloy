/**
 * Regression tests for the composition findings from the 2026-07-30 live
 * penetration test against a running server:
 *
 *  - Finding 1 (high): every network-identity access-control gate — `geoBlock`,
 *    `ipRestriction`, `botGuard`, `autoBan`, `ipReputation` — ran in
 *    `beforeHandle`, the SAME phase as `responseCache()`. A cache HIT returns a
 *    Response from `beforeHandle` and ends the chain, so a `responseCache()`
 *    mounted ahead of a gate silently disabled it: a denied country, a
 *    deny-listed IP, a blocked scraper and an actively-banned client all
 *    received `200` + the cached body. The docs' own quick-start mounts the
 *    cache first, so the documented pattern produced the vulnerable order.
 *    `App` boot Guard 3 already refuses to boot for cache-ahead-of-`tenancy()`;
 *    the access-control feeds carried no equivalent protection.
 *
 *    Fix: the gates run in `preBody`, which always precedes any `beforeHandle`.
 *    Mount order can no longer preempt them. Authentication (`bearerAuth`,
 *    `basicAuth`, `clientCertAuth`) was already immune for exactly this reason.
 *
 *  - Finding 2 (medium): `autoBan` treated an unresolvable forwarded identity as
 *    "skip". `resolveForwardedClientIp` fails closed past one hop, so an
 *    attacker reaching the origin directly — past the CDN that appends
 *    `X-Forwarded-For` — got UNLIMITED credential attempts by simply omitting
 *    the header. Fix: strikes fall back to the unspoofable TCP peer address
 *    (`onUnresolvedIdentity: "peer"`, the new default).
 *
 * Test model: the cache is mounted FIRST on purpose in the Finding 1 tests.
 * That is the arrangement that used to be exploitable, so it is the one worth
 * asserting on.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  App,
  autoBan,
  _resetAutoBanStoresForTests,
  botGuard,
  geoBlock,
  idempotency,
  ipRestriction,
  ipReputation,
  MemoryIdempotencyStore,
  responseCache,
  setConnInfo,
} from "../src/index.js";

const FLAG = "CACHED-BODY-BEHIND-THE-GATE";

/** A cacheable route whose body must never reach a rejected client. */
function addReport(app: App): void {
  app.route({
    method: "GET",
    path: "/report",
    operationId: "report",
    responses: {
      200: { description: "ok", body: z.object({ secret: z.string() }) as any },
    },
    handler: async () => ({ status: 200 as const, body: { secret: FLAG } }),
  });
}

/** Build an app with `responseCache()` mounted AHEAD of `gate`. */
function cacheFirstApp(gate: any): App {
  const app = new App({ env: "production", logger: false, trustProxy: true });
  app.use(responseCache({ ttlSeconds: 30, statusHeaderName: "x-cache" }));
  app.use(gate);
  addReport(app);
  return app;
}

const get = (app: App, headers: Record<string, string> = {}) =>
  app.fetch(new Request("https://api.test/report", { headers }));

/**
 * Warm the cache from a permitted client, assert the entry really is warm, then
 * return so the caller can probe it as a rejected client.
 */
async function warm(app: App, headers: Record<string, string>): Promise<void> {
  const res = await get(app, headers);
  assert.equal(res.status, 200, "warm-up should succeed");
  assert.match(await res.text(), new RegExp(FLAG), "warm-up should return the body");
  const again = await get(app, headers);
  assert.equal(again.headers.get("x-cache"), "HIT", "second permitted read should be a cache HIT");
}

// ---------------------------------------------------------------------------
// Finding 1 — a cache HIT must not preempt a network-identity gate
// ---------------------------------------------------------------------------

test("geoBlock denies a blocked country even with responseCache mounted ahead of it", async () => {
  const app = cacheFirstApp(
    geoBlock({
      deny: ["ZZ"],
      trustProxyHeaders: true,
      lookupCountry: (ip) => (ip === "203.0.113.7" ? "ZZ" : "US"),
    })
  );
  await warm(app, { "x-forwarded-for": "203.0.113.8" });

  const res = await get(app, { "x-forwarded-for": "203.0.113.7" });
  assert.equal(res.status, 403, "denied country must be rejected, not served from cache");
  assert.doesNotMatch(await res.text(), new RegExp(FLAG));
});

test("ipRestriction denies a deny-listed address even with responseCache mounted ahead", async () => {
  const app = cacheFirstApp(ipRestriction({ deny: ["198.51.100.20"], trustProxyHeaders: true }));
  await warm(app, { "x-forwarded-for": "203.0.113.8" });

  const res = await get(app, { "x-forwarded-for": "198.51.100.20" });
  assert.equal(res.status, 403);
  assert.doesNotMatch(await res.text(), new RegExp(FLAG));
});

test("botGuard blocks a denied user agent even with responseCache mounted ahead", async () => {
  const app = cacheFirstApp(botGuard({ blockedUserAgents: [/evil-scraper/i] }));
  await warm(app, { "user-agent": "Mozilla/5.0" });

  const res = await get(app, { "user-agent": "evil-scraper/1.0" });
  assert.equal(res.status, 403);
  assert.doesNotMatch(await res.text(), new RegExp(FLAG));
});

test("ipReputation blocks a denylisted address even with responseCache mounted ahead", async () => {
  const gate = ipReputation({
    feeds: [{ name: "test-feed", fetch: async () => ["203.0.113.66"] }],
    refreshIntervalMs: 0,
    trustProxyHeaders: true,
  });
  // The feed loads asynchronously; wait for the first load before attacking.
  await gate.ready;

  const app = new App({ env: "production", logger: false, trustProxy: true });
  app.use(responseCache({ ttlSeconds: 30, statusHeaderName: "x-cache" }));
  app.use(gate.hooks);
  addReport(app);

  await warm(app, { "x-forwarded-for": "203.0.113.8" });

  const res = await get(app, { "x-forwarded-for": "203.0.113.66" });
  assert.equal(res.status, 403);
  assert.doesNotMatch(await res.text(), new RegExp(FLAG));
  gate.stop();
});

test("autoBan enforces an active ban even with responseCache mounted ahead", async () => {
  _resetAutoBanStoresForTests();
  const app = new App({ env: "production", logger: false, trustProxy: true });
  app.use(responseCache({ ttlSeconds: 30, statusHeaderName: "x-cache" }));
  app.use(
    autoBan({
      trustProxyHeaders: true,
      groupId: "compose-test",
      windowMs: 60_000,
      maxStrikes: 2,
      banMs: 30_000,
      watchStatuses: [401],
      banStatus: 429,
    })
  );
  addReport(app);
  app.route({
    method: "GET",
    path: "/fail",
    operationId: "fail",
    acknowledgeNoResponseBodySchema: true,
    responses: { 401: { description: "nope" } },
    handler: async () => new Response("no", { status: 401 }),
  });

  const attacker = { "x-forwarded-for": "203.0.113.99" };
  await warm(app, { "x-forwarded-for": "203.0.113.8" });

  // Earn the ban on an uncached route.
  for (let i = 0; i < 3; i++) {
    await app.fetch(new Request("https://api.test/fail", { headers: attacker }));
  }
  const banned = await app.fetch(new Request("https://api.test/fail", { headers: attacker }));
  assert.equal(banned.status, 429, "ban should be active");

  const res = await get(app, attacker);
  assert.equal(res.status, 429, "a banned client must not be served the cached body");
  assert.doesNotMatch(await res.text(), new RegExp(FLAG));
});

test("the cache still serves permitted clients once the gates run earlier", async () => {
  const app = cacheFirstApp(
    geoBlock({
      deny: ["ZZ"],
      trustProxyHeaders: true,
      lookupCountry: (ip) => (ip === "203.0.113.7" ? "ZZ" : "US"),
    })
  );
  await warm(app, { "x-forwarded-for": "203.0.113.8" });

  // A different permitted client shares the entry — the whole point of the cache.
  const res = await get(app, { "x-forwarded-for": "203.0.113.9" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-cache"), "HIT");
  assert.match(await res.text(), new RegExp(FLAG));
});

// ---------------------------------------------------------------------------
// Finding 2 — an unresolvable forwarded identity must still be accounted for
// ---------------------------------------------------------------------------

/** Build a bare autoBan app whose only route always returns 401. */
function banApp(overrides: Record<string, unknown> = {}, groupId = "unresolved-test"): App {
  _resetAutoBanStoresForTests();
  const app = new App({ env: "production", logger: false, trustProxy: true });
  app.use(
    autoBan({
      trustedHops: 2,
      groupId,
      windowMs: 60_000,
      maxStrikes: 2,
      banMs: 30_000,
      watchStatuses: [401],
      banStatus: 429,
      ...overrides,
    })
  );
  app.route({
    method: "POST",
    path: "/login",
    operationId: "login",
    acknowledgeNoResponseBodySchema: true,
    responses: { 401: { description: "nope" } },
    handler: async () => new Response("bad creds", { status: 401 }),
  });
  return app;
}

/** Fire `n` failed logins from a peer, returning the final status. */
async function hammer(
  app: App,
  peer: string,
  headers: Record<string, string>,
  n: number
): Promise<number> {
  let status = 0;
  for (let i = 0; i < n; i++) {
    const req = new Request("https://api.test/login", { method: "POST", headers });
    setConnInfo(req, { remoteAddress: peer });
    status = (await app.fetch(req)).status;
  }
  return status;
}

test("autoBan bans on a forwarded chain shorter than the declaration, via the TCP peer", async () => {
  const app = banApp();
  // One XFF entry against a 2-hop declaration: the forwarded identity is
  // unresolvable, so strikes must fall back to the peer.
  const status = await hammer(app, "203.0.113.61", { "x-forwarded-for": "203.0.113.61" }, 5);
  assert.equal(status, 429, "unlimited credential attempts must not be possible");
});

test("autoBan bans when no forwarded header is present at all", async () => {
  const app = banApp({}, "unresolved-test-2");
  const status = await hammer(app, "203.0.113.62", {}, 5);
  assert.equal(status, 429);
});

test("peer-attributed strikes do not leak across distinct peers", async () => {
  const app = banApp({}, "unresolved-test-3");
  // One strike short of the ban from the first peer.
  await hammer(app, "203.0.113.70", {}, 1);
  // A different peer must start with a clean slate.
  const other = await hammer(app, "203.0.113.71", {}, 1);
  assert.equal(other, 401, "a second peer must not inherit the first peer's strike");
});

test("a well-formed 2-hop chain still keys on the forwarded client, not the peer", async () => {
  const app = banApp({}, "unresolved-test-4");
  // Two different peers, same forwarded client: strikes must accumulate on the
  // client, so the ban lands even though no single peer reached maxStrikes.
  await hammer(app, "10.0.0.1", { "x-forwarded-for": "203.0.113.80, 10.0.0.1" }, 1);
  const status = await hammer(app, "10.0.0.2", { "x-forwarded-for": "203.0.113.80, 10.0.0.2" }, 2);
  assert.equal(status, 429, "strikes should follow the forwarded client across proxies");
});

test('onUnresolvedIdentity: "skip" restores the fail-open posture', async () => {
  const app = banApp({ onUnresolvedIdentity: "skip" }, "unresolved-test-5");
  const status = await hammer(app, "203.0.113.63", {}, 6);
  assert.equal(status, 401, 'explicit "skip" must never ban an unresolved request');
});

test("autoBan refuses an invalid onUnresolvedIdentity value at construction", () => {
  assert.throws(
    () => autoBan({ trustProxyHeaders: true, onUnresolvedIdentity: "nope" as any }),
    /onUnresolvedIdentity must be "peer" or "skip"/
  );
});

test("autoBan skips when the identity is unresolvable and no peer is available", async () => {
  // Edge runtimes expose no peer socket. With neither a forwarded identity nor a
  // peer there is nothing to attribute strikes to, so the request is skipped
  // rather than collapsed into a shared bucket that would ban everyone.
  const app = banApp({}, "unresolved-test-6");
  let status = 0;
  for (let i = 0; i < 6; i++) {
    // No setConnInfo() — no peer address attached.
    status = (await app.fetch(new Request("https://api.test/login", { method: "POST" }))).status;
  }
  assert.equal(status, 401);
});

// ---------------------------------------------------------------------------
// Finding 3 — idempotency() must not share one namespace across callers it
// cannot identify.
//
// `scope` defaults to the `Authorization` header. A cookie-authenticated app
// sends none, so the scope tag was empty and every caller shared a namespace:
// the retry fingerprint (method + path + body) was all that separated two users,
// and two users submitting the same payload fingerprint identically. Live probe
// had Bob receive Alice's stored order response — CWE-524, the exact
// disclosure `scope` exists to stop.
// ---------------------------------------------------------------------------

/** An order endpoint whose response body identifies its owner. */
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
      201: {
        description: "created",
        body: z.object({ orderId: z.string() }) as any,
      },
    },
    handler: async ({ request }: any) => {
      const owner = /session=(\w+)/.exec(request.headers.get("cookie") ?? "")?.[1] ?? "anon";
      counter += 1;
      return { status: 201 as const, body: { orderId: `ord-${counter}-for-${owner}` } };
    },
  });
  return app;
}

/** POST an identical payload under `key`, authenticated however `headers` says. */
const placeOrder = (app: App, key: string, headers: Record<string, string>) =>
  app.fetch(
    new Request("https://shop.test/orders", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key, ...headers },
      body: JSON.stringify({ item: "widget" }),
    })
  );

test("idempotency refuses a cookie-bearing request the default scope cannot identify", async () => {
  const app = orderApp();
  const res = await placeOrder(app, "shared-key", { cookie: "session=alice" });
  assert.equal(res.status, 500, "an unscopeable credentialed caller must fail loudly");
  const body = await res.text();
  assert.doesNotMatch(body, /for-alice/, "no order body should be produced");
});

test("idempotency partitions cookie callers once scope is supplied", async () => {
  const app = orderApp({
    scope: (ctx: any) => /session=(\w+)/.exec(ctx.request.headers.get("cookie") ?? "")?.[1],
  });
  const alice = await placeOrder(app, "shared-key", { cookie: "session=alice" });
  const bob = await placeOrder(app, "shared-key", { cookie: "session=bob" });
  assert.equal(alice.status, 201);
  assert.equal(bob.status, 201);
  assert.match(await alice.text(), /for-alice/);
  const bobBody = await bob.text();
  assert.match(bobBody, /for-bob/, "bob must get his own order");
  assert.doesNotMatch(bobBody, /for-alice/, "bob must never receive alice's stored response");
});

test("idempotency still scopes bearer callers by Authorization out of the box", async () => {
  const app = orderApp();
  const alice = await placeOrder(app, "shared-key", { authorization: "Bearer alice-token" });
  const bob = await placeOrder(app, "shared-key", { authorization: "Bearer bob-token" });
  assert.equal(alice.status, 201);
  assert.equal(bob.status, 201);
  assert.notEqual(
    await alice.text(),
    await bob.text(),
    "two bearer principals must get independent reservations"
  );
});

test("idempotency replays a genuine retry from the same caller", async () => {
  const app = orderApp();
  const first = await placeOrder(app, "same-key", { authorization: "Bearer alice-token" });
  const retry = await placeOrder(app, "same-key", { authorization: "Bearer alice-token" });
  assert.equal(first.status, 201);
  assert.equal(
    await retry.text(),
    await first.text(),
    "the same caller retrying must get the stored response, not a second order"
  );
});

test("allowUnscopedCallers: true knowingly restores the shared namespace", async () => {
  const app = orderApp({ allowUnscopedCallers: true });
  const alice = await placeOrder(app, "shared-key", { cookie: "session=alice" });
  const bob = await placeOrder(app, "shared-key", { cookie: "session=bob" });
  assert.equal(alice.status, 201);
  assert.equal(
    await bob.text(),
    await alice.text(),
    "the opt-out is explicit: callers share one namespace"
  );
});

test("a truly anonymous caller (no credential at all) is not blocked", async () => {
  const app = orderApp();
  const res = await placeOrder(app, "anon-key", {});
  assert.equal(res.status, 201, "public unauthenticated idempotent writes must still work");
});

test("an explicit scope returning undefined bypasses the guard", async () => {
  // A custom resolver owns its own posture, including opting a request out.
  const app = orderApp({ scope: () => undefined });
  const res = await placeOrder(app, "shared-key", { cookie: "session=alice" });
  assert.equal(res.status, 201);
});
