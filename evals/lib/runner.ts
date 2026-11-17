/**
 * Trial runner: prepare a workspace, run the agent, grade, clean up.
 *
 * @module
 */

import { join } from "node:path";
import { buildPrompt, type AgentAdapter } from "./agents.ts";
import { IMAGE_DEPS_DIR, runGraderContainer } from "./docker-sandbox.ts";
import { runGrader, type GradeExec } from "./graders.ts";
import {
  copyWorkspace,
  disposeWorkspace,
  openForContainer,
  prepareWorkspace,
  REPO_ROOT,
  snapshot,
  workspaceDiff,
  workspaceFootprint,
} from "./workspace.ts";
import {
  trialOutcome,
  type Ablation,
  type EvalTask,
  type GradeResult,
  type McpMode,
  type AgentRunResult,
  type TrialResult,
} from "./types.ts";

/** Grading commands in a no-network container (`--sandbox docker`). */
export const dockerGradeExec: GradeExec = (dir, argv, timeoutMs) =>
  runGraderContainer(dir, argv, timeoutMs);

/** Options for {@link runTrial}. */
export interface TrialOptions {
  readonly ablation: Ablation;
  readonly trial: number;
  /** Agent wall-clock budget. */
  readonly timeoutMs: number;
  /** Keep the workspace on disk for inspection. */
  readonly keep: boolean;
  readonly model?: string;
  /** MCP servers offered to the agent. */
  readonly mcp?: McpMode;
  /**
   * `docker`: the agent runs in a container that sees only its workspace,
   * and grading runs on a copy in a no-network container. Default: both run
   * on this machine (offline adapters, or an already isolated VM).
   */
  readonly sandbox?: "docker";
  /** Egress proxy (URL and network) for a sandboxed live agent. */
  readonly egressProxy?: { readonly url: string; readonly network: string };
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
  const docker = opts.sandbox === "docker";
  const ws = await prepareWorkspace(
    task,
    opts.ablation,
    docker ? { depsRoot: IMAGE_DEPS_DIR } : {},
  );
  try {
    if (docker) await openForContainer(ws.dir);
    let agentRun: AgentRunResult;
    try {
      agentRun = await agent.run({
        task,
        dir: ws.dir,
        prompt: buildPrompt(task),
        timeoutMs: opts.timeoutMs,
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.mcp ? { mcp: opts.mcp } : {}),
        ...(docker ? { sandbox: "docker" as const } : {}),
        ...(opts.egressProxy ? { egressProxy: opts.egressProxy } : {}),
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
    const footprint = await workspaceFootprint(ws.dir);
    // Grade a copy: hidden tests and the agent's code run there, and the
    // workspace the agent left stays untouched as the record.
    const gradeDir = join(ws.root, "graded");
    await copyWorkspace(ws.dir, gradeDir);
    if (docker) await openForContainer(gradeDir);
    const grades: GradeResult[] = [];
    for (const spec of task.graders) {
      grades.push(
        await runGrader(spec, {
          dir: gradeDir,
          before: ws.before,
          after,
          hiddenDir: hiddenDirFor(task.id),
          ...(agentRun.trace ? { trace: agentRun.trace } : {}),
          ...(docker ? { exec: dockerGradeExec } : {}),
        }),
      );
    }
    return {
      taskId: task.id,
      suite: task.suite,
      ablation: opts.ablation,
      trial: opts.trial,
      agent: agent.name,
      ...trialOutcome(grades),
      agentRun,
      grades,
      diff,
      footprint,
      workspace: opts.keep ? ws.dir : null,
    };
  } finally {
    if (!opts.keep) await disposeWorkspace(ws.root);
  }
}
