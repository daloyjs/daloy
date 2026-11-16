/**
 * Regrading results whose stored diffs predate `DIFF_FORMAT` 2 and therefore
 * omit deleted files. Replaying such a diff leaves every file the agent
 * deleted in place, which can flip the graders that look at file existence.
 * For those graders this module keeps the original live grade (computed from
 * real snapshots) whenever the diff cannot show what happened.
 *
 * @module
 */

import {
  graderId,
  type EvalTask,
  type GradeResult,
  type TrialResult,
} from "./types.ts";

/** Paths touched by a unified diff (`diff --git a/<p> b/<p>` headers). */
function touchedPaths(diff: string): Set<string> {
  const out = new Set<string>();
  for (const m of diff.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)) {
    out.add(m[1]!);
    out.add(m[2]!);
  }
  return out;
}

const under = (path: string, root: string): boolean =>
  path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`);

/**
 * Reconcile regraded results for a legacy (deletion-less) diff.
 *
 * - `absent`: originally passing but now failing, while the diff never
 *   touches the path, means the agent deleted it. Keep the original pass.
 * - `protected-files`: originally failing while the diff never touches any
 *   protected file means the file was deleted. Keep the original failure.
 * - `guardrails`: an original `deleted-tests` violation cannot be seen in the
 *   replay. Keep the original failure.
 *
 * @param task - The task the trial ran.
 * @param original - The trial as originally graded.
 * @param regraded - Grades from replaying the legacy diff.
 * @returns Reconciled grades and the ids that kept their original result.
 */
export function reconcileLegacyGrades(
  task: EvalTask,
  original: TrialResult,
  regraded: readonly GradeResult[],
): { grades: GradeResult[]; kept: string[] } {
  const touched = touchedPaths(original.diff);
  const before = new Map(original.grades.map((g) => [g.id, g]));
  const kept: string[] = [];
  const grades = regraded.map((g) => {
    const spec = task.graders.find((s) => graderId(s) === g.id);
    const orig = before.get(g.id);
    if (!spec || !orig) return g;
    let keep = false;
    if (spec.kind === "absent") {
      keep =
        orig.pass &&
        !g.pass &&
        !spec.paths.some((p) => [...touched].some((t) => under(t, p)));
    } else if (spec.kind === "protected-files") {
      keep = !orig.pass && !spec.files.some((f) => touched.has(f));
    } else if (spec.kind === "guardrails") {
      keep =
        !orig.pass && orig.details.some((d) => d.includes("deleted-tests"));
    }
    if (!keep) return g;
    kept.push(g.id);
    return {
      ...orig,
      details: [
        ...orig.details,
        "kept original grade: legacy diff omits deleted files",
      ],
    };
  });
  return { grades, kept };
}
