/**
 * Grading revisions for `pnpm eval:regrade`. A regrade writes a new revision
 * of each trial and keeps the original grades as history. When the saved
 * artifacts cannot support the current graders (a truncated diff, a diff that
 * no longer applies, a legacy diff that cannot show deletions), the new
 * revision says **unverified**. It never copies the old grade forward as if
 * the current graders had confirmed it.
 *
 * @module
 */

import {
  trialOutcome,
  type GradeResult,
  type TrialResult,
} from "./types.ts";

/** A trial's grades as first recorded, kept as history by every regrade. */
export interface OriginalGrades {
  readonly pass: boolean;
  readonly unverified?: true;
  readonly grades: readonly GradeResult[];
}

/** A trial in a regraded results file. */
export type RevisedTrial = TrialResult & {
  /** The first recorded grades (history, not current results). */
  readonly original: OriginalGrades;
  /** Why the new revision is unverified as a whole, when it is. */
  readonly unverifiedReason?: string;
};

/**
 * The earliest grades on record for a trial: its `original` when it was
 * already regraded, otherwise its own grades.
 *
 * @param t - A stored trial, possibly from an earlier regrade.
 * @returns The history entry to keep.
 */
export function originalOf(t: TrialResult): OriginalGrades {
  const prior = (t as Partial<RevisedTrial>).original;
  if (prior) return prior;
  return {
    pass: t.pass,
    ...(t.unverified ? { unverified: true as const } : {}),
    grades: t.grades,
  };
}

/**
 * Build a trial's new revision.
 *
 * @param t - The stored trial.
 * @param outcome - New grades, or the reason the artifacts could not be replayed.
 * @returns The trial with current grades (or unverified) and its history.
 */
export function reviseTrial(
  t: TrialResult,
  outcome: { readonly grades: readonly GradeResult[] } | { readonly skip: string },
): RevisedTrial {
  const original = originalOf(t);
  // Drop the previous revision's verdict fields; keep the run data.
  const {
    unverified: _unverified,
    unverifiedReason: _reason,
    original: _original,
    ...rest
  } = t as RevisedTrial;
  if ("skip" in outcome) {
    return {
      ...rest,
      grades: [],
      pass: false,
      unverified: true,
      unverifiedReason: outcome.skip,
      original,
    };
  }
  return {
    ...rest,
    grades: [...outcome.grades],
    ...trialOutcome(outcome.grades, rest.agentRun),
    original,
  };
}
