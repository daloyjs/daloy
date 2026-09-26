/**
 * Opt-in integration tests that run the shipped Lua scripts against a REAL
 * Redis. The unit tests in `rate-limit-redis.test.ts` use a JS fake that
 * re-implements each script, so only this file proves the Lua itself.
 *
 * Skipped unless `DALOY_TEST_REDIS_URL` is set, e.g.
 *   docker run --rm -p 127.0.0.1:6399:6379 redis:7-alpine
 *   DALOY_TEST_REDIS_URL=redis://127.0.0.1:6399 pnpm exec tsx --test tests/rate-limit-redis-live.test.ts
 *
 * Uses a ~40-line RESP client so the suite needs no Redis client dependency.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { connect, type Socket } from "node:net";
import { redisAutoBanStore, redisRateLimitStore, type RedisCommands } from "../src/rate-limit-redis.js";
import { applyAutoBanStrike, type AutoBanRecord, type AutoBanStrikePolicy } from "../src/index.js";

const REDIS_URL = process.env.DALOY_TEST_REDIS_URL;
const skip = REDIS_URL ? false : "set DALOY_TEST_REDIS_URL to run against a real Redis";

type Reply = string | number | null | Reply[] | Error;

/** Minimal RESP2 client: one connection, requests answered in order. */
class RespClient implements RedisCommands {
  #sock: Socket;
  #buf = Buffer.alloc(0);
  #waiters: Array<(r: Reply) => void> = [];

  constructor(url: string) {
    const u = new URL(url);
    this.#sock = connect(Number(u.port || 6379), u.hostname);
    this.#sock.on("data", (d: Buffer) => {
      this.#buf = Buffer.concat([this.#buf, d]);
      for (;;) {
        const parsed = parse(this.#buf, 0);
        if (!parsed) break;
        this.#buf = this.#buf.subarray(parsed.end);
        this.#waiters.shift()!(parsed.value);
      }
    });
  }

  command(...args: string[]): Promise<Reply> {
    let out = `*${args.length}\r\n`;
    for (const a of args) out += `$${Buffer.byteLength(a)}\r\n${a}\r\n`;
    return new Promise((resolve) => {
      this.#waiters.push(resolve);
      this.#sock.write(out);
    });
  }

  async eval(script: string, keys: string[], args: string[]): Promise<unknown> {
    const r = await this.command("EVAL", script, String(keys.length), ...keys, ...args);
    if (r instanceof Error) throw r;
    return r;
  }

  close(): void {
    this.#sock.destroy();
  }
}

function parse(buf: Buffer, at: number): { value: Reply; end: number } | undefined {
  const nl = buf.indexOf("\r\n", at);
  if (nl === -1) return undefined;
  const type = String.fromCharCode(buf[at]!);
  const line = buf.toString("utf8", at + 1, nl);
  if (type === "+") return { value: line, end: nl + 2 };
  if (type === "-") return { value: new Error(line), end: nl + 2 };
  if (type === ":") return { value: Number(line), end: nl + 2 };
  if (type === "$") {
    const len = Number(line);
    if (len === -1) return { value: null, end: nl + 2 };
    if (buf.length < nl + 2 + len + 2) return undefined;
    return { value: buf.toString("utf8", nl + 2, nl + 2 + len), end: nl + 2 + len + 2 };
  }
  if (type === "*") {
    const n = Number(line);
    if (n === -1) return { value: null, end: nl + 2 };
    const items: Reply[] = [];
    let end = nl + 2;
    for (let i = 0; i < n; i++) {
      const item = parse(buf, end);
      if (!item) return undefined;
      items.push(item.value);
      end = item.end;
    }
    return { value: items, end };
  }
  throw new Error(`unexpected RESP type ${type}`);
}

function uniquePrefix(): string {
  return `daloy:test:${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}:`;
}

test("live Redis: autoBan strike() Lua matches applyAutoBanStrike() step for step", { skip }, async () => {
  const client = new RespClient(REDIS_URL!);
  try {
    const store = redisAutoBanStore({ client, prefix: uniquePrefix() });
    const policies: AutoBanStrikePolicy[] = [
      { windowMs: 1_000, maxStrikes: 3, banMs: 5_000, maxBanMs: 60_000, escalate: true },
      { windowMs: 60_000, maxStrikes: 1, banMs: 1_000, maxBanMs: 4_000, escalate: true },
      { windowMs: 500, maxStrikes: 2, banMs: 2_000, maxBanMs: 2_000, escalate: false },
    ];
    for (const [p, policy] of policies.entries()) {
      let reference: AutoBanRecord | undefined;
      let now = 1_700_000_000_000 + p * 10_000_000;
      for (let step = 0; step < 40; step++) {
        // Mix in-window strikes with gaps that let the window lapse.
        now += step % 7 === 6 ? policy.windowMs + 1 : 37;
        const expected = applyAutoBanStrike(reference, policy, now);
        reference = expected.record;
        const actual = await store.strike!(`k${p}`, policy, now);
        assert.deepEqual(actual, expected.result, `policy ${p} step ${step}`);
        const stored = await store.get(`k${p}`);
        assert.deepEqual(stored, expected.record, `stored record policy ${p} step ${step}`);
      }
    }
  } finally {
    client.close();
  }
});

test("live Redis: concurrent strikes are atomic (no lost updates)", { skip }, async () => {
  const client = new RespClient(REDIS_URL!);
  // A second connection so the strikes genuinely race across clients.
  const other = new RespClient(REDIS_URL!);
  try {
    const prefix = uniquePrefix();
    const a = redisAutoBanStore({ client, prefix });
    const b = redisAutoBanStore({ client: other, prefix });
    const policy = { windowMs: 60_000, maxStrikes: 1_000, banMs: 1_000, maxBanMs: 1_000, escalate: false };
    const now = Date.now();
    const results = await Promise.all(
      Array.from({ length: 200 }, (_, i) => (i % 2 ? a : b).strike!("race", policy, now)),
    );
    const counts = results.map((r) => r.strikes).sort((x, y) => x - y);
    assert.deepEqual(counts, Array.from({ length: 200 }, (_, i) => i + 1), "every strike counted exactly once");
  } finally {
    client.close();
    other.close();
  }
});

test("live Redis: autoBan records expire and set/delete round-trip", { skip }, async () => {
  const client = new RespClient(REDIS_URL!);
  try {
    const prefix = uniquePrefix();
    const store = redisAutoBanStore({ client, prefix });
    const record = { strikes: 2, strikeExpiresMs: 123, bannedUntilMs: 456, banCount: 1 };
    await store.set("rt", record, 60_000);
    assert.deepEqual(await store.get("rt"), record);
    const pttl = Number(await client.command("PTTL", `${prefix}rt`));
    assert.ok(pttl > 0 && pttl <= 60_000, `PTTL ${pttl}`);
    await store.delete("rt");
    assert.equal(await store.get("rt"), undefined);
    // strike() also sets a TTL covering the ban.
    await store.strike!("ttl", { windowMs: 1_000, maxStrikes: 1, banMs: 30_000, maxBanMs: 30_000, escalate: false }, Date.now());
    const banTtl = Number(await client.command("PTTL", `${prefix}ttl`));
    assert.ok(banTtl > 1_000 && banTtl <= 30_000, `ban PTTL ${banTtl}`);
  } finally {
    client.close();
  }
});

test("live Redis: rateLimit store Lua counts hits and resets after the window", { skip }, async () => {
  const client = new RespClient(REDIS_URL!);
  try {
    const store = redisRateLimitStore({ client, prefix: uniquePrefix() });
    const first = await store.hit("ip", 300);
    const second = await store.hit("ip", 300);
    assert.equal(first.count, 1);
    assert.equal(second.count, 2);
    // resetMs is an absolute epoch-ms deadline.
    const left = second.resetMs - Date.now();
    assert.ok(left > 0 && left <= 300, `reset in ${left}ms`);
    await new Promise((r) => setTimeout(r, 350));
    assert.equal((await store.hit("ip", 300)).count, 1);
  } finally {
    client.close();
  }
});
