/**
 * Deterministic trace analysis for `pnpm eval:analyze`: what agents did
 * across a run (files read, tests run and added, skills and docs used), the
 * root causes behind failures, and passes worth a second look.
 *
 * No model is involved, so the analysis is free, offline, and repeatable. It
 * points a reviewer at the traces to read; it does not replace reading them.
 *
 * @module
 */

import type { AgentTrace, TrialResult } from "./types.ts";

/** A trial plus where it came from, ready to analyse. */
export interface AnalyzedTrial {
  /** Results file the trial was read from (its label in the report). */
  readonly source: string;
  readonly trial: TrialResult;
  /** The trace, from the results JSON or re-parsed from the trace file. */
  readonly trace?: AgentTrace;
}

/** Behaviour counts over a set of trials. */
export interface UsageSummary {
  readonly trials: number;
  /** Trials with a trace to analyse. */
  readonly traced: number;
  readonly finalAnswer: number;
  readonly ranTests: number;
  readonly ranTypecheck: number;
  readonly addedTests: number;
  readonly loadedSkill: number;
  readonly usedDocsMcp: number;
  /** Mean files looked at, over traced trials. */
  readonly meanFilesRead: number;
}

/** A group of failures with the same task, grader, and failing check. */
export interface FailureCause {
  readonly taskId: string;
  readonly grader: string;
  /** Failing test name or first detail line. */
  readonly check: string;
  readonly count: number;
  /** `source#task/ablation/trial` of up to three examples. */
  readonly examples: readonly string[];
}

/** A passing trial a reviewer should open. */
export interface ReviewFlag {
  readonly trial: string;
  readonly reason: string;
}

/** The analysis of one or more results files. */
export interface Analysis {
  readonly usage: UsageSummary;
  readonly usageByTask: Readonly<Record<string, UsageSummary>>;
  readonly causes: readonly FailureCause[];
  readonly flags: readonly ReviewFlag[];
  /** Unverified trials and why (grader ids or the trial's reason). */
  readonly unverified: readonly ReviewFlag[];
}

const TEST_CMD = /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?test\b|node\s+(?:[^|;&]*\s)?--test\b|\bvitest\b|\bjest\b/;
const TYPECHECK_CMD = /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?typecheck\b|\btsc\b/;
const REPORTS_TROUBLE =
  /\b(?:could(?:n'?t| not)|unable to|did(?:n'?t| not) (?:pass|work)|still fail|tests? (?:are |is )?failing|(?:was|were) not able)\b/i;

/** Whether the agent's diff adds or edits a test file. */
export function diffTouchesTests(diff: string): boolean {
  return /^diff --git a\/(?:\S*\/)?tests?\/\S+ b\//m.test(diff) ||
    /^diff --git a\/\S+\.test\.\w+ b\//m.test(diff);
}

/**
 * Failing checks named in a grade's details: `✖ <test name>` lines from the
 * Node test runner, else the first non-empty detail line.
 *
 * @param details - The grade's details.
 * @returns Check names (at least one).
 */
export function failingChecks(details: readonly string[]): string[] {
  const names = new Set<string>();
  for (const block of details) {
    for (const line of block.split("\n")) {
      const m = /^\s*✖ (.+?)(?: \(\d[\d.]*m?s\))?$/.exec(line);
      if (m && m[1] !== "failing tests:") names.add(m[1]!.trim());
    }
  }
  if (names.size > 0) return [...names];
  const first = details
    .flatMap((d) => d.split("\n"))
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !/^exit \d+$/.test(l));
  return [first?.slice(0, 160) ?? "(no details)"];
}

function usageOf(items: readonly AnalyzedTrial[]): UsageSummary {
  const traced = items.filter((i) => i.trace);
  const count = (p: (i: AnalyzedTrial) => boolean): number =>
    items.filter(p).length;
  const cmds = (i: AnalyzedTrial): readonly string[] =>
    i.trace?.shellCommands ?? [];
  return {
    trials: items.length,
    traced: traced.length,
    finalAnswer: count((i) => !!i.trace?.finalMessage),
    ranTests: count((i) => cmds(i).some((c) => TEST_CMD.test(c))),
    ranTypecheck: count((i) => cmds(i).some((c) => TYPECHECK_CMD.test(c))),
    addedTests: count((i) => diffTouchesTests(i.trial.diff)),
    loadedSkill: count((i) => (i.trace?.skills.length ?? 0) > 0),
    usedDocsMcp: count((i) => (i.trace?.docsMcpCalls ?? 0) > 0),
    meanFilesRead:
      traced.length === 0
        ? 0
        : traced.reduce((s, i) => s + i.trace!.filesRead.length, 0) /
          traced.length,
  };
}

const label = (i: AnalyzedTrial): string =>
  `${i.source}#${i.trial.taskId}/${i.trial.ablation}/${i.trial.trial}`;

/**
 * Analyse trials from one or more runs.
 *
 * @param items - Trials with their traces.
 * @returns Usage, failure causes (most frequent first), and review flags.
 */
export function analyze(items: readonly AnalyzedTrial[]): Analysis {
  const byTask = new Map<string, AnalyzedTrial[]>();
  for (const i of items) {
    const list = byTask.get(i.trial.taskId) ?? [];
    list.push(i);
    byTask.set(i.trial.taskId, list);
  }
  const usageByTask: Record<string, UsageSummary> = {};
  for (const [task, list] of byTask) usageByTask[task] = usageOf(list);

  const causes = new Map<string, { cause: Omit<FailureCause, "count" | "examples">; examples: string[] }>();
  for (const i of items) {
    if (i.trial.pass) continue;
    for (const g of i.trial.grades) {
      // Missing evidence is not a failure cause; it is listed separately.
      if (g.pass || g.unverified) continue;
      for (const check of failingChecks(g.details)) {
        const key = `${i.trial.taskId}\u0000${g.id}\u0000${check}`;
        const entry = causes.get(key) ?? {
          cause: { taskId: i.trial.taskId, grader: g.id, check },
          examples: [],
        };
        entry.examples.push(label(i));
        causes.set(key, entry);
      }
    }
  }

  const flags: ReviewFlag[] = [];
  for (const i of items) {
    if (!i.trial.pass) continue;
    const t = i.trace;
    if (i.trial.agentRun.timedOut)
      flags.push({ trial: label(i), reason: "passed although the agent timed out" });
    if (!t) continue;
    if (!t.finalMessage)
      flags.push({ trial: label(i), reason: "passed with no final answer to the user" });
    else if (REPORTS_TROUBLE.test(t.finalMessage))
      flags.push({ trial: label(i), reason: "passed, but the final answer reports a problem" });
    if (
      i.trial.suite !== "dont-act" &&
      t.shellCommands.length > 0 &&
      !t.shellCommands.some((c) => TEST_CMD.test(c))
    )
      flags.push({ trial: label(i), reason: "passed without the agent ever running the tests" });
  }

  const unverified: ReviewFlag[] = items
    .filter((i) => i.trial.unverified)
    .map((i) => ({
      trial: label(i),
      reason:
        (i.trial as { unverifiedReason?: string }).unverifiedReason ??
        i.trial.grades
          .filter((g) => g.unverified)
          .map((g) => g.id)
          .join(", "),
    }));
  return {
    unverified,
    usage: usageOf(items),
    usageByTask,
    causes: [...causes.values()]
      .map((e) => ({ ...e.cause, count: e.examples.length, examples: e.examples.slice(0, 3) }))
      .sort((a, b) => b.count - a.count || a.taskId.localeCompare(b.taskId)),
    flags,
  };
}

const share = (n: number, of: number): string =>
  of === 0 ? "—" : `${n}/${of} (${Math.round((100 * n) / of)}%)`;

function usageRow(name: string, u: UsageSummary): string {
  return (
    `| ${name} | ${u.trials} | ${share(u.finalAnswer, u.traced)} | ${share(u.ranTests, u.traced)} | ` +
    `${share(u.ranTypecheck, u.traced)} | ${share(u.addedTests, u.trials)} | ${share(u.loadedSkill, u.traced)} | ` +
    `${share(u.usedDocsMcp, u.traced)} | ${u.traced === 0 ? "—" : u.meanFilesRead.toFixed(1)} |`
  );
}

/**
 * Render an analysis as Markdown.
 *
 * @param a - From {@link analyze}.
 * @param sources - Results files analysed, for the heading.
 * @returns Markdown text.
 */
export function renderAnalysis(a: Analysis, sources: readonly string[]): string {
  const lines = [
    "## DaloyJS agent-eval trace analysis",
    "",
    `Sources: ${sources.map((s) => `\`${s}\``).join(", ")}`,
    "",
    "### What the agents did",
    "",
    "| Task | Trials | Final answer | Ran tests | Ran typecheck | Added tests | Loaded a skill | Used docs MCP | Files looked at |",
    "|---|---|---|---|---|---|---|---|---|",
    usageRow("**all**", a.usage),
    ...Object.entries(a.usageByTask).map(([t, u]) => usageRow(t, u)),
    "",
    "### Failure causes (most frequent first)",
    "",
  ];
  if (a.causes.length === 0) lines.push("No failing trials.");
  else {
    lines.push("| Task | Grader | Failing check | Trials | Examples |", "|---|---|---|---|---|");
    for (const c of a.causes)
      lines.push(
        `| ${c.taskId} | ${c.grader} | ${c.check.replaceAll("|", "\\|")} | ${c.count} | ${c.examples.join("<br>")} |`,
      );
  }
  if (a.unverified.length > 0) {
    lines.push("", "### Unverified trials (evidence missing; not counted as failures)", "");
    for (const u of a.unverified) lines.push(`- \`${u.trial}\`: ${u.reason}`);
  }
  lines.push("", "### Passes to review", "");
  if (a.flags.length === 0) lines.push("Nothing flagged.");
  else for (const f of a.flags) lines.push(`- \`${f.trial}\`: ${f.reason}`);
  lines.push(
    "",
    "Flags and causes are pointers, not verdicts: open the trace and the diff before acting on them.",
  );
  return `${lines.join("\n")}\n`;
}
