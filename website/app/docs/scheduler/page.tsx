import { CodeBlock } from "../../../components/code-block";
import { FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Scheduled tasks (in-process cron)",
  description:
    "Run periodic work inside your DaloyJS process with app.cron() and the Scheduler primitive. Cron expressions or fixed intervals, single-flight overlap protection, per-run timeouts, and graceful-shutdown integration with zero runtime dependencies.",
  path: "/docs/scheduler",
  keywords: [
    "in-process cron",
    "scheduled tasks",
    "cron expression",
    "DaloyJS scheduler",
    "app.cron",
    "single-flight",
    "graceful shutdown",
    "periodic jobs",
    "interval scheduler",
    "timezone cron",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Scheduled tasks (in-process cron)</h1>
      <p>
        DaloyJS ships a <strong>queue-agnostic schedule primitive</strong>
        {": "}run periodic work inside <em>this</em> process on a fixed
        interval or a cron expression. It is the in-process counterpart to an
        external job queue. Reach for it for cache sweeps, token refresh,
        reconciliation, and other housekeeping, not for distributed fan-out. It
        has zero runtime dependencies and three properties a production
        scheduler needs:
      </p>
      <ul>
        <li>
          <strong>Flexible schedules</strong>
          {": "}fixed intervals (<code>intervalMs</code>) or 5-field cron
          expressions (<code>cron</code>
          {", "}with <code>@hourly</code>/<code>@daily</code>/… aliases and an
          optional IANA <code>timeZone</code>).
        </li>
        <li>
          <strong>Single-flight</strong>
          {": "}a task never overlaps itself. If a tick fires while the
          previous run is still in progress, the tick is skipped (and counted),
          so a slow task can never pile up unbounded concurrent runs.
        </li>
        <li>
          <strong>Graceful shutdown</strong>
          {": "}<code>app.cron()</code> ties the scheduler to the app
          lifecycle: on shutdown it stops arming new runs, awaits in-flight
          runs, and aborts their <code>AbortSignal</code> if they outlast the
          grace period. Timers are <code>unref</code>&apos;d, so a scheduler
          never keeps an idle process alive on its own.
        </li>
      </ul>

      <FlowDiagram
        title="One tick"
        numbered
        steps={[
          {
            label: "Tick fires",
            detail: "cron expr or intervalMs is due",
            eyebrow: "schedule",
          },
          {
            label: "Single-flight check",
            detail: "already running? skip + count getState().skipped",
            tone: "accent",
          },
          {
            label: "Run handler",
            detail: "({ signal }) with optional timeoutMs budget",
          },
          {
            label: "Completed",
            detail: "runs++, lastDurationMs recorded",
            tone: "success",
          },
          {
            label: "Threw / timed out",
            detail: "failures++, onError(err, { timedOut })",
            tone: "danger",
          },
        ]}
        caption="Each tick is armed fixed-rate before the run starts. If the previous run is still in flight the overlapping tick is skipped, not started concurrently, so a slow task degrades to back-to-back runs instead of piling up."
      />

      <h2 id="quick-start-with-app-cron">
        Quick start with <code>app.cron()</code>
      </h2>
      <p>
        The easiest entry point is <code>app.cron()</code>
        {". "}The first call lazily creates an app-managed{" "}
        <code>Scheduler</code>
        {", "}starts it, and registers the shutdown drain for you.
      </p>
      <CodeBlock
        language="ts"
        code={`import { createApp } from "@daloyjs/core";

const app = createApp();

// Every hour, on the hour.
app.cron({ name: "purge-sessions", cron: "0 * * * *" }, async ({ signal }) => {
  await purgeExpiredSessions({ signal });
});

// Every 30 seconds, starting immediately.
app.cron(
  { name: "heartbeat", intervalMs: 30_000, runOnStart: true },
  () => publishHeartbeat(),
);`}
      />
      <p>
        Inspect or manually trigger tasks through{" "}
        <code>app.scheduledTasks</code> (the underlying <code>Scheduler</code>):
      </p>
      <CodeBlock
        language="ts"
        code={`app.scheduledTasks?.list();              // execution stats for every task
app.scheduledTasks?.getState("heartbeat"); // one task's snapshot
await app.scheduledTasks?.runNow("purge-sessions"); // out-of-band run`}
      />

      <h2 id="cron-expressions">Cron expressions</h2>
      <p>
        The <code>cron</code> field accepts a standard 5-field expression (<code>minute hour day-of-month month day-of-week</code>) with wildcards,
        lists (<code>1,15,30</code>), ranges (<code>1-5</code>), steps (<code>*/5</code>), and case-insensitive month/day names. Day-of-week
        accepts both <code>0</code> and <code>7</code> for Sunday. The named
        aliases <code>@yearly</code>
        {", "}<code>@monthly</code>
        {", "}
        <code>@weekly</code>
        {", "}<code>@daily</code>
        {", "}and <code>@hourly</code> are also supported.
      </p>
      <CodeBlock
        language="ts"
        code={`app.cron({ name: "nightly", cron: "0 2 * * *" }, run);          // 02:00 daily
app.cron({ name: "weekday-9am", cron: "0 9 * * 1-5" }, run);    // 09:00 Mon–Fri
app.cron({ name: "quarter-hour", cron: "*/15 * * * *" }, run);  // every 15 min
app.cron({ name: "first-of-month", cron: "@monthly" }, run);    // 00:00 on the 1st`}
      />
      <p>
        Cron expressions evaluate in UTC by default. Pass an IANA{" "}
        <code>timeZone</code> to schedule against a wall clock:
      </p>
      <CodeBlock
        language="ts"
        code={`app.cron(
  { name: "ny-open", cron: "30 9 * * 1-5", timeZone: "America/New_York" },
  run,
);`}
      />
      <p>
        Parsing is purely arithmetic (no backtracking regular expressions), and
        a malformed or unsatisfiable expression (for example{" "}
        <code>0 0 30 2 *</code>
        {", "}the 30th of February) throws a <code>CronParseError</code> at
        registration time, not silently at runtime.
      </p>

      <h2 id="single-flight-and-overruns">Single-flight &amp; overruns</h2>
      <p>
        Schedules are <strong>fixed-rate</strong>
        {": "}the next tick is armed before the current run starts. If a run
        outlasts its interval, the overlapping tick is <em>skipped</em> rather
        than started concurrently, and the skip is counted in{" "}
        <code>getState(name).skipped</code>
        {". "}This guarantees at most one concurrent run per task: a slow task
        degrades to &ldquo;runs back-to-back&rdquo; instead of fanning out.
      </p>
      <CodeBlock
        language="ts"
        code={`const state = app.scheduledTasks!.getState("purge-sessions")!;
state.runs;            // total completed runs
state.failures;        // runs that threw or timed out
state.skipped;         // ticks skipped due to overrun
state.running;         // is a run in progress right now?
state.lastDurationMs;  // wall-clock duration of the last run
state.nextRunAt;       // epoch ms of the next scheduled run`}
      />

      <h2 id="per-run-timeouts">Per-run timeouts</h2>
      <p>
        Set <code>timeoutMs</code> to bound a run. When it elapses the
        run&apos;s <code>signal</code> is aborted; forward it to your I/O so the
        handler unwinds promptly. A timed-out run is recorded as a failure and
        reported to <code>onError</code> with <code>timedOut: true</code>.
      </p>
      <CodeBlock
        language="ts"
        code={`app.cron(
  {
    name: "sync",
    cron: "*/5 * * * *",
    timeoutMs: 60_000,
    onError: (err, info) => metrics.increment("cron.failed", { task: info.name }),
  },
  async ({ signal }) => {
    await reconcile({ signal });
  },
);`}
      />

      <h2 id="using-the-scheduler-directly">
        Using the <code>Scheduler</code> directly
      </h2>
      <p>
        For lifecycles you manage yourself (workers, scripts, tests), construct
        a <code>Scheduler</code> and drive it directly. It accepts an injectable
        clock and timer primitives, which makes it fully deterministic under
        test.
      </p>
      <CodeBlock
        language="ts"
        code={`import { Scheduler } from "@daloyjs/core";

const scheduler = new Scheduler({ logger });
scheduler.define({ name: "cleanup", intervalMs: 60_000 }, ({ signal }) =>
  sweep({ signal }),
);
scheduler.start();

// On shutdown, wait up to 5s for in-flight runs, then abort:
process.on("SIGTERM", () => scheduler.stop(5_000));`}
      />
      <p>
        The cron utilities are exported standalone too:{" "}
        <code>parseCron(expr)</code> compiles an expression to its field sets,
        and <code>nextCronRun(expr, after?, timeZone?)</code> returns the next
        matching <code>Date</code>.
      </p>

      <h2 id="when-to-reach-for-a-real-queue-instead">
        When to reach for a real queue instead
      </h2>
      <p>
        This scheduler runs in-process: each instance of your app runs its own
        timers. That is exactly what you want for idempotent maintenance, but
        for work that must run <em>exactly once</em> across a
        horizontally-scaled fleet (or that must survive a process restart) use a
        durable queue or a leader-elected external scheduler and have the
        elected instance call <code>runNow()</code>
        {". "}The single-flight guarantee is per-process, not cluster-wide.
      </p>
    </>
  );
}
