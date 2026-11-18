/**
 * Shared types for the DaloyJS agent-eval harness.
 *
 * An eval measures how well an AI coding agent performs a realistic task in a
 * freshly scaffolded DaloyJS project, guided only by the repository's shipped
 * agent instructions (`AGENTS.md`, the `daloyjs-best-practices` skill). It is
 * graded by deterministic checks: typecheck, visible tests, hidden tests the
 * agent never saw, and a static guardrail diff that fails a run if a
 * secure-by-default control was weakened.
 *
 * @module
 */

/**
 * Which family of behaviour a task measures. `dont-act` tasks ask for
 * something the agent should decline (or that is impossible); the right
 * outcome is an explanation after investigating, not a code change.
 */
export type EvalSuite = "guardrail" | "scaffold" | "migration" | "dont-act";

/**
 * Which agent-instruction surfaces are present in the workspace. Running the
 * same task under several ablations measures what each surface contributes.
 *
 * - `full` — the template exactly as `create-daloy` ships it.
 * - `no-agents-md` — `AGENTS.md` removed.
 * - `no-skill` — `.agents/` (the bundled skill) removed.
 * - `bare` — both removed.
 */
export type Ablation = "full" | "no-agents-md" | "no-skill" | "bare";

/**
 * Which MCP servers the agent may use.
 *
 * - `none` — no MCP servers (the default, and every run before this option).
 * - `docs` — only the public, read-only DaloyJS docs MCP
 *   (`https://daloyjs.dev/mcp`), the same server `create-daloy` templates
 *   configure in `.vscode/mcp.json`. GitHub's built-in MCP servers stay off
 *   either way, because they can search this repository's hidden tests.
 */
export type McpMode = "none" | "docs";

/** Every supported MCP mode. */
export const MCP_MODES: readonly McpMode[] = ["none", "docs"];

/** URL of the DaloyJS docs MCP server offered by `--mcp docs`. */
export const DOCS_MCP_URL = "https://daloyjs.dev/mcp";

/** Every supported ablation, in report order. */
export const ABLATIONS: readonly Ablation[] = [
  "full",
  "no-agents-md",
  "no-skill",
  "bare",
];

/** Every suite, in report order. */
export const SUITES: readonly EvalSuite[] = [
  "guardrail",
  "scaffold",
  "migration",
  "dont-act",
];

/** A mutable view of a scaffolded workspace handed to setup and solution steps. */
export interface WorkspaceHandle {
  /** Absolute path of the project root. */
  readonly dir: string;
  /** Read a UTF-8 file relative to the root. Throws if it does not exist. */
  read(rel: string): Promise<string>;
  /** Write a UTF-8 file relative to the root, creating parent directories. */
  write(rel: string, content: string): Promise<void>;
  /** Remove a file or directory relative to the root (no error if missing). */
  remove(rel: string): Promise<void>;
  /** Whether a path relative to the root exists. */
  exists(rel: string): Promise<boolean>;
  /**
   * Set the agent's final answer to the user. Offline calibration adapters
   * provide it so "don't act" tasks can be calibrated; setup steps ignore it.
   */
  reply?(message: string): void;
}

/** A deterministic step that mutates a workspace (setup, reference, unsafe). */
export type WorkspaceStep = (ws: WorkspaceHandle) => Promise<void>;

/**
 * A grader the task opts into. Graders are deterministic: no LLM judge is
 * used for pass/fail, so a score change always traces to a concrete check.
 */
export type GraderSpec =
  /** `tsc --noEmit` in the workspace. */
  | { readonly kind: "typecheck" }
  /** The workspace's own (visible) test suite. */
  | { readonly kind: "tests" }
  /** Tests from the task's `hidden/` directory, copied in only at grading time. */
  | { readonly kind: "hidden" }
  /** Static before/after diff of secure-by-default controls; see `guardrails.ts`. */
  | { readonly kind: "guardrails" }
  /**
   * Files whose original lines must all survive, in order (no editing the
   * failing test). Appending new tests is allowed.
   */
  | { readonly kind: "protected-files"; readonly files: readonly string[] }
  /**
   * A regex that must (or must not) match the concatenated text of the files
   * under `paths` (relative files or directories).
   */
  | {
      readonly kind: "pattern";
      readonly id: string;
      readonly description: string;
      readonly paths: readonly string[];
      readonly pattern: RegExp;
      readonly mustMatch: boolean;
    }
  /** Paths that must not exist after the run. */
  | {
      readonly kind: "absent";
      readonly id: string;
      readonly paths: readonly string[];
    }
  /**
   * Every regex must match what the agent told the user (all its messages;
   * see `AgentTrace.assistantText`). Fails closed when the agent wrote
   * nothing. Used by "don't act" tasks, where the right outcome is an
   * explanation, not a code change.
   */
  | {
      readonly kind: "response";
      readonly id: string;
      readonly description: string;
      readonly patterns: readonly RegExp[];
    }
  /**
   * The agent must have looked at every listed file (viewed, searched, edited,
   * or named it in a shell command) before finishing. Catches a "don't act"
   * answer given without investigating. Fails closed without a trace.
   */
  | {
      readonly kind: "read-files";
      readonly id: string;
      readonly files: readonly string[];
    };

/** A known-bad solution used to prove the graders catch it (grader calibration). */
export interface UnsafeVariant {
  /** Short identifier, unique within the task. */
  readonly id: string;
  /** What shortcut this simulates (e.g. "raise the global body limit"). */
  readonly description: string;
  /** Applied on top of the setup, instead of the reference solution. */
  readonly apply: WorkspaceStep;
  /** Grader ids that MUST fail for this variant; calibration fails otherwise. */
  readonly expectFail: readonly string[];
}

/**
 * A different solution that is also correct. Calibration requires every
 * alternative to pass every grader, which catches graders that only accept
 * the one shape the task author had in mind (false failures).
 */
export interface ValidAlternative {
  /** Short identifier, unique within the task. */
  readonly id: string;
  /** What makes this solution different from the reference. */
  readonly description: string;
  /** Applied on top of the setup, instead of the reference solution. */
  readonly apply: WorkspaceStep;
}

/** One eval task. */
export interface EvalTask {
  /** Stable kebab-case id; also the directory name under `evals/tasks/`. */
  readonly id: string;
  readonly suite: EvalSuite;
  /** One-line human summary shown in reports. */
  readonly title: string;
  /** `create-daloy` template to scaffold. */
  readonly template: "node-basic";
  /** The instruction given to the agent, phrased like a real user request. */
  readonly prompt: string;
  /** Builds the scenario after scaffolding (adds a failing test, a legacy app, ...). */
  readonly setup?: WorkspaceStep;
  /** Graders that decide pass/fail. A trial passes only if every grader passes. */
  readonly graders: readonly GraderSpec[];
  /** A known-good solution. Calibration requires it to pass every grader. */
  readonly reference: WorkspaceStep;
  /** Other correct solutions. Calibration requires each to pass every grader. */
  readonly alternatives?: readonly ValidAlternative[];
  /** Known-bad solutions. Calibration requires each to fail its `expectFail` graders. */
  readonly unsafe: readonly UnsafeVariant[];
}

/** Outcome of one grader on one trial. */
export interface GradeResult {
  /** Grader id: the kind, or the explicit `id` for `pattern` / `absent`. */
  readonly id: string;
  readonly pass: boolean;
  /**
   * The grader could not decide: the evidence it needs is missing (an
   * incomplete trace, a stored diff that cannot show what happened). Always
   * paired with `pass: false`; it is not the agent's failure.
   */
  readonly unverified?: true;
  /** Human-readable reasons, populated on failure (and for guardrail warnings). */
  readonly details: readonly string[];
  readonly durationMs: number;
}

/**
 * What a run cost the agent, as reported by its CLI. Every field is optional:
 * only some CLIs report tokens, cost, or a step count, and the harness never
 * guesses a value it was not given.
 */
export interface AgentEffort {
  /** Agent turns or tool-using steps. */
  readonly steps?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly costUsd?: number;
  /** GitHub Copilot premium requests (Copilot CLI bills in these, not USD). */
  readonly premiumRequests?: number;
}

/**
 * What the agent did, parsed from its CLI output (or recorded by an offline
 * adapter). Paths are workspace-relative. Only the Copilot CLI stream yields
 * every field; other CLIs fill what their output exposes.
 */
export interface AgentTrace {
  /** The agent's last message to the user, when one was found. */
  readonly finalMessage?: string;
  /**
   * Everything the agent wrote to the user, every message in order (capped,
   * keeping the head and the tail). Agents often explain in one message, call
   * a tool, and conclude in the next; a reader sees both.
   */
  readonly assistantText?: string;
  /**
   * `assistantText` exceeded the cap and lost its middle. A pattern missing
   * from it may be in the cut part, so the response check is unverified.
   */
  readonly assistantTextClipped?: boolean;
  /**
   * Files the agent viewed, searched, or named in a content-reading shell
   * command. A view or search counts only when the CLI reports that call
   * succeeded; listings (`glob`, `ls`, `tree`, `stat`) never count.
   */
  readonly filesRead: readonly string[];
  /**
   * Paths named in shell commands that exited non-zero and were not read
   * elsewhere. `cat a.ts; ls missing` read `a.ts` yet exits 1, `cat
   * missing.ts` read nothing: a check that depends on one of these is
   * unverified, not passed and not failed.
   */
  readonly filesAttempted?: readonly string[];
  /** Files the agent created or edited through its edit tools. */
  readonly filesEdited: readonly string[];
  /** Shell commands, each truncated. */
  readonly shellCommands: readonly string[];
  /** Tool name to call count. */
  readonly toolCalls: Readonly<Record<string, number>>;
  /** Skills the agent loaded. */
  readonly skills: readonly string[];
  /** Calls to the DaloyJS docs MCP server. */
  readonly docsMcpCalls: number;
  /**
   * What the parser could see. `tools: false` means the output had no tool
   * events (an unsupported CLI mode, unparsable output), so an empty
   * `filesRead` means "unknown", not "read nothing". `complete: false` means
   * part of the session is missing (its start or end event was not captured,
   * or the middle was elided), so an absent action may simply be unrecorded.
   * Missing on traces stored before 17 Nov 2026, which count as incomplete.
   */
  readonly observed?: {
    readonly messages: boolean;
    readonly tools: boolean;
    readonly complete: boolean;
  };
}

/** Outcome of one agent invocation. */
export interface AgentRunResult {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly durationMs: number;
  /** Tail of combined stdout/stderr, for failure analysis. */
  readonly outputTail: string;
  /** Effort the CLI reported, when it reports any. */
  readonly effort?: AgentEffort;
  /**
   * Full captured output (capped), kept so a reviewer can read what the agent
   * did. `pnpm eval` writes it to a trace file and drops it from the JSON.
   */
  readonly transcript?: string;
  /** Parsed actions and final answer, kept in the results JSON. */
  readonly trace?: AgentTrace;
  /**
   * The workspace root as the agent saw it (`/work` in the Docker sandbox),
   * so a saved trace re-parses with the same paths.
   */
  readonly traceRoot?: string;
}

/** How much the agent changed, from `git diff --numstat` against the baseline. */
export interface DiffFootprint {
  readonly filesChanged: number;
  readonly linesAdded: number;
  readonly linesRemoved: number;
}

/** One trial: one agent run on one task under one ablation, then graded. */
export interface TrialResult {
  readonly taskId: string;
  readonly suite: EvalSuite;
  readonly ablation: Ablation;
  readonly trial: number;
  readonly agent: string;
  /** Every grader passed. */
  readonly pass: boolean;
  /**
   * No grader failed, but at least one was unverified. Such a trial is
   * neither a pass nor a failure: reports count it separately and leave it
   * out of pass rates.
   */
  readonly unverified?: true;
  /** Why the trial as a whole is unverified, when no grader ran (see {@link noAgentSession}). */
  readonly unverifiedReason?: string;
  readonly agentRun: AgentRunResult;
  readonly grades: readonly GradeResult[];
  /** `git diff` of the agent's changes against the post-setup baseline (truncated). */
  readonly diff: string;
  /** Size of that diff. A passing app can still waste effort. */
  readonly footprint: DiffFootprint;
  /** Workspace path when `--keep` was passed, otherwise `null`. */
  readonly workspace: string | null;
}

/**
 * Whether a live agent never had a session: its CLI exited non-zero (or the
 * adapter failed) before saying or doing anything, and the workspace is
 * unchanged. That is the harness's problem (an expired token, the egress
 * proxy, the image), not an attempt, so the trial is unverified instead of a
 * failure. Grading the untouched workspace would otherwise count every such
 * trial as the agent failing the task.
 *
 * Not a session failure: a timeout (the work it left is graded), a zero
 * exit (offline adapters, and an agent that finished), or any message or
 * tool call (an agent that worked and declined to edit, as a don't-act task
 * expects, is graded).
 *
 * @param agentRun - The agent run.
 * @param diff - The stored diff of the agent's changes.
 * @returns The reason, or `undefined` when the agent had a session.
 */
export function noAgentSession(agentRun: AgentRunResult, diff: string): string | undefined {
  if (agentRun.exitCode === 0 || agentRun.timedOut) return undefined;
  if (diff.trim().length > 0) return undefined;
  const seen = agentRun.trace?.observed;
  if (seen?.messages || seen?.tools) return undefined;
  const last = agentRun.outputTail.trim().split("\n").pop()?.slice(0, 200) || "no output";
  return `the agent stage exited ${agentRun.exitCode ?? "without an exit code"} without a session: ${last}`;
}

/**
 * A trial's outcome from its grades: `pass` when every grader passed,
 * `unverified` when none failed but at least one could not decide, otherwise
 * `fail`. A run that hit its time limit is never unverified: a timeout cuts
 * the trace short, which would otherwise make trace checks unverified and
 * drop the trial from every rate. So a timed-out run fails unless every
 * grader passes on the work it saved; the time limit itself is not a grader.
 *
 * @param grades - The trial's grades.
 * @param agentRun - The agent run, when known (`timedOut`).
 * @returns The fields to spread into a {@link TrialResult}.
 */
export function trialOutcome(
  grades: readonly GradeResult[],
  agentRun?: { readonly timedOut?: boolean },
): { pass: boolean; unverified?: true } {
  if (grades.every((g) => g.pass)) return { pass: true };
  if (grades.some((g) => !g.pass && !g.unverified)) return { pass: false };
  if (agentRun?.timedOut) return { pass: false };
  return { pass: false, unverified: true };
}

/**
 * The id a grader reports under: its `kind`, or the explicit `id` for the
 * task-specific `pattern` and `absent` graders.
 *
 * @param spec - The grader definition.
 * @returns The grader id used in results and in `UnsafeVariant.expectFail`.
 */
export function graderId(spec: GraderSpec): string {
  return "id" in spec ? spec.id : spec.kind;
}
