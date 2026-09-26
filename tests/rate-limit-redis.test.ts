import { test } from "node:test";
import assert from "node:assert/strict";
import {
  redisRateLimitStore,
  ioredisAdapter,
  nodeRedisAdapter,
  redisAutoBanStore,
  type RedisCommands,
} from "../src/rate-limit-redis.js";
import {
  App,
  rateLimit,
  autoBan,
  UnauthorizedError,
  _resetAutoBanStoresForTests,
} from "../src/index.js";

/**
 * Minimal in-memory fake of the EVAL contract. Only models the script that
 * `redisRateLimitStore` ships, which is enough to exercise the store end to
 * end without requiring a real Redis.
 */
function fakeRedis(): RedisCommands & { store: Map<string, { count: number; expireAt: number }> } {
  const store = new Map<string, { count: number; expireAt: number }>();
  return {
    store,
    async eval(_script, keys, args) {
      const key = keys[0]!;
      const ttlMs = Number(args[0]!);
      const now = Date.now();
      let entry = store.get(key);
      if (!entry || entry.expireAt <= now) {
        entry = { count: 1, expireAt: now + ttlMs };
        store.set(key, entry);
        return [1, ttlMs];
      }
      entry.count += 1;
      return [entry.count, entry.expireAt - now];
    },
  };
}

test("redisRateLimitStore returns count and resetMs from EVAL result", async () => {
  const client = fakeRedis();
  const store = redisRateLimitStore({ client });

  const first = await store.hit("user:1", 60_000);
  assert.equal(first.count, 1);
  assert.ok(first.resetMs > Date.now());

  const second = await store.hit("user:1", 60_000);
  assert.equal(second.count, 2);
});

test("redisRateLimitStore prefixes keys with the configured namespace", async () => {
  const client = fakeRedis();
  const store = redisRateLimitStore({ client, prefix: "myapp:rl:" });
  await store.hit("alice", 1_000);
  assert.ok(client.store.has("myapp:rl:alice"));
});

test("redisRateLimitStore default prefix is daloy:rl:", async () => {
  const client = fakeRedis();
  const store = redisRateLimitStore({ client });
  await store.hit("bob", 1_000);
  assert.ok(client.store.has("daloy:rl:bob"));
});

test("redisRateLimitStore fails open when EVAL throws", async () => {
  const client: RedisCommands = {
    async eval() {
      throw new Error("boom");
    },
  };
  const store = redisRateLimitStore({ client });
  const result = await store.hit("k", 1_000);
  assert.equal(result.count, 1);
  assert.ok(result.resetMs > Date.now());
});

test("redisRateLimitStore can fail closed via onError", async () => {
  const client: RedisCommands = {
    async eval() {
      throw new Error("boom");
    },
  };
  const store = redisRateLimitStore({ client, onError: () => "fail-closed" });
  await assert.rejects(() => store.hit("k", 1_000), /boom/);
});

test("redisRateLimitStore coerces bigint and string EVAL return values", async () => {
  const cases: Array<readonly [unknown, unknown, number]> = [
    [BigInt(3), BigInt(500), 3],
    ["7", "1000", 7],
    ["not-a-number", "abc", 0],
  ];
  for (const [count, ttl, expectedCount] of cases) {
    const client: RedisCommands = {
      async eval() {
        return [count, ttl];
      },
    };
    const store = redisRateLimitStore({ client });
    const result = await store.hit("k", 1_000);
    assert.equal(result.count, expectedCount);
  }
});

test("redisRateLimitStore handles missing/empty EVAL response", async () => {
  const client: RedisCommands = {
    async eval() {
      return null;
    },
  };
  const store = redisRateLimitStore({ client });
  const result = await store.hit("k", 1_000);
  assert.equal(result.count, 0);
});

test("ioredisAdapter forwards numKeys + flat args to the client", async () => {
  const calls: Array<{ script: string; numKeys: number; rest: string[] }> = [];
  const client = {
    async eval(script: string, numKeys: number, ...rest: string[]) {
      calls.push({ script, numKeys, rest });
      return [1, 1000];
    },
  };
  const adapter = ioredisAdapter(client);
  await adapter.eval("SCRIPT", ["k1", "k2"], ["a1"]);
  assert.deepEqual(calls, [{ script: "SCRIPT", numKeys: 2, rest: ["k1", "k2", "a1"] }]);
});

test("nodeRedisAdapter forwards keys and arguments as an options object", async () => {
  const calls: Array<{ script: string; opts: { keys: string[]; arguments: string[] } }> = [];
  const client = {
    async eval(script: string, opts: { keys: string[]; arguments: string[] }) {
      calls.push({ script, opts });
      return [1, 1000];
    },
  };
  const adapter = nodeRedisAdapter(client);
  await adapter.eval("SCRIPT", ["k"], ["a"]);
  assert.deepEqual(calls, [{ script: "SCRIPT", opts: { keys: ["k"], arguments: ["a"] } }]);
});

test("redisRateLimitStore integrates with rateLimit and surfaces 429 + Retry-After", async () => {
  const client = fakeRedis();
  const app = new App({ logger: false });
  app.use(
    rateLimit({
      windowMs: 10_000,
      max: 2,
      store: redisRateLimitStore({ client }),
      keyGenerator: () => "shared",
    })
  );
  app.route({
    method: "GET",
    path: "/ping",
    operationId: "ping",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  const ok1 = await app.request("/ping");
  assert.equal(ok1.status, 200);
  assert.equal(ok1.headers.get("x-ratelimit-remaining"), "1");

  const ok2 = await app.request("/ping");
  assert.equal(ok2.status, 200);
  assert.equal(ok2.headers.get("x-ratelimit-remaining"), "0");

  const blocked = await app.request("/ping");
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get("retry-after"));
});

// ---------- redisAutoBanStore (deepsec 2026-09-26) ----------

/**
 * Fake of the autoBan scripts: dispatches on the marker comment each script
 * starts with and models the hash + PEXPIRE semantics (a JS mirror of the Lua).
 * Adds latency so concurrent callers genuinely interleave.
 */
function fakeAutoBanRedis(): RedisCommands & {
  hashes: Map<string, { h: Record<string, number>; expireAt: number }>;
  scripts: string[];
} {
  const hashes = new Map<string, { h: Record<string, number>; expireAt: number }>();
  const scripts: string[] = [];
  const live = (k: string) => {
    const e = hashes.get(k);
    if (e && e.expireAt <= Date.now()) hashes.delete(k);
    return hashes.get(k);
  };
  return {
    hashes,
    scripts,
    async eval(script, keys, args) {
      await new Promise((r) => setTimeout(r, 1));
      const marker = script.split("\n", 1)[0]!;
      scripts.push(marker);
      const k = keys[0]!;
      if (marker === "-- daloy:autoban:get") {
        const e = live(k);
        return e ? [e.h.s, e.h.se, e.h.bu, e.h.bc].map(String) : [null, null, null, null];
      }
      if (marker === "-- daloy:autoban:set") {
        const [s, se, bu, bc, ttl] = args.map(Number);
        hashes.set(k, { h: { s: s!, se: se!, bu: bu!, bc: bc! }, expireAt: Date.now() + ttl! });
        return 1;
      }
      if (marker === "-- daloy:autoban:del") {
        hashes.delete(k);
        return 1;
      }
      if (marker === "-- daloy:autoban:strike") {
        const [now, windowMs, maxStrikes, banMs, maxBanMs] = args.map(Number) as number[];
        const e = live(k);
        let s = e?.h.s ?? 0;
        let se = e?.h.se ?? 0;
        let bu = e?.h.bu ?? 0;
        let bc = e?.h.bc ?? 0;
        if (se <= now!) s = 0;
        s += 1;
        const strikes = s;
        let banned = 0;
        let dur = 0;
        se = now! + windowMs!;
        if (s >= maxStrikes!) {
          bc += 1;
          dur = args[5] === "1" ? Math.min(maxBanMs!, banMs! * 2 ** (bc - 1)) : banMs!;
          bu = now! + dur;
          banned = 1;
          s = 0;
        }
        hashes.set(k, { h: { s, se, bu, bc }, expireAt: Date.now() + Math.max(se, bu) - now! });
        return [strikes, banned, bc, dur, bu];
      }
      throw new Error("unknown script " + marker);
    },
  };
}

test("redisAutoBanStore get/set/delete round-trip under the prefix", async () => {
  const client = fakeAutoBanRedis();
  const store = redisAutoBanStore({ client });
  assert.equal(await store.get("a"), undefined);
  await store.set("a", { strikes: 2, strikeExpiresMs: 10, bannedUntilMs: 0, banCount: 1 }, 5_000);
  assert.ok(client.hashes.has("daloy:ab:a"));
  assert.deepEqual(await store.get("a"), {
    strikes: 2,
    strikeExpiresMs: 10,
    bannedUntilMs: 0,
    banCount: 1,
  });
  await store.delete("a");
  assert.equal(await store.get("a"), undefined);
});

test("redisAutoBanStore strike() is used by autoBan and counts concurrent failures", async () => {
  _resetAutoBanStoresForTests();
  const client = fakeAutoBanRedis();
  const bans: number[] = [];
  const app = new App({ env: "development", logger: false });
  app.use(
    autoBan({
      keyGenerator: () => "attacker",
      store: redisAutoBanStore({ client, prefix: "t:" }),
      maxStrikes: 5,
      onBan: (e) => bans.push(e.banCount),
    })
  );
  app.route({
    method: "GET",
    path: "/login",
    responses: { 200: { description: "ok" } },
    handler: () => {
      throw new UnauthorizedError();
    },
  });
  const res = await Promise.all(
    Array.from({ length: 15 }, () => app.fetch(new Request("http://x/login")))
  );
  assert.ok(res.every((r) => r.status === 401));
  assert.deepEqual(bans, [1, 2, 3]);
  assert.ok(client.scripts.includes("-- daloy:autoban:strike"));
  assert.ok(!client.scripts.includes("-- daloy:autoban:set"));
  assert.equal((await app.fetch(new Request("http://x/login"))).status, 429);
});

test("redisAutoBanStore strike() rejects a malformed reply", async () => {
  const store = redisAutoBanStore({ client: { eval: async () => "OK" } });
  await assert.rejects(
    store.strike!("k", { windowMs: 1, maxStrikes: 1, banMs: 1, maxBanMs: 1, escalate: false }, 0),
    /unexpected strike reply/
  );
});

test("redisAutoBanStore propagates transport errors", async () => {
  const store = redisAutoBanStore({
    client: {
      eval: async () => {
        throw new Error("ECONNREFUSED");
      },
    },
  });
  await assert.rejects(store.get("k"), /ECONNREFUSED/);
});
