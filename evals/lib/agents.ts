/**
 * Agent adapters. An adapter turns (task, workspace) into an agent run.
 *
 * - Offline adapters (`noop`, `reference`, `unsafe:<id>`) apply deterministic
 *   steps and exist to calibrate the graders.
 * - Live adapters (`copilot`, `claude`, `codex`, `command`) drive a real
 *   coding agent headlessly. They run with broad tool permissions inside the
 *   throwaway workspace, so the runner refuses them unless the caller passes
 *   `--sandbox-ack`, confirming the run happens in an isolated container or
 *   VM with no secrets beyond the agent's own API key.
 *
 * @module
 */

import { childEnv, runProcess, workspaceHandle } from "./workspace.ts";
import type { AgentRunResult, EvalTask } from "./types.ts";

/** What an adapter receives for one trial. */
export interface AgentInvocation {
  readonly task: EvalTask;
  /** Workspace root (the agent's working directory). */
  readonly dir: string;
  /** Full prompt: environment preamble plus the task prompt. */
  readonly prompt: string;
  readonly timeoutMs: number;
  /** Optional model override, passed to CLIs that accept one. */
  readonly model?: string;
}

/** A named way to run an agent. */
export interface AgentAdapter {
  readonly name: string;
  /** `true` when the adapter executes a real, tool-using agent. */
  readonly live: boolean;
  run(inv: AgentInvocation): Promise<AgentRunResult>;
}

/**
 * Environment notes prepended to every task prompt. They describe the
 * sandbox only; they never hint at what the graders check.
 */
export const PROMPT_PREAMBLE = [
  "You are working in a DaloyJS project in the current directory.",
  "Dependencies are already installed and the machine is offline: do not run",
  "`pnpm install` or add packages. `pnpm typecheck` and `pnpm test` work.",
  "Complete the request below, then stop.",
  "",
  "Request:",
].join("\n");

/**
 * Compose the prompt an agent receives.
 *
 * @param task - The task.
 * @returns The preamble followed by the task prompt.
 */
export function buildPrompt(task: EvalTask): string {
  return `${PROMPT_PREAMBLE}\n${task.prompt.trim()}\n`;
}

const OUTPUT_TAIL_CHARS = 8_000;

function offline(
  name: string,
  step: (inv: AgentInvocation) => Promise<void>,
): AgentAdapter {
  return {
    name,
    live: false,
    async run(inv) {
      const started = Date.now();
      await step(inv);
      return {
        exitCode: 0,
        timedOut: false,
        durationMs: Date.now() - started,
        outputTail: "",
      };
    },
  };
}

function cli(
  name: string,
  command: string,
  envKeys: readonly string[],
  args: (inv: AgentInvocation) => string[],
): AgentAdapter {
  return {
    name,
    live: true,
    async run(inv) {
      const r = await runProcess(command, args(inv), {
        cwd: inv.dir,
        env: childEnv(envKeys),
        timeoutMs: inv.timeoutMs,
      });
      return {
        exitCode: r.exitCode,
        timedOut: r.timedOut,
        durationMs: r.durationMs,
        outputTail: r.output.slice(-OUTPUT_TAIL_CHARS),
      };
    },
  };
}

const withModel = (flag: string, inv: AgentInvocation): string[] =>
  inv.model ? [flag, inv.model] : [];

/**
 * Parse `DALOY_EVAL_AGENT_CMD`: a JSON array of strings where `{prompt}` and
 * `{dir}` are substituted per trial. No shell is involved.
 *
 * @param raw - The variable's value.
 * @returns The argv template.
 * @throws Error when the value is not a non-empty JSON array of strings.
 */
export function parseCommandTemplate(raw: string | undefined): string[] {
  if (!raw)
    throw new Error(
      "agent `command` needs DALOY_EVAL_AGENT_CMD (a JSON array of strings)",
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("DALOY_EVAL_AGENT_CMD must be a JSON array of strings");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    !parsed.every((x) => typeof x === "string")
  ) {
    throw new Error(
      "DALOY_EVAL_AGENT_CMD must be a non-empty JSON array of strings",
    );
  }
  return parsed as string[];
}

/**
 * Resolve an adapter by name.
 *
 * @param name - `noop`, `reference`, `unsafe:<variant>`, `copilot`, `claude`,
 *   `codex`, or `command`.
 * @param env - Environment to read `DALOY_EVAL_AGENT_CMD` from.
 * @returns The adapter.
 * @throws Error for an unknown name or a bad `command` template.
 */
export function resolveAgent(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): AgentAdapter {
  if (name === "noop") return offline(name, async () => {});
  if (name === "reference") {
    return offline(name, async ({ task, dir }) =>
      task.reference(workspaceHandle(dir)),
    );
  }
  if (name.startsWith("unsafe:")) {
    const variantId = name.slice("unsafe:".length);
    return offline(name, async ({ task, dir }) => {
      const variant = task.unsafe.find((v) => v.id === variantId);
      if (!variant)
        throw new Error(`task ${task.id} has no unsafe variant "${variantId}"`);
      await variant.apply(workspaceHandle(dir));
    });
  }
  switch (name) {
    case "copilot":
      // GitHub Copilot CLI, non-interactive.
      return cli(
        name,
        "copilot",
        ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN", "XDG_CONFIG_HOME"],
        (inv) => [
          "-p",
          inv.prompt,
          "--allow-all-tools",
          ...withModel("--model", inv),
        ],
      );
    case "claude":
      // Claude Code in print mode; permissions bypassed because the sandbox is the boundary.
      return cli(
        name,
        "claude",
        ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "XDG_CONFIG_HOME"],
        (inv) => [
          "-p",
          inv.prompt,
          "--output-format",
          "json",
          "--permission-mode",
          "bypassPermissions",
          ...withModel("--model", inv),
        ],
      );
    case "codex":
      // Codex CLI with its own OS sandbox limited to the workspace.
      return cli(name, "codex", ["OPENAI_API_KEY", "CODEX_HOME"], (inv) => [
        "exec",
        "--sandbox",
        "workspace-write",
        "--skip-git-repo-check",
        "-C",
        inv.dir,
        ...withModel("-m", inv),
        inv.prompt,
      ]);
    case "command": {
      const template = parseCommandTemplate(env.DALOY_EVAL_AGENT_CMD);
      const passthrough = (env.DALOY_EVAL_AGENT_ENV ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return cli(name, template[0]!, passthrough, (inv) =>
        template
          .slice(1)
          .map((a) =>
            a.replaceAll("{prompt}", inv.prompt).replaceAll("{dir}", inv.dir),
          ),
      );
    }
    default:
      throw new Error(
        `unknown agent "${name}". Use one of: noop, reference, unsafe:<variant>, copilot, claude, codex, command`,
      );
  }
}
