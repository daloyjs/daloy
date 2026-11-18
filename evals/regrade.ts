/**
 * `pnpm eval:regrade <results.json> [...]` — regrade saved trials after a
 * grader fix, without paying for new agent runs.
 *
 * For each trial it scaffolds a fresh workspace exactly as the original run
 * did (task setup and ablation), applies the agent's stored diff with
 * `git apply`, and runs the task's current graders. The agent's trace is
 * re-parsed from the saved agent output (so trace-parser fixes apply too);
 * the rest of its run data (time, effort, trace path) is kept. Trials whose stored diff was truncated
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
import { markLegacyUnverified } from "./lib/legacy-diff.ts";
import { reviseTrial } from "./lib/revision.ts";
import { renderMarkdown, summarize, type RunMeta } from "./lib/report.ts";
import { checkGraderImage, IMAGE_DEPS_DIR } from "./lib/docker-sandbox.ts";
import { dockerGradeExec, hiddenDirFor } from "./lib/runner.ts";
import { loadTrialTrace } from "./lib/trace.ts";
import {
  childEnv,
  DIFF_UNAVAILABLE,
  disposeWorkspace,
  openForContainer,
  prepareWorkspace,
  runProcess,
  snapshot,
} from "./lib/workspace.ts";
import { TASKS } from "./tasks/index.ts";
import type { AgentTrace, GradeResult, TrialResult } from "./lib/types.ts";

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
  trace: AgentTrace | undefined,
  docker: boolean,
): Promise<{ grades: GradeResult[] } | { skip: string }> {
  const task = TASKS.find((x) => x.id === t.taskId);
  if (!task) return { skip: "task no longer exists" };
  if (t.diff.endsWith(TRUNCATED)) return { skip: "stored diff was truncated" };
  if (t.diff.startsWith(DIFF_UNAVAILABLE)) return { skip: `stored diff is unavailable: ${t.diff.slice(DIFF_UNAVAILABLE.length).trim()}` };
  const ws = await prepareWorkspace(
    task,
    t.ablation,
    docker ? { depsRoot: IMAGE_DEPS_DIR } : {},
  );
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
    if (docker) await openForContainer(ws.dir);
    const grades: GradeResult[] = [];
    for (const spec of task.graders) {
      grades.push(
        await runGrader(spec, {
          dir: ws.dir,
          before: ws.before,
          after,
          hiddenDir: hiddenDirFor(task.id),
          protectedFiles: task.graders.flatMap((g) => (g.kind === "protected-files" ? g.files : [])),
          ...(trace ? { trace } : {}),
          ...(docker ? { exec: dockerGradeExec } : {}),
        }),
      );
    }
    return { grades };
  } finally {
    await disposeWorkspace(ws.root);
  }
}

/** `PASS`, `FAIL`, or `UNVERIFIED` for a trial. */
function verdict(t: TrialResult): "PASS" | "FAIL" | "UNVERIFIED" {
  return t.pass ? "PASS" : t.unverified ? "UNVERIFIED" : "FAIL";
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--sandbox");
  const mode = at === -1 ? "none" : argv[at + 1];
  if (mode !== "none" && mode !== "docker")
    throw new Error("--sandbox must be none or docker");
  const files = argv.filter((_, i) => at === -1 || (i !== at && i !== at + 1));
  if (files.length === 0)
    throw new Error(
      "usage: pnpm eval:regrade [--sandbox docker] <results.json> [...]",
    );
  const docker = mode === "docker";
  const executorName = mode;
  if (docker) await checkGraderImage();
  else
    process.stderr.write(
      "warning: grading runs the agents' code on this machine; pass --sandbox docker to run it in a no-network container\n",
    );
  for (const path of files) {
    const data = JSON.parse(await readFile(path, "utf8")) as ResultsFile;
    const unverified: string[] = [];
    // Results written before DIFF_FORMAT 2 store diffs without deleted files.
    const legacy = typeof data.diffFormat !== "number" || data.diffFormat < 2;
    if (legacy) {
      process.stdout.write(
        `${path}: legacy diff format (no deletions); checks a missing deletion could change are marked unverified\n`,
      );
    }
    let flipped = 0;
    for (let [i, t] of data.trials.entries()) {
      process.stdout.write(
        `[${i + 1}/${data.trials.length}] ${t.taskId} · trial ${t.trial} ... `,
      );
      // Re-parse the saved agent output so trace-parser fixes apply too.
      const trace = await loadTrialTrace(path, data.meta?.agent ?? "", t, data.meta?.sandbox);
      if (trace) data.trials[i] = t = { ...t, agentRun: { ...t.agentRun, trace } };
      const r = await regradeTrial(t, trace, docker);
      let outcome: { grades: GradeResult[] } | { skip: string } = r;
      if (!("skip" in r) && legacy) {
        const task = TASKS.find((x) => x.id === t.taskId)!;
        const marked = markLegacyUnverified(task, t, r.grades);
        outcome = { grades: marked.grades };
      }
      const revised = reviseTrial(t, outcome);
      if (revised.unverified)
        unverified.push(
          `${t.taskId}#${t.trial}: ${
            revised.unverifiedReason ??
            revised.grades
              .filter((g) => g.unverified)
              .map((g) => g.id)
              .join(", ")
          }`,
        );
      const was = verdict(t);
      const now = verdict(revised);
      if (was !== now) flipped++;
      process.stdout.write(
        `${was} → ${now}${
          now === "FAIL"
            ? ` (${revised.grades
                .filter((g) => !g.pass && !g.unverified)
                .map((g) => g.id)
                .join(", ")})`
            : now === "UNVERIFIED"
              ? ` (${unverified.at(-1)!.split(": ").slice(1).join(": ")})`
              : ""
        }\n`,
      );
      data.trials[i] = revised;
    }
    const summary = summarize(data.trials, data.options.k);
    const out = path.replace(/\.json$/, ".regraded.json");
    await writeFile(
      out,
      `${JSON.stringify({ ...data, summary, regrade: { at: new Date().toISOString(), sandbox: executorName, flipped, unverified, legacyDiff: legacy } }, null, 2)}\n`,
    );
    await writeFile(
      out.replace(/\.json$/, ".md"),
      renderMarkdown(summary, data.meta ?? { agent: "unknown" }),
    );
    process.stdout.write(
      `${path}: ${flipped} trial(s) changed, ${unverified.length} unverified; overall ${(summary.overallPassRate * 100).toFixed(0)}% of verified trials → ${out}\n`,
    );
  }
}

try {
  await main();
} catch (err) {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exitCode = 1;
}
