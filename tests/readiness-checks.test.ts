import { test } from "node:test";
import assert from "node:assert/strict";
import { App } from "../src/index.js";
import { createLogger } from "../src/logger.js";

function appWithLog(): { app: App; lines: () => Array<Record<string, unknown>> } {
  const raw: string[] = [];
  const app = new App({
    env: "development",
    logger: createLogger({ level: "info", write: (line) => raw.push(line) }),
  });
  return { app, lines: () => raw.map((line) => JSON.parse(line) as Record<string, unknown>) };
}

function failures(lines: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return lines.filter((l) => l.event === "readiness.check_failed");
}

test("readinesscheck checks: 200 when every check passes, each gets an AbortSignal", async () => {
  const { app } = appWithLog();
  const seen: AbortSignal[] = [];
  app.readinesscheck({
    checks: {
      db: async (signal) => {
        seen.push(signal);
        return { rows: 1 };
      },
      cache: (signal) => {
        seen.push(signal);
        return true;
      },
      noValue: () => undefined,
    },
  });
  const res = await app.fetch(new Request("http://x/readyz"));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ready" });
  assert.equal(seen.length, 2);
  for (const signal of seen) assert.ok(signal instanceof AbortSignal && !signal.aborted);
});

test("readinesscheck checks: false, throw, and reject each fail with an opaque 503", async () => {
  for (const check of [
    () => false,
    () => {
      throw new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2");
    },
    async () => Promise.reject(new Error("pool exhausted")),
  ]) {
    const { app, lines } = appWithLog();
    app.readinesscheck({ checks: { ok: () => true, db: check } });
    const res = await app.fetch(new Request("http://x/readyz"));
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("retry-after"), "5");
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { status: "not-ready" });
    // Neither the check name nor its error reaches the client.
    assert.doesNotMatch(text, /db|ECONNREFUSED|hunter2|pool/);
    const logged = failures(lines());
    assert.equal(logged.length, 1);
    assert.equal(logged[0]!.check, "db");
  }
});

test("readinesscheck checks: a hung check times out, is aborted, and fails the probe", async () => {
  const { app, lines } = appWithLog();
  let abortedWith: unknown;
  app.readinesscheck({
    checkTimeoutMs: 25,
    checks: {
      db: (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            abortedWith = signal.reason;
            reject(signal.reason);
          });
        }),
    },
  });
  const started = Date.now();
  const res = await app.fetch(new Request("http://x/readyz"));
  assert.equal(res.status, 503);
  assert.ok(Date.now() - started < 2000, "probe answered promptly");
  assert.ok(abortedWith instanceof DOMException && abortedWith.name === "TimeoutError");
  const logged = failures(lines());
  assert.equal(logged.length, 1);
  assert.equal(logged[0]!.reason, "timeout");
});

test("readinesscheck checks: a late rejection after timeout is not an unhandled rejection", async () => {
  const { app } = appWithLog();
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    app.readinesscheck({
      checkTimeoutMs: 10,
      checks: {
        // Ignores the signal and rejects well after the timeout.
        db: () => new Promise((_resolve, reject) => setTimeout(() => reject(new Error("late")), 40)),
      },
    });
    assert.equal((await app.fetch(new Request("http://x/readyz"))).status, 503);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("readinesscheck checks: checks run concurrently, not one after another", async () => {
  const { app } = appWithLog();
  const slow = () => new Promise((resolve) => setTimeout(() => resolve(true), 60));
  app.readinesscheck({ checks: { a: slow, b: slow, c: slow }, checkTimeoutMs: 1000 });
  const started = Date.now();
  assert.equal((await app.fetch(new Request("http://x/readyz"))).status, 200);
  assert.ok(Date.now() - started < 170, "three 60ms checks finish in about 60ms");
});

test("readinesscheck checks: skipped while draining (503 without calling them)", async () => {
  const { app } = appWithLog();
  let calls = 0;
  app.readinesscheck({ checks: { db: () => (calls++, true) } });
  void app.shutdown(0);
  assert.equal((await app.fetch(new Request("http://x/readyz"))).status, 503);
  assert.equal(calls, 0);
});

test("readinesscheck checks: token auth still runs before any check", async () => {
  const { app } = appWithLog();
  let calls = 0;
  app.readinesscheck({ token: "a-very-long-probe-token-123", checks: { db: () => (calls++, true) } });
  assert.equal((await app.fetch(new Request("http://x/readyz"))).status, 401);
  assert.equal(calls, 0);
  const ok = await app.fetch(
    new Request("http://x/readyz", { headers: { authorization: "Bearer a-very-long-probe-token-123" } }),
  );
  assert.equal(ok.status, 200);
  assert.equal(calls, 1);
});

test("readinesscheck checks: malformed configuration is rejected at registration", () => {
  const app = new App({ env: "development", logger: false });
  assert.throws(() => app.readinesscheck({ checks: [] as unknown as Record<string, () => true> }), /checks must be an object/);
  assert.throws(() => app.readinesscheck({ checks: null as unknown as Record<string, () => true> }), /checks must be an object/);
  assert.throws(() => app.readinesscheck({ checks: { "bad name": () => true } }), /must match/);
  assert.throws(() => app.readinesscheck({ checks: { ["x".repeat(65)]: () => true } }), /must match/);
  assert.throws(
    () => app.readinesscheck({ checks: JSON.parse('{"__proto__": 1}') as Record<string, () => true> }),
    /must match|must be a function/,
  );
  assert.throws(() => app.readinesscheck({ checks: { constructor: () => true } }), /must match/);
  assert.throws(() => app.readinesscheck({ checks: { db: "select 1" as unknown as () => true } }), /must be a function/);
  for (const checkTimeoutMs of [0, -1, 1.5, 60_001, Number.NaN]) {
    assert.throws(() => app.readinesscheck({ checkTimeoutMs }), /checkTimeoutMs must be an integer/);
  }
});
