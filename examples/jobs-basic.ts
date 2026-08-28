/**
 * Background jobs demo — DaloyJS queue-agnostic job interface.
 *
 * Exercises the real interfaces end to end (topology instance A — local dev /
 * CI: Memory store, worker in the same process):
 *   - MemoryJobStore + createJobQueue
 *   - createJobWorker with an allowlisted handler
 *   - enqueue (one delayed, one immediate) + idempotency-key dedupe
 *   - worker.runOnce() deterministic drain
 *   - retries with backoff after a transient failure
 *   - graceful stop()
 *
 * Run:  node --import tsx examples/jobs-basic.ts
 */

import {
  computeBackoffMs,
  createJobQueue,
  createJobWorker,
  jobIdempotencyKey,
  MemoryJobStore,
} from "../src/index.ts";

const store = new MemoryJobStore();
const queue = createJobQueue({ store, backoff: { random: () => 1 } });

const consoleLog = {
  debug: () => {},
  info: (obj: object | string, msg?: string) =>
    console.log(`[worker] ${msg ?? (typeof obj === "string" ? obj : JSON.stringify(obj))}`),
  warn: (obj: object | string, msg?: string) =>
    console.log(`[worker:warn] ${msg ?? (typeof obj === "string" ? obj : JSON.stringify(obj))}`),
  error: (obj: object | string, msg?: string) =>
    console.log(`[worker:error] ${msg ?? (typeof obj === "string" ? obj : JSON.stringify(obj))}`),
};

let smtpDown = true; // first attempt fails, the retry succeeds
const worker = createJobWorker({
  queue,
  logger: consoleLog,
  handlers: {
    "email.welcome": async ({ job, log }) => {
      const { to } = job.payload as { to: string };
      log.info({ to }, `welcome email sent to ${to}`);
      return { providerId: `msg_${job.id.slice(0, 8)}` };
    },
    "email.retry": async ({ job, attempt, log }) => {
      const { to } = job.payload as { to: string };
      if (smtpDown) {
        smtpDown = false;
        throw new Error("SMTP 421 try again later");
      }
      log.info({ to, attempt }, `retry email sent to ${to} on attempt ${attempt}`);
      return { providerId: `msg_${job.id.slice(0, 8)}` };
    },
  },
  onDead: (job, error) => console.log(`[dead] ${job.name} (${job.id}): ${error}`),
});

async function main() {
  console.log("=== enqueue two jobs (one delayed 0ms, one idempotent) ===");
  const welcome = await queue.enqueue({
    name: "email.welcome",
    payload: { to: "ada@example.com" },
    idempotencyKey: jobIdempotencyKey({ name: "email.welcome", key: "user_1" }),
  });
  console.log(`enqueued ${welcome.job.id} (duplicate: ${welcome.duplicate})`);

  // Same key + same payload collapses to the existing job.
  const again = await queue.enqueue({
    name: "email.welcome",
    payload: { to: "ada@example.com" },
    idempotencyKey: jobIdempotencyKey({ name: "email.welcome", key: "user_1" }),
  });
  console.log(`re-enqueue returned ${again.job.id} (duplicate: ${again.duplicate})`);

  const retry = await queue.enqueue({
    name: "email.retry",
    payload: { to: "grace@example.com" },
    delayMs: 0,
  });
  console.log(`enqueued ${retry.job.id} (will fail once, then retry)`);

  console.log("\n=== runOnce() drain ===");
  await worker.runOnce(); // welcome email completes
  await worker.runOnce(); // retry job fails -> delayed by backoff
  console.log(
    `after first failure: backoff = ${computeBackoffMs(1, 200, 60_000, () => 1)}ms, ` +
      `status = ${(await queue.get(retry.job.id))?.status}`
  );
  // Wait out the real-time backoff window, then the retry succeeds.
  await new Promise((r) => setTimeout(r, 250));
  await worker.runOnce(); // retry job succeeds on attempt 2

  console.log("\n=== store dump ===");
  for (const job of store.dump()) {
    console.log(
      `${job.name} [${job.status}] attempts=${job.attempts} result=${JSON.stringify(job.result)}`
    );
  }

  await worker.stop();
}

await main();
