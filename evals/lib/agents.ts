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

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CONTAINER_WORKDIR, runAgentContainer } from "./docker-sandbox.ts";
import { parseTrace, RecordedTrace } from "./trace.ts";
import { childEnv, runProcess, workspaceHandle } from "./workspace.ts";
import {
  DOCS_MCP_URL,
  type AgentEffort,
  type AgentRunResult,
  type EvalTask,
  type McpMode,
  type WorkspaceHandle,
} from "./types.ts";

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
  /** MCP servers offered to the agent (default `none`). */
  readonly mcp?: McpMode;
  /**
   * `docker`: run a live CLI in the agent container, which sees only this
   * workspace (see `docker-sandbox.ts`). Default: run it directly.
   */
  readonly sandbox?: "docker";
  /** This run's egress proxy; required with `sandbox: "docker"`. */
  readonly egressProxy?: { readonly url: string; readonly network: string };
}

/** A named way to run an agent. */
export interface AgentAdapter {
  readonly name: string;
  /** `true` when the adapter executes a real, tool-using agent. */
  readonly live: boolean;
  /** Executable for live agents; `<command> --version` is recorded in results. */
  readonly command?: string;
  /** MCP modes this adapter can provide. Offline adapters ignore MCP. */
  readonly mcpModes: readonly McpMode[];
  /**
   * Names of the credential variables this adapter hands to its CLI. The
   * runner redacts their values from the stored diff, as the adapter does
   * for the agent's output.
   */
  readonly credentialVars?: readonly string[];
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

/**
 * Cap on a live agent's captured output (its trace). Long sessions keep their
 * start and end; see `runProcess`. 200,000 characters (the old cap) lost the
 * start of verbose Copilot sessions, and with it what the agent had read.
 */
export const AGENT_OUTPUT_CAP_CHARS = 4_000_000;

/**
 * A workspace handle that records reads, writes, and `reply()` into a trace,
 * so offline solutions are graded by the same trace graders as live agents.
 *
 * @param dir - Workspace root.
 * @param trace - Recorder to write into.
 * @returns The recording handle.
 */
export function recordingHandle(
  dir: string,
  trace: RecordedTrace,
): WorkspaceHandle {
  const ws = workspaceHandle(dir);
  return {
    ...ws,
    async read(rel) {
      trace.read(rel);
      return ws.read(rel);
    },
    async write(rel, content) {
      trace.write(rel);
      await ws.write(rel, content);
    },
    reply: (message) => trace.reply(message),
  };
}

function offline(
  name: string,
  step: (inv: AgentInvocation, ws: WorkspaceHandle) => Promise<void>,
): AgentAdapter {
  return {
    name,
    live: false,
    mcpModes: ["none", "docs"],
    async run(inv) {
      const started = Date.now();
      const trace = new RecordedTrace();
      await step(inv, recordingHandle(inv.dir, trace));
      return {
        exitCode: 0,
        timedOut: false,
        durationMs: Date.now() - started,
        outputTail: "",
        trace: trace.build(),
      };
    },
  };
}

/** Which CLI output format {@link parseEffort} should read. */
export type EffortFormat =
  "claude-json" | "codex-jsonl" | "copilot-jsonl" | "none";

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;

function jsonLines(output: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of output.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const v: unknown = JSON.parse(t);
      if (v && typeof v === "object" && !Array.isArray(v))
        out.push(v as Record<string, unknown>);
    } catch {
      // Not a JSON line (agent chatter, stderr).
    }
  }
  return out;
}

function compact(e: AgentEffort): AgentEffort | undefined {
  const entries = Object.entries(e).filter(([, v]) => v !== undefined);
  return entries.length > 0
    ? (Object.fromEntries(entries) as AgentEffort)
    : undefined;
}

/**
 * Read the effort an agent CLI reports in its own output: Claude Code's
 * final `result` object in `--output-format stream-json` (or `json`) output (`num_turns`, `usage`,
 * `total_cost_usd`), Codex's `exec --json` event stream (`usage` on
 * `turn.completed`, one step per completed item), or Copilot CLI's
 * `--output-format json` stream (per-model tokens in the last
 * `session.usage_checkpoint`, premium requests, one step per turn). Unknown shapes yield
 * `undefined` instead of a guess.
 *
 * @param format - Which CLI produced the output.
 * @param output - Captured stdout/stderr.
 * @returns The reported effort, or `undefined` when none was found.
 */
export function parseEffort(
  format: EffortFormat,
  output: string,
): AgentEffort | undefined {
  if (format === "claude-json") {
    const result = jsonLines(output)
      .reverse()
      .find((o) => o.type === "result" || "total_cost_usd" in o);
    if (!result) return undefined;
    const usage = (result.usage ?? {}) as Record<string, unknown>;
    const input = [
      usage.input_tokens,
      usage.cache_creation_input_tokens,
      usage.cache_read_input_tokens,
    ]
      .map(num)
      .filter((v): v is number => v !== undefined);
    return compact({
      steps: num(result.num_turns),
      inputTokens:
        input.length > 0 ? input.reduce((a, b) => a + b, 0) : undefined,
      outputTokens: num(usage.output_tokens),
      costUsd: num(result.total_cost_usd),
    });
  }
  if (format === "copilot-jsonl") {
    let steps = 0;
    let snapshot: Record<string, unknown> | undefined;
    let premium: number | undefined;
    for (const ev of jsonLines(output)) {
      if (ev.type === "assistant.turn_start") steps++;
      const data = ev.data as Record<string, unknown> | undefined;
      if (ev.type === "session.usage_checkpoint" && data) {
        snapshot = data.accountingSnapshot as
          Record<string, unknown> | undefined;
        premium = num(data.totalPremiumRequests) ?? premium;
      }
      const usage = ev.usage as Record<string, unknown> | undefined;
      if (ev.type === "result" && usage)
        premium = num(usage.premiumRequests) ?? premium;
    }
    let input: number | undefined;
    let outputTokens: number | undefined;
    const metrics = snapshot?.modelMetrics as
      Record<string, { usage?: Record<string, unknown> }> | undefined;
    for (const m of Object.values(metrics ?? {})) {
      const i = num(m.usage?.inputTokens);
      const o = num(m.usage?.outputTokens);
      if (i !== undefined) input = (input ?? 0) + i;
      if (o !== undefined) outputTokens = (outputTokens ?? 0) + o;
    }
    return compact({
      steps: steps > 0 ? steps : undefined,
      inputTokens: input,
      outputTokens,
      premiumRequests: premium,
    });
  }
  if (format === "codex-jsonl") {
    let input: number | undefined;
    let outputTokens: number | undefined;
    let steps = 0;
    for (const ev of jsonLines(output)) {
      if (ev.type === "item.completed") steps++;
      const usage = ev.usage as Record<string, unknown> | undefined;
      if (ev.type === "turn.completed" && usage) {
        const i = num(usage.input_tokens);
        const o = num(usage.output_tokens);
        if (i !== undefined) input = (input ?? 0) + i;
        if (o !== undefined) outputTokens = (outputTokens ?? 0) + o;
      }
    }
    return compact({
      steps: steps > 0 ? steps : undefined,
      inputTokens: input,
      outputTokens,
    });
  }
  return undefined;
}

/** Shortest credential value worth redacting; anything shorter would match ordinary text. */
const MIN_REDACTED_SECRET_CHARS = 8;

/** Whether an allowlisted variable name holds a credential (not a path or a proxy URL). */
const isCredentialVar = (name: string): boolean => /(?:KEY|TOKEN|SECRET|PASSWORD)$/i.test(name);

/**
 * The credential values an adapter hands to its agent CLI, read from this
 * process's environment by name.
 *
 * @param envKeys - The adapter's allowlisted variable names.
 * @returns Name-to-value map of the credentials that are set.
 */
export function forwardedCredentials(envKeys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of envKeys) {
    const v = process.env[k];
    if (isCredentialVar(k) && v !== undefined && v.length >= MIN_REDACTED_SECRET_CHARS) out[k] = v;
  }
  return out;
}

/**
 * Remove credential values from captured agent output before it is parsed
 * or stored.
 *
 * The agent CLI holds its credential as an environment variable, and the
 * agent runs shell commands of its own choosing, so one `env` puts the key
 * in the transcript, the results JSON, and the uploaded CI artifact. Each
 * value is replaced, as written and in its base64, base64url, hex and
 * URL-encoded forms, with `[REDACTED:<NAME>]`.
 *
 * This is a net, not a guarantee: an agent that transforms the value some
 * other way (reversed, split across lines) is not caught. Treat any reported
 * leak as a reason to rotate the credential.
 *
 * @param output - Captured agent output.
 * @param secrets - Credential values by variable name. Values shorter than
 *   eight characters are ignored.
 * @returns The redacted text and the names of the variables that were found.
 */
export function redactSecrets(
  output: string,
  secrets: Readonly<Record<string, string | undefined>>,
): { text: string; leaked: string[] } {
  let text = output;
  const leaked = new Set<string>();
  for (const [name, value] of Object.entries(secrets)) {
    if (value === undefined || value.length < MIN_REDACTED_SECRET_CHARS) continue;
    const bytes = Buffer.from(value, "utf8");
    const base64 = bytes.toString("base64");
    const forms = new Set([
      value,
      base64,
      base64.replace(/=+$/, ""),
      bytes.toString("base64url"),
      bytes.toString("hex"),
      bytes.toString("hex").toUpperCase(),
      encodeURIComponent(value),
    ]);
    for (const form of forms) {
      if (!text.includes(form)) continue;
      leaked.add(name);
      text = text.split(form).join(`[REDACTED:${name}]`);
    }
  }
  return { text, leaked: [...leaked].sort() };
}

function cli(
  name: string,
  command: string,
  envKeys: readonly string[],
  args: (inv: AgentInvocation) => string[],
  effortFormat: EffortFormat = "none",
  extraEnv?: (inv: AgentInvocation) => Promise<Record<string, string>>,
  mcpModes: readonly McpMode[] = ["none"],
): AgentAdapter {
  return {
    name,
    live: true,
    command,
    mcpModes,
    credentialVars: envKeys.filter(isCredentialVar),
    async run(inv) {
      let r;
      let traceDir = inv.dir;
      if (inv.sandbox === "docker") {
        if (!inv.egressProxy)
          throw new Error("a sandboxed live agent needs the run's egress proxy");
        // Inside the container the workspace is /work; only the agent's own
        // credentials are forwarded (by name), never the host's PATH, HOME,
        // or proxy settings.
        const inner = { ...inv, dir: CONTAINER_WORKDIR };
        const secrets: NodeJS.ProcessEnv = {};
        for (const k of envKeys)
          if (!AGENT_PROXY_ENV_VARS.includes(k) && process.env[k] !== undefined)
            secrets[k] = process.env[k];
        r = await runAgentContainer(
          inv.dir,
          [command, ...args(inner)],
          secrets,
          extraEnv ? await extraEnv(inner) : {},
          inv.timeoutMs,
          inv.egressProxy,
        );
        traceDir = CONTAINER_WORKDIR;
      } else {
        r = await runProcess(command, args(inv), {
          cwd: inv.dir,
          env: { ...childEnv(envKeys), ...(extraEnv ? await extraEnv(inv) : {}) },
          timeoutMs: inv.timeoutMs,
          maxOutputChars: AGENT_OUTPUT_CAP_CHARS,
        });
      }
      // Redact before anything is parsed or kept: the output goes to a
      // trace file, the results JSON, and (in CI) an uploaded artifact.
      const { text: output, leaked } = redactSecrets(r.output, forwardedCredentials(envKeys));
      return {
        exitCode: r.exitCode,
        timedOut: r.timedOut,
        durationMs: r.durationMs,
        outputTail: output.slice(-OUTPUT_TAIL_CHARS),
        transcript: output,
        trace: parseTrace(effortFormat, output, traceDir),
        traceRoot: traceDir,
        ...(leaked.length > 0 ? { secretLeak: leaked } : {}),
        ...(() => {
          const effort = parseEffort(effortFormat, output);
          return effort ? { effort } : {};
        })(),
      };
    },
  };
}

const withModel = (flag: string, inv: AgentInvocation): string[] =>
  inv.model ? [flag, inv.model] : [];

/**
 * Copilot CLI `--additional-mcp-config` JSON for an MCP mode: the DaloyJS
 * docs server only, read-only and keyless. No credential is ever forwarded to
 * it (`--mcp-oauth-*` flags are not used).
 *
 * @param mode - The run's MCP mode.
 * @returns Extra CLI arguments (empty for `none`).
 */
export function copilotMcpArgs(mode: McpMode | undefined): string[] {
  if (mode !== "docs") return [];
  const config = {
    mcpServers: {
      "daloyjs-docs": { type: "http", url: DOCS_MCP_URL, tools: ["*"] },
    },
  };
  return ["--additional-mcp-config", JSON.stringify(config)];
}

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

/** Token variables the Copilot CLI may read but its agent's shell must never see. */
export const COPILOT_SECRET_ENV_VARS: readonly string[] = [
  "COPILOT_GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_TOKEN",
];

/**
 * Proxy settings passed to live agents (only when set), so the sandbox's
 * egress proxy (`evals/sandbox-run.sh`) carries their traffic. Graders never
 * get them: hidden tests must reach local test servers directly.
 */
export const AGENT_PROXY_ENV_VARS: readonly string[] = [
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "NO_PROXY",
  "no_proxy",
  "NODE_USE_ENV_PROXY",
];

/**
 * Resolve an adapter by name.
 *
 * @param name - `noop`, `reference`, `alternative:<id>`, `unsafe:<variant>`,
 *   `copilot`, `claude`,
 *   `codex`, or `command`.
 * @param env - Environment to read `DALOY_EVAL_AGENT_CMD` from.
 * @returns The adapter.
 * @throws Error for an unknown name or a bad `command` template.
 */
/**
 * Whether an agent name is one of the offline adapters, whose work is the
 * task's own known code (`noop`, `reference`, `alternative:<id>`,
 * `unsafe:<id>`). Everything else, including an unknown or missing name,
 * counts as a live agent whose code must not run on this machine: the rule
 * fails safe.
 *
 * @param name - Agent name, as recorded in a results file's `meta.agent`.
 * @returns `true` only for the offline adapters.
 */
export function isOfflineAgent(name: string | undefined): boolean {
  if (!name) return false;
  return name === "noop" || name === "reference" || name.startsWith("alternative:") || name.startsWith("unsafe:");
}

export function resolveAgent(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): AgentAdapter {
  if (name === "noop") return offline(name, async () => {});
  if (name === "reference") {
    return offline(name, async ({ task }, ws) => task.reference(ws));
  }
  if (name.startsWith("alternative:")) {
    const altId = name.slice("alternative:".length);
    return offline(name, async ({ task }, ws) => {
      const alt = task.alternatives?.find((a) => a.id === altId);
      if (!alt)
        throw new Error(`task ${task.id} has no valid alternative "${altId}"`);
      await alt.apply(ws);
    });
  }
  if (name.startsWith("unsafe:")) {
    const variantId = name.slice("unsafe:".length);
    return offline(name, async ({ task }, ws) => {
      const variant = task.unsafe.find((v) => v.id === variantId);
      if (!variant)
        throw new Error(`task ${task.id} has no unsafe variant "${variantId}"`);
      await variant.apply(ws);
    });
  }
  switch (name) {
    case "copilot":
      // GitHub Copilot CLI, non-interactive. Each trial gets a fresh
      // COPILOT_HOME next to the workspace, so the user's own instructions,
      // skills, MCP servers, and hooks never load; auth comes from the token.
      // Built-in MCP servers are off so the agent cannot search this
      // repository (and its hidden tests) through the GitHub MCP server.
      return cli(
        name,
        "copilot",
        ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN", ...AGENT_PROXY_ENV_VARS],
        (inv) => [
          "-p",
          inv.prompt,
          "--allow-all-tools",
          "--no-ask-user",
          "--disable-builtin-mcps",
          "--no-auto-update",
          // Strip the auth token from the agent's shell and MCP environments
          // (and mask it in JSON output). The CLI itself still uses it.
          `--secret-env-vars=${COPILOT_SECRET_ENV_VARS.join(",")}`,
          "--output-format",
          "json",
          // No per-token delta events: they made up most of the output and
          // add nothing the complete messages and tool events do not have.
          "--stream",
          "off",
          ...copilotMcpArgs(inv.mcp),
          ...withModel("--model", inv),
        ],
        "copilot-jsonl",
        async (inv) => {
          // In the container the home is a throwaway tmpfs.
          const home =
            inv.dir === CONTAINER_WORKDIR
              ? "/home/eval/.copilot"
              : join(dirname(inv.dir), "copilot-home");
          if (inv.dir !== CONTAINER_WORKDIR) await mkdir(home, { recursive: true });
          return {
            COPILOT_HOME: home,
            COPILOT_AUTO_UPDATE: "false",
            // Without this the CLI re-reads your login shell (`bash -l`) and
            // re-exports its variables into the agent's shell commands,
            // undoing the harness's environment allowlist.
            COPILOT_DISABLE_LOGIN_SHELL_ENV: "1",
          };
        },
        ["none", "docs"],
      );
    case "claude":
      // Claude Code in print mode; permissions bypassed because the sandbox is the boundary.
      return cli(
        name,
        "claude",
        ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "XDG_CONFIG_HOME", ...AGENT_PROXY_ENV_VARS],
        (inv) => [
          "-p",
          inv.prompt,
          // stream-json carries every message and tool call; plain json holds
          // only the final answer, which leaves trace graders unverifiable.
          "--output-format",
          "stream-json",
          "--verbose",
          "--permission-mode",
          "bypassPermissions",
          ...withModel("--model", inv),
        ],
        "claude-json",
      );
    case "codex":
      // Codex CLI with its own OS sandbox limited to the workspace.
      return cli(
        name,
        "codex",
        ["OPENAI_API_KEY", "CODEX_HOME", ...AGENT_PROXY_ENV_VARS],
        (inv) => [
          "exec",
          "--json",
          "--sandbox",
          "workspace-write",
          "--skip-git-repo-check",
          "-C",
          inv.dir,
          ...withModel("-m", inv),
          inv.prompt,
        ],
        "codex-jsonl",
      );
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
        `unknown agent "${name}". Use one of: noop, reference, alternative:<id>, unsafe:<variant>, copilot, claude, codex, command`,
      );
  }
}
