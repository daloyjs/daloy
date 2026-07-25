import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  App,
  responseCache,
  MemoryResponseCacheStore,
  _resetSharedResponseCacheStoresForTests,
  type CachedResponse,
  type ResponseCacheOptions,
  type ResponseCacheStore,
} from "../src/index.js";

/**
 * Build an app with `responseCache()` mounted ahead of a `GET /now` route.
 * The handler increments `calls` so tests can prove a cache hit skipped it,
 * and echoes the current call count so a stale vs. fresh body is observable.
 */
function makeApp(opts: ResponseCacheOptions = {}) {
  const app = new App({ logger: false });
  const state = {
    calls: 0,
    cacheControl: null as string | null,
    setCookie: false,
    status: 200 as number,
  };
  app.use(responseCache(opts));
  app.route({
    method: "GET",
    path: "/now",
    operationId: "now",
    responses: { 200: { description: "ok", body: z.object({ calls: z.number() }) as any } },
    handler: async ({ set }) => {
      state.calls++;
      if (state.cacheControl) set.headers.set("cache-control", state.cacheControl);
      if (state.setCookie) set.headers.set("set-cookie", "sid=abc");
      return { status: state.status as 200, body: { calls: state.calls } };
    },
  });
  app.route({
    method: "POST",
    path: "/now",
    operationId: "nowWrite",
    request: { body: z.object({}).optional() as any },
    responses: { 200: { description: "ok" } },
    handler: async () => {
      state.calls++;
      return { status: 200 as const, body: { calls: state.calls } };
    },
  });
  return { app, state };
}

function get(headers?: Record<string, string>): RequestInit {
  return { method: "GET", headers };
}

/**
 * Wrap a {@link MemoryResponseCacheStore} so a test can address the entry the
 * middleware actually wrote without hardcoding the internal cache-key format.
 *
 * The key is deliberately opaque: it contains the full effective request URI
 * (scheme + authority + path + query, per RFC 9111 §4) plus any tenant /
 * principal partition, and those components are a security control that may grow.
 * Tests that assert *behavior* should never re-derive it by hand.
 */
function keyCapturingStore(): {
  store: ResponseCacheStore;
  inner: MemoryResponseCacheStore;
  lastKey: () => string;
} {
  const inner = new MemoryResponseCacheStore();
  let lastKey: string | undefined;
  return {
    inner,
    lastKey: () => {
      assert.ok(lastKey !== undefined, "no cache entry was written");
      return lastKey;
    },
    store: {
      get: (key) => inner.get(key),
      set: (key, entry, ttlMs) => {
        lastKey = key;
        inner.set(key, entry, ttlMs);
      },
      delete: (key) => inner.delete(key),
    },
  };
}

// ---------- Happy paths ----------

test("first request misses and runs the handler", async () => {
  const { app, state } = makeApp({ ttlSeconds: 60 });
  const res = await app.request("/now", get());
  assert.equal(res.status, 200);
  assert.equal(state.calls, 1);
  assert.equal(res.headers.get("x-cache"), "MISS");
  assert.deepEqual(await res.json(), { calls: 1 });
});

test("second request within TTL hits the cache and skips the handler", async () => {
  const { app, state } = makeApp({ ttlSeconds: 60 });
  await app.request("/now", get());
  const res = await app.request("/now", get());
  assert.equal(res.status, 200);
  assert.equal(state.calls, 1, "handler must run exactly once while fresh");
  assert.equal(res.headers.get("x-cache"), "HIT");
  assert.notEqual(res.headers.get("age"), null);
  assert.deepEqual(await res.json(), { calls: 1 });
});

test("HEAD request serves a cached body as an empty body", async () => {
  const { app, state } = makeApp({ ttlSeconds: 60, methods: ["GET", "HEAD"] });
  await app.request("/now", { method: "HEAD" });
  const res = await app.request("/now", { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.equal(state.calls, 1);
  assert.equal(res.headers.get("x-cache"), "HIT");
  assert.equal(await res.text(), "");
});

test("entries expire after the TTL elapses", async () => {
  const { store, inner, lastKey } = keyCapturingStore();
  const { app, state } = makeApp({ ttlSeconds: 60, store });
  await app.request("/now", get());
  assert.equal(state.calls, 1);

  // Force the stored entry to look expired.
  const key = lastKey();
  const entry = inner.get(key) as CachedResponse;
  assert.ok(entry);
  inner.set(key, { ...entry, freshUntil: Date.now() - 1, staleUntil: Date.now() - 1 }, 1);

  const res = await app.request("/now", get());
  assert.equal(state.calls, 2, "expired entry must re-run the handler");
  assert.equal(res.headers.get("x-cache"), "MISS");
});

// ---------- Cache-Control orchestration ----------

test("response max-age overrides the configured ttl as the freshness window", async () => {
  const { store, inner, lastKey } = keyCapturingStore();
  const { app, state } = makeApp({ ttlSeconds: 5, store });
  state.cacheControl = "max-age=600";
  await app.request("/now", get());
  const entry = inner.get(lastKey()) as CachedResponse;
  assert.ok(entry);
  const freshFor = entry.freshUntil - entry.storedAt;
  assert.ok(freshFor > 500_000, `expected ~600s freshness, got ${freshFor}ms`);
});

test("response s-maxage wins over max-age", async () => {
  const { store, inner, lastKey } = keyCapturingStore();
  const { app, state } = makeApp({ ttlSeconds: 5, store });
  state.cacheControl = "max-age=10, s-maxage=600";
  await app.request("/now", get());
  const entry = inner.get(lastKey()) as CachedResponse;
  const freshFor = entry.freshUntil - entry.storedAt;
  assert.ok(freshFor > 500_000, `expected s-maxage to win, got ${freshFor}ms`);
});

// ---------- Skip rules ----------

test("responses with Set-Cookie are never cached", async () => {
  const { app, state } = makeApp({ ttlSeconds: 60 });
  state.setCookie = true;
  await app.request("/now", get());
  const res = await app.request("/now", get());
  assert.equal(state.calls, 2);
  assert.equal(res.headers.get("x-cache"), "MISS");
});

for (const directive of ["no-store", "private", "no-cache"]) {
  test(`responses marked Cache-Control: ${directive} are never cached`, async () => {
    const { app, state } = makeApp({ ttlSeconds: 60 });
    state.cacheControl = directive;
    await app.request("/now", get());
    const res = await app.request("/now", get());
    assert.equal(state.calls, 2, `${directive} must not be cached`);
    assert.equal(res.headers.get("x-cache"), "MISS");
  });
}

test("custom cacheableStatus controls which statuses are stored", async () => {
  const { app, state } = makeApp({
    ttlSeconds: 60,
    cacheableStatus: (s) => s === 201,
  });
  await app.request("/now", get());
  const res = await app.request("/now", get());
  assert.equal(state.calls, 2, "200 is excluded by the custom predicate");
  assert.equal(res.headers.get("x-cache"), "MISS");
});

test("non-eligible methods bypass the cache", async () => {
  const { app, state } = makeApp({ ttlSeconds: 60 });
  await app.request("/now", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  await app.request("/now", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(state.calls, 2);
});

// ---------- Request directives ----------

test("request Cache-Control: no-store bypasses the cache entirely", async () => {
  const { app, state } = makeApp({ ttlSeconds: 60 });
  await app.request("/now", get());
  const res = await app.request("/now", get({ "cache-control": "no-store" }));
  assert.equal(state.calls, 2, "no-store request must skip both read and write");
  assert.equal(res.headers.get("x-cache"), null);
});

test("request Cache-Control: no-cache bypasses the read but refreshes the entry", async () => {
  const { app, state } = makeApp({ ttlSeconds: 60 });
  await app.request("/now", get()); // calls = 1, stored
  const res = await app.request("/now", get({ "cache-control": "no-cache" }));
  assert.equal(state.calls, 2, "no-cache must re-run the handler");
  assert.equal(res.headers.get("x-cache"), "MISS");
  // The refreshed entry is now served on a normal read.
  const hit = await app.request("/now", get());
  assert.equal(state.calls, 2, "refreshed entry should be served");
  assert.equal(hit.headers.get("x-cache"), "HIT");
  assert.deepEqual(await hit.json(), { calls: 2 });
});

// ---------- Vary / keying ----------

test("varyHeaders partition the cache by request header value", async () => {
  const { app, state } = makeApp({ ttlSeconds: 60, varyHeaders: ["accept-language"] });
  await app.request("/now", get({ "accept-language": "en" }));
  await app.request("/now", get({ "accept-language": "fr" }));
  assert.equal(state.calls, 2, "different vary values must miss separately");
  const en = await app.request("/now", get({ "accept-language": "en" }));
  assert.equal(en.headers.get("x-cache"), "HIT");
  assert.equal(state.calls, 2);
});

test("keyGenerator returning null disables caching for that request", async () => {
  const { app, state } = makeApp({
    ttlSeconds: 60,
    keyGenerator: () => null,
  });
  await app.request("/now", get());
  const res = await app.request("/now", get());
  assert.equal(state.calls, 2);
  assert.equal(res.headers.get("x-cache"), null);
});

// ---------- Body size cap ----------

test("responses larger than maxBodyBytes are not cached", async () => {
  const { app, state } = makeApp({ ttlSeconds: 60, maxBodyBytes: 4 });
  await app.request("/now", get());
  const res = await app.request("/now", get());
  assert.equal(state.calls, 2, "oversized body must not be stored");
  assert.equal(res.headers.get("x-cache"), "MISS");
});

// ---------- stale-while-revalidate ----------

test("stale-while-revalidate serves stale and refreshes in the background", async () => {
  const { store, inner, lastKey } = keyCapturingStore();
  let app!: App<any>;
  const built = makeAppWithSwr(store, () => app);
  app = built.app;
  const state = built.state;

  // Prime the cache.
  const first = await app.request("/now", get());
  assert.equal(await firstCalls(first), 1);

  // Make the stored entry stale (past freshUntil, within staleUntil).
  const key = lastKey();
  const entry = inner.get(key) as CachedResponse;
  inner.set(key, { ...entry, freshUntil: Date.now() - 1 }, 1_000_000);

  const stale = await app.request("/now", get());
  assert.equal(stale.headers.get("x-cache"), "STALE");
  assert.deepEqual(await stale.json(), { calls: 1 }, "stale body served immediately");

  // Let the background refresh settle, then a normal read should be fresh.
  await new Promise((r) => setTimeout(r, 20));
  const refreshed = await app.request("/now", get());
  assert.equal(refreshed.headers.get("x-cache"), "HIT");
  assert.deepEqual(await refreshed.json(), { calls: 2 }, "background refresh repopulated the cache");
});

function makeAppWithSwr(store: ResponseCacheStore, getApp: () => App<any>) {
  const app = new App({ logger: false });
  const state = { calls: 0 };
  app.use(
    responseCache({
      ttlSeconds: 60,
      staleWhileRevalidateSeconds: 600,
      store,
      revalidate: (req) => getApp().fetch(req),
    }),
  );
  app.route({
    method: "GET",
    path: "/now",
    operationId: "swrNow",
    responses: { 200: { description: "ok", body: z.object({ calls: z.number() }) as any } },
    handler: async () => {
      state.calls++;
      return { status: 200 as const, body: { calls: state.calls } };
    },
  });
  return { app, state };
}

async function firstCalls(res: Response): Promise<number> {
  return (await res.json()).calls;
}

// ---------- Custom stores ----------

test("a custom async store is awaited for get/set", async () => {
  const backing = new Map<string, CachedResponse>();
  const store: ResponseCacheStore = {
    async get(key) {
      return backing.get(key) ?? null;
    },
    async set(key, entry) {
      backing.set(key, entry);
    },
    async delete(key) {
      backing.delete(key);
    },
  };
  const { app, state } = makeApp({ ttlSeconds: 60, store });
  await app.request("/now", get());
  assert.equal(backing.size, 1);
  const res = await app.request("/now", get());
  assert.equal(state.calls, 1);
  assert.equal(res.headers.get("x-cache"), "HIT");
});

test("groupId shares an in-memory store across mounts", async () => {
  _resetSharedResponseCacheStoresForTests();
  const a = makeApp({ ttlSeconds: 60, groupId: "g1" });
  const b = makeApp({ ttlSeconds: 60, groupId: "g1" });
  await a.app.request("/now", get());
  // b shares the same backing store, so its handler should be skipped.
  const res = await b.app.request("/now", get());
  assert.equal(b.state.calls, 0, "shared store should serve across mounts");
  assert.equal(res.headers.get("x-cache"), "HIT");
});

// ---------- Option validation ----------

test("invalid ttlSeconds throws", () => {
  assert.throws(() => responseCache({ ttlSeconds: 0 }), /positive integer/);
  assert.throws(() => responseCache({ ttlSeconds: 1.5 }), /positive integer/);
});

test("invalid staleWhileRevalidateSeconds throws", () => {
  assert.throws(
    () => responseCache({ staleWhileRevalidateSeconds: -1 }),
    /non-negative integer/,
  );
});

test("staleWhileRevalidateSeconds without a revalidate callback throws", () => {
  assert.throws(
    () => responseCache({ staleWhileRevalidateSeconds: 30 }),
    /revalidate callback/,
  );
});

test("invalid maxBodyBytes throws", () => {
  assert.throws(() => responseCache({ maxBodyBytes: 0 }), /positive integer/);
});

// ---------- MemoryResponseCacheStore unit behavior ----------

test("MemoryResponseCacheStore drops fully-expired entries on get", () => {
  const store = new MemoryResponseCacheStore();
  const now = Date.now();
  const entry: CachedResponse = {
    status: 200,
    headers: [],
    body: "",
    storedAt: now - 10,
    freshUntil: now - 5,
    staleUntil: now - 1,
  };
  store.set("k", entry, 1);
  assert.equal(store.get("k"), null);
  assert.equal(store.size(), 0);
  store.clear();
});

test("statusHeaderName: null disables the X-Cache marker", async () => {
  const { app } = makeApp({ ttlSeconds: 60, statusHeaderName: null });
  await app.request("/now", get());
  const res = await app.request("/now", get());
  assert.equal(res.headers.get("x-cache"), null);
});
