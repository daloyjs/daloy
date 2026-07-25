/**
 * RED-TEAM ATTACK SUITE — WAVE 11 (response-cache key completeness)
 * =================================================================
 *
 * Wave 5 closed F-3: `responseCache()` ignoring the `Authorization` header.
 * A follow-up live engagement showed that the *same* CWE-524 defect had three
 * more faces, because the default cache key covered only `method + path +
 * query` and `Authorization` was the only credential the middleware knew about.
 * All three were confirmed exploitable over a real socket and are locked here:
 *
 *   F-4  The cache key omitted the request **authority**. One process serving
 *        several hostnames (vanity domains, subdomain-per-customer) shared a
 *        single entry across them, so `customer-b.example.com` was served
 *        `customer-a.example.com`'s response. No opt-in, no misconfiguration —
 *        plain defaults. RFC 9111 §4 keys a cache on the effective request URI,
 *        which includes the authority.
 *
 *   F-5  The cache did not partition on the tenant that `tenancy()` had itself
 *        resolved into `ctx.state`. A second tenant — and even a caller sending
 *        no tenant at all — received the first tenant's confidential body.
 *        Now the resolved tenant is folded into the key automatically, and a
 *        cache mounted *ahead* of `tenancy()` (where the tenant is not yet in
 *        state) refuses to boot.
 *
 *   F-6  The request `Cookie` header was never consulted; only response
 *        `Set-Cookie` was. A cookie-authenticated private response was stored
 *        and replayed to an anonymous stranger. Now `Cookie` is a credential
 *        like `Authorization`, and `principal` exists so per-user caching stays
 *        possible instead of merely disabled.
 *
 * The SECURE outcome is the PASSING outcome.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  App,
  responseCache,
  tenancy,
  tenantFromHeader,
  MemoryResponseCacheStore,
} from "../src/index.js";

/** Per-hostname private content — the multi-domain deployment shape. */
function hostApp() {
  let calls = 0;
  const app = new App({ env: "development", logger: false });
  app.use(responseCache({ ttlSeconds: 60, store: new MemoryResponseCacheStore() }));
  app.route({
    method: "GET",
    path: "/whoami",
    operationId: "whoami",
    responses: {
      200: {
        description: "ok",
        body: z.object({ servedFor: z.string(), calls: z.number() }) as any,
      },
    },
    handler: async ({ request }) => {
      calls++;
      return {
        status: 200 as const,
        body: { servedFor: new URL(request.url).hostname, calls },
      };
    },
  });
  return app;
}

/** Per-tenant confidential content, tenancy resolved from a header. */
function tenantApp(opts: { require?: boolean } = {}) {
  const SECRETS: Record<string, string> = {
    acme: "ACME-CONFIDENTIAL",
    globex: "GLOBEX-CONFIDENTIAL",
  };
  const app = new App({ env: "development", logger: false });
  app.use(
    tenancy({
      resolve: tenantFromHeader("x-tenant-id"),
      allow: ["acme", "globex"],
      require: opts.require ?? false,
    }),
  );
  app.use(responseCache({ ttlSeconds: 60, store: new MemoryResponseCacheStore() }));
  app.route({
    method: "GET",
    path: "/report",
    operationId: "report",
    responses: {
      200: { description: "ok", body: z.object({ secret: z.string() }) as any },
      404: { description: "none", body: z.object({ title: z.string() }) as any },
    },
    handler: async ({ state }) => {
      const tenant = (state as Record<string, unknown>).tenant as string | undefined;
      const secret = tenant ? SECRETS[tenant] : undefined;
      if (!secret) return { status: 404 as const, body: { title: "Not Found" } };
      return { status: 200 as const, body: { secret } };
    },
  });
  return app;
}

/**
 * Cookie-authenticated private content. The cookie is read directly (rather than
 * via `session()`) so the test isolates the cache's credential handling from
 * session rolling behavior.
 */
function cookieApp(opts: Parameters<typeof responseCache>[0] = {}) {
  const USERS: Record<string, string> = { "sid-alice": "alice", "sid-bob": "bob" };
  let calls = 0;
  const app = new App({ env: "development", logger: false });
  app.use(responseCache({ ttlSeconds: 60, store: new MemoryResponseCacheStore(), ...opts }));
  app.route({
    method: "GET",
    path: "/profile",
    operationId: "profile",
    responses: {
      200: { description: "ok", body: z.object({ user: z.string(), calls: z.number() }) as any },
      401: { description: "anon", body: z.object({ user: z.string() }) as any },
    },
    handler: async ({ request }) => {
      calls++;
      const sid = /(?:^|;\s*)sid=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1];
      const user = sid ? USERS[sid] : undefined;
      if (!user) return { status: 401 as const, body: { user: "anonymous" } };
      return { status: 200 as const, body: { user, calls } };
    },
  });
  return app;
}

// ===========================================================================
// F-4 — authority omitted from the cache key
// ===========================================================================

test("F-4: a second hostname does not receive the first hostname's cached body", async () => {
  const app = hostApp();

  const a = await app.request(new Request("http://customer-a.example.com/whoami"));
  assert.equal(a.headers.get("x-cache"), "MISS");
  assert.deepEqual(await a.json(), { servedFor: "customer-a.example.com", calls: 1 });

  const b = await app.request(new Request("http://customer-b.example.com/whoami"));
  assert.equal(b.headers.get("x-cache"), "MISS", "a different authority must not hit");
  assert.deepEqual(
    await b.json(),
    { servedFor: "customer-b.example.com", calls: 2 },
    "customer-b must be served its own response, not customer-a's",
  );
});

test("F-4: the same hostname still hits the cache (the feature keeps working)", async () => {
  const app = hostApp();
  await app.request(new Request("http://customer-a.example.com/whoami"));
  const again = await app.request(new Request("http://customer-a.example.com/whoami"));
  assert.equal(again.headers.get("x-cache"), "HIT");
  assert.deepEqual(await again.json(), { servedFor: "customer-a.example.com", calls: 1 });
});

test("F-4: scheme and port are part of the key", async () => {
  const app = hostApp();
  await app.request(new Request("http://customer-a.example.com/whoami"));
  const otherPort = await app.request(new Request("http://customer-a.example.com:8443/whoami"));
  assert.equal(otherPort.headers.get("x-cache"), "MISS", "a distinct port is a distinct origin");
  const https = await app.request(new Request("https://customer-a.example.com/whoami"));
  assert.equal(https.headers.get("x-cache"), "MISS", "a distinct scheme is a distinct origin");
});

test("F-4: a URL fragment does not fragment the cache", async () => {
  // Fragments are never sent by HTTP clients and are meaningless to a cache;
  // treating them as part of the key would only cause avoidable misses.
  const app = hostApp();
  await app.request(new Request("http://customer-a.example.com/whoami"));
  const withFragment = await app.request(new Request("http://customer-a.example.com/whoami#top"));
  assert.equal(withFragment.headers.get("x-cache"), "HIT");
});

// ===========================================================================
// F-5 — resolved tenant omitted from the cache key
// ===========================================================================

test("F-5: a second tenant does not receive the first tenant's cached body", async () => {
  const app = tenantApp();

  const acme = await app.request("/report", { headers: { "x-tenant-id": "acme" } });
  assert.deepEqual(await acme.json(), { secret: "ACME-CONFIDENTIAL" });

  const globex = await app.request("/report", { headers: { "x-tenant-id": "globex" } });
  assert.equal(globex.headers.get("x-cache"), "MISS");
  assert.deepEqual(
    await globex.json(),
    { secret: "GLOBEX-CONFIDENTIAL" },
    "globex must never see acme's report",
  );
});

test("F-5: a tenant-less caller does not receive a tenant's cached body", async () => {
  const app = tenantApp();
  await app.request("/report", { headers: { "x-tenant-id": "acme" } });

  // The most damning shape of the original bug: send nothing at all, get a
  // tenant's confidential body back with a normal-looking cache HIT.
  const anon = await app.request("/report");
  assert.equal(anon.status, 404, "an unresolved tenant must reach the handler's 404");
  const body = await anon.text();
  assert.ok(!body.includes("ACME-CONFIDENTIAL"), `leaked acme's secret: ${body}`);
});

test("F-5: repeat requests from the same tenant still hit the cache", async () => {
  const app = tenantApp();
  await app.request("/report", { headers: { "x-tenant-id": "acme" } });
  const again = await app.request("/report", { headers: { "x-tenant-id": "acme" } });
  assert.equal(again.headers.get("x-cache"), "HIT");
  assert.deepEqual(await again.json(), { secret: "ACME-CONFIDENTIAL" });
});

test("F-5: a custom keyGenerator cannot widen the tenant partition", async () => {
  // A generator that deliberately returns one constant for every request would,
  // before the fix, collapse all tenants onto a single entry. The partition is
  // applied around the generator's output, so it cannot.
  const SECRETS: Record<string, string> = { acme: "ACME-CONFIDENTIAL", globex: "GLOBEX-CONFIDENTIAL" };
  const app = new App({ env: "development", logger: false });
  app.use(tenancy({ resolve: tenantFromHeader("x-tenant-id"), allow: ["acme", "globex"] }));
  app.use(
    responseCache({
      ttlSeconds: 60,
      store: new MemoryResponseCacheStore(),
      keyGenerator: () => "one-key-for-everything",
    }),
  );
  app.route({
    method: "GET",
    path: "/report",
    operationId: "reportFixedKey",
    responses: { 200: { description: "ok", body: z.object({ secret: z.string() }) as any } },
    handler: async ({ state }) => ({
      status: 200 as const,
      body: { secret: SECRETS[(state as Record<string, unknown>).tenant as string]! },
    }),
  });

  await app.request("/report", { headers: { "x-tenant-id": "acme" } });
  const globex = await app.request("/report", { headers: { "x-tenant-id": "globex" } });
  assert.deepEqual(await globex.json(), { secret: "GLOBEX-CONFIDENTIAL" });
});

test("F-5: responseCache mounted ahead of tenancy refuses to boot in production", async () => {
  // In this order the key is built before the tenant exists in ctx.state, so
  // automatic partitioning cannot see it. Fail closed rather than leak.
  const app = new App({ env: "production", logger: false });
  app.use(responseCache({ ttlSeconds: 60, store: new MemoryResponseCacheStore() }));
  app.use(tenancy({ resolve: tenantFromHeader("x-tenant-id"), require: false }));
  app.route({
    method: "GET",
    path: "/report",
    operationId: "reportBadOrder",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  const res = await app.request("/report", { headers: { "x-tenant-id": "acme" } });
  assert.equal(res.status, 500, "the boot guard must refuse to serve this app");
});

test("F-5: the correct order (tenancy first) boots and serves normally", async () => {
  const app = tenantApp();
  const res = await app.request("/report", { headers: { "x-tenant-id": "acme" } });
  assert.equal(res.status, 200);
});

// ===========================================================================
// F-6 — Cookie not treated as a credential
// ===========================================================================

test("F-6: a cookie-authenticated response is not served to an anonymous caller", async () => {
  const app = cookieApp();

  const alice = await app.request("/profile", { headers: { cookie: "sid=sid-alice" } });
  assert.deepEqual(await alice.json(), { user: "alice", calls: 1 });

  const stranger = await app.request("/profile");
  assert.equal(stranger.status, 401, "an anonymous caller must not get a cached private body");
  assert.deepEqual(await stranger.json(), { user: "anonymous" });
});

test("F-6: one cookie principal is not served another's response", async () => {
  const app = cookieApp();
  await app.request("/profile", { headers: { cookie: "sid=sid-alice" } });
  const bob = await app.request("/profile", { headers: { cookie: "sid=sid-bob" } });
  assert.deepEqual(await bob.json(), { user: "bob", calls: 2 });
});

test("F-6: `principal` makes per-user caching work instead of merely bypassing", async () => {
  const app = cookieApp({
    principal: (ctx) =>
      /(?:^|;\s*)sid=([^;]+)/.exec(ctx.request.headers.get("cookie") ?? "")?.[1] ?? null,
  });

  const first = await app.request("/profile", { headers: { cookie: "sid=sid-alice" } });
  assert.equal(first.headers.get("x-cache"), "MISS");
  assert.deepEqual(await first.json(), { user: "alice", calls: 1 });

  // Same principal: a real hit, so the middleware still earns its keep.
  const second = await app.request("/profile", { headers: { cookie: "sid=sid-alice" } });
  assert.equal(second.headers.get("x-cache"), "HIT");
  assert.deepEqual(await second.json(), { user: "alice", calls: 1 });

  // Different principal: must not collide with alice's entry.
  const bob = await app.request("/profile", { headers: { cookie: "sid=sid-bob" } });
  assert.equal(bob.headers.get("x-cache"), "MISS");
  assert.deepEqual(await bob.json(), { user: "bob", calls: 2 });

  // Anonymous: no principal, and the request carries no cookie, so it is a
  // plain public entry — and definitely not alice's.
  const anon = await app.request("/profile");
  assert.deepEqual(await anon.json(), { user: "anonymous" });
});

test("F-6: a principal returning null for a credentialed request fails closed", async () => {
  // A `principal` that cannot name this particular caller must not fall back to
  // sharing one anonymous entry among authenticated users.
  const app = cookieApp({ principal: () => null });
  const alice = await app.request("/profile", { headers: { cookie: "sid=sid-alice" } });
  assert.equal(alice.headers.get("x-cache"), null, "credentialed request must bypass the cache");
  const stranger = await app.request("/profile");
  assert.deepEqual(await stranger.json(), { user: "anonymous" });
});

test("F-6: cookie caching can be opted into explicitly, per header", async () => {
  const app = cookieApp({ cacheAuthenticatedRequests: { cookie: true } });
  await app.request("/profile", { headers: { cookie: "sid=sid-alice" } });
  const stranger = await app.request("/profile");
  assert.equal(
    stranger.headers.get("x-cache"),
    "HIT",
    "an explicit opt-in is honored — the operator declared this response shareable",
  );
});

test("F-6: opting cookies in does not opt Authorization in", async () => {
  const app = cookieApp({ cacheAuthenticatedRequests: { cookie: true } });
  const authed = await app.request("/profile", { headers: { authorization: "Bearer t" } });
  assert.equal(authed.headers.get("x-cache"), null, "Authorization must still bypass");
});

test("F-6: declaring the credential in varyHeaders counts as handling it", async () => {
  const app = cookieApp({ varyHeaders: ["cookie"] });
  const alice = await app.request("/profile", { headers: { cookie: "sid=sid-alice" } });
  assert.equal(alice.headers.get("x-cache"), "MISS");
  const again = await app.request("/profile", { headers: { cookie: "sid=sid-alice" } });
  assert.equal(again.headers.get("x-cache"), "HIT", "the cookie value now partitions the key");
  const bob = await app.request("/profile", { headers: { cookie: "sid=sid-bob" } });
  assert.deepEqual(await bob.json(), { user: "bob", calls: 2 });
});

test("F-6: public traffic with no credentials still caches normally", async () => {
  // The regression risk of a fail-closed credential rule is disabling the cache
  // for everyone. Ordinary anonymous reads must still be served from cache.
  const app = hostApp();
  const first = await app.request(new Request("http://public.example.com/whoami"));
  assert.equal(first.headers.get("x-cache"), "MISS");
  const second = await app.request(new Request("http://public.example.com/whoami"));
  assert.equal(second.headers.get("x-cache"), "HIT");
  assert.deepEqual(await second.json(), { servedFor: "public.example.com", calls: 1 });
});

test("F-6: a principal containing the key delimiter stays in its own partition", async () => {
  // Partition components are length-prefixed, so a principal id carrying the
  // delimiter cannot be shaped to look like a different partition. Defense in
  // depth: principals often come from a claim, a DB row, or a body — places
  // where a newline is not filtered out for free the way a header value is.
  //
  // `keyGenerator` deliberately ignores the query string, so the two requests
  // below share an identical key *body* and only the partition differs. That
  // isolates the property under test.
  let calls = 0;
  const app = new App({ env: "development", logger: false });
  app.use(
    responseCache({
      ttlSeconds: 60,
      store: new MemoryResponseCacheStore(),
      keyGenerator: (ctx) => `GET ${new URL(ctx.request.url).pathname}`,
      principal: (ctx) => new URL(ctx.request.url).searchParams.get("u"),
    }),
  );
  app.route({
    method: "GET",
    path: "/profile",
    operationId: "profileByQuery",
    responses: {
      200: { description: "ok", body: z.object({ user: z.string(), calls: z.number() }) as any },
    },
    handler: async ({ request }) => {
      calls++;
      return {
        status: 200 as const,
        body: { user: new URL(request.url).searchParams.get("u") ?? "anonymous", calls },
      };
    },
  });

  const victim = await app.request("/profile?u=alice");
  assert.equal(victim.headers.get("x-cache"), "MISS");
  assert.deepEqual(await victim.json(), { user: "alice", calls: 1 });

  const forged = await app.request(`/profile?u=${encodeURIComponent("alice\nGET /profile")}`);
  assert.equal(forged.headers.get("x-cache"), "MISS", "must not reconstruct alice's entry");

  // And alice's own entry is intact and still hers.
  const aliceAgain = await app.request("/profile?u=alice");
  assert.equal(aliceAgain.headers.get("x-cache"), "HIT");
  assert.deepEqual(await aliceAgain.json(), { user: "alice", calls: 1 });
});
