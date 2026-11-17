/**
 * Scoring for repeated, non-deterministic agent trials.
 *
 * Agents do not give the same result twice, so every task runs `n` times and
 * the report shows two complementary estimates:
 *
 * - **pass@k** — the chance that at least one of `k` attempts passes
 *   ("can the agent do it at all?").
 * - **pass^k** — the chance that all `k` attempts pass ("can we rely on
 *   it?"). For guardrail tasks this is the number that matters: an agent that
 *   strips `secureHeaders()` one run in five is not safe.
 *
 * Both use the standard unbiased estimators over `n` samples with `c` passes
 * (Chen et al., 2021 for pass@k; the τ-bench pass^k form).
 *
 * @module
 */

/**
 * C(a, k) / C(b, k) for a ≤ b, as a product of ratios each in [0, 1]. Never
 * forms the coefficients themselves, which overflow to Infinity (and give
 * NaN) beyond a few hundred trials.
 */
function chooseRatio(a: number, b: number, k: number): number {
  if (k > a) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r *= (a - i) / (b - i);
  return r;
}

function assertCounts(n: number, c: number, k: number): void {
  if (!Number.isInteger(n) || !Number.isInteger(c) || !Number.isInteger(k)) {
    throw new RangeError("n, c and k must be integers");
  }
  if (n < 1 || c < 0 || c > n || k < 1 || k > n) {
    throw new RangeError(
      `invalid counts: n=${n}, c=${c}, k=${k} (need 0<=c<=n, 1<=k<=n)`,
    );
  }
}

/**
 * Unbiased pass@k: 1 − C(n−c, k) / C(n, k).
 *
 * @param n - Trials run.
 * @param c - Trials that passed.
 * @param k - Attempt budget being estimated (1 ≤ k ≤ n).
 * @returns Probability in [0, 1].
 * @throws RangeError when the counts are inconsistent.
 */
export function passAtK(n: number, c: number, k: number): number {
  assertCounts(n, c, k);
  return 1 - chooseRatio(n - c, n, k);
}

/**
 * Unbiased pass^k: C(c, k) / C(n, k).
 *
 * @param n - Trials run.
 * @param c - Trials that passed.
 * @param k - Number of consecutive successes required (1 ≤ k ≤ n).
 * @returns Probability in [0, 1].
 * @throws RangeError when the counts are inconsistent.
 */
export function passHatK(n: number, c: number, k: number): number {
  assertCounts(n, c, k);
  return chooseRatio(c, n, k);
}
