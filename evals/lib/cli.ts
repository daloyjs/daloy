/**
 * Argument parsing and task selection for `pnpm eval`. Pure functions so they
 * can be unit-tested without spawning anything.
 *
 * @module
 */

import {
  ABLATIONS,
  SUITES,
  type Ablation,
  type EvalSuite,
  type EvalTask,
} from "./types.ts";

/** Parsed `pnpm eval` options. */
export interface RunOptions {
  readonly agent: string;
  readonly suites: readonly EvalSuite[];
  readonly tasks: readonly string[];
  readonly ablations: readonly Ablation[];
  readonly trials: number;
  readonly k: number;
  readonly timeoutMs: number;
  readonly out: string | undefined;
  readonly keep: boolean;
  readonly sandboxAck: boolean;
  readonly model: string | undefined;
  readonly failUnder: number | undefined;
  readonly list: boolean;
}

/** Usage text for `pnpm eval --help`. */
export const USAGE = `Usage: pnpm eval --agent <name> [options]

Agents:
  noop | reference | unsafe:<variant>   offline, for calibration
  copilot | claude | codex | command    live; require --sandbox-ack

Options:
  --suite <list>        guardrail,scaffold,migration (default: all)
  --task <list>         task ids (default: all in the selected suites)
  --ablation <list>     ${ABLATIONS.join(",")} (default: full)
  --trials <n>          trials per task and ablation (default: 1)
  --k <n>               k for pass@k / pass^k (default: trials)
  --timeout-min <n>     agent wall-clock budget per trial (default: 20)
  --model <id>          model passed to the agent CLI
  --out <file>          JSON results path (default: evals/results/<time>-<agent>.json)
  --fail-under <0..1>   exit 1 when the overall pass rate is below this
  --keep                keep trial workspaces for inspection
  --sandbox-ack         confirm live agents run in an isolated, secret-free sandbox
  --list                list tasks and exit
`;

function list(value: string | undefined, flag: string): string[] {
  if (!value) throw new Error(`${flag} needs a value`);
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function int(value: string | undefined, flag: string, min: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min)
    throw new Error(`${flag} must be an integer >= ${min}`);
  return n;
}

/**
 * Parse `pnpm eval` arguments.
 *
 * @param argv - Arguments after the script name.
 * @returns Validated options.
 * @throws Error on unknown flags, bad values, or a missing `--agent`.
 */
export function parseRunArgs(argv: readonly string[]): RunOptions {
  const args = [...argv];
  let agent: string | undefined;
  let suites: EvalSuite[] = [...SUITES];
  let tasks: string[] = [];
  let ablations: Ablation[] = ["full"];
  let trials = 1;
  let k: number | undefined;
  let timeoutMs = 20 * 60_000;
  let out: string | undefined;
  let keep = false;
  let sandboxAck = false;
  let model: string | undefined;
  let failUnder: number | undefined;
  let listOnly = false;

  while (args.length > 0) {
    const raw = args.shift()!;
    const eq = raw.indexOf("=");
    const flag = raw.startsWith("--") && eq !== -1 ? raw.slice(0, eq) : raw;
    const next = (): string | undefined =>
      raw.startsWith("--") && eq !== -1 ? raw.slice(eq + 1) : args.shift();
    switch (flag) {
      case "--agent":
        agent = next();
        break;
      case "--suite": {
        const values = list(next(), flag);
        for (const v of values)
          if (!SUITES.includes(v as EvalSuite))
            throw new Error(`unknown suite "${v}"`);
        suites = values as EvalSuite[];
        break;
      }
      case "--task":
        tasks = list(next(), flag);
        break;
      case "--ablation": {
        const values = list(next(), flag);
        for (const v of values)
          if (!ABLATIONS.includes(v as Ablation))
            throw new Error(`unknown ablation "${v}"`);
        ablations = values as Ablation[];
        break;
      }
      case "--trials":
        trials = int(next(), flag, 1);
        break;
      case "--k":
        k = int(next(), flag, 1);
        break;
      case "--timeout-min":
        timeoutMs = int(next(), flag, 1) * 60_000;
        break;
      case "--out":
        out = next();
        break;
      case "--model":
        model = next();
        break;
      case "--fail-under": {
        const v = Number(next());
        if (!Number.isFinite(v) || v < 0 || v > 1)
          throw new Error("--fail-under must be between 0 and 1");
        failUnder = v;
        break;
      }
      case "--keep":
        keep = true;
        break;
      case "--sandbox-ack":
        sandboxAck = true;
        break;
      case "--list":
        listOnly = true;
        break;
      default:
        throw new Error(`unknown argument "${raw}"\n\n${USAGE}`);
    }
  }
  if (!agent && !listOnly) throw new Error(`--agent is required\n\n${USAGE}`);
  if (k !== undefined && k > trials)
    throw new Error("--k cannot exceed --trials");
  return {
    agent: agent ?? "noop",
    suites,
    tasks,
    ablations,
    trials,
    k: k ?? trials,
    timeoutMs,
    out,
    keep,
    sandboxAck,
    model,
    failUnder,
    list: listOnly,
  };
}

/**
 * Pick the tasks a run covers.
 *
 * @param all - The registry.
 * @param suites - Suites to include.
 * @param ids - Explicit task ids (empty means every task in `suites`).
 * @returns Selected tasks in registry order.
 * @throws Error when an explicit id does not exist.
 */
export function selectTasks(
  all: readonly EvalTask[],
  suites: readonly EvalSuite[],
  ids: readonly string[],
): EvalTask[] {
  for (const id of ids)
    if (!all.some((t) => t.id === id)) throw new Error(`unknown task "${id}"`);
  return all.filter(
    (t) => suites.includes(t.suite) && (ids.length === 0 || ids.includes(t.id)),
  );
}
