/**
 * Scheduler / cron demo — DaloyJS in-process task scheduler.
 *
 * Exercises the real interfaces end to end:
 *   - app.cron({ intervalMs, runOnStart }) fixed-rate task
 *   - app.cron({ cron }) 5-field cron task
 *   - app.scheduledTasks.runNow() / getState() / list()
 *   - parseCron() / nextCronRun() standalone helpers
 *   - graceful drain on app.close()
 *
 * Run:  node --import tsx examples/scheduler-demo.ts
 */

import { App, nextCronRun, parseCron } from "../src/index.ts";

const app = new App({ env: "development" });

let ticks = 0;
app.cron(
  { name: "heartbeat", intervalMs: 1000, runOnStart: true },
  ({ name, runCount }) => {
    ticks++;
    console.log(`[tick] ${name} run #${runCount} (total ${ticks})`);
  },
);

let cronRuns = 0;
app.cron(
  // Fires automatically at the top of every minute (second 0). Whether it
  // auto-fires during this short demo depends on crossing a minute boundary;
  // either way we also trigger it manually via runNow() below.
  { name: "minutely", cron: "* * * * *" },
  ({ name }) => {
    cronRuns++;
    console.log(`[cron] ${name} fired (run #${cronRuns})`);
  },
);

console.log("=== standalone cron helpers ===");
console.log("parseCron('*/15 * * * *') minute set:", [...parseCron("*/15 * * * *").minute]);
console.log("nextCronRun('@hourly', 2026-06-18T10:30:00Z):", nextCronRun("@hourly", new Date("2026-06-18T10:30:00Z")).toISOString());
console.log("nextCronRun('0 9 * * 1' NY tz):", nextCronRun("0 9 * * 1", new Date("2026-06-18T12:00:00Z"), "America/New_York").toISOString());

console.log("\n=== registered tasks ===");
console.log(app.scheduledTasks?.list());

async function main() {
  // Let the interval task tick a few times.
  await new Promise((r) => setTimeout(r, 3200));

  console.log("\n=== runNow() manual trigger (fires regardless of schedule) ===");
  await app.scheduledTasks?.runNow("minutely");

  console.log("\n=== getState('heartbeat') ===");
  console.log(app.scheduledTasks?.getState("heartbeat"));

  console.log("\n=== graceful drain via app.close() ===");
  await app.close();
  console.log(`closed cleanly — heartbeat ticked ${ticks}x, minutely fired ${cronRuns}x (auto + runNow)`);
  process.exit(0);
}

void main();
