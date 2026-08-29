import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  createApp,
  JobConfigError,
  MemoryJobStore,
  type Job,
} from "../src/index.js";

function makeLogger(records: Array<{ level: string; msg: string }>) {
  const logger = {
    level: "trace" as const,
    trace() {},
    debug() {},
    info() {},
    warn(obj: unknown, msg?: string) {
      records.push({ level: "warn", msg: msg ?? String(obj) });
    },
    error(obj: unknown, msg?: string) {
      records.push({ level: "error", msg: msg ?? String(obj) });
    },
    fatal() {},
    child() {
      return logger;
    },
  };
  return logger;
}

// ── configuration guards ────────────────────────────────────────────

test("jobs app: jobs and jobWorker are undefined before useJobs", async () => {
  const app = createApp();
  assert.equal(app.jobs, undefined);
  assert.equal(app.jobWorker, undefined);
  await app.close();
});

test("jobs app: useJobs twice throws", async () => {
  const app = createApp();
  app.useJobs({ store: new MemoryJobStore() });
  assert.throws(
    () => app.useJobs({ store: new MemoryJobStore() }),
    (err: unknown) => err instanceof JobConfigError && err.code === "invalid_option"
  );
  await app.close();
});

test("jobs app: cronEnqueue without useJobs throws at registration", async () => {
  const app = createApp();
  assert.throws(
    () => app.cronEnqueue({ name: "tick", intervalMs: 60_000 }, { name: "a.b" }),
    (err: unknown) => {
      assert.ok(err instanceof JobConfigError);
      assert.equal(err.code, "store_required");
      return true;
    }
  );
  await app.close();
});

test("jobs app: startWorker without handlers throws", async () => {
  const app = createApp();
  assert.throws(
    () => app.useJobs({ store: new MemoryJobStore(), startWorker: true }),
    (err: unknown) => err instanceof JobConfigError && err.code === "invalid_option"
  );
  assert.throws(
    () => app.useJobs({ store: new MemoryJobStore(), startWorker: true, handlers: {} }),
    (err: unknown) => err instanceof JobConfigError && err.code === "invalid_option"
  );
  await app.close();
});

// ── worker lifecycle ────────────────────────────────────────────────

test("jobs app: useJobs starts the worker and close() stops it", async () => {
  const app = createApp();
  const done: string[] = [];
  app.useJobs({
    store: new MemoryJobStore(),
    handlers: {
      "email.welcome": async ({ job }) => {
        done.push(job.id);
      },
    },
    startWorker: true,
  });
  assert.ok(app.jobs);
  assert.ok(app.jobWorker);
  assert.equal(app.jobWorker!.getState().running, true);

  await app.jobs!.enqueue({ name: "email.welcome", payload: { to: "a@b.c" } });
  assert.equal(await app.jobWorker!.runOnce(), true);
  assert.equal(done.length, 1);

  await app.close();
  assert.equal(app.jobWorker!.getState().running, false);
});

test("jobs app: close() drains an in-flight job before settling", async () => {
  const app = createApp();
  let finish!: () => void;
  app.useJobs({
    store: new MemoryJobStore(),
    handlers: {
      "slow.job": () => new Promise<void>((resolve) => (finish = resolve)),
    },
    startWorker: true,
  });
  const { job } = await app.jobs!.enqueue({ name: "slow.job", payload: {} });
  const run = app.jobWorker!.runOnce();
  // Let the claim + launch land so the handler is in flight before close().
  await new Promise((r) => setTimeout(r, 0));
  const close = app.close();
  let closed = false;
  void close.then(() => (closed = true));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(closed, false);
  finish();
  await run;
  await close;
  const stored = await app.jobs!.get(job.id);
  assert.equal(stored!.status, "completed");
});

// ── cronEnqueue ─────────────────────────────────────────────────────

test("jobs app: cronEnqueue enqueues on tick and collapses duplicate slots", async () => {
  const app = createApp();
  const store = new MemoryJobStore();
  app.useJobs({ store });
  const ret = app.cronEnqueue(
    { name: "nightly", intervalMs: 3_600_000 },
    { name: "ops.reconcile" }
  );
  assert.equal(ret, app); // chainable
  assert.ok(app.scheduledTasks);

  assert.equal(await app.scheduledTasks!.runNow("nightly"), true);
  assert.equal(store.size, 1);
  const first = store.list()[0]!;
  assert.equal(first.name, "ops.reconcile");
  assert.equal(first.status, "queued");
  assert.match(first.idempotencyKey!, /^cron:nightly:\d+$/);
  // The default payload carries the tick's scheduled time.
  assert.ok(typeof (first.payload as { scheduledFor?: string }).scheduledFor === "string");

  // A second tick in the same slot (two replicas firing together) dedupes.
  assert.equal(await app.scheduledTasks!.runNow("nightly"), true);
  assert.equal(store.size, 1);
  await app.close();
});

test("jobs app: cronEnqueue forwards an explicit payload and queue", async () => {
  const app = createApp();
  const store = new MemoryJobStore();
  app.useJobs({ store });
  app.cronEnqueue(
    { name: "hourly-mail", intervalMs: 3_600_000 },
    { name: "mail.digest", payload: { kind: "hourly" }, queue: "mail" }
  );
  await app.scheduledTasks!.runNow("hourly-mail");
  const job = store.list({ queue: "mail" })[0]!;
  assert.deepEqual(job.payload, { kind: "hourly" });
  await app.close();
});

test("jobs app: cronEnqueue default payload dedupes replicas ticking milliseconds apart", async () => {
  // Regression: the default payload used to embed the raw tick time, so two
  // replicas ticking the same slot a millisecond or two apart produced
  // different payloads, and the second enqueue threw
  // JobIdempotencyConflictError (an error-level scheduled-task failure)
  // instead of returning duplicate: true. The default is now derived from
  // the idempotency slot, so every replica enqueues an identical payload.
  const store = new MemoryJobStore();
  const appA = createApp();
  const appB = createApp();
  appA.useJobs({ store });
  appB.useJobs({ store });
  appA.cronEnqueue({ name: "nightly", intervalMs: 3_600_000 }, { name: "ops.reconcile" });
  appB.cronEnqueue({ name: "nightly", intervalMs: 3_600_000 }, { name: "ops.reconcile" });

  const realNow = Date.now;
  const slotStart = Math.floor(realNow() / 3_600_000) * 3_600_000;
  try {
    Date.now = () => slotStart + 1; // replica A ticks 1ms into the slot
    assert.equal(await appA.scheduledTasks!.runNow("nightly"), true);
    Date.now = () => slotStart + 2; // replica B ticks 2ms into the same slot
    assert.equal(await appB.scheduledTasks!.runNow("nightly"), true);
  } finally {
    Date.now = realNow;
  }

  assert.equal(store.size, 1); // deduped — no conflict, no second job
  assert.deepEqual(store.list()[0]!.payload, {
    scheduledFor: new Date(slotStart).toISOString(),
  });
  assert.equal(appA.scheduledTasks!.getState("nightly")!.failures, 0);
  assert.equal(appB.scheduledTasks!.getState("nightly")!.failures, 0);
  await appA.close();
  await appB.close();
});

// ── production posture ──────────────────────────────────────────────

test("jobs app: MemoryJobStore in production logs a warning", async () => {
  const records: Array<{ level: string; msg: string }> = [];
  const app = createApp({ env: "production", logger: makeLogger(records) as never });
  app.useJobs({ store: new MemoryJobStore() });
  assert.ok(
    records.some(
      (r) => r.level === "warn" && r.msg.includes("MemoryJobStore is not durable")
    )
  );
  await app.close();
});

test("jobs app: strictProduction refuses a MemoryJobStore", async () => {
  const app = createApp({ env: "production" });
  assert.throws(
    () => app.useJobs({ store: new MemoryJobStore(), strictProduction: true }),
    (err: unknown) => {
      assert.ok(err instanceof JobConfigError);
      assert.match(err.message, /MemoryJobStore is not durable/);
      return true;
    }
  );
  await app.close();
});

// ── end-to-end through a route ──────────────────────────────────────

test("jobs app: a route handler enqueues and a worker runs the job", async () => {
  const app = createApp();
  const store = new MemoryJobStore();
  const sent: string[] = [];
  app.useJobs({
    store,
    handlers: {
      "email.welcome": async ({ job }) => {
        sent.push((job.payload as { userId: string }).userId);
      },
    },
    startWorker: true,
  });
  app.route({
    method: "POST",
    path: "/users",
    request: { body: z.object({ id: z.string() }).strict() },
    responses: { 201: { description: "created", body: z.object({ id: z.string() }) } },
    handler: async (ctx) => {
      await app.jobs!.enqueue({
        name: "email.welcome",
        payload: { userId: ctx.body.id },
        idempotencyKey: `signup:${ctx.body.id}`,
      });
      return { status: 201 as const, body: { id: ctx.body.id } };
    },
  });

  const res = await app.request("http://x/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "u42" }),
  });
  assert.equal(res.status, 201);
  // A client retry with the same key never double-enqueues.
  const retry = await app.request("http://x/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "u42" }),
  });
  assert.equal(retry.status, 201);
  assert.equal(store.size, 1);

  assert.equal(await app.jobWorker!.runOnce(), true);
  assert.deepEqual(sent, ["u42"]);
  const stored: Job = (await app.jobs!.get(store.list()[0]!.id))!;
  assert.equal(stored.status, "completed");
  await app.close();
});
