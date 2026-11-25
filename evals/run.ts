/**
 * `pnpm eval` — run AI coding agents against the DaloyJS eval tasks.
 *
 * Every trial scaffolds a fresh project with the local `create-daloy`, runs
 * the agent headlessly, then grades the result with deterministic checks
 * (typecheck, visible tests, hidden tests, static guardrail diff). Results
 * are written as JSON plus a Markdown summary (also appended to
 * `$GITHUB_STEP_SUMMARY` when set).
 *
 * Live agents get broad tool permissions, so they are refused unless
 * `--sandbox docker` runs them in a container that sees only their workspace
 * (or `--sandbox-ack` confirms this whole machine is an isolated VM). See
 * `evals/README.md`.
 *
 * Examples:
 *   pnpm eval --agent reference
 *   pnpm eval --agent codex --sandbox docker --suite guardrail --trials 5
 *   pnpm eval --agent claude --sandbox docker --ablation full,bare --trials 3
 */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { resolveAgent } from "./lib/agents.ts";
import { parseRunArgs, selectTasks, USAGE } from "./lib/cli.ts";
import { renderMarkdown, summarize, type RunMeta } from "./lib/report.ts";
import { runTrial } from "./lib/runner.ts";
import {
  AGENT_IMAGE,
  checkAgentImage,
  DEFAULT_EGRESS,
  startEgressProxy,
  type EgressProxy,
} from "./lib/docker-sandbox.ts";
import { DOCS_MCP_HOST, parseAllowlist } from "./lib/egress.ts";
import {
  childEnv,
  DIFF_FORMAT,
  REPO_ROOT,
  runProcess,
} from "./lib/workspace.ts";
import type { AgentAdapter } from "./lib/agents.ts";
import { TASKS } from "./tasks/index.ts";
import type { TrialResult } from "./lib/types.ts";

/** First line of a command's output, or `undefined` when it fails. */
async function firstLine(
  command: string,
  args: string[],
  extraEnv: readonly string[] = [],
): Promise<string | undefined> {
  const r = await runProcess(command, args, {
    cwd: REPO_ROOT,
    env: childEnv(extraEnv),
    timeoutMs: 30_000,
  });
  const line = r.output.trim().split("\n")[0]?.trim();
  return r.exitCode === 0 && line ? line.slice(0, 120) : undefined;
}

/**
 * Record what this run is pinned to, so a later run can be compared against
 * it only when the agent, its version, and the limits match.
 */
async function runMeta(
  agent: AgentAdapter,
  opts: {
    model: string | undefined;
    mcp: string;
    sandbox: string;
    trials: number;
    timeoutMs: number;
  },
): Promise<RunMeta> {
  const pkg = JSON.parse(
    await readFile(join(REPO_ROOT, "package.json"), "utf8"),
  ) as { version?: string };
  const entries = Object.entries({
    agent: agent.name,
    model: opts.model,
    mcp: opts.mcp,
    sandbox: opts.sandbox,
    agentVersion: !agent.command
      ? undefined
      : opts.sandbox === "docker"
        ? await firstLine("docker", ["run", "--rm", "--network", "none", AGENT_IMAGE, agent.command, "--version"])
        : await firstLine(agent.command, ["--version"]),
    gitSha: await firstLine("git", ["rev-parse", "HEAD"]),
    coreVersion: pkg.version,
    node: process.version,
    trials: opts.trials,
    timeoutMs: opts.timeoutMs,
  }).filter(([, v]) => v !== undefined);
  return Object.fromEntries(entries) as unknown as RunMeta;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }
  const opts = parseRunArgs(argv);
  const tasks = selectTasks(TASKS, opts.suites, opts.tasks);

  if (opts.list) {
    for (const t of tasks)
      process.stdout.write(
        `${t.id.padEnd(32)} ${t.suite.padEnd(10)} ${t.title}\n`,
      );
    return;
  }

  const agent = resolveAgent(opts.agent);
  if (agent.live && opts.sandbox !== "docker" && !opts.sandboxAck) {
    throw new Error(
      `"${agent.name}" runs a real agent with broad tool permissions. Pass --sandbox docker (recommended: ` +
        "the agent sees only its workspace), or --sandbox-ack if this whole machine is an isolated, " +
        "secret-free VM.",
    );
  }
  if (agent.live && opts.sandbox !== "docker")
    process.stderr.write(
      "warning: without --sandbox docker the agent can read this repository, including the hidden tests and reference solutions\n",
    );
  if (tasks.length === 0) throw new Error("no tasks selected");
  if (!agent.mcpModes.includes(opts.mcp)) {
    throw new Error(
      `agent "${agent.name}" does not support --mcp ${opts.mcp} (supported: ${agent.mcpModes.join(", ")})`,
    );
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out =
    opts.out ??
    join(
      REPO_ROOT,
      "evals",
      "results",
      `${stamp}-${agent.name.replace(/[^\w-]/g, "_")}.json`,
    );
  await mkdir(dirname(out), { recursive: true });

  let egress: EgressProxy | undefined;
  if (opts.sandbox === "docker") {
    await checkAgentImage(agent.live ? agent.name : "grader");
    if (agent.live) {
      const allow = process.env.EGRESS_ALLOW
        ? parseAllowlist(process.env.EGRESS_ALLOW)
        : [
            ...(DEFAULT_EGRESS[agent.name] ?? []),
            ...(opts.mcp === "docs" ? [DOCS_MCP_HOST] : []),
          ];
      if (allow.length === 0)
        throw new Error(`no default egress allowlist for "${agent.name}"; set EGRESS_ALLOW`);
      egress = await startEgressProxy(allow);
      process.stdout.write(`Egress allowlist: ${allow.join(", ")}\n`);
    }
  }

  const trials: TrialResult[] = [];
  const total = tasks.length * opts.ablations.length * opts.trials;
  let done = 0;
  try {
  for (const task of tasks) {
    for (const ablation of opts.ablations) {
      for (let trial = 1; trial <= opts.trials; trial++) {
        done++;
        process.stdout.write(
          `[${done}/${total}] ${task.id} · ${ablation} · trial ${trial} ... `,
        );
        const result = await runTrial(task, agent, {
          ablation,
          trial,
          timeoutMs: opts.timeoutMs,
          keep: opts.keep,
          ...(opts.model ? { model: opts.model } : {}),
          mcp: opts.mcp,
          ...(opts.sandbox === "docker" ? { sandbox: "docker" as const } : {}),
          ...(egress ? { egressProxy: { url: egress.url, network: egress.network } } : {}),
        });
        trials.push(result);
        const failed = result.grades.filter((g) => !g.pass).map((g) => g.id);
        process.stdout.write(
          `${result.pass ? "PASS" : result.unverified ? `UNVERIFIED (${failed.join(", ")})` : `FAIL (${failed.join(", ")})`}` +
            `${result.agentRun.timedOut ? " [agent timed out]" : ""}` +
            `${result.workspace ? ` → ${result.workspace}` : ""}\n`,
        );
      }
    }
  }
  } finally {
    if (egress) {
      const log = out.replace(/\.json$/, "") + "-egress.log";
      await egress.stop(log);
      process.stdout.write(`Egress log: ${relative(process.cwd(), log)}\n`);
    }
  }

  const summary = summarize(trials, opts.k);
  const meta = await runMeta(agent, opts);
  const markdown = renderMarkdown(summary, meta);

  // Agent traces go to their own files: reviewers read them next to the app,
  // and they would bloat the results JSON.
  const traceDir = out.replace(/\.json$/, "") + "-traces";
  const stored = [];
  for (const t of trials) {
    const { transcript, ...agentRun } = t.agentRun;
    let tracePath: string | null = null;
    if (transcript) {
      await mkdir(traceDir, { recursive: true });
      tracePath = join(traceDir, `${t.taskId}__${t.ablation}__${t.trial}.log`);
      await writeFile(tracePath, transcript);
    }
    stored.push({ ...t, agentRun, tracePath });
  }
  await writeFile(
    out,
    `${JSON.stringify({ meta, diffFormat: DIFF_FORMAT, startedAt: stamp, options: { ...opts, out }, summary, trials: stored }, null, 2)}\n`,
  );
  await writeFile(out.replace(/\.json$/, ".md"), markdown);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);

  process.stdout.write(
    `\n${markdown}\nResults: ${relative(process.cwd(), out)}\n`,
  );
  if (
    opts.failUnder !== undefined &&
    summary.overallPassRate < opts.failUnder
  ) {
    process.stderr.write(
      `Overall pass rate ${(summary.overallPassRate * 100).toFixed(0)}% is below --fail-under ${opts.failUnder}\n`,
    );
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (err) {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exitCode = 1;
}
