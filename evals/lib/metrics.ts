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
 * (Chen et al., 2021 for pass@k; the τ-bench pass^k form). pass@1 also gets
 * a Wilson score interval ({@link wilsonInterval}), because with a handful
 * of trials the rate alone overstates what was measured.
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

/**
 * Wilson score interval for **pass@1** (a binomial proportion): the range
 * the true pass rate plausibly lies in, given `c` passes in `n` verified
 * trials. Not for pass@k or pass^k, which are derived from the same `n`
 * trials rather than from independent observations. Unlike
 * `c/n ± z·sqrt(...)` it stays inside [0, 1] and is not zero-width at 0 or
 * `n` passes: 5 of 5 gives roughly 57% to 100%, 3 of 5 roughly 23% to 88%.
 *
 * @param n - Verified trials (unverified ones excluded), at least 1.
 * @param c - Trials that passed.
 * @param z - Normal quantile; 1.96 for a 95% interval.
 * @returns `[low, high]`, both in [0, 1].
 * @throws RangeError when the counts are inconsistent.
 */
export function wilsonInterval(n: number, c: number, z = 1.96): [number, number] {
  if (!Number.isInteger(n) || !Number.isInteger(c) || n < 1 || c < 0 || c > n)
    throw new RangeError(`invalid counts: n=${n}, c=${c} (need 0<=c<=n, n>=1)`);
  const p = c / n;
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/**
 * Fisher's exact test, two-sided: the chance of a split at least this uneven
 * between two runs if the change made no difference (`a` passes of `n1`
 * before, `b` of `n2` after). Exact at any sample size, which is what a
 * before/after comparison of a few trials needs; checking whether two
 * {@link wilsonInterval}s overlap is only a rule of thumb, and too cautious:
 * 20/20 against 14/20 overlaps, but p is 0.02.
 *
 * Works in log space, so large trial counts do not overflow.
 *
 * @param a - Passes in the first run.
 * @param n1 - Verified trials in the first run, at least 1.
 * @param b - Passes in the second run.
 * @param n2 - Verified trials in the second run, at least 1.
 * @returns The two-sided p-value, in [0, 1].
 * @throws RangeError when the counts are inconsistent.
 */
export function fisherExact(a: number, n1: number, b: number, n2: number): number {
  for (const [c, n] of [[a, n1], [b, n2]] as const)
    if (!Number.isInteger(c) || !Number.isInteger(n) || n < 1 || c < 0 || c > n)
      throw new RangeError(`invalid counts: ${c} of ${n}`);
  const logFactorial = (n: number): number => {
    let sum = 0;
    for (let i = 2; i <= n; i++) sum += Math.log(i);
    return sum;
  };
  const logChoose = (n: number, k: number): number => logFactorial(n) - logFactorial(k) - logFactorial(n - k);
  const total = a + b;
  const p = (x: number): number => Math.exp(logChoose(n1, x) + logChoose(n2, total - x) - logChoose(n1 + n2, total));
  const observed = p(a);
  let sum = 0;
  // Tables as or less likely than the observed one; the tolerance absorbs rounding.
  for (let x = Math.max(0, total - n2); x <= Math.min(n1, total); x++) if (p(x) <= observed * (1 + 1e-9)) sum += p(x);
  return Math.min(1, sum);
}
