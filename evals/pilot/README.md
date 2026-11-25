# DeepEval books pilot

This replay answers whether each saved attempt to add `GET /books` passed its five executable checks. One DeepEval case represents one trial. Named metrics expose each recorded check and a separate trial verdict. The runner also reports verified and unverified counts. Model-generated scores are never used.

## Reproduce the review

From the repository root with Docker available:

```sh
pnpm build
pnpm eval:image
pnpm --dir evals/pilot install --frozen-lockfile --ignore-scripts
pnpm --silent eval:pilot evals/pilot/fixtures/claude-sonnet-5.5.json evals/pilot/fixtures/gpt-6-sol.json > models.md
pnpm --silent eval:pilot evals/pilot/fixtures/reference.json evals/pilot/fixtures/noop.json > controls.md
pnpm eval:calibrate --task scaffold-books-list
```

The four fixture files contain only the reportable fields extracted from the November 24 saved runs, at historical grader revision 1. They support scoring replay. Re-executing a patch with `pnpm eval:regrade --sandbox docker path/to/run.json` requires the **original full result JSON** with its diff. Regrading writes a new sibling result and retains the original grades. Replay accepts full books-task result files as well as the smaller fixtures. Report each grader revision separately.

The reporter reads the run on the host and sends selected labels, timings, verdicts and a bounded diagnostic excerpt into an unprivileged, read-only, network-disabled Docker container. It forwards no host credentials or repository mount. DeepEval writes native Markdown into temporary container storage. The command emits the report on stdout. A completed report may contain failed trials. Runtime, input and parity errors exit nonzero.

## Pilot review, November 25

| Evidence | Historical result | DeepEval replay or revision 2 result |
|---|---|---|
| Sonnet 5.5, skill present and absent | 2/2 trials passed | Both original verdicts and all 10 checks reproduced. Both patches also passed revision 2. |
| GPT-6 Sol, skill present and absent | 2/2 trials passed | Both original verdicts and all 10 checks reproduced. Both patches also passed revision 2. |
| Reference control | Passed all five checks | Passed |
| Unchanged scaffold | Failed hidden tests and route-test check | Failed the same two checks, with reasons in the report |
| Missing session, synthetic test | Unverified | Reported separately with no vote in the trial success rate |
| Timeout with incomplete evidence, synthetic test | Failed under the historical timeout rule | Failed trial, individual unavailable check has no score |
| Valid optional-limit implementation, revision 2 | Calibration control | Passed |
| Incorrect default or unbounded query, revision 2 | Calibration controls | Hidden grader rejected both |

The changed fixture addresses a specific blind spot. Returning all two seeded books used to satisfy the default-limit assertion. The hidden checker now requests an eleven-book fixture and verifies ten are returned by default and eleven with an explicit limit of fifty. The standard two-book fixture still applies to the agent's visible tests. Revision 2 describes a regrade of existing work; it adds zero independent model trials.

These results support a tie on this task. With one trial per model and skill condition they do not estimate a reproducible speedup or rank either model.

## Reporting decision

Adopt native DeepEval Markdown for per-trial, per-check details. Keep the existing summary and comparison commands for pass@k, pass^k, uncertainty, effort, and comparisons between compatible runs. DeepEval 0.9.26's native aggregation counts a skipped metric as successful. The adapter represents unavailable checks with no score or verdict, and handles entirely unverified trials outside the native pass/fail table. Its parity checks compare each emitted score and trial verdict with the original evidence.

The pilot applies the article's distinction between a task, an agent configuration and a trial, and uses a deterministic check on the resulting behavior. The existing Docker execution and trace artifacts support a separate end-to-end investigation. [Vercel's agent evals article](https://vercel.com/blog/agent-evals)

## Git baseline and command compatibility

Deletion `232692a5` removed 62 files from `evals/` but left its package scripts, tests, website guide and CI references. This pilot restores the historical implementation from `052466f0`; only the books task is connected to DeepEval. [Full file inventory](inventory.md)

| Entry point | Pilot decision |
|---|---|
| `eval`, `eval:image` | Reuse the scaffold, agent isolation, network policy and stored diffs. New books trials record the grader revision. |
| `eval:calibrate` | Retain reference, alternative, no-change and known-wrong controls. Add the wrong-default example. |
| `eval:regrade` | Reuse the offline Docker patch replay; record the new grader revision alongside the original grading history. |
| `eval:analyze`, `eval:compare` | Retain trace and cross-trial analyses. Use separate reports for different grader revisions. |
| `eval:pilot` | New optional native report for saved books trials. Installs into its own private package. |
| CI and documentation | Existing eval workflow and harness tests remain consumers of the original commands. The pilot has offline tests and a reproduction example on the existing agent-evals docs page. |

The other 14 tasks remain available through the original harness. Migrating their presentation or retiring any existing report is deferred to the pilot review.
