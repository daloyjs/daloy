/**
 * `pnpm eval` — run AI coding agents against the DaloyJS eval tasks.
 *
 * Every trial scaffolds a fresh project with the local `create-daloy`, runs
 * the agent headlessly, then grades the result with deterministic checks
 * (typecheck, visible tests, hidden tests, static guardrail diff). Results
 * are written as JSON plus a Markdown summary (also appended to
 * `$GITHUB_STEP_SUMMARY` when set).
 *
 * Live agents get broad tool permissions inside the workspace, so they are
 * refused unless `--sandbox-ack` confirms the run happens in an isolated
 * container or VM. See `evals/README.md`.
 *
 * Examples:
 *   pnpm eval --agent reference
 *   pnpm eval --agent codex --sandbox-ack --suite guardrail --trials 5
 *   pnpm eval --agent claude --sandbox-ack --ablation full,bare --trials 3
 */

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { resolveAgent } from "./lib/agents.ts";
import { parseRunArgs, selectTasks, USAGE } from "./lib/cli.ts";
import { renderMarkdown, summarize } from "./lib/report.ts";
import { runTrial } from "./lib/runner.ts";
import { REPO_ROOT } from "./lib/workspace.ts";
import { TASKS } from "./tasks/index.ts";
import type { TrialResult } from "./lib/types.ts";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }
  const opts = parseRunArgs(argv);
  const tasks = selectTasks(TASKS, opts.suites, opts.tasks);

  if (opts.list) {
    for (const t of tasks)
      process.stdout.write(
        `${t.id.padEnd(32)} ${t.suite.padEnd(10)} ${t.title}\n`,
      );
    return;
  }

  const agent = resolveAgent(opts.agent);
  if (agent.live && !opts.sandboxAck) {
    throw new Error(
      `"${agent.name}" runs a real agent with broad tool permissions. Run it only inside an isolated ` +
        "container or VM with no secrets except the agent's own API key, then pass --sandbox-ack.",
    );
  }
  if (tasks.length === 0) throw new Error("no tasks selected");

  const trials: TrialResult[] = [];
  const total = tasks.length * opts.ablations.length * opts.trials;
  let done = 0;
  for (const task of tasks) {
    for (const ablation of opts.ablations) {
      for (let trial = 1; trial <= opts.trials; trial++) {
        done++;
        process.stdout.write(
          `[${done}/${total}] ${task.id} · ${ablation} · trial ${trial} ... `,
        );
        const result = await runTrial(task, agent, {
          ablation,
          trial,
          timeoutMs: opts.timeoutMs,
          keep: opts.keep,
          ...(opts.model ? { model: opts.model } : {}),
        });
        trials.push(result);
        const failed = result.grades.filter((g) => !g.pass).map((g) => g.id);
        process.stdout.write(
          `${result.pass ? "PASS" : `FAIL (${failed.join(", ")})`}` +
            `${result.agentRun.timedOut ? " [agent timed out]" : ""}` +
            `${result.workspace ? ` → ${result.workspace}` : ""}\n`,
        );
      }
    }
  }

  const summary = summarize(trials, opts.k);
  const markdown = renderMarkdown(summary, {
    agent: agent.name,
    ...(opts.model ? { model: opts.model } : {}),
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out =
    opts.out ??
    join(
      REPO_ROOT,
      "evals",
      "results",
      `${stamp}-${agent.name.replace(/[^\w-]/g, "_")}.json`,
    );
  await mkdir(dirname(out), { recursive: true });
  await writeFile(
    out,
    `${JSON.stringify({ agent: agent.name, model: opts.model ?? null, startedAt: stamp, options: { ...opts, out }, summary, trials }, null, 2)}\n`,
  );
  await writeFile(out.replace(/\.json$/, ".md"), markdown);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);

  process.stdout.write(
    `\n${markdown}\nResults: ${relative(process.cwd(), out)}\n`,
  );
  if (
    opts.failUnder !== undefined &&
    summary.overallPassRate < opts.failUnder
  ) {
    process.stderr.write(
      `Overall pass rate ${(summary.overallPassRate * 100).toFixed(0)}% is below --fail-under ${opts.failUnder}\n`,
    );
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (err) {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exitCode = 1;
}
