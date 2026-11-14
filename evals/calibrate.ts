/**
 * `pnpm eval:calibrate` — prove the graders measure what they claim before
 * trusting any agent score.
 *
 * For every task:
 * - the `reference` solution must pass every grader,
 * - doing nothing (`noop`) must fail at least one grader (the task is not
 *   already solved), and
 * - each `unsafe` variant must fail every grader in its `expectFail` list.
 *
 * Exits 1 on any miscalibration. Needs `pnpm build` (the workspace copies
 * `dist/`) but no network and no agent.
 *
 * Usage: `pnpm eval:calibrate [--task <id,...>] [--keep]`
 */

import { resolveAgent } from "./lib/agents.ts";
import { runTrial } from "./lib/runner.ts";
import { TASKS } from "./tasks/index.ts";
import type { EvalTask, TrialResult } from "./lib/types.ts";

/** One calibration check outcome. */
interface Check {
  readonly task: string;
  readonly agent: string;
  readonly ok: boolean;
  readonly message: string;
}

function failing(t: TrialResult): string[] {
  return t.grades.filter((g) => !g.pass).map((g) => g.id);
}

function explain(t: TrialResult): string {
  return t.grades
    .filter((g) => !g.pass)
    .map(
      (g) =>
        `    ✗ ${g.id}\n${g.details.map((d) => `      ${d.replaceAll("\n", "\n      ")}`).join("\n")}`,
    )
    .join("\n");
}

async function calibrateTask(task: EvalTask, keep: boolean): Promise<Check[]> {
  const opts = { ablation: "full" as const, trial: 1, timeoutMs: 60_000, keep };
  const checks: Check[] = [];

  const ref = await runTrial(task, resolveAgent("reference"), opts);
  checks.push({
    task: task.id,
    agent: "reference",
    ok: ref.pass,
    message: ref.pass
      ? "passes every grader"
      : `must pass every grader but failed:\n${explain(ref)}`,
  });

  const noop = await runTrial(task, resolveAgent("noop"), opts);
  checks.push({
    task: task.id,
    agent: "noop",
    ok: !noop.pass,
    message: noop.pass
      ? "doing nothing passes every grader: the task does not test anything"
      : `fails as expected (${failing(noop).join(", ")})`,
  });

  for (const variant of task.unsafe) {
    const name = `unsafe:${variant.id}`;
    const r = await runTrial(task, resolveAgent(name), opts);
    const failed = failing(r);
    const missed = variant.expectFail.filter((id) => !failed.includes(id));
    checks.push({
      task: task.id,
      agent: name,
      ok: missed.length === 0,
      message:
        missed.length === 0
          ? `caught by ${variant.expectFail.join(", ")}`
          : `"${variant.description}" was NOT caught by: ${missed.join(", ")} (failed: ${failed.join(", ") || "none"})`,
    });
  }
  return checks;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const keep = argv.includes("--keep");
  const taskArg = argv.indexOf("--task");
  const ids =
    taskArg !== -1 ? (argv[taskArg + 1] ?? "").split(",").filter(Boolean) : [];
  for (const id of ids)
    if (!TASKS.some((t) => t.id === id))
      throw new Error(`unknown task "${id}"`);
  const tasks =
    ids.length > 0 ? TASKS.filter((t) => ids.includes(t.id)) : TASKS;

  let bad = 0;
  for (const task of tasks) {
    process.stdout.write(`\n${task.id} (${task.suite})\n`);
    for (const c of await calibrateTask(task, keep)) {
      if (!c.ok) bad++;
      process.stdout.write(`  ${c.ok ? "✓" : "✗"} ${c.agent}: ${c.message}\n`);
    }
  }
  process.stdout.write(
    `\n${bad === 0 ? "Calibration OK" : `Calibration FAILED (${bad} check(s))`}\n`,
  );
  if (bad > 0) process.exitCode = 1;
}

await main();
