/**
 * `pnpm eval:analyze` — summarise what agents did in one or more eval runs:
 * files read, tests run and added, skills and docs MCP used, the root causes
 * behind failures, and passes worth a second look. Deterministic and offline
 * (no model is called); it tells you which traces to read.
 *
 * Traces are re-parsed from the saved `<results>-traces/*.log` files when
 * present (so parser fixes apply to old runs), else read from the JSON.
 *
 * Usage: `pnpm eval:analyze <results.json> [...] [--out analysis.md]`
 */

import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { analyze, renderAnalysis, type AnalyzedTrial } from "./lib/analyze.ts";
import { loadTrialTrace } from "./lib/trace.ts";
import type { TrialResult } from "./lib/types.ts";

interface ResultsFile {
  readonly meta?: { readonly agent?: string };
  readonly trials: readonly TrialResult[];
}

async function load(path: string): Promise<AnalyzedTrial[]> {
  const data = JSON.parse(await readFile(path, "utf8")) as ResultsFile;
  const source = basename(path).replace(/\.json$/, "");
  const out: AnalyzedTrial[] = [];
  for (const trial of data.trials) {
    const trace = await loadTrialTrace(path, data.meta?.agent ?? "", trial);
    out.push({ source, trial, ...(trace ? { trace } : {}) });
  }
  return out;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const outAt = argv.indexOf("--out");
  const out = outAt !== -1 ? argv[outAt + 1] : undefined;
  if (outAt !== -1 && !out) throw new Error("--out needs a file path");
  const files = argv.filter(
    (_, i) => outAt === -1 || (i !== outAt && i !== outAt + 1),
  );
  if (files.length === 0)
    throw new Error("usage: pnpm eval:analyze <results.json> [...] [--out analysis.md]");
  const items = (await Promise.all(files.map(load))).flat();
  const markdown = renderAnalysis(analyze(items), files.map((f) => basename(f)));
  if (out) await writeFile(out, markdown);
  process.stdout.write(markdown);
}

try {
  await main();
} catch (err) {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exitCode = 1;
}
