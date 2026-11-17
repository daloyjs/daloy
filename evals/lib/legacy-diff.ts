/**
 * Regrading results whose stored diffs predate `DIFF_FORMAT` 2 and therefore
 * omit deleted files. Replaying such a diff leaves every file the agent
 * deleted in place, which can flip the graders that look at file existence.
 * When the diff cannot show what happened, the new grade is marked
 * **unverified**: the saved artifact cannot support the current check. The
 * original live grade stays in the trial's history; it is never carried
 * forward as if the current graders had confirmed it.
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
 * Mark the grades a legacy (deletion-less) diff cannot support.
 *
 * - `absent`: failing now while the diff never touches the path, but passing
 *   live: the agent most likely deleted it, which the diff cannot show.
 * - `protected-files`: failing live while the diff never touches any
 *   protected file: the file was most likely deleted.
 * - `guardrails`: a live `deleted-tests` violation cannot be seen in the
 *   replay.
 *
 * @param task - The task the trial ran.
 * @param original - The trial as originally graded.
 * @param regraded - Grades from replaying the legacy diff.
 * @returns Grades with the unsupported ones marked unverified, and their ids.
 */
export function markLegacyUnverified(
  task: EvalTask,
  original: TrialResult,
  regraded: readonly GradeResult[],
): { grades: GradeResult[]; unverified: string[] } {
  const touched = touchedPaths(original.diff);
  const before = new Map(original.grades.map((g) => [g.id, g]));
  const marked: string[] = [];
  const grades = regraded.map((g): GradeResult => {
    const spec = task.graders.find((s) => graderId(s) === g.id);
    const orig = before.get(g.id);
    if (!spec || !orig) return g;
    let blind = false;
    if (spec.kind === "absent") {
      blind =
        orig.pass &&
        !g.pass &&
        !spec.paths.some((p) => [...touched].some((t) => under(t, p)));
    } else if (spec.kind === "protected-files") {
      blind = !orig.pass && !spec.files.some((f) => touched.has(f));
    } else if (spec.kind === "guardrails") {
      blind =
        !orig.pass && orig.details.some((d) => d.includes("deleted-tests"));
    }
    if (!blind) return g;
    marked.push(g.id);
    return {
      id: g.id,
      pass: false,
      unverified: true,
      durationMs: g.durationMs,
      details: [
        ...g.details,
        `unverified: the stored diff predates deleted-file capture, so this check cannot be replayed (the live grade was ${orig.pass ? "pass" : "fail"}; see the trial's original grades)`,
      ],
    };
  });
  return { grades, unverified: marked };
}
