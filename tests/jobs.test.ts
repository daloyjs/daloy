import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeBackoffMs,
  createJobQueue,
  createJobWorker,
  JobConfigError,
  JobFatalError,
  JobIdempotencyConflictError,
  JobTimeoutError,
  jobIdempotencyKey,
  MemoryJobStore,
  type Job,
  type JobHandler,
  type TimerFns,
} from "../src/index.js";

// ── deterministic clock + timer harness ─────────────────────────────

let now = 1_000_000;
const nowFn = (): number => now;

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
// injected worker timers, so awaited handler promises settle.
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function makeStore(opts: { capacity?: number; retentionMs?: number; deadRetentionMs?: number } = {}) {
  return new MemoryJobStore({ now: nowFn, ...opts });
}

function makeQueue(store: MemoryJobStore, extra: Record<string, unknown> = {}) {
  return createJobQueue({
    store,
    now: nowFn,
    backoff: { baseDelayMs: 200, maxDelayMs: 60_000, random: () => 1 },
    ...extra,
  });
}

// ── enqueue / get ───────────────────────────────────────────────────

test("jobs: enqueue + get round-trips the record", async () => {
  const store = makeStore();
  const queue = makeQueue(store);
  const { job, duplicate } = await queue.enqueue({
    name: "email.welcome",
    payload: { userId: "u1", tags: ["a", 1, true, null] },
    tenant: "acme",
  });
  assert.equal(duplicate, false);
  assert.equal(job.status, "queued");
  assert.equal(job.attempts, 0);
  assert.equal(job.queue, "default");
  assert.equal(job.tenant, "acme");
  assert.equal(job.priority, 0);
  assert.equal(job.maxAttempts, 5);
  assert.equal(job.timeoutMs, 30_000);
  assert.equal(job.leaseMs, 30_000);
  assert.equal(job.result, null);

  const fetched = await queue.get(job.id);
  assert.ok(fetched);
  assert.deepEqual(fetched.payload, { userId: "u1", tags: ["a", 1, true, null] });
  assert.equal(fetched.id, job.id);
  // Snapshots are deep copies: mutating one must not touch the store.
  (fetched.payload as { userId: string }).userId = "hacked";
  const again = await queue.get(job.id);
  assert.equal((again!.payload as { userId: string }).userId, "u1");
});

test("jobs: enqueue rejects an invalid name", async () => {
  const queue = makeQueue(makeStore());
  for (const bad of ["../../etc", "", "has space", "1digit", "-dash", "x".repeat(200)]) {
    await assert.rejects(() => queue.enqueue({ name: bad, payload: {} }), (err: unknown) => {
      assert.ok(err instanceof JobConfigError);
      assert.equal(err.code, "invalid_name");
      return true;
    });
  }
});

test("jobs: enqueue rejects an invalid queue name", async () => {
  const queue = makeQueue(makeStore());
  await assert.rejects(
    () => queue.enqueue({ name: "ok.name", payload: {}, queue: "bad queue!" }),
    (err: unknown) => err instanceof JobConfigError && err.code === "invalid_name"
  );
});

test("jobs: enqueue rejects a polluted payload", async () => {
  const queue = makeQueue(makeStore());
  const polluted = JSON.parse('{"__proto__": {"admin": true}}') as Record<string, unknown>;
  await assert.rejects(
    () => queue.enqueue({ name: "a.b", payload: polluted }),
    (err: unknown) => {
      assert.ok(err instanceof JobConfigError);
      assert.equal(err.code, "invalid_payload");
      return true;
    }
  );
  // Nested pollution is rejected too.
  const nested = { safe: JSON.parse('{"constructor": {"x": 1}}') as unknown };
  await assert.rejects(
    () => queue.enqueue({ name: "a.b", payload: nested }),
    (err: unknown) => err instanceof JobConfigError && err.code === "invalid_payload"
  );
  // And the store never saw the payload.
  assert.equal(storeJobs(queue).length, 0);
});

test("jobs: enqueue rejects non-JSON payloads", async () => {
  const queue = makeQueue(makeStore());
  await assert.rejects(
    () => queue.enqueue({ name: "a.b", payload: undefined }),
    (err: unknown) => err instanceof JobConfigError && err.code === "invalid_payload"
  );
  await assert.rejects(
    () => queue.enqueue({ name: "a.b", payload: (() => 1) as unknown }),
    (err: unknown) => err instanceof JobConfigError && err.code === "invalid_payload"
  );
  await assert.rejects(
    () => queue.enqueue({ name: "a.b", payload: 10n as unknown }),
    (err: unknown) => err instanceof JobConfigError && err.code === "invalid_payload"
  );
  await assert.rejects(
    () => queue.enqueue({ name: "a.b", payload: new Uint8Array([1, 2]) as unknown }),
    (err: unknown) => err instanceof JobConfigError && err.code === "invalid_payload"
  );
  await assert.rejects(
    () => queue.enqueue({ name: "a.b", payload: new Date() as unknown }),
    (err: unknown) => err instanceof JobConfigError && err.code === "invalid_payload"
  );
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  await assert.rejects(
    () => queue.enqueue({ name: "a.b", payload: cyclic }),
    (err: unknown) => err instanceof JobConfigError && err.code === "invalid_payload"
  );
});

test("jobs: enqueue rejects oversized payloads", async () => {
  const queue = makeQueue(makeStore(), { payloadMaxBytes: 64 });
  await assert.rejects(
    () => queue.enqueue({ name: "a.b", payload: { blob: "x".repeat(200) } }),
    (err: unknown) => {
      assert.ok(err instanceof JobConfigError);
      assert.equal(err.code, "payload_too_large");
      return true;
    }
  );
});

test("jobs: enqueue validates numeric options", async () => {
  const queue = makeQueue(makeStore());
  await assert.rejects(
    () => queue.enqueue({ name: "a.b", payload: {}, maxAttempts: 0 }),
    (err: unknown) => err instanceof JobConfigError && err.code === "invalid_option"
  );
  await assert.rejects(
    () => queue.enqueue({ name: "a.b", payload: {}, delayMs: -1 }),
    (err: unknown) => err instanceof JobConfigError && err.code === "invalid_option"
  );
  await assert.rejects(
    () => queue.enqueue({ name: "a.b", payload: {}, priority: 1.5 }),
    (err: unknown) => err instanceof JobConfigError && err.code === "invalid_option"
  );
  await assert.rejects(
    () => queue.enqueue({ name: "a.b", payload: {}, leaseMs: 0 }),
    (err: unknown) => err instanceof JobConfigError && err.code === "invalid_option"
  );
});

test("jobs: enqueue rejects a bad tenant id", async () => {
  const queue = makeQueue(makeStore());
  await assert.rejects(
    () => queue.enqueue({ name: "a.b", payload: {}, tenant: "Acme Corp\n" }),
    (err: unknown) => err instanceof JobConfigError && err.code === "invalid_option"
  );
});

test("jobs: createJobQueue requires a store and validates bounds", () => {
  assert.throws(
    () => createJobQueue({} as never),
    (err: unknown) => err instanceof JobConfigError && err.code === "store_required"
  );
  assert.throws(
    () => createJobQueue({ store: makeStore(), payloadMaxBytes: 0 }),
    RangeError
  );
  assert.throws(
    () => createJobQueue({ store: makeStore(), defaultMaxAttempts: 0 }),
    RangeError
  );
  assert.throws(
    () => createJobQueue({ store: makeStore(), defaultQueue: "bad queue" }),
    (err: unknown) => err instanceof JobConfigError && err.code === "invalid_name"
  );
});

function storeJobs(queue: ReturnType<typeof makeQueue>): readonly Job[] {
  return (queue.store as MemoryJobStore).list();
}

// ── delayed jobs ────────────────────────────────────────────────────

test("jobs: delayMs starts delayed; claimable only after runAt", async () => {
  const store = makeStore();
  const queue = makeQueue(store);
  const { job } = await queue.enqueue({ name: "a.b", payload: {}, delayMs: 5_000 });
  assert.equal(job.status, "delayed");
  assert.equal(job.runAt, now + 5_000);

  assert.equal(store.claim("default", "w1", now), null);
  now += 4_999;
  assert.equal(store.claim("default", "w1", now), null);
  now += 1;
  const claimed = store.claim("default", "w1", now);
  assert.ok(claimed);
  assert.equal(claimed.id, job.id);
  assert.equal(claimed.status, "running");
});

test("jobs: runAt accepts a Date and beats delayMs", async () => {
  const queue = makeQueue(makeStore());
  const at = new Date(now + 60_000);
  const { job } = await queue.enqueue({ name: "a.b", payload: {}, runAt: at, delayMs: 1 });
  assert.equal(job.runAt, at.getTime());
  assert.equal(job.status, "delayed");
});

// ── idempotency ─────────────────────────────────────────────────────

test("jobs: idempotency key dedupes the same payload", async () => {
  const store = makeStore();
  const queue = makeQueue(store);
  const first = await queue.enqueue({
    name: "a.b",
    payload: { orderId: "o1" },
    idempotencyKey: "key-1",
  });
  const second = await queue.enqueue({
    name: "a.b",
    payload: { orderId: "o1" },
    idempotencyKey: "key-1",
  });
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.job.id, first.job.id);
  assert.equal(store.size, 1);
});

test("jobs: idempotency key + different payload conflicts", async () => {
  const queue = makeQueue(makeStore());
  const first = await queue.enqueue({
    name: "a.b",
    payload: { orderId: "o1" },
    idempotencyKey: "key-1",
  });
  await assert.rejects(
    () =>
      queue.enqueue({ name: "a.b", payload: { orderId: "o2" }, idempotencyKey: "key-1" }),
    (err: unknown) => {
      assert.ok(err instanceof JobIdempotencyConflictError);
      assert.equal(err.code, "idempotency_conflict");
      assert.equal(err.key, "key-1");
      assert.equal(err.existingJobId, first.job.id);
      return true;
    }
  );
});

test("jobs: idempotency keys are scoped per queue", async () => {
  const store = makeStore();
  const queue = makeQueue(store);
  const a = await queue.enqueue({ name: "a.b", payload: { x: 1 }, idempotencyKey: "k" });
  const b = await queue.enqueue({
    name: "a.b",
    payload: { x: 1 },
    idempotencyKey: "k",
    queue: "mail",
  });
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, false);
  assert.notEqual(a.job.id, b.job.id);
});

test("jobs: concurrent enqueue with the same key creates one job", async () => {
  const store = makeStore();
  const queue = makeQueue(store);
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      queue.enqueue({ name: "a.b", payload: { x: 1 }, idempotencyKey: "race" })
    )
  );
  assert.equal(store.size, 1);
  assert.equal(results.filter((r) => !r.duplicate).length, 1);
  assert.equal(results.filter((r) => r.duplicate).length, 7);
  assert.ok(results.every((r) => r.job.id === results[0]!.job.id));
});

test("jobs: idempotency key rejects whitespace/control characters", async () => {
  const queue = makeQueue(makeStore());
  await assert.rejects(
    () => queue.enqueue({ name: "a.b", payload: {}, idempotencyKey: "bad key\n" }),
    (err: unknown) => err instanceof JobConfigError && err.code === "invalid_option"
  );
});

// ── claim ordering / attempts ───────────────────────────────────────

test("jobs: claim picks highest priority, then earliest runAt, then oldest", async () => {
  const store = makeStore();
  const queue = makeQueue(store);
  const low = await queue.enqueue({ name: "a.b", payload: { tag: "low" }, priority: 1 });
  now += 1; // distinct createdAt so the oldest-first tiebreak is deterministic
  const highOld = await queue.enqueue({ name: "a.b", payload: { tag: "high-old" }, priority: 5 });
  now += 1;
  const highNew = await queue.enqueue({ name: "a.b", payload: { tag: "high-new" }, priority: 5 });

  const first = store.claim("default", "w1", now)!;
  assert.equal(first.id, highOld.job.id);
  const second = store.claim("default", "w1", now)!;
  assert.equal(second.id, highNew.job.id);
  const third = store.claim("default", "w1", now)!;
  assert.equal(third.id, low.job.id);
  assert.equal(store.claim("default", "w1", now), null);
});

test("jobs: claim prefers the earlier runAt within one priority", async () => {
  const store = makeStore();
  const queue = makeQueue(store);
  const later = await queue.enqueue({ name: "a.b", payload: { tag: "later" }, delayMs: 100 });
  const sooner = await queue.enqueue({ name: "a.b", payload: { tag: "sooner" } });
  now += 200; // both runnable now
  const first = store.claim("default", "w1", now)!;
  assert.equal(first.id, sooner.job.id);
  const second = store.claim("default", "w1", now)!;
  assert.equal(second.id, later.job.id);
});

test("jobs: claim increments attempts and sets the lease", async () => {
  const store = makeStore();
  const queue = makeQueue(store);
  const { job } = await queue.enqueue({ name: "a.b", payload: {}, leaseMs: 10_000 });
  const claimed = store.claim("default", "w1", now)!;
  assert.equal(claimed.id, job.id);
  assert.equal(claimed.attempts, 1);
  assert.equal(claimed.lockedBy, "w1");
  assert.equal(claimed.leaseUntil, now + 10_000);
});

test("jobs: claim is per-queue, never cross-queue", async () => {
  const store = makeStore();
  const queue = makeQueue(store);
  await queue.enqueue({ name: "a.b", payload: {}, queue: "mail" });
  assert.equal(store.claim("default", "w1", now), null);
  assert.ok(store.claim("mail", "w1", now));
});

// ── complete / fail / cancel ────────────────────────────────────────

test("jobs: complete is terminal and stores the result", async () => {
  const store = makeStore();
  const queue = makeQueue(store);
  const { job } = await queue.enqueue({ name: "a.b", payload: {} });
  const claimed = store.claim("default", "w1", now)!;
  assert.equal(store.complete(claimed.id, "w1", now, { invoiceId: "in_1" }), true);
  const done = (await queue.get(job.id))!;
  assert.equal(done.status, "completed");
  assert.equal(done.completedAt, now);
  assert.deepEqual(done.result, { invoiceId: "in_1" });
  assert.equal(done.lockedBy, null);
  // Terminal: no further claim, no second complete, no cancel.
  assert.equal(store.claim("default", "w1", now), null);
  assert.equal(store.complete(claimed.id, "w1", now, null), false);
  assert.equal(store.cancel(job.id, now), false);
});

test("jobs: complete with the wrong workerId is refused", async () => {
  const store = makeStore();
  const queue = makeQueue(store);
  await queue.enqueue({ name: "a.b", payload: {} });
  const claimed = store.claim("default", "w1", now)!;
  assert.equal(store.complete(claimed.id, "w2", now, null), false);
  assert.equal(store.complete(claimed.id, "w1", now, null), true);
});

test("jobs: fail retries with backoff, then dead-letters at maxAttempts", async () => {
  const store = makeStore();
  const queue = makeQueue(store);
  const { job } = await queue.enqueue({ name: "a.b", payload: {}, maxAttempts: 2 });

  const first = store.claim("default", "w1", now)!;
  assert.equal(first.attempts, 1);
  const delay = computeBackoffMs(first.attempts, 200, 60_000, () => 1);
  assert.equal(delay, 200);
  assert.equal(
    store.fail(first.id, "w1", "boom", { status: "delayed", runAt: now + delay }, now),
    true
  );
  let current = (await queue.get(job.id))!;
  assert.equal(current.status, "delayed");
  assert.equal(current.runAt, now + 200);
  assert.equal(current.lastError, "boom");

  now += 200;
  const second = store.claim("default", "w1", now)!;
  assert.equal(second.attempts, 2);
  assert.equal(
    store.fail(second.id, "w1", "boom again", { status: "delayed", runAt: now + 400 }, now),
    true
  );
  current = (await queue.get(job.id))!;
  assert.equal(current.status, "dead");
  assert.equal(current.lastError, "boom again");
  assert.equal(store.claim("default", "w1", now), null);
});

test("jobs: cancel moves a queued job to a terminal state", async () => {
  const store = makeStore();
  const queue = makeQueue(store);
  const { job } = await queue.enqueue({ name: "a.b", payload: {} });
  assert.equal(await queue.cancel(job.id), true);
  assert.equal((await queue.get(job.id))!.status, "cancelled");
  assert.equal(store.claim("default", "w1", now), null);
  assert.equal(await queue.cancel(job.id), false); // already terminal
  assert.equal(await queue.cancel("nope"), false); // unknown id
});

// ── leases + heartbeats ─────────────────────────────────────────────

test("jobs: an expired lease returns the job to the next claimer", async () => {
  const store = makeStore();
  const queue = makeQueue(store);
  const { job } = await queue.enqueue({ name: "a.b", payload: {}, leaseMs: 1_000 });
  const first = store.claim("default", "w1", now)!;
  assert.equal(first.attempts, 1);
  // Never completed; the lease lapses and another worker picks the job up.
  now += 1_001;
  const second = store.claim("default", "w2", now);
  assert.ok(second);
  assert.equal(second.id, job.id);
  assert.equal(second.attempts, 2); // the crashed attempt stays spent
  assert.equal(second.lockedBy, "w2");
});

test("jobs: heartbeat extends the lease", async () => {
  const store = makeStore();
  const queue = makeQueue(store);
  const { job } = await queue.enqueue({ name: "a.b", payload: {}, leaseMs: 1_000 });
  const claimed = store.claim("default", "w1", now)!;
  now += 900;
  const extendedUntil = now + 1_000;
  assert.equal(store.heartbeat(job.id, "w1", extendedUntil, now), true);
  now += 500; // past the original lease, inside the extended one
  assert.equal(store.claim("default", "w2", now), null);
  const fetched = (await queue.get(job.id))!;
  assert.equal(fetched.status, "running");
  assert.equal(fetched.leaseUntil, extendedUntil);
});

test("jobs: heartbeat with the wrong workerId is refused", async () => {
  const store = makeStore();
  const queue = makeQueue(store);
  const { job } = await queue.enqueue({ name: "a.b", payload: {} });
  store.claim("default", "w1", now);
  assert.equal(store.heartbeat(job.id, "w2", now + 60_000, now), false);
  // An expired lease cannot be extended either.
  now += 31_000;
  assert.equal(store.heartbeat(job.id, "w1", now + 60_000, now), false);
});

// ── capacity / retention ────────────────────────────────────────────

test("jobs: a full store throws instead of evicting queued work", async () => {
  const store = makeStore({ capacity: 2 });
  const queue = makeQueue(store);
  await queue.enqueue({ name: "a.b", payload: {} });
  await queue.enqueue({ name: "a.b", payload: {} });
  await assert.rejects(
    () => queue.enqueue({ name: "a.b", payload: {} }),
    (err: unknown) => {
      assert.ok(err instanceof JobConfigError);
      assert.equal(err.code, "store_full");
      return true;
    }
  );
});

test("jobs: expired terminal records are swept before capacity throws", async () => {
  const store = makeStore({ capacity: 1, retentionMs: 100 });
  const queue = makeQueue(store);
  const { job } = await queue.enqueue({ name: "a.b", payload: {} });
  store.claim("default", "w1", now);
  store.complete(job.id, "w1", now, null);
  assert.equal(store.size, 1);
  now += 101; // completed record is past retention
  const again = await queue.enqueue({ name: "a.b", payload: {} });
  assert.equal(again.duplicate, false);
  assert.equal(store.size, 1);
  assert.notEqual(again.job.id, job.id);
});

test("jobs: MemoryJobStore validates constructor options", () => {
  assert.throws(() => new MemoryJobStore({ capacity: 0 }), RangeError);
  assert.throws(() => new MemoryJobStore({ retentionMs: -1 }), RangeError);
  assert.throws(() => new MemoryJobStore({ deadRetentionMs: -1 }), RangeError);
});

test("jobs: list filters by queue, status, name, and tenant", async () => {
  const store = makeStore();
  const queue = makeQueue(store);
  await queue.enqueue({ name: "a.one", payload: {}, tenant: "acme" });
  await queue.enqueue({ name: "a.two", payload: {}, queue: "mail", tenant: "globex" });
  assert.equal(store.list({ queue: "mail" }).length, 1);
  assert.equal(store.list({ status: "queued" }).length, 2);
  assert.equal(store.list({ status: ["queued", "running"] }).length, 2);
  assert.equal(store.list({ name: "a.one" }).length, 1);
  assert.equal(store.list({ tenant: "acme" }).length, 1);
  assert.equal(store.list({ tenant: "initech" }).length, 0);
});

// ── computeBackoffMs ────────────────────────────────────────────────

test("jobs: computeBackoffMs doubles to the cap, jitter applied", () => {
  assert.equal(computeBackoffMs(1, 200, 60_000, () => 1), 200);
  assert.equal(computeBackoffMs(2, 200, 60_000, () => 1), 400);
  assert.equal(computeBackoffMs(3, 200, 60_000, () => 1), 800);
  assert.equal(computeBackoffMs(10, 200, 60_000, () => 1), 60_000);
  assert.equal(computeBackoffMs(3, 200, 60_000, () => 0), 0);
  const inRange = computeBackoffMs(3, 200, 60_000, () => 0.5);
  assert.equal(inRange, 400);
});

// ── jobIdempotencyKey ───────────────────────────────────────────────

test("jobs: jobIdempotencyKey composes tenant-scoped and global keys", () => {
  assert.equal(
    jobIdempotencyKey({ tenant: "acme", name: "email.welcome", key: "u1" }),
    "t/acme/email.welcome/u1"
  );
  assert.equal(jobIdempotencyKey({ name: "email.welcome", key: "u1" }), "g/email.welcome/u1");
});

test("jobs: jobIdempotencyKey rejects bad segments", () => {
  assert.throws(
    () => jobIdempotencyKey({ tenant: "Bad Tenant", name: "a.b", key: "u1" }),
    JobConfigError
  );
  assert.throws(
    () => jobIdempotencyKey({ name: "a.b", key: "line\nbreak" }),
    JobConfigError
  );
  assert.throws(() => jobIdempotencyKey({ name: "a.b", key: "up..one" }), JobConfigError);
  assert.throws(() => jobIdempotencyKey({ name: "../bad", key: "u1" }), JobConfigError);
  assert.throws(
    () => jobIdempotencyKey({ name: "a.b", key: "x".repeat(300) }),
    JobConfigError
  );
});

// ── worker: basics ──────────────────────────────────────────────────

function makeWorker(
  queue: ReturnType<typeof makeQueue>,
  handlers: Record<string, JobHandler<any>>,
  extra: Record<string, unknown> = {}
) {
  const harness = makeTimers();
  const worker = createJobWorker({
    queue,
    handlers,
    timers: harness.timers,
    now: nowFn,
    workerId: "w1",
    ...extra,
  });
  return { worker, harness };
}

test("jobs: runOnce executes the handler and completes with a result", async () => {
  const store = makeStore();
  const queue = makeQueue(store);
  const seen: string[] = [];
  const { worker } = makeWorker(queue, {
    "email.welcome": async ({ job, attempt, signal }) => {
      seen.push(`${job.name}:${(job.payload as { to: string }).to}:${attempt}`);
      assert.equal(signal.aborted, false);
      return { sent: true };
    },
  });
  const { job } = await queue.enqueue({ name: "email.welcome", payload: { to: "a@b.c" } });
  assert.equal(await worker.runOnce(), true);
  assert.deepEqual(seen, ["email.welcome:a@b.c:1"]);
  const done = (await queue.get(job.id))!;
  assert.equal(done.status, "completed");
  assert.deepEqual(done.result, { sent: true });
  assert.equal(await worker.runOnce(), false); // nothing left
});

test("jobs: unknown handler dead-letters immediately and calls onDead", async () => {
  const store = makeStore();
  const queue = makeQueue(store);
  const dead: Array<[string, string]> = [];
  const { worker } = makeWorker(
    queue,
    { "other.job": () => undefined },
    { onDead: (job: Job, error: string) => dead.push([job.id, error]) }
  );
  const { job } = await queue.enqueue({ name: "ghost.job", payload: {} });
  assert.equal(await worker.runOnce(), true);
  const done = (await queue.get(job.id))!;
  assert.equal(done.status, "dead");
  assert.equal(done.attempts, 1); // fatal: no budget spent on retries
  assert.match(done.lastError!, /Unknown job handler/);
  assert.equal(dead.length, 1);
  assert.match(dead[0]![1], /Unknown job handler/);
});

test("jobs: a retryable throw reschedules with jittered backoff", async () => {
  const store = makeStore();
  const queue = makeQueue(store);
  const fails: Array<[string, boolean, number | undefined]> = [];
  let calls = 0;
  const { worker } = makeWorker(
    queue,
    {
      "flaky.job": () => {
        calls++;
        throw new Error("smtp 421");
      },
    },
    { onFail: (job: Job, error: string, willRetry: boolean, delayMs?: number) => fails.push([error, willRetry, delayMs]) }
  );
  const { job } = await queue.enqueue({ name: "flaky.job", payload: {}, maxAttempts: 3 });

  assert.equal(await worker.runOnce(), true);
  let current = (await queue.get(job.id))!;
  assert.equal(current.status, "delayed");
  assert.equal(current.runAt, now + 200); // random: () => 1 -> full ceiling
  assert.deepEqual(fails, [["Error: smtp 421", true, 200]]);

  now += 200;
  assert.equal(await worker.runOnce(), true);
  current = (await queue.get(job.id))!;
  assert.equal(current.status, "delayed");
  assert.equal(current.runAt, now + 400);

  now += 400;
  assert.equal(await worker.runOnce(), true);
  current = (await queue.get(job.id))!;
  assert.equal(current.status, "dead");
  assert.equal(calls, 3);
  assert.equal(fails.length, 3);
  assert.deepEqual(fails[2]!.slice(0, 2), ["Error: smtp 421", false]);
});

test("jobs: JobFatalError dead-letters on the first attempt", async () => {
  const store = makeStore();
  const queue = makeQueue(store);
  const dead: string[] = [];
  const { worker } = makeWorker(
    queue,
    {
      "bad.job": () => {
        throw new JobFatalError("permanent: unknown user");
      },
    },
    { onDead: (job: Job) => dead.push(job.id) }
  );
  const { job } = await queue.enqueue({ name: "bad.job", payload: {}, maxAttempts: 5 });
  assert.equal(await worker.runOnce(), true);
  const done = (await queue.get(job.id))!;
  assert.equal(done.status, "dead");
  assert.equal(done.attempts, 1);
  assert.match(done.lastError!, /permanent: unknown user/);
  assert.deepEqual(dead, [job.id]);
});

test("jobs: a timeout aborts the handler and fails retryably", async () => {
  const store = makeStore();
  const queue = makeQueue(store);
  let sawAbort = false;
  const { worker, harness } = makeWorker(queue, {
    "slow.job": ({ signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          sawAbort = true;
          reject(new Error("hung up"));
        });
      }),
  });
  const { job } = await queue.enqueue({ name: "slow.job", payload: {}, timeoutMs: 1_000 });
  const run = worker.runOnce();
  await flush();
  harness.fireAll(); // fire the per-attempt timeout
  await run;
  assert.equal(sawAbort, true);
  const current = (await queue.get(job.id))!;
  assert.equal(current.status, "delayed"); // retryable, not dead
  assert.match(current.lastError!, new RegExp(JobTimeoutError.name));
});

test("jobs: concurrency 2 runs two jobs at once", async () => {
  const store = makeStore();
  const queue = makeQueue(store);
  const started: string[] = [];
  const resolvers: Array<() => void> = [];
  const { worker, harness } = makeWorker(
    queue,
    {
      "parallel.job": ({ job }) => {
        started.push(job.id);
        return new Promise<void>((resolve) => resolvers.push(resolve));
      },
    },
    { concurrency: 2 }
  );
  await queue.enqueue({ name: "parallel.job", payload: {} });
  await queue.enqueue({ name: "parallel.job", payload: {} });
  await queue.enqueue({ name: "parallel.job", payload: {} });

  worker.start();
  harness.fireAll(); // first poll tick
  await flush();
  assert.equal(started.length, 2); // third job waits for a free slot
  assert.equal(worker.getState().inFlight, 2);

  resolvers.forEach((r) => r());
  await flush();
  harness.fireAll(); // next poll tick picks up the third
  await flush();
  assert.equal(started.length, 3);
  resolvers.forEach((r) => r());
  await flush();
  await worker.stop();
  assert.equal(store.list({ status: "completed" }).length, 3);
});

test("jobs: stop() waits for in-flight work to finish", async () => {
  const store = makeStore();
  const queue = makeQueue(store);
  let finish!: () => void;
  const { worker } = makeWorker(queue, {
    "gentle.job": () => new Promise<void>((resolve) => (finish = resolve)),
  });
  const { job } = await queue.enqueue({ name: "gentle.job", payload: {} });
  const run = worker.runOnce();
  await flush();
  const stop = worker.stop(5_000);
  let stopped = false;
  void stop.then(() => (stopped = true));
  await flush();
  assert.equal(stopped, false); // still waiting on the handler
  finish();
  await run;
  await stop;
  assert.equal(stopped, true);
  assert.equal((await queue.get(job.id))!.status, "completed");
});

test("jobs: stop() aborts in-flight work after the grace period", async () => {
  const store = makeStore();
  const queue = makeQueue(store);
  const { worker, harness } = makeWorker(queue, {
    "stuck.job": ({ signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("went away")));
      }),
  });
  const { job } = await queue.enqueue({ name: "stuck.job", payload: {}, timeoutMs: 0 });
  const run = worker.runOnce();
  await flush();
  const stop = worker.stop(1_000);
  await flush();
  harness.fireAll(); // grace deadline elapses -> abort in-flight
  await run;
  await stop;
  const current = (await queue.get(job.id))!;
  // The aborted attempt fails back to the queue for another worker.
  assert.equal(current.status, "delayed");
  assert.equal(current.attempts, 1);
});

test("jobs: duplicate start() throws, and start-after-stop throws", async () => {
  const queue = makeQueue(makeStore());
  const { worker } = makeWorker(queue, { "a.b": () => undefined });
  worker.start();
  assert.throws(
    () => worker.start(),
    (err: unknown) => err instanceof JobConfigError && err.code === "invalid_option"
  );
  await worker.stop();
  assert.throws(
    () => worker.start(),
    (err: unknown) => err instanceof JobConfigError && err.code === "invalid_option"
  );
  // stop() is idempotent.
  await worker.stop();
});

test("jobs: createJobWorker validates its registry and options", () => {
  const queue = makeQueue(makeStore());
  assert.throws(
    () => createJobWorker({ queue, handlers: {} }),
    (err: unknown) => err instanceof JobConfigError && err.code === "unknown_handler"
  );
  assert.throws(
    () => createJobWorker({ queue, handlers: { "bad name": () => undefined } }),
    (err: unknown) => err instanceof JobConfigError && err.code === "invalid_name"
  );
  assert.throws(
    () => createJobWorker({ queue, handlers: { "a.b": "nope" as never } }),
    (err: unknown) => err instanceof JobConfigError && err.code === "invalid_option"
  );
  assert.throws(
    () => createJobWorker({ queue, handlers: { "a.b": () => undefined }, concurrency: 0 }),
    RangeError
  );
  assert.throws(
    () => createJobWorker({ queue, handlers: { "a.b": () => undefined }, concurrency: 1001 }),
    RangeError
  );
});

test("jobs: a handler result that is not plain JSON fails the attempt", async () => {
  const store = makeStore();
  const queue = makeQueue(store);
  const { worker } = makeWorker(queue, {
    "weird.job": () => new Date() as unknown,
  });
  const { job } = await queue.enqueue({ name: "weird.job", payload: {} });
  assert.equal(await worker.runOnce(), true);
  const current = (await queue.get(job.id))!;
  assert.equal(current.status, "delayed");
  assert.match(current.lastError!, /result/);
});

test("jobs: ctx.heartbeat extends the lease while a long job runs", async () => {
  const store = makeStore();
  const queue = makeQueue(store);
  const { worker } = makeWorker(queue, {
    "long.job": async ({ heartbeat }) => {
      now += 900; // long work, still inside the 1s lease
      await heartbeat(); // extends the lease another 1s
      now += 900; // more long work, inside the extended lease
      await heartbeat();
    },
  });
  const { job } = await queue.enqueue({ name: "long.job", payload: {}, leaseMs: 1_000 });
  assert.equal(await worker.runOnce(), true);
  const done = (await queue.get(job.id))!;
  assert.equal(done.status, "completed"); // heartbeats kept the lease alive
});
