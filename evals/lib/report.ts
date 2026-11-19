/**
 * Aggregation, Markdown reporting, and before/after comparison for eval
 * results.
 *
 * Reporting follows "quality first, then effort": a cell's pass rates come
 * first, and effort (agent time, steps, tokens, cost, diff size) is averaged
 * over its **passing** trials only, so a cheap failure never looks efficient
 * and a passing app that took three times the effort still stands out.
 * Alongside it, "per success" divides what **every** trial spent (failed ones
 * included) by the number of passes: the price of one working result.
 *
 * @module
 */

import { passAtK, passHatK, wilsonInterval } from "./metrics.ts";
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

/**
 * What one passing result really cost: the total over every trial in a cell,
 * failed ones included, divided by its passes. Absent when nothing passed or
 * no trial reported the field.
 */
export interface PerSuccessSummary {
  readonly agentMs?: number;
  readonly tokens?: number;
  readonly costUsd?: number;
  readonly premiumRequests?: number;
}

/** Aggregate for one (task, ablation) cell. */
export interface CellSummary {
  readonly taskId: string;
  readonly suite: EvalSuite;
  readonly ablation: Ablation;
  /** Verified trials (passed or failed); unverified ones are not counted. */
  readonly n: number;
  readonly passes: number;
  /** Trials no grader failed but some grader could not decide. */
  readonly unverified: number;
  readonly passAt1: number;
  /**
   * 95% Wilson interval of pass@1 over the verified trials; absent when
   * there are none, and in results files written before it existed.
   */
  readonly passAt1Interval?: readonly [number, number];
  readonly passAtK: number;
  readonly passHatK: number;
  readonly k: number;
  /** Grader id → number of trials it failed. */
  readonly failures: Readonly<Record<string, number>>;
  /** Mean agent wall-clock time over all trials. */
  readonly meanAgentMs: number;
  /** Mean effort over passing trials. */
  readonly effort: EffortSummary;
  /** Total effort over all trials divided by passes. */
  readonly perSuccess: PerSuccessSummary;
}

/** Full summary of a run. */
export interface RunSummary {
  readonly cells: readonly CellSummary[];
  /** Pass rate over every verified trial in the run. */
  readonly overallPassRate: number;
  /** Trials left out of every rate because they are unverified. */
  readonly unverified: number;
  /**
   * Pass rate if every unverified trial had failed: passes over all trials.
   * The lower bound to quote next to {@link overallPassRate} when trials
   * are unverified, since leaving them out can only raise the rate.
   */
  readonly worstCasePassRate: number;
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
  /** MCP servers offered to the agent (`none` when absent, for older runs). */
  readonly mcp?: string;
  /** `docker` when the agent ran isolated (`none` when absent, for older runs). */
  readonly sandbox?: string;
  /** `<cli> --version` output for live agents. */
  readonly agentVersion?: string;
  readonly gitSha?: string;
  readonly coreVersion?: string;
  readonly node?: string;
  readonly trials?: number;
  readonly timeoutMs?: number;
}

const verified = (xs: readonly TrialResult[]): TrialResult[] =>
  xs.filter((t) => !t.unverified);

const rate = (xs: readonly TrialResult[]): number => {
  const v = verified(xs);
  return v.length === 0 ? 0 : v.filter((t) => t.pass).length / v.length;
};

function mean(values: readonly (number | undefined)[]): number | undefined {
  const defined = values.filter((v): v is number => v !== undefined);
  return defined.length === 0
    ? undefined
    : defined.reduce((a, b) => a + b, 0) / defined.length;
}

const tokensOf = (t: TrialResult): number | undefined => {
  const e = t.agentRun.effort;
  if (e?.inputTokens === undefined && e?.outputTokens === undefined)
    return undefined;
  return (e.inputTokens ?? 0) + (e.outputTokens ?? 0);
};

/**
 * Total of a per-trial value over all trials, divided by passes. Undefined
 * when nothing passed or no trial reported the value; trials that did not
 * report it count as zero, so the figure is a lower bound.
 */
function perPass(
  trials: readonly TrialResult[],
  passes: number,
  value: (t: TrialResult) => number | undefined,
): number | undefined {
  if (passes === 0) return undefined;
  const values = trials.map(value);
  if (values.every((v) => v === undefined)) return undefined;
  return values.reduce<number>((a, v) => a + (v ?? 0), 0) / passes;
}

/**
 * Effort per passing result for a cell, counting failed trials' spend.
 *
 * @param trials - Every trial in the cell.
 * @returns Per-success totals; empty when nothing passed.
 */
export function perSuccessOf(
  trials: readonly TrialResult[],
): PerSuccessSummary {
  const passes = trials.filter((t) => t.pass).length;
  const entries = Object.entries({
    agentMs: perPass(trials, passes, (t) => t.agentRun.durationMs),
    tokens: perPass(trials, passes, tokensOf),
    costUsd: perPass(trials, passes, (t) => t.agentRun.effort?.costUsd),
    premiumRequests: perPass(
      trials,
      passes,
      (t) => t.agentRun.effort?.premiumRequests,
    ),
  }).filter(([, v]) => v !== undefined);
  return Object.fromEntries(entries) as PerSuccessSummary;
}

function effortOf(passing: readonly TrialResult[]): EffortSummary {
  const tokens = tokensOf;
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
  for (const all of groups.values()) {
    const first = all[0]!;
    const list = verified(all);
    const n = list.length;
    const passing = list.filter((t) => t.pass);
    const c = passing.length;
    const kk = Math.max(1, Math.min(k, Math.max(n, 1)));
    const failures: Record<string, number> = {};
    for (const t of list)
      for (const g of t.grades)
        if (!g.pass && !g.unverified) failures[g.id] = (failures[g.id] ?? 0) + 1;
    cells.push({
      taskId: first.taskId,
      suite: first.suite,
      ablation: first.ablation,
      n,
      passes: c,
      unverified: all.length - n,
      passAt1: n === 0 ? 0 : c / n,
      ...(n > 0 ? { passAt1Interval: wilsonInterval(n, c) } : {}),
      passAtK: n === 0 ? 0 : passAtK(n, c, kk),
      passHatK: n === 0 ? 0 : passHatK(n, c, kk),
      k: kk,
      failures,
      meanAgentMs:
        n === 0 ? 0 : list.reduce((s, t) => s + t.agentRun.durationMs, 0) / n,
      effort: effortOf(passing),
      perSuccess: perSuccessOf(list),
    });
  }
  const byAblation: Partial<Record<Ablation, number>> = {};
  for (const a of new Set(trials.map((t) => t.ablation)))
    byAblation[a] = rate(trials.filter((t) => t.ablation === a));
  const bySuite: Partial<Record<EvalSuite, number>> = {};
  for (const s of new Set(trials.map((t) => t.suite)))
    bySuite[s] = rate(trials.filter((t) => t.suite === s));
  return {
    cells,
    overallPassRate: rate(trials),
    unverified: trials.length - verified(trials).length,
    worstCasePassRate:
      trials.length === 0 ? 0 : trials.filter((t) => t.pass).length / trials.length,
    byAblation,
    bySuite,
  };
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
    meta.mcp && meta.mcp !== "none" && `MCP: ${meta.mcp}`,
    meta.sandbox === "docker" && "Docker sandbox",
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
  lines.push(
    `Overall pass rate: **${pct(summary.overallPassRate)}**` +
      (summary.unverified > 0
        ? ` (over verified trials; **${summary.unverified} unverified**, left out: their evidence is incomplete; **${pct(summary.worstCasePassRate)}** if they all failed)`
        : ""),
  );
  const graded = summary.cells.filter((c) => c.n > 0);
  if (graded.length > 0)
    lines.push(
      "",
      // An average hides the task that fails one attempt in three.
      `Every attempt passed on **${graded.filter((c) => c.passes === c.n).length} of ${graded.length}** task/ablation cells. ` +
        "The interval next to each pass@1 is where the true rate plausibly lies; with few trials it is wide.",
    );
  lines.push("");
  lines.push("### Quality");
  lines.push("");
  lines.push(
    "| Task | Suite | Ablation | Passes | pass@1 (95% interval) | pass@k | pass^k | Failing graders | Unverified |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const c of summary.cells) {
    const failing = Object.entries(c.failures)
      .map(([id, n]) => `${id}×${n}`)
      .join(", ");
    lines.push(
      `| ${c.taskId} | ${c.suite} | ${c.ablation} | ${c.passes}/${c.n} | ${pct(c.passAt1)}${
        c.passAt1Interval ? ` (${pct(c.passAt1Interval[0])}–${pct(c.passAt1Interval[1])})` : ""
      } | ` +
        `${pct(c.passAtK)} (k=${c.k}) | ${pct(c.passHatK)} | ${failing || dash} | ${c.unverified || dash} |`,
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
  lines.push("");
  lines.push("### Cost per success (all trials, failed ones included, ÷ passes)");
  lines.push("");
  lines.push("| Task | Ablation | Time | Tokens | Cost |");
  lines.push("|---|---|---|---|---|");
  for (const c of summary.cells) {
    const e = c.perSuccess;
    const none = c.passes === 0 ? "no passes" : dash;
    lines.push(
      `| ${c.taskId} | ${c.ablation} | ` +
        `${e.agentMs === undefined ? none : `${(e.agentMs / 1000).toFixed(0)}s`} | ` +
        `${e.tokens === undefined ? none : `${(e.tokens / 1000).toFixed(0)}k`} | ` +
        `${
          e.costUsd !== undefined
            ? `$${e.costUsd.toFixed(2)}`
            : e.premiumRequests !== undefined
              ? `${e.premiumRequests.toFixed(1)} req`
              : none
        } |`,
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
  /**
   * `regressed` / `improved`: pass@1 moved and the two 95% intervals do not
   * overlap, or (regressed) the guardrail-failure rate rose. `uncertain`:
   * pass@1 moved, but the intervals overlap, so the change could be chance.
   */
  readonly status: "regressed" | "improved" | "uncertain" | "same" | "added" | "removed";
  readonly baseEffort?: EffortSummary;
  readonly headEffort?: EffortSummary;
  /** Guardrail-grader failures in base and head. */
  readonly guardrailFailures: { readonly base: number; readonly head: number };
  /** Unverified trials in base and head; nonzero makes the row unreliable. */
  readonly unverified: { readonly base: number; readonly head: number };
}

/**
 * Compare two runs cell by cell (same task and ablation).
 *
 * A pass@1 change is called `regressed` or `improved` only when the two 95%
 * Wilson intervals do not overlap; otherwise it is `uncertain`: with a
 * handful of trials per cell, 3/3 against 2/3 is well within chance, and
 * calling it a regression misleads. To settle an `uncertain` row, rerun that
 * task 20 to 30 times with and without the change into a separate results
 * folder (never into the main run's totals).
 *
 * A rise in the guardrail-failure rate is always `regressed`, whatever the
 * sample size: it is a security control seen being weakened in a trace, a
 * fact to read, not a rate to estimate. Either way a regression is a reason
 * to read traces, not a verdict.
 *
 * Intervals are computed from the stored counts, so results files written
 * before {@link CellSummary.passAt1Interval} existed compare the same way.
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
    else if (h.n > 0 && b.n > 0 && guardrailFailures.head / h.n > guardrailFailures.base / b.n)
      status = "regressed";
    else if (h.n === 0 || b.n === 0) status = h.n === b.n ? "same" : "uncertain";
    else if (h.passAt1 === b.passAt1) status = "same";
    else {
      const [bLo, bHi] = wilsonInterval(b.n, b.passes);
      const [hLo, hHi] = wilsonInterval(h.n, h.passes);
      if (hHi < bLo) status = "regressed";
      else if (hLo > bHi) status = "improved";
      else status = "uncertain";
    }
    rows.push({
      taskId: any.taskId,
      ablation: any.ablation,
      ...(b ? { basePassAt1: b.passAt1, baseEffort: b.effort } : {}),
      ...(h ? { headPassAt1: h.passAt1, headEffort: h.effort } : {}),
      status,
      guardrailFailures,
      unverified: { base: b?.unverified ?? 0, head: h?.unverified ?? 0 },
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
  const order = { regressed: 0, removed: 1, added: 2, uncertain: 3, improved: 4, same: 5 };
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
      `could be chance: ${rows.filter((r) => r.status === "uncertain").length} · ` +
      `unchanged: ${rows.filter((r) => r.status === "same").length}`,
    "",
    "A pass@1 change counts as regressed or improved only when the 95% intervals do not overlap; " +
      "a rise in guardrail failures always counts. **Could be chance**: rerun that task 20 to 30 times " +
      "with and without the change, in a separate results folder, before believing it.",
    "",
    "| Status | Task | Ablation | pass@1 | Guardrail failures | Time (passing) | Tokens (passing) |",
    "|---|---|---|---|---|---|---|",
  ];
  const shaky = rows.filter((r) => r.unverified.base + r.unverified.head > 0);
  if (shaky.length > 0)
    lines.splice(
      4,
      0,
      `**${shaky.length} row(s) include unverified trials** (marked ⚠): their pass rates cover fewer trials than the run had, so treat those comparisons as incomplete.`,
      "",
    );
  for (const r of sorted) {
    lines.push(
      `| ${r.status === "uncertain" ? "could be chance" : r.status}${r.unverified.base + r.unverified.head > 0 ? " ⚠" : ""} | ${r.taskId} | ${r.ablation} | ${p(r.basePassAt1)} → ${p(r.headPassAt1)} | ` +
        `${r.guardrailFailures.base} → ${r.guardrailFailures.head} | ` +
        `${time(r.baseEffort)} → ${time(r.headEffort)} | ${tok(r.baseEffort)} → ${tok(r.headEffort)} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}
