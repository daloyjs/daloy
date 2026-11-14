/**
 * Trial runner: prepare a workspace, run the agent, grade, clean up.
 *
 * @module
 */

import { join } from "node:path";
import { buildPrompt, type AgentAdapter } from "./agents.ts";
import { runGrader } from "./graders.ts";
import {
  disposeWorkspace,
  prepareWorkspace,
  REPO_ROOT,
  snapshot,
  workspaceDiff,
} from "./workspace.ts";
import type { Ablation, EvalTask, GradeResult, TrialResult } from "./types.ts";

/** Options for {@link runTrial}. */
export interface TrialOptions {
  readonly ablation: Ablation;
  readonly trial: number;
  /** Agent wall-clock budget. */
  readonly timeoutMs: number;
  /** Keep the workspace on disk for inspection. */
  readonly keep: boolean;
  readonly model?: string;
}

/**
 * Absolute path of a task's hidden-test directory.
 *
 * @param taskId - Task id.
 * @returns `evals/tasks/<id>/hidden`.
 */
export function hiddenDirFor(taskId: string): string {
  return join(REPO_ROOT, "evals", "tasks", taskId, "hidden");
}

/**
 * Run one trial end to end. The workspace is always deleted unless
 * `opts.keep` is set, including when the agent or a grader throws.
 *
 * @param task - Task to run.
 * @param agent - Adapter that performs the work.
 * @param opts - Ablation, trial number, timeout, keep flag.
 * @returns The graded trial.
 */
export async function runTrial(
  task: EvalTask,
  agent: AgentAdapter,
  opts: TrialOptions,
): Promise<TrialResult> {
  const ws = await prepareWorkspace(task, opts.ablation);
  try {
    let agentRun;
    try {
      agentRun = await agent.run({
        task,
        dir: ws.dir,
        prompt: buildPrompt(task),
        timeoutMs: opts.timeoutMs,
        ...(opts.model ? { model: opts.model } : {}),
      });
    } catch (err) {
      agentRun = {
        exitCode: null,
        timedOut: false,
        durationMs: 0,
        outputTail: `[adapter error] ${(err as Error).message}`,
      };
    }
    const after = await snapshot(ws.dir);
    const diff = await workspaceDiff(ws.dir);
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
    return {
      taskId: task.id,
      suite: task.suite,
      ablation: opts.ablation,
      trial: opts.trial,
      agent: agent.name,
      pass: grades.every((g) => g.pass),
      agentRun,
      grades,
      diff,
      workspace: opts.keep ? ws.dir : null,
    };
  } finally {
    if (!opts.keep) await disposeWorkspace(ws.root);
  }
}
