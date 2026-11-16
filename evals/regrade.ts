/**
 * `pnpm eval:regrade <results.json> [...]` — regrade saved trials after a
 * grader fix, without paying for new agent runs.
 *
 * For each trial it scaffolds a fresh workspace exactly as the original run
 * did (task setup and ablation), applies the agent's stored diff with
 * `git apply`, and runs the task's current graders. The agent's run data
 * (time, effort, trace path) is kept. Trials whose stored diff was truncated
 * or no longer applies keep their original grades and are listed in
 * `regrade.skipped`.
 *
 * Grading runs the agent's code (its tests, typecheck, and the hidden tests),
 * so run this inside the same sandbox as the agents (see evals/Dockerfile).
 * Writes `<name>.regraded.json` and `.md` next to each input.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runGrader } from "./lib/graders.ts";
import { renderMarkdown, summarize, type RunMeta } from "./lib/report.ts";
import { hiddenDirFor } from "./lib/runner.ts";
import {
  childEnv,
  disposeWorkspace,
  prepareWorkspace,
  runProcess,
  snapshot,
} from "./lib/workspace.ts";
import { TASKS } from "./tasks/index.ts";
import type { GradeResult, TrialResult } from "./lib/types.ts";

/** Marker `workspaceDiff()` appends when it truncates a diff. */
const TRUNCATED = "\n[diff truncated]";

interface ResultsFile {
  meta?: RunMeta;
  options: { k: number };
  trials: TrialResult[];
  [key: string]: unknown;
}

/**
 * Regrade one trial from its stored diff.
 *
 * @returns New grades, or a reason the trial could not be replayed.
 */
async function regradeTrial(
  t: TrialResult,
): Promise<{ grades: GradeResult[] } | { skip: string }> {
  const task = TASKS.find((x) => x.id === t.taskId);
  if (!task) return { skip: "task no longer exists" };
  if (t.diff.endsWith(TRUNCATED)) return { skip: "stored diff was truncated" };
  const ws = await prepareWorkspace(task, t.ablation);
  try {
    if (t.diff.trim().length > 0) {
      const patch = join(ws.root, "agent.patch");
      await writeFile(patch, t.diff.endsWith("\n") ? t.diff : `${t.diff}\n`);
      const applied = await runProcess(
        "git",
        ["apply", "--whitespace=nowarn", patch],
        {
          cwd: ws.dir,
          env: childEnv(),
          timeoutMs: 60_000,
        },
      );
      if (applied.exitCode !== 0)
        return { skip: `git apply failed: ${applied.output.slice(0, 200)}` };
    }
    const after = await snapshot(ws.dir);
    const grades: GradeResult[] = [];
    for (const spec of task.graders) {
      grades.push(
        await runGrader(spec, {
          dir: ws.dir,
          before: ws.before,
          after,
          hiddenDir: hiddenDirFor(task.id),
        }),
      );
    }
    return { grades };
  } finally {
    await disposeWorkspace(ws.root);
  }
}

async function main(): Promise<void> {
  const files = process.argv.slice(2);
  if (files.length === 0)
    throw new Error("usage: pnpm eval:regrade <results.json> [...]");
  for (const path of files) {
    const data = JSON.parse(await readFile(path, "utf8")) as ResultsFile;
    const skipped: string[] = [];
    let flipped = 0;
    for (const [i, t] of data.trials.entries()) {
      process.stdout.write(
        `[${i + 1}/${data.trials.length}] ${t.taskId} · trial ${t.trial} ... `,
      );
      const r = await regradeTrial(t);
      if ("skip" in r) {
        skipped.push(`${t.taskId}#${t.trial}: ${r.skip}`);
        process.stdout.write(`kept original (${r.skip})\n`);
        continue;
      }
      const pass = r.grades.every((g) => g.pass);
      if (pass !== t.pass) flipped++;
      process.stdout.write(
        `${t.pass ? "PASS" : "FAIL"} → ${
          pass
            ? "PASS"
            : `FAIL (${r.grades
                .filter((g) => !g.pass)
                .map((g) => g.id)
                .join(", ")})`
        }\n`,
      );
      data.trials[i] = { ...t, grades: r.grades, pass };
    }
    const summary = summarize(data.trials, data.options.k);
    const out = path.replace(/\.json$/, ".regraded.json");
    await writeFile(
      out,
      `${JSON.stringify({ ...data, summary, regrade: { at: new Date().toISOString(), flipped, skipped } }, null, 2)}\n`,
    );
    await writeFile(
      out.replace(/\.json$/, ".md"),
      renderMarkdown(summary, data.meta ?? { agent: "unknown" }),
    );
    process.stdout.write(
      `${path}: ${flipped} trial(s) changed, ${skipped.length} skipped; overall ${(summary.overallPassRate * 100).toFixed(0)}% → ${out}\n`,
    );
  }
}

try {
  await main();
} catch (err) {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exitCode = 1;
}
