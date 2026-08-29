import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Scheduler,
  CronParseError,
  parseCron,
  nextCronRun,
  type TimerFns,
  type TaskErrorInfo,
} from "../src/index.js";

// ── deterministic timer + clock harness ─────────────────────────────

interface Pending {
  id: number;
  cb: () => void;
  delay: number;
}

function makeTimers(): {
  timers: TimerFns;
  pending: () => Pending[];
  fireAll: () => void;
  size: () => number;
} {
  let seq = 0;
  const scheduled = new Map<number, Pending>();
  const timers: TimerFns = {
    set(cb, delayMs) {
      const id = ++seq;
      scheduled.set(id, { id, cb, delay: delayMs });
      return id;
    },
    clear(h) {
      scheduled.delete(h as number);
    },
  };
  return {
    timers,
    pending: () => [...scheduled.values()],
    fireAll: () => {
      const all = [...scheduled.values()];
      scheduled.clear();
      for (const e of all) e.cb();
    },
    size: () => scheduled.size,
  };
}

// Flush microtasks + the real macrotask queue WITHOUT advancing the
// injected scheduler timers, so awaited handler promises settle.
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

// ── parseCron ───────────────────────────────────────────────────────

test("parseCron: wildcard fills every field", () => {
  const f = parseCron("* * * * *");
  assert.equal(f.minute.size, 60);
  assert.equal(f.hour.size, 24);
  assert.equal(f.dayOfMonth.size, 31);
  assert.equal(f.month.size, 12);
  assert.equal(f.dayOfWeek.size, 7);
  assert.equal(f.domRestricted, false);
  assert.equal(f.dowRestricted, false);
});

test("parseCron: steps, ranges, and lists", () => {
  assert.deepEqual([...parseCron("*/15 * * * *").minute], [0, 15, 30, 45]);
  assert.deepEqual([...parseCron("0 9 * * 1-5").dayOfWeek], [1, 2, 3, 4, 5]);
  assert.deepEqual([...parseCron("1,15,30 * * * *").minute], [1, 15, 30]);
  assert.deepEqual([...parseCron("0 0-10/2 * * *").hour], [0, 2, 4, 6, 8, 10]);
});

test("parseCron: named months and days, case-insensitive", () => {
  assert.deepEqual([...parseCron("0 0 1 JAN-MAR *").month], [1, 2, 3]);
  assert.deepEqual([...parseCron("0 0 * * mon,fri").dayOfWeek], [1, 5]);
});

test("parseCron: dow 7 normalizes to Sunday (0)", () => {
  assert.deepEqual([...parseCron("0 0 * * 7").dayOfWeek], [0]);
});

test("parseCron: aliases expand", () => {
  assert.deepEqual([...parseCron("@hourly").minute], [0]);
  assert.equal(parseCron("@hourly").hour.size, 24);
  const daily = parseCron("@daily");
  assert.deepEqual([...daily.minute], [0]);
  assert.deepEqual([...daily.hour], [0]);
  assert.deepEqual([...parseCron("@weekly").dayOfWeek], [0]);
  assert.deepEqual([...parseCron("@yearly").month], [1]);
});

test("parseCron: rejects malformed expressions", () => {
  assert.throws(() => parseCron("* * * *"), CronParseError); // too few
  assert.throws(() => parseCron("60 * * * *"), CronParseError); // minute out of range
  assert.throws(() => parseCron("* 24 * * *"), CronParseError); // hour out of range
  assert.throws(() => parseCron("*/0 * * * *"), CronParseError); // zero step
  assert.throws(() => parseCron("5-1 * * * *"), CronParseError); // inverted range
  assert.throws(() => parseCron("@bogus"), CronParseError); // unknown alias
  assert.throws(() => parseCron("a * * * *"), CronParseError); // non-numeric
});

// ── nextCronRun ─────────────────────────────────────────────────────

test("nextCronRun: next top of the hour", () => {
  const after = new Date("2026-01-01T10:17:30Z");
  const next = nextCronRun("0 * * * *", after);
  assert.equal(next.toISOString(), "2026-01-01T11:00:00.000Z");
});

test("nextCronRun: every 15 minutes", () => {
  const after = new Date("2026-01-01T10:07:00Z");
  assert.equal(nextCronRun("*/15 * * * *", after).toISOString(), "2026-01-01T10:15:00.000Z");
});

test("nextCronRun: day-of-month OR day-of-week (Vixie semantics)", () => {
  // 13th OR Friday. 2026-02-13 is itself a Friday; 2026-03-13 is a Friday too.
  // Use "1 of month or Monday": 0 0 1 * 1 → matches the 1st OR any Monday.
  const fields = parseCron("0 0 1 * 1");
  // From Jan 2 2026 (Friday), the next match is Monday Jan 5.
  const next = nextCronRun(fields, new Date("2026-01-02T12:00:00Z"));
  assert.equal(next.toISOString(), "2026-01-05T00:00:00.000Z"); // Monday
});

test("nextCronRun: honours timezone wall clock", () => {
  // Noon in New York (EST, UTC-5 in January) is 17:00 UTC.
  const after = new Date("2026-01-15T00:00:00Z");
  const next = nextCronRun("0 12 * * *", after, "America/New_York");
  assert.equal(next.toISOString(), "2026-01-15T17:00:00.000Z");
});

test("nextCronRun: unsatisfiable expression throws", () => {
  // The 30th of February never occurs.
  assert.throws(() => nextCronRun("0 0 30 2 *", new Date("2026-01-01T00:00:00Z")), CronParseError);
});

// ── Scheduler via runNow (deterministic, no timers) ─────────────────

test("Scheduler.runNow: runs the handler and records state", async () => {
  const scheduler = new Scheduler();
  let calls = 0;
  scheduler.define({ name: "job", intervalMs: 1000 }, () => {
    calls++;
  });
  const ran = await scheduler.runNow("job");
  assert.equal(ran, true);
  assert.equal(calls, 1);
  const state = scheduler.getState("job")!;
  assert.equal(state.runs, 1);
  assert.equal(state.failures, 0);
  assert.equal(state.running, false);
  assert.equal(state.lastError, undefined);
});

test("Scheduler.runNow: a throwing handler is counted and reported", async () => {
  let captured: TaskErrorInfo | undefined;
  const scheduler = new Scheduler();
  scheduler.define(
    { name: "boom", intervalMs: 1000, onError: (_e, info) => (captured = info) },
    () => {
      throw new Error("kaboom");
    }
  );
  await scheduler.runNow("boom");
  const state = scheduler.getState("boom")!;
  assert.equal(state.runs, 1);
  assert.equal(state.failures, 1);
  assert.equal((state.lastError as Error).message, "kaboom");
  assert.equal(captured?.timedOut, false);
  assert.equal(captured?.runCount, 1);
});

test("Scheduler.runNow: single-flight skips an overlapping run", async () => {
  const scheduler = new Scheduler();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  scheduler.define({ name: "slow", intervalMs: 1000 }, () => gate);

  const p1 = scheduler.runNow("slow");
  const second = await scheduler.runNow("slow"); // already running → skipped
  assert.equal(second, false);
  assert.equal(scheduler.getState("slow")!.skipped, 1);

  release();
  assert.equal(await p1, true);
  assert.equal(scheduler.getState("slow")!.runs, 1);
});

test("Scheduler.runNow: unknown task throws", async () => {
  const scheduler = new Scheduler();
  await assert.rejects(() => scheduler.runNow("nope"), RangeError);
});

test("Scheduler: a per-run timeout aborts the handler", async () => {
  const h = makeTimers();
  let captured: TaskErrorInfo | undefined;
  const scheduler = new Scheduler({ timers: h.timers });
  scheduler.define(
    { name: "hang", intervalMs: 1000, timeoutMs: 50, onError: (_e, info) => (captured = info) },
    ({ signal }) =>
      new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      })
  );
  const p = scheduler.runNow("hang");
  await flush();
  h.fireAll(); // fire the timeout timer → controller.abort()
  const ran = await p;
  assert.equal(ran, true);
  const state = scheduler.getState("hang")!;
  assert.equal(state.failures, 1);
  assert.equal(captured?.timedOut, true);
});

// ── Scheduler validation ────────────────────────────────────────────

test("Scheduler.define: rejects invalid definitions", () => {
  const s = new Scheduler();
  assert.throws(() => s.define({ name: "" } as never, () => {}), RangeError);
  assert.throws(() => s.define({ name: "x" }, () => {}), RangeError); // neither schedule
  assert.throws(
    () => s.define({ name: "x", intervalMs: 100, cron: "* * * * *" }, () => {}),
    RangeError
  ); // both
  assert.throws(() => s.define({ name: "x", intervalMs: 0 }, () => {}), RangeError);
  assert.throws(() => s.define({ name: "x", intervalMs: -5 }, () => {}), RangeError);
  assert.throws(
    () => s.define({ name: "x", intervalMs: 100, timeoutMs: -1 }, () => {}),
    RangeError
  );
  assert.throws(() => s.define({ name: "x", cron: "not valid" }, () => {}), CronParseError);
  s.define({ name: "dup", intervalMs: 100 }, () => {});
  assert.throws(() => s.define({ name: "dup", intervalMs: 100 }, () => {}), RangeError);
});

// ── Scheduler arming + ticking via injected timers ──────────────────

test("Scheduler: runOnStart fires immediately on start", async () => {
  const h = makeTimers();
  let calls = 0;
  const scheduler = new Scheduler({ timers: h.timers });
  scheduler.define({ name: "boot", intervalMs: 10_000, runOnStart: true }, () => {
    calls++;
  });
  scheduler.start();
  assert.equal(h.size(), 1); // armed with delay 0
  assert.equal(h.pending()[0]!.delay, 0);
  h.fireAll();
  await flush();
  assert.equal(calls, 1);
  // After the immediate run it re-arms for the interval.
  assert.equal(h.pending()[0]!.delay, 10_000);
});

test("Scheduler: a cron task arms a timer at the correct delay", () => {
  const h = makeTimers();
  const nowMs = Date.parse("2026-01-01T00:00:30Z");
  const scheduler = new Scheduler({ timers: h.timers, now: () => nowMs });
  scheduler.define({ name: "c", cron: "*/5 * * * *" }, () => {});
  scheduler.start();
  // Next */5 minute after 00:00:30 is 00:05:00 → 270000ms away.
  assert.equal(h.pending()[0]!.delay, 270_000);
  assert.equal(scheduler.getState("c")!.nextRunAt, nowMs + 270_000);
});

test("Scheduler: nextRunAt stays on the cron boundary when the clock advances between reads", () => {
  // Regression: #arm used to read the clock twice — once inside #nextDelay
  // and again to anchor nextRunAt — so a millisecond slipping between the
  // reads pushed nextRunAt (and the tick's scheduledFor) off the boundary
  // by a per-process delta, which broke cronEnqueue payload dedup across
  // replicas. The arm must anchor delay and nextRunAt from one read.
  const h = makeTimers();
  let nowMs = Date.parse("2026-01-01T00:00:30Z");
  const scheduler = new Scheduler({ timers: h.timers, now: () => (nowMs += 1) });
  scheduler.define({ name: "c", cron: "*/5 * * * *" }, () => {});
  scheduler.start();
  // Exactly 00:05:00.000 — not 00:05:00.001 or .002.
  assert.equal(scheduler.getState("c")!.nextRunAt, Date.parse("2026-01-01T00:05:00Z"));
});

test("Scheduler: a tick during an in-flight run is skipped", async () => {
  const h = makeTimers();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let calls = 0;
  const scheduler = new Scheduler({ timers: h.timers });
  scheduler.define({ name: "s", intervalMs: 100, runOnStart: true }, () => {
    calls++;
    return gate;
  });
  scheduler.start();
  h.fireAll(); // fire the runOnStart timer → run starts, blocks on gate
  await flush();
  assert.equal(scheduler.getState("s")!.running, true);
  // Fire the re-armed interval timer while the first run is still blocked.
  h.fireAll();
  await flush();
  assert.equal(scheduler.getState("s")!.skipped, 1);
  assert.equal(calls, 1);
  release();
  await flush();
});

// ── Scheduler graceful stop ─────────────────────────────────────────

test("Scheduler.stop: clears timers and marks not running", async () => {
  const h = makeTimers();
  const scheduler = new Scheduler({ timers: h.timers });
  scheduler.define({ name: "a", intervalMs: 1000 }, () => {});
  scheduler.start();
  assert.equal(scheduler.running, true);
  assert.ok(h.size() >= 1);
  await scheduler.stop();
  assert.equal(scheduler.running, false);
  assert.equal(scheduler.getState("a")!.nextRunAt, undefined);
});

test("Scheduler.stop: aborts in-flight runs after the grace period", async () => {
  const h = makeTimers();
  let aborted = false;
  const scheduler = new Scheduler({ timers: h.timers });
  scheduler.define({ name: "stuck", intervalMs: 1000, runOnStart: true }, ({ signal }) => {
    signal.addEventListener("abort", () => {
      aborted = true;
    });
    return new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
  });
  scheduler.start();
  h.fireAll(); // start the run
  await flush();
  assert.equal(scheduler.getState("stuck")!.running, true);

  const stopPromise = scheduler.stop(5_000);
  await flush();
  // Fire the grace-period timer → scheduler aborts the in-flight run.
  h.fireAll();
  await stopPromise;
  assert.equal(aborted, true);
  assert.equal(scheduler.running, false);
});

test("Scheduler.stop: is a no-op when never started", async () => {
  const scheduler = new Scheduler();
  await scheduler.stop();
  assert.equal(scheduler.running, false);
});

// ── App integration ─────────────────────────────────────────────────

test("app.cron: registers a task, exposes the scheduler, drains on close", async () => {
  const { createApp } = await import("../src/index.js");
  const app = createApp();
  let calls = 0;
  const ret = app.cron({ name: "tick", intervalMs: 60_000 }, () => {
    calls++;
  });
  assert.equal(ret, app); // chainable
  assert.ok(app.scheduledTasks);
  assert.equal(app.scheduledTasks!.size, 1);
  assert.equal(app.scheduledTasks!.running, true);

  // Deterministically trigger one run without waiting on the interval.
  await app.scheduledTasks!.runNow("tick");
  assert.equal(calls, 1);

  await app.close();
  assert.equal(app.scheduledTasks!.running, false);
});

test("app.cron: a second call reuses the same scheduler", async () => {
  const { createApp } = await import("../src/index.js");
  const app = createApp();
  app.cron({ name: "a", intervalMs: 60_000 }, () => {});
  const first = app.scheduledTasks;
  app.cron({ name: "b", cron: "0 * * * *" }, () => {});
  assert.equal(app.scheduledTasks, first);
  assert.equal(app.scheduledTasks!.size, 2);
  await app.close();
});
