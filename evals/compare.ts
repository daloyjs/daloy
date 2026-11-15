/**
 * `pnpm eval:compare <base.json> <head.json>` — compare two `pnpm eval` runs
 * cell by cell: fix the framework, docs, or skill, rerun the same tasks with
 * the same agent and limits, and see what moved.
 *
 * Refuses to compare runs whose agent, agent version, model, or time limit
 * differ unless `--allow-mismatch` is passed: otherwise the difference could
 * come from the agent, not the change under test. A new model is baselined
 * with its own run first, then compared against itself.
 *
 * Exits 1 with `--fail-on-regression` when any cell regressed.
 */

import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  compareRuns,
  renderComparison,
  type RunMeta,
  type RunSummary,
} from "./lib/report.ts";

/** The parts of a results file this command reads. */
interface ResultsFile {
  readonly meta?: RunMeta;
  readonly summary: RunSummary;
}

/** Fields that must match for a comparison to isolate the change under test. */
const PINNED: readonly (keyof RunMeta)[] = [
  "agent",
  "agentVersion",
  "model",
  "timeoutMs",
];

/**
 * Which pinned fields differ between two runs.
 *
 * @param base - Metadata of the earlier run.
 * @param head - Metadata of the run under test.
 * @returns Human-readable mismatches; empty when the runs are comparable.
 */
export function pinMismatches(
  base: RunMeta | undefined,
  head: RunMeta | undefined,
): string[] {
  return PINNED.filter((k) => base?.[k] !== head?.[k]).map(
    (k) =>
      `${k}: ${String(base?.[k] ?? "unset")} vs ${String(head?.[k] ?? "unset")}`,
  );
}

async function load(path: string): Promise<ResultsFile> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as ResultsFile;
  if (!parsed?.summary?.cells)
    throw new Error(`${path} is not a pnpm eval results file`);
  return parsed;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const files = args.filter((a) => !a.startsWith("--"));
  const outIdx = args.indexOf("--out");
  const outPath = outIdx !== -1 ? args[outIdx + 1] : undefined;
  const positional = files.filter((f) => f !== outPath);
  if (positional.length !== 2) {
    throw new Error(
      "usage: pnpm eval:compare <base.json> <head.json> [--out <file.md>] [--fail-on-regression] [--allow-mismatch]",
    );
  }
  const [basePath, headPath] = positional as [string, string];
  const [base, head] = [await load(basePath), await load(headPath)];

  const mismatches = pinMismatches(base.meta, head.meta);
  if (mismatches.length > 0 && !args.includes("--allow-mismatch")) {
    throw new Error(
      `runs are not comparable (${mismatches.join("; ")}). ` +
        "Rerun with the same agent, version, model, and limits, or pass --allow-mismatch.",
    );
  }

  const rows = compareRuns(base.summary, head.summary);
  const label = (m: RunMeta | undefined, p: string): string =>
    m?.coreVersion
      ? `${m.coreVersion}${m.gitSha ? `@${m.gitSha.slice(0, 7)}` : ""}`
      : basename(p);
  const markdown = renderComparison(rows, {
    base: label(base.meta, basePath),
    head: label(head.meta, headPath),
  });
  if (outPath) await writeFile(outPath, markdown);
  process.stdout.write(markdown);
  if (
    args.includes("--fail-on-regression") &&
    rows.some((r) => r.status === "regressed")
  )
    process.exitCode = 1;
}

if (
  process.argv[1]?.endsWith("compare.ts") ||
  process.argv[1]?.endsWith("compare.js")
) {
  try {
    await main();
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exitCode = 1;
  }
}
