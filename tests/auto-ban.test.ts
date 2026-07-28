import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  autoBan,
  MemoryAutoBanStore,
  _resetAutoBanStoresForTests,
  UnauthorizedError,
  type AutoBanStore,
  type AutoBanRecord,
  type AutoBanEvent,
} from "../src/index.js";

// ---------- helpers ----------

/**
 * App with an `autoBan()` guard plus two routes: `/fail` throws a 401 (a watched
 * status) and `/ok` returns 200. Each test resets the shared store first.
 */
function appWith(opts: Parameters<typeof autoBan>[0]): App {
  _resetAutoBanStoresForTests();
  const app = new App({ env: "development" });
  app.use(autoBan(opts));
  app.route({
    method: "GET",
    path: "/fail",
    responses: { 200: { description: "ok" } },
    handler: () => {
      throw new UnauthorizedError();
    },
  });
  app.route({
    method: "GET",
    path: "/ok",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  return app;
}

function req(path: string, id = "1.2.3.4"): Request {
  return new Request(`http://x${path}`, { headers: { "x-id": id } });
}

const byHeader = (ctx: { request: Request }): string | undefined =>
  ctx.request.headers.get("x-id") ?? undefined;

// ---------- construction validation (unhappy) ----------

test("autoBan() requires an identity source", () => {
  assert.throws(() => autoBan(), /keyGenerator, trustedHops, or set trustProxyHeaders/);
  assert.throws(() => autoBan({}), /keyGenerator, trustedHops, or set trustProxyHeaders/);
});

test("autoBan() validates numeric options", () => {
  assert.throws(() => autoBan({ keyGenerator: byHeader, windowMs: 0 }), /windowMs/);
  assert.throws(() => autoBan({ keyGenerator: byHeader, maxStrikes: -1 }), /maxStrikes/);
  assert.throws(() => autoBan({ keyGenerator: byHeader, banMs: 1.5 }), /banMs/);
  assert.throws(
    () => autoBan({ keyGenerator: byHeader, banMs: 1000, maxBanMs: 500 }),
    /maxBanMs must be >= banMs/
  );
});

test("autoBan() validates banStatus and watchStatuses", () => {
  assert.throws(
    // @ts-expect-error intentionally invalid
    () => autoBan({ keyGenerator: byHeader, banStatus: 418 }),
    /banStatus/
  );
  assert.throws(
    () => autoBan({ keyGenerator: byHeader, watchStatuses: [] }),
    /at least one status/
  );
  assert.throws(() => autoBan({ keyGenerator: byHeader, watchStatuses: [99] }), /100-599/);
});

// ---------- happy paths ----------

test("autoBan() can attribute clients from proxy headers", async () => {
  _resetAutoBanStoresForTests();
  const app = new App({ env: "development" });
  app.use(autoBan({ trustProxyHeaders: true, maxStrikes: 2 }));
  app.route({
    method: "GET",
    path: "/fail",
    responses: { 200: { description: "ok" } },
    handler: () => {
      throw new UnauthorizedError();
    },
  });
  app.route({
    method: "GET",
    path: "/ok",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const xff = (path: string) =>
    new Request(`http://x${path}`, { headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } });
  assert.equal((await app.fetch(xff("/fail"))).status, 401);
  assert.equal((await app.fetch(xff("/fail"))).status, 401);
  assert.equal((await app.fetch(xff("/ok"))).status, 429);
  // A different forwarded client is unaffected.
  const other = new Request("http://x/ok", { headers: { "x-real-ip": "8.8.8.8" } });
  assert.equal((await app.fetch(other)).status, 200);
});

test("autoBan() leaves clients under the threshold untouched", async () => {
  const app = appWith({ keyGenerator: byHeader, maxStrikes: 3 });
  for (let i = 0; i < 2; i++) {
    assert.equal((await app.fetch(req("/fail"))).status, 401);
  }
  // A clean request still succeeds — no ban yet.
  assert.equal((await app.fetch(req("/ok"))).status, 200);
});

test("autoBan() does not count non-watched statuses", async () => {
  const app = appWith({ keyGenerator: byHeader, maxStrikes: 2 });
  // Ten successful requests must never trip a ban.
  for (let i = 0; i < 10; i++) {
    assert.equal((await app.fetch(req("/ok"))).status, 200);
  }
  assert.equal((await app.fetch(req("/ok"))).status, 200);
});

// ---------- ban behaviour ----------

test("autoBan() bans a client after maxStrikes watched responses", async () => {
  const app = appWith({ keyGenerator: byHeader, maxStrikes: 3 });
  // 3 failing requests build strikes; the 4th request is banned.
  for (let i = 0; i < 3; i++) {
    assert.equal((await app.fetch(req("/fail"))).status, 401);
  }
  const banned = await app.fetch(req("/ok"));
  assert.equal(banned.status, 429);
  assert.ok(banned.headers.has("retry-after"));
  assert.equal(banned.headers.get("cache-control"), "no-store");
});

test("autoBan() bans are scoped per client identity", async () => {
  const app = appWith({ keyGenerator: byHeader, maxStrikes: 2 });
  // Client A trips a ban.
  await app.fetch(req("/fail", "10.0.0.1"));
  await app.fetch(req("/fail", "10.0.0.1"));
  assert.equal((await app.fetch(req("/ok", "10.0.0.1"))).status, 429);
  // Client B is unaffected.
  assert.equal((await app.fetch(req("/ok", "10.0.0.2"))).status, 200);
});

test("autoBan() skips requests it cannot attribute", async () => {
  const app = appWith({ keyGenerator: () => undefined, maxStrikes: 1 });
  for (let i = 0; i < 5; i++) {
    assert.equal((await app.fetch(req("/fail"))).status, 401);
  }
  // Never banned because no identity could be derived.
  assert.equal((await app.fetch(req("/ok"))).status, 200);
});

test("autoBan() honours banStatus 403 with a custom message", async () => {
  const app = appWith({
    keyGenerator: byHeader,
    maxStrikes: 1,
    banStatus: 403,
    message: "Go away",
  });
  assert.equal((await app.fetch(req("/fail"))).status, 401);
  const banned = await app.fetch(req("/ok"));
  assert.equal(banned.status, 403);
  const body = (await banned.json()) as { detail?: string };
  assert.equal(body.detail, "Go away");
});

test("autoBan() omits Retry-After when retryAfter is false", async () => {
  const app = appWith({ keyGenerator: byHeader, maxStrikes: 1, retryAfter: false });
  await app.fetch(req("/fail"));
  const banned = await app.fetch(req("/ok"));
  assert.equal(banned.status, 429);
  assert.equal(banned.headers.has("retry-after"), false);
});

test("autoBan() can watch custom statuses", async () => {
  _resetAutoBanStoresForTests();
  const app = new App({ env: "development" });
  app.use(autoBan({ keyGenerator: byHeader, maxStrikes: 2, watchStatuses: [422] }));
  app.route({
    method: "GET",
    path: "/unprocessable",
    responses: { 200: { description: "ok" }, 422: { description: "bad" } },
    handler: () => ({ status: 422 as const, body: { bad: true } }),
  });
  app.route({
    method: "GET",
    path: "/ok",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  // Two 422s trip the ban; default watched statuses (401/403/429) would not.
  assert.equal((await app.fetch(req("/unprocessable"))).status, 422);
  assert.equal((await app.fetch(req("/unprocessable"))).status, 422);
  assert.equal((await app.fetch(req("/ok"))).status, 429);
});

// ---------- callbacks ----------

test("autoBan() fires onStrike and onBan callbacks", async () => {
  _resetAutoBanStoresForTests();
  const strikes: number[] = [];
  const bans: AutoBanEvent[] = [];
  const app = new App({ env: "development" });
  app.use(
    autoBan({
      keyGenerator: byHeader,
      maxStrikes: 2,
      onStrike: (e) => strikes.push(e.strikes),
      onBan: (e) => bans.push(e),
    })
  );
  app.route({
    method: "GET",
    path: "/fail",
    responses: { 200: { description: "ok" } },
    handler: () => {
      throw new UnauthorizedError();
    },
  });
  await app.fetch(req("/fail"));
  await app.fetch(req("/fail"));
  assert.deepEqual(strikes, [1, 2]);
  assert.equal(bans.length, 1);
  assert.equal(bans[0]!.banCount, 1);
  assert.ok(bans[0]!.banDurationMs > 0);
});

// ---------- escalation (custom store to fast-forward expiry) ----------

test("autoBan() escalates the ban duration for repeat offenders", async () => {
  // A controllable store so we can expire the first ban without real time.
  const map = new Map<string, AutoBanRecord>();
  const store: AutoBanStore = {
    async get(key) {
      return map.get(key);
    },
    async set(key, record) {
      map.set(key, { ...record });
    },
    async delete(key) {
      map.delete(key);
    },
  };
  const bans: AutoBanEvent[] = [];
  const app = new App({ env: "development" });
  app.use(
    autoBan({
      keyGenerator: byHeader,
      maxStrikes: 2,
      banMs: 1000,
      store,
      onBan: (e) => bans.push(e),
    })
  );
  app.route({
    method: "GET",
    path: "/fail",
    responses: { 200: { description: "ok" } },
    handler: () => {
      throw new UnauthorizedError();
    },
  });

  // First ban.
  await app.fetch(req("/fail"));
  await app.fetch(req("/fail"));
  assert.equal(bans.length, 1);

  // Fast-forward: clear the active ban window but keep banCount, so new strikes
  // accumulate toward a second (escalated) ban.
  for (const [key, rec] of map) {
    map.set(key, { ...rec, bannedUntilMs: 0, strikes: 0, strikeExpiresMs: 0 });
  }

  await app.fetch(req("/fail"));
  await app.fetch(req("/fail"));
  assert.equal(bans.length, 2);
  assert.equal(bans[1]!.banCount, 2);
  // Escalation doubles: second ban is longer than the first.
  assert.ok(bans[1]!.banDurationMs > bans[0]!.banDurationMs);
});

test("autoBan() escalate:false keeps a constant ban duration", async () => {
  const map = new Map<string, AutoBanRecord>();
  const store: AutoBanStore = {
    async get(key) {
      return map.get(key);
    },
    async set(key, record) {
      map.set(key, { ...record });
    },
    async delete(key) {
      map.delete(key);
    },
  };
  const bans: AutoBanEvent[] = [];
  const app = new App({ env: "development" });
  app.use(
    autoBan({
      keyGenerator: byHeader,
      maxStrikes: 1,
      banMs: 1000,
      escalate: false,
      store,
      onBan: (e) => bans.push(e),
    })
  );
  app.route({
    method: "GET",
    path: "/fail",
    responses: { 200: { description: "ok" } },
    handler: () => {
      throw new UnauthorizedError();
    },
  });

  await app.fetch(req("/fail"));
  for (const [key, rec] of map) {
    map.set(key, { ...rec, bannedUntilMs: 0 });
  }
  await app.fetch(req("/fail"));
  assert.equal(bans.length, 2);
  assert.equal(bans[0]!.banDurationMs, bans[1]!.banDurationMs);
});

// ---------- MemoryAutoBanStore ----------

test("MemoryAutoBanStore expires entries past their TTL", async () => {
  const store = new MemoryAutoBanStore();
  await store.set("k", { strikes: 1, strikeExpiresMs: 0, bannedUntilMs: 0, banCount: 0 }, -1);
  assert.equal(await store.get("k"), undefined);

  await store.set("k", { strikes: 1, strikeExpiresMs: 0, bannedUntilMs: 0, banCount: 0 }, 60_000);
  assert.ok(await store.get("k"));
  await store.delete("k");
  assert.equal(await store.get("k"), undefined);
});
