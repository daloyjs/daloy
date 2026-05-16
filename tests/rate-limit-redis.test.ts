import { test } from "node:test";
import assert from "node:assert/strict";
import {
  redisRateLimitStore,
  ioredisAdapter,
  nodeRedisAdapter,
  type RedisCommands,
} from "../src/rate-limit-redis.js";
import { App, rateLimit } from "../src/index.js";

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
    const client: RedisCommands = { async eval() { return [count, ttl]; } };
    const store = redisRateLimitStore({ client });
    const result = await store.hit("k", 1_000);
    assert.equal(result.count, expectedCount);
  }
});

test("redisRateLimitStore handles missing/empty EVAL response", async () => {
  const client: RedisCommands = { async eval() { return null; } };
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
    }),
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
