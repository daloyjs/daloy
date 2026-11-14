/**
 * Aggregation and Markdown reporting for eval results.
 *
 * @module
 */

import { passAtK, passHatK } from "./metrics.ts";
import type { Ablation, EvalSuite, TrialResult } from "./types.ts";

/** Aggregate for one (task, ablation) cell. */
export interface CellSummary {
  readonly taskId: string;
  readonly suite: EvalSuite;
  readonly ablation: Ablation;
  readonly n: number;
  readonly passes: number;
  readonly passAt1: number;
  readonly passAtK: number;
  readonly passHatK: number;
  readonly k: number;
  /** Grader id → number of trials it failed. */
  readonly failures: Readonly<Record<string, number>>;
  readonly meanAgentMs: number;
}

/** Full summary of a run. */
export interface RunSummary {
  readonly cells: readonly CellSummary[];
  /** Pass rate over every trial in the run. */
  readonly overallPassRate: number;
  /** Ablation → pass rate over its trials. */
  readonly byAblation: Readonly<Partial<Record<Ablation, number>>>;
  /** Suite → pass rate over its trials. */
  readonly bySuite: Readonly<Partial<Record<EvalSuite, number>>>;
}

const rate = (xs: readonly TrialResult[]): number =>
  xs.length === 0 ? 0 : xs.filter((t) => t.pass).length / xs.length;

/**
 * Group trials by (task, ablation) and compute pass@1, pass@k, pass^k and the
 * per-grader failure counts that point at a failure pattern.
 *
 * @param trials - Graded trials.
 * @param k - Attempt budget for pass@k / pass^k; clamped to each cell's n.
 * @returns The summary.
 */
export function summarize(
  trials: readonly TrialResult[],
  k: number,
): RunSummary {
  const groups = new Map<string, TrialResult[]>();
  for (const t of trials) {
    const key = `${t.taskId}\u0000${t.ablation}`;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }
  const cells: CellSummary[] = [];
  for (const list of groups.values()) {
    const first = list[0]!;
    const n = list.length;
    const c = list.filter((t) => t.pass).length;
    const kk = Math.max(1, Math.min(k, n));
    const failures: Record<string, number> = {};
    for (const t of list)
      for (const g of t.grades)
        if (!g.pass) failures[g.id] = (failures[g.id] ?? 0) + 1;
    cells.push({
      taskId: first.taskId,
      suite: first.suite,
      ablation: first.ablation,
      n,
      passes: c,
      passAt1: c / n,
      passAtK: passAtK(n, c, kk),
      passHatK: passHatK(n, c, kk),
      k: kk,
      failures,
      meanAgentMs: list.reduce((s, t) => s + t.agentRun.durationMs, 0) / n,
    });
  }
  const byAblation: Partial<Record<Ablation, number>> = {};
  for (const a of new Set(trials.map((t) => t.ablation)))
    byAblation[a] = rate(trials.filter((t) => t.ablation === a));
  const bySuite: Partial<Record<EvalSuite, number>> = {};
  for (const s of new Set(trials.map((t) => t.suite)))
    bySuite[s] = rate(trials.filter((t) => t.suite === s));
  return { cells, overallPassRate: rate(trials), byAblation, bySuite };
}

const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;

/**
 * Render a run summary as Markdown (for the terminal, a file, or the GitHub
 * Actions job summary).
 *
 * @param summary - From {@link summarize}.
 * @param meta - Agent name and model, shown in the heading.
 * @returns Markdown text.
 */
export function renderMarkdown(
  summary: RunSummary,
  meta: { agent: string; model?: string },
): string {
  const lines: string[] = [];
  lines.push(
    `## DaloyJS agent evals: \`${meta.agent}\`${meta.model ? ` (${meta.model})` : ""}`,
  );
  lines.push("");
  lines.push(`Overall pass rate: **${pct(summary.overallPassRate)}**`);
  lines.push("");
  lines.push(
    "| Task | Suite | Ablation | Passes | pass@1 | pass@k | pass^k | Failing graders |",
  );
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const c of summary.cells) {
    const failing = Object.entries(c.failures)
      .map(([id, n]) => `${id}×${n}`)
      .join(", ");
    lines.push(
      `| ${c.taskId} | ${c.suite} | ${c.ablation} | ${c.passes}/${c.n} | ${pct(c.passAt1)} | ` +
        `${pct(c.passAtK)} (k=${c.k}) | ${pct(c.passHatK)} | ${failing || "—"} |`,
    );
  }
  const ablations = Object.entries(summary.byAblation);
  if (ablations.length > 1) {
    lines.push("");
    lines.push("| Ablation | Pass rate |");
    lines.push("|---|---|");
    for (const [a, r] of ablations) lines.push(`| ${a} | ${pct(r ?? 0)} |`);
  }
  return `${lines.join("\n")}\n`;
}
