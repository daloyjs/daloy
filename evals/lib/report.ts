/**
 * Aggregation, Markdown reporting, and before/after comparison for eval
 * results.
 *
 * Reporting follows "quality first, then effort": a cell's pass rates come
 * first, and effort (agent time, steps, tokens, cost, diff size) is averaged
 * over its **passing** trials only, so a cheap failure never looks efficient
 * and a passing app that took three times the effort still stands out.
 *
 * @module
 */

import { passAtK, passHatK } from "./metrics.ts";
import type { Ablation, EvalSuite, TrialResult } from "./types.ts";

/** Mean effort over a cell's passing trials. A field is absent when no trial reported it. */
export interface EffortSummary {
  readonly agentMs?: number;
  readonly steps?: number;
  readonly tokens?: number;
  readonly costUsd?: number;
  readonly premiumRequests?: number;
  /** Lines added plus removed, from the diff footprint. */
  readonly linesChanged?: number;
}

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
  /** Mean agent wall-clock time over all trials. */
  readonly meanAgentMs: number;
  /** Mean effort over passing trials. */
  readonly effort: EffortSummary;
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

/**
 * What a run was pinned to. Two runs are only comparable when everything
 * except the one thing under test (a framework change, a docs change, a new
 * model) is the same.
 */
export interface RunMeta {
  readonly agent: string;
  readonly model?: string;
  /** `<cli> --version` output for live agents. */
  readonly agentVersion?: string;
  readonly gitSha?: string;
  readonly coreVersion?: string;
  readonly node?: string;
  readonly trials?: number;
  readonly timeoutMs?: number;
}

const rate = (xs: readonly TrialResult[]): number =>
  xs.length === 0 ? 0 : xs.filter((t) => t.pass).length / xs.length;

function mean(values: readonly (number | undefined)[]): number | undefined {
  const defined = values.filter((v): v is number => v !== undefined);
  return defined.length === 0
    ? undefined
    : defined.reduce((a, b) => a + b, 0) / defined.length;
}

function effortOf(passing: readonly TrialResult[]): EffortSummary {
  const tokens = (t: TrialResult): number | undefined => {
    const e = t.agentRun.effort;
    if (e?.inputTokens === undefined && e?.outputTokens === undefined)
      return undefined;
    return (e.inputTokens ?? 0) + (e.outputTokens ?? 0);
  };
  const entries = Object.entries({
    agentMs: mean(passing.map((t) => t.agentRun.durationMs)),
    steps: mean(passing.map((t) => t.agentRun.effort?.steps)),
    tokens: mean(passing.map(tokens)),
    costUsd: mean(passing.map((t) => t.agentRun.effort?.costUsd)),
    premiumRequests: mean(
      passing.map((t) => t.agentRun.effort?.premiumRequests),
    ),
    linesChanged: mean(
      passing.map((t) =>
        t.footprint
          ? t.footprint.linesAdded + t.footprint.linesRemoved
          : undefined,
      ),
    ),
  }).filter(([, v]) => v !== undefined);
  return Object.fromEntries(entries) as EffortSummary;
}

/**
 * Group trials by (task, ablation) and compute pass@1, pass@k, pass^k, the
 * per-grader failure counts that point at a failure pattern, and the effort
 * of passing trials.
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
    const passing = list.filter((t) => t.pass);
    const c = passing.length;
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
      effort: effortOf(passing),
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
const dash = "—";

function fmtEffort(e: EffortSummary): string[] {
  return [
    e.agentMs === undefined ? dash : `${(e.agentMs / 1000).toFixed(0)}s`,
    e.steps === undefined ? dash : e.steps.toFixed(0),
    e.tokens === undefined ? dash : `${(e.tokens / 1000).toFixed(0)}k`,
    e.costUsd !== undefined
      ? `$${e.costUsd.toFixed(2)}`
      : e.premiumRequests !== undefined
        ? `${e.premiumRequests.toFixed(1)} req`
        : dash,
    e.linesChanged === undefined ? dash : e.linesChanged.toFixed(0),
  ];
}

function pins(meta: RunMeta): string {
  const parts = [
    meta.agentVersion && `agent ${meta.agentVersion}`,
    meta.coreVersion && `@daloyjs/core ${meta.coreVersion}`,
    meta.gitSha && `commit ${meta.gitSha.slice(0, 10)}`,
    meta.node && `node ${meta.node}`,
    meta.trials !== undefined && `${meta.trials} trial(s)`,
    meta.timeoutMs !== undefined &&
      `${Math.round(meta.timeoutMs / 60_000)} min limit`,
  ].filter(Boolean);
  return parts.join(" · ");
}

/**
 * Render a run summary as Markdown (for the terminal, a file, or the GitHub
 * Actions job summary).
 *
 * @param summary - From {@link summarize}.
 * @param meta - Agent, model, and pinned versions, shown in the heading.
 * @returns Markdown text.
 */
export function renderMarkdown(summary: RunSummary, meta: RunMeta): string {
  const lines: string[] = [];
  lines.push(
    `## DaloyJS agent evals: \`${meta.agent}\`${meta.model ? ` (${meta.model})` : ""}`,
  );
  const pinned = pins(meta);
  if (pinned) lines.push("", pinned);
  lines.push("");
  lines.push(`Overall pass rate: **${pct(summary.overallPassRate)}**`);
  lines.push("");
  lines.push("### Quality");
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
        `${pct(c.passAtK)} (k=${c.k}) | ${pct(c.passHatK)} | ${failing || dash} |`,
    );
  }
  lines.push("");
  lines.push("### Effort (mean over passing trials)");
  lines.push("");
  lines.push(
    "| Task | Ablation | Time | Steps | Tokens | Cost | Lines changed |",
  );
  lines.push("|---|---|---|---|---|---|---|");
  for (const c of summary.cells) {
    lines.push(
      `| ${c.taskId} | ${c.ablation} | ${fmtEffort(c.effort).join(" | ")} |`,
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

/** One row of a before/after comparison. */
export interface ComparisonRow {
  readonly taskId: string;
  readonly ablation: Ablation;
  readonly basePassAt1?: number;
  readonly headPassAt1?: number;
  readonly status: "regressed" | "improved" | "same" | "added" | "removed";
  readonly baseEffort?: EffortSummary;
  readonly headEffort?: EffortSummary;
  /** Guardrail-grader failures in base and head. */
  readonly guardrailFailures: { readonly base: number; readonly head: number };
}

/**
 * Compare two runs cell by cell (same task and ablation). A cell regresses
 * when its pass@1 drops or when it gains guardrail failures, even if the pass
 * rate held. With a handful of trials per cell a one-trial swing is noise, so
 * treat a regression as a reason to inspect traces, not as a verdict.
 *
 * @param base - Summary of the earlier run (last release, previous model).
 * @param head - Summary of the run under test.
 * @returns One row per cell present in either run.
 */
export function compareRuns(
  base: RunSummary,
  head: RunSummary,
): ComparisonRow[] {
  const key = (c: CellSummary): string => `${c.taskId}\u0000${c.ablation}`;
  const baseCells = new Map(base.cells.map((c) => [key(c), c]));
  const headCells = new Map(head.cells.map((c) => [key(c), c]));
  const rows: ComparisonRow[] = [];
  for (const k of new Set([...baseCells.keys(), ...headCells.keys()])) {
    const b = baseCells.get(k);
    const h = headCells.get(k);
    const any = (h ?? b)!;
    const guardrailFailures = {
      base: b?.failures.guardrails ?? 0,
      head: h?.failures.guardrails ?? 0,
    };
    let status: ComparisonRow["status"];
    if (!b) status = "added";
    else if (!h) status = "removed";
    else if (
      h.passAt1 < b.passAt1 ||
      guardrailFailures.head / h.n > guardrailFailures.base / b.n
    )
      status = "regressed";
    else if (h.passAt1 > b.passAt1) status = "improved";
    else status = "same";
    rows.push({
      taskId: any.taskId,
      ablation: any.ablation,
      ...(b ? { basePassAt1: b.passAt1, baseEffort: b.effort } : {}),
      ...(h ? { headPassAt1: h.passAt1, headEffort: h.effort } : {}),
      status,
      guardrailFailures,
    });
  }
  return rows;
}

/**
 * Render a comparison as Markdown, regressions first.
 *
 * @param rows - From {@link compareRuns}.
 * @param labels - Names for the two runs (for example `v1.24.2` / `HEAD`).
 * @returns Markdown text.
 */
export function renderComparison(
  rows: readonly ComparisonRow[],
  labels: { base: string; head: string },
): string {
  const order = { regressed: 0, removed: 1, added: 2, improved: 3, same: 4 };
  const sorted = [...rows].sort(
    (a, b) =>
      order[a.status] - order[b.status] || a.taskId.localeCompare(b.taskId),
  );
  const p = (x: number | undefined): string =>
    x === undefined ? dash : pct(x);
  const time = (e: EffortSummary | undefined): string =>
    e?.agentMs === undefined ? dash : `${(e.agentMs / 1000).toFixed(0)}s`;
  const tok = (e: EffortSummary | undefined): string =>
    e?.tokens === undefined ? dash : `${(e.tokens / 1000).toFixed(0)}k`;
  const lines = [
    `## Eval comparison: ${labels.base} → ${labels.head}`,
    "",
    `Regressed: **${rows.filter((r) => r.status === "regressed").length}** · ` +
      `improved: ${rows.filter((r) => r.status === "improved").length} · ` +
      `unchanged: ${rows.filter((r) => r.status === "same").length}`,
    "",
    "| Status | Task | Ablation | pass@1 | Guardrail failures | Time (passing) | Tokens (passing) |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const r of sorted) {
    lines.push(
      `| ${r.status} | ${r.taskId} | ${r.ablation} | ${p(r.basePassAt1)} → ${p(r.headPassAt1)} | ` +
        `${r.guardrailFailures.base} → ${r.guardrailFailures.head} | ` +
        `${time(r.baseEffort)} → ${time(r.headEffort)} | ${tok(r.baseEffort)} → ${tok(r.headEffort)} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}
