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

/** Which family of behaviour a task measures. */
export type EvalSuite = "guardrail" | "scaffold" | "migration";

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
  /** Files that must be byte-identical after the run (no editing the failing test). */
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
  /** Known-bad solutions. Calibration requires each to fail its `expectFail` graders. */
  readonly unsafe: readonly UnsafeVariant[];
}

/** Outcome of one grader on one trial. */
export interface GradeResult {
  /** Grader id: the kind, or the explicit `id` for `pattern` / `absent`. */
  readonly id: string;
  readonly pass: boolean;
  /** Human-readable reasons, populated on failure (and for guardrail warnings). */
  readonly details: readonly string[];
  readonly durationMs: number;
}

/** Outcome of one agent invocation. */
export interface AgentRunResult {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly durationMs: number;
  /** Tail of combined stdout/stderr, for failure analysis. */
  readonly outputTail: string;
}

/** One trial: one agent run on one task under one ablation, then graded. */
export interface TrialResult {
  readonly taskId: string;
  readonly suite: EvalSuite;
  readonly ablation: Ablation;
  readonly trial: number;
  readonly agent: string;
  readonly pass: boolean;
  readonly agentRun: AgentRunResult;
  readonly grades: readonly GradeResult[];
  /** `git diff` of the agent's changes against the post-setup baseline (truncated). */
  readonly diff: string;
  /** Workspace path when `--keep` was passed, otherwise `null`. */
  readonly workspace: string | null;
}

/**
 * The id a grader reports under: its `kind`, or the explicit `id` for the
 * task-specific `pattern` and `absent` graders.
 *
 * @param spec - The grader definition.
 * @returns The grader id used in results and in `UnsafeVariant.expectFail`.
 */
export function graderId(spec: GraderSpec): string {
  return spec.kind === "pattern" || spec.kind === "absent"
    ? spec.id
    : spec.kind;
}
