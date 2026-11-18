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
 * start, before any app code loads. App code runs in the same process as the
 * tests, so it can reach what they rely on:
 * - `node --test` reports a test file whose process exits 0 as one passed
 *   test, even if no test ran, so a `process.exit(0)` at module scope forged
 *   a pass. The guard turns any `process.exit` during a test run into exit
 *   code 70 and says so.
 * - `assert.equal = () => {}` from app code made every assertion a no-op
 *   (a full pass with no implementation). The guard freezes `node:assert`,
 *   `node:assert/strict`, and `node:test`, so that assignment throws.
 * Honest runs are unaffected. The test graders also require every expected
 * test to report `ok` by name ({@link missingPasses}), which catches what the
 * guard cannot (a test that never ran).
 */
export const PROCESS_GUARD = `import assert from "node:assert";
import strict from "node:assert/strict";
import * as nodeTest from "node:test";
for (const o of [assert, strict, nodeTest.default, nodeTest.test, nodeTest.it, nodeTest.describe, nodeTest.suite])
  if (o) Object.freeze(o);
const realExit = process.reallyExit.bind(process);
const trap = (code) => {
  process.stderr.write(\`[eval] process.exit(\${code}) was called while tests were running\\n\`);
  realExit(70);
};
process.exit = (code) => trap(code ?? process.exitCode ?? 0);
process.reallyExit = (code) => trap(code);
`;

/**
 * Names of the tests a trusted test file declares: the string-literal first
 * argument of each `test(...)` / `it(...)` call. Template literals with
 * placeholders are skipped (their names are only known at run time).
 *
 * @param source - Test file source.
 * @returns Declared test names, in order.
 */
export function declaredTestNames(source: string): string[] {
  const out: string[] = [];
  const call = /(?<![\w$.])(?:test|it)(?:\.only)?\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
  for (const m of source.matchAll(call)) {
    if (m[1] === "`" && m[2]!.includes("${")) continue;
    out.push(m[2]!.replace(/\\(.)/g, "$1"));
  }
  return out;
}

/**
 * Expected tests that do not appear as passed (`ok`, not SKIP or TODO) in a
 * `node --test --test-reporter=tap` report. The runner prints whatever the
 * tests and the app write as `# ` comment lines, so app code cannot add an
 * `ok` line. A test that was commented out, never registered, skipped, or
 * cut short by an exit is missing.
 *
 * @param tap - The runner's output.
 * @param expected - Test names that must have passed.
 * @returns The missing names.
 */
export function missingPasses(tap: string, expected: readonly string[]): string[] {
  const passed = new Set<string>();
  for (const line of tap.split("\n")) {
    const m = /^\s*ok \d+ - (.*?)(?:\s+#\s+(?:SKIP|TODO)\b.*)?$/.exec(line);
    if (m && !/\s#\s+(?:SKIP|TODO)\b/.test(line))
      passed.add(m[1]!.replace(/\\#/g, "#").replace(/\\\\/g, "\\"));
  }
  return [...new Set(expected)].filter((n) => !passed.has(n));
}

/**
 * Run `node --test` on `files` with {@link PROCESS_GUARD} preloaded and the
 * TAP reporter; passes only when the run exits 0 **and** every `expected`
 * test reports `ok` by name. The guard is removed with its directory
 * afterwards when `cleanup` is set (the hidden grader removes it itself).
 */
async function runTests(
  ctx: GradeContext,
  files: readonly string[],
  expected: readonly string[],
  cleanup: boolean,
): Promise<{ ok: boolean; details: string[] }> {
  const ws = workspaceHandle(ctx.dir);
  await ws.write(PROCESS_GUARD_PATH, PROCESS_GUARD);
  try {
    const r = await runNode(ctx, [
      "--import",
      `./${PROCESS_GUARD_PATH}`,
      "--test",
      "--test-reporter=tap",
      ...files,
    ]);
    const missing = missingPasses(r.output, expected);
    if (missing.length === 0) return r;
    const shown = missing.slice(0, 10).map((n) => `  - ${n}`);
    return {
      ok: false,
      details: [
        `${missing.length} expected test(s) did not run and pass:\n${shown.join("\n")}`,
        ...(r.ok ? [] : r.details),
      ],
    };
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
): Promise<{ ok: boolean; details: string[]; output: string }> {
  const r = await (ctx.exec ?? localGradeExec)(
    ctx.dir,
    ["node", ...args],
    GRADER_TIMEOUT_MS,
  );
  if (r.exitCode === 0 && !r.timedOut)
    return { ok: true, details: [], output: r.output };
  return {
    ok: false,
    output: r.output,
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
      // The tests that existed before the agent must still run and pass:
      // commenting one out or deleting it is not a fix.
      const expected = [...ctx.before]
        .filter(([rel]) => /^tests\/.*\.test\.ts$/.test(rel))
        .flatMap(([, text]) => declaredTestNames(text));
      const r = await runTests(ctx, ["tests/**/*.test.ts"], expected, true);
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
      const expected: string[] = [];
      for (const f of files) {
        const text = await readFile(join(ctx.hiddenDir, f), "utf8");
        expected.push(...declaredTestNames(text));
        await ws.write(`${HIDDEN_TEST_DIR}/${f}`, text);
      }
      try {
        const r = await runTests(
          ctx,
          files.map((f) => `${HIDDEN_TEST_DIR}/${f}`),
          expected,
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
      const attempted = unread.filter((f) =>
        traceTouched({ ...trace, filesRead: trace.filesAttempted ?? [], filesEdited: [] }, f),
      );
      if (attempted.length > 0)
        return unverified(
          attempted.map(
            (f) => `the only read of ${f} was a shell command that exited non-zero, so it may not have been read`,
          ),
        );
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
