/**
 * Deterministic graders. Each returns a {@link GradeResult}; a trial passes
 * only when every grader the task lists passes.
 *
 * @module
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkGuardrails, type Snapshot } from "./guardrails.ts";
import { childEnv, runProcess, workspaceHandle } from "./workspace.ts";
import { graderId, type GradeResult, type GraderSpec } from "./types.ts";

/** Directory, inside the workspace, hidden tests are copied into at grading time. */
export const HIDDEN_TEST_DIR = "tests/__eval_hidden__";

/** Per-grader process timeout. */
const GRADER_TIMEOUT_MS = 180_000;

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
}

function tail(text: string, lines = 40): string {
  return text.trimEnd().split("\n").slice(-lines).join("\n");
}

async function runNode(
  dir: string,
  args: string[],
): Promise<{ ok: boolean; details: string[] }> {
  const r = await runProcess(process.execPath, args, {
    cwd: dir,
    env: childEnv(),
    timeoutMs: GRADER_TIMEOUT_MS,
  });
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

  switch (spec.kind) {
    case "typecheck": {
      const r = await runNode(ctx.dir, [
        join("node_modules", "typescript", "bin", "tsc"),
        "--noEmit",
      ]);
      return done(r.ok, r.details);
    }
    case "tests": {
      const r = await runNode(ctx.dir, [
        "--test",
        "--test-reporter=spec",
        "tests/**/*.test.ts",
      ]);
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
        const r = await runNode(ctx.dir, [
          "--test",
          "--test-reporter=spec",
          ...files.map((f) => `${HIDDEN_TEST_DIR}/${f}`),
        ]);
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
        (f) => ctx.before.get(f) !== ctx.after.get(f),
      );
      return done(
        changed.length === 0,
        changed.map(
          (f) => `${f} was modified or deleted; fix the code, not the test`,
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
