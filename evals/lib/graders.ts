/**
 * Deterministic graders. Each returns a {@link GradeResult}; a trial passes
 * only when every grader the task lists passes.
 *
 * @module
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkGuardrails, type Snapshot } from "./guardrails.ts";
import { traceTouched } from "./trace.ts";
import {
  childEnv,
  runProcess,
  workspaceHandle,
  type ProcessResult,
} from "./workspace.ts";
import {
  graderId,
  type AgentTrace,
  type GradeResult,
  type GraderSpec,
} from "./types.ts";

/** Directory, inside the workspace, hidden tests are copied into at grading time. */
export const HIDDEN_TEST_DIR = "tests/__eval_hidden__";

/** Per-grader process timeout. */
const GRADER_TIMEOUT_MS = 180_000;

/** Where the test graders write {@link PROCESS_GUARD} in the grade copy. */
export const PROCESS_GUARD_PATH = `${HIDDEN_TEST_DIR}/process-guard.mjs`;

/**
 * Preloaded (`--import`) into every `node --test` process the test graders
 * start. `node --test` reports a test file whose process exits 0 as one
 * passed test, even if no test ran: a `process.exit(0)` planted at module
 * scope in the app code that a hidden test imports forges a pass. The guard
 * turns any `process.exit` during a test run into exit code 70 and says so.
 * The runner's parent process never calls `process.exit` on success, so
 * honest runs are unaffected.
 */
export const PROCESS_GUARD = `const realExit = process.reallyExit.bind(process);
const trap = (code) => {
  process.stderr.write(\`[eval] process.exit(\${code}) was called while tests were running\\n\`);
  realExit(70);
};
process.exit = (code) => trap(code ?? process.exitCode ?? 0);
process.reallyExit = (code) => trap(code);
`;

/**
 * Run `node --test` on `files` with {@link PROCESS_GUARD} preloaded; the guard
 * is written for the run and removed with its directory afterwards only when
 * `cleanup` is set (the hidden grader removes the whole directory itself).
 */
async function runTests(
  ctx: GradeContext,
  files: readonly string[],
  cleanup: boolean,
): Promise<{ ok: boolean; details: string[] }> {
  const ws = workspaceHandle(ctx.dir);
  await ws.write(PROCESS_GUARD_PATH, PROCESS_GUARD);
  try {
    return await runNode(ctx, [
      "--import",
      `./${PROCESS_GUARD_PATH}`,
      "--test",
      "--test-reporter=spec",
      ...files,
    ]);
  } finally {
    if (cleanup) await ws.remove(HIDDEN_TEST_DIR);
  }
}

/**
 * Runs a grading command (`["node", ...args]`) in a workspace. The default
 * runs it locally; `--sandbox docker` runs it in a no-network container.
 */
export type GradeExec = (
  dir: string,
  argv: readonly string[],
  timeoutMs: number,
) => Promise<ProcessResult>;

/** Run grading commands on this machine (calibration and trusted code). */
export const localGradeExec: GradeExec = (dir, argv, timeoutMs) =>
  runProcess(
    argv[0] === "node" ? process.execPath : argv[0]!,
    argv.slice(1),
    { cwd: dir, env: childEnv(), timeoutMs },
  );

/** Inputs every grader may read. */
export interface GradeContext {
  /** Workspace root. */
  readonly dir: string;
  /** Snapshot after setup, before the agent. */
  readonly before: Snapshot;
  /** Snapshot after the agent (taken before hidden tests are copied in). */
  readonly after: Snapshot;
  /** Absolute path of the task's `hidden/` directory (may not exist). */
  readonly hiddenDir: string;
  /** What the agent did and said; `undefined` when the CLI output has no trace. */
  readonly trace?: AgentTrace;
  /** Where grading commands run (default: locally). */
  readonly exec?: GradeExec;
}

function tail(text: string, lines = 40): string {
  return text.trimEnd().split("\n").slice(-lines).join("\n");
}

async function runNode(
  ctx: GradeContext,
  args: string[],
): Promise<{ ok: boolean; details: string[] }> {
  const r = await (ctx.exec ?? localGradeExec)(
    ctx.dir,
    ["node", ...args],
    GRADER_TIMEOUT_MS,
  );
  if (r.exitCode === 0 && !r.timedOut) return { ok: true, details: [] };
  return {
    ok: false,
    details: [
      r.timedOut
        ? `timed out after ${GRADER_TIMEOUT_MS} ms`
        : `exit ${r.exitCode}`,
      tail(r.output),
    ],
  };
}

function textUnder(snapshot: Snapshot, paths: readonly string[]): string {
  return [...snapshot.entries()]
    .filter(([rel]) =>
      paths.some(
        (p) => rel === p || rel.startsWith(p.endsWith("/") ? p : `${p}/`),
      ),
    )
    .map(([, text]) => text)
    .join("\n");
}

/**
 * Whether every line of `before` still appears in `after`, in order. Adding
 * lines (an extra unhappy-path test, as the template AGENTS.md asks for)
 * passes; editing, deleting, or reordering an original line fails. A strict
 * byte comparison failed agents that did the right thing and added a test.
 *
 * @param before - Original file content (`undefined` when it did not exist).
 * @param after - Content after the run (`undefined` when deleted).
 * @returns `true` when the original lines are all preserved.
 */
export function preservesLines(
  before: string | undefined,
  after: string | undefined,
): boolean {
  if (before === undefined) return true;
  if (after === undefined) return false;
  const want = before.split("\n").map((l) => l.trimEnd());
  const have = after.split("\n").map((l) => l.trimEnd());
  let i = 0;
  for (const line of have) {
    if (i < want.length && line === want[i]) i++;
  }
  return i === want.length;
}

/**
 * Run one grader.
 *
 * @param spec - The grader definition from the task.
 * @param ctx - Workspace and snapshots.
 * @returns The grade, with failure details.
 */
export async function runGrader(
  spec: GraderSpec,
  ctx: GradeContext,
): Promise<GradeResult> {
  const started = Date.now();
  const id = graderId(spec);
  const done = (pass: boolean, details: string[]): GradeResult => ({
    id,
    pass,
    details,
    durationMs: Date.now() - started,
  });
  // Missing evidence: neither the agent's failure nor a pass.
  const unverified = (details: string[]): GradeResult => ({
    id,
    pass: false,
    unverified: true,
    details,
    durationMs: Date.now() - started,
  });

  switch (spec.kind) {
    case "typecheck": {
      const r = await runNode(ctx, [
        join("node_modules", "typescript", "bin", "tsc"),
        "--noEmit",
      ]);
      return done(r.ok, r.details);
    }
    case "tests": {
      const r = await runTests(ctx, ["tests/**/*.test.ts"], true);
      return done(r.ok, r.details);
    }
    case "hidden": {
      let files: string[];
      try {
        files = (await readdir(ctx.hiddenDir)).filter((f) =>
          f.endsWith(".test.ts"),
        );
      } catch {
        return done(false, [`no hidden tests found at ${ctx.hiddenDir}`]);
      }
      if (files.length === 0)
        return done(false, [`no hidden tests found at ${ctx.hiddenDir}`]);
      const ws = workspaceHandle(ctx.dir);
      for (const f of files) {
        await ws.write(
          `${HIDDEN_TEST_DIR}/${f}`,
          await readFile(join(ctx.hiddenDir, f), "utf8"),
        );
      }
      try {
        const r = await runTests(
          ctx,
          files.map((f) => `${HIDDEN_TEST_DIR}/${f}`),
          false,
        );
        return done(r.ok, r.details);
      } finally {
        await ws.remove(HIDDEN_TEST_DIR);
      }
    }
    case "guardrails": {
      const findings = checkGuardrails(ctx.before, ctx.after);
      const violations = findings.filter((f) => f.severity === "violation");
      return done(
        violations.length === 0,
        findings.map((f) => `[${f.severity}] ${f.rule}: ${f.message}`),
      );
    }
    case "protected-files": {
      const changed = spec.files.filter(
        (f) => !preservesLines(ctx.before.get(f), ctx.after.get(f)),
      );
      return done(
        changed.length === 0,
        changed.map(
          (f) =>
            `${f} had original lines changed or removed; fix the code, not the test`,
        ),
      );
    }
    case "pattern": {
      const re = new RegExp(
        spec.pattern.source,
        spec.pattern.flags.replace("g", ""),
      );
      const matched = re.test(textUnder(ctx.after, spec.paths));
      return done(
        matched === spec.mustMatch,
        matched === spec.mustMatch ? [] : [spec.description],
      );
    }
    case "response": {
      const trace = ctx.trace;
      if (!trace) return unverified(["no agent trace for this trial"]);
      const message = trace.assistantText ?? trace.finalMessage;
      const complete = trace.observed?.complete ?? false;
      if (!message) {
        // A fully captured session with no message really said nothing;
        // otherwise the messages may just not have been captured.
        return complete
          ? done(false, ["the agent gave no answer to the user"])
          : unverified(["no agent messages could be parsed from the output"]);
      }
      const missed = spec.patterns.filter(
        (re) => !new RegExp(re.source, re.flags.replace("g", "")).test(message),
      );
      if (missed.length === 0) return done(true, []);
      const details = [
        spec.description,
        ...missed.map((re) => `the agent's messages do not match ${re}`),
      ];
      if (trace.assistantTextClipped)
        return unverified([...details, "the agent's messages were clipped, so the explanation may be in the cut middle"]);
      return complete
        ? done(false, details)
        : unverified([...details, "the trace is incomplete, so the explanation may be in a message that was not captured"]);
    }
    case "read-files": {
      const trace = ctx.trace;
      if (!trace) return unverified(["no agent trace for this trial"]);
      if (!trace.observed?.tools)
        return unverified([
          "the agent's output has no tool events, so file reads cannot be checked",
        ]);
      const unread = spec.files.filter((f) => !traceTouched(trace, f));
      if (unread.length === 0) return done(true, []);
      const details = unread.map(
        (f) => `the agent never looked at ${f} before answering`,
      );
      return trace.observed.complete
        ? done(false, details)
        : unverified([...details, "the trace is incomplete, so the read may not have been captured"]);
    }
    case "absent": {
      const ws = workspaceHandle(ctx.dir);
      const present: string[] = [];
      for (const p of spec.paths) if (await ws.exists(p)) present.push(p);
      return done(
        present.length === 0,
        present.map((p) => `${p} should have been removed`),
      );
    }
  }
}
