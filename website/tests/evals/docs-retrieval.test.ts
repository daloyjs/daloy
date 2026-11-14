import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { RETRIEVAL_CASES } from "./docs-retrieval.dataset";

/**
 * Docs-retrieval eval for the docs MCP `search_docs` tool.
 *
 * Runs every labelled query in `docs-retrieval.dataset.ts` through the same
 * `rankDocPages()` the MCP endpoint and site search use, over the real docs
 * corpus, and reports recall@1, recall@3, and mean reciprocal rank (MRR).
 * The thresholds below are regression floors set from the measured baseline:
 * a ranking, keyword, or content change that makes agents land on the wrong
 * page fails CI instead of silently degrading answers. Raise the floors when
 * the numbers improve; never lower them to make a change pass.
 *
 * `getAllDocPages()` calls `cacheLife()` from `next/cache`, which throws
 * outside the Next.js runtime, so it is stubbed first (as in
 * `tests/lib/docs-content.test.ts`).
 */
mock.module("next/cache", {
  namedExports: { cacheLife: () => {}, cacheTag: () => {} },
});

const { getAllDocPages } = await import("../../lib/docs-content");
const { rankDocPages } = await import("../../lib/docs-ranking");

/** Same default page size the MCP `search_docs` tool returns. */
const TOP_K = 5;

/**
 * Regression floors, set just below the baseline measured on 2026-11-13
 * (46 queries: recall@1 0.935, recall@3 0.978, MRR 0.953). Known misses at
 * that baseline: "testing routes with app.request" (testing page not in the
 * top 5), "run on bun" (rank 3), "websocket" (rank 2).
 */
const MIN_RECALL_AT_1 = 0.9;
const MIN_RECALL_AT_3 = 0.95;
const MIN_MRR = 0.92;

test("docs search ranks the right page for realistic agent queries", async () => {
  const pages = await getAllDocPages();
  const routes = new Set<string>(pages.map((p) => p.href));

  let hitsAt1 = 0;
  let hitsAt3 = 0;
  let reciprocalRankSum = 0;
  const misses: string[] = [];

  for (const { query, relevant } of RETRIEVAL_CASES) {
    for (const href of relevant) assert.ok(routes.has(href), `dataset points at a missing page: ${href}`);
    const ranked = rankDocPages(pages, query, TOP_K).map((r) => r.page.href);
    const rank = ranked.findIndex((href) => relevant.includes(href)) + 1;
    if (rank === 1) hitsAt1++;
    if (rank >= 1 && rank <= 3) hitsAt3++;
    if (rank >= 1) reciprocalRankSum += 1 / rank;
    if (rank !== 1) {
      misses.push(`  "${query}" → ${rank === 0 ? `not in top ${TOP_K}` : `rank ${rank}`} (got ${ranked.slice(0, 3).join(", ") || "nothing"})`);
    }
  }

  const n = RETRIEVAL_CASES.length;
  const recallAt1 = hitsAt1 / n;
  const recallAt3 = hitsAt3 / n;
  const mrr = reciprocalRankSum / n;
  const report =
    `docs retrieval over ${n} queries: recall@1=${recallAt1.toFixed(3)} recall@3=${recallAt3.toFixed(3)} ` +
    `MRR=${mrr.toFixed(3)}${misses.length > 0 ? `\nnot ranked first:\n${misses.join("\n")}` : ""}`;
  console.log(report);

  assert.ok(recallAt1 >= MIN_RECALL_AT_1, `recall@1 ${recallAt1.toFixed(3)} < ${MIN_RECALL_AT_1}\n${report}`);
  assert.ok(recallAt3 >= MIN_RECALL_AT_3, `recall@3 ${recallAt3.toFixed(3)} < ${MIN_RECALL_AT_3}\n${report}`);
  assert.ok(mrr >= MIN_MRR, `MRR ${mrr.toFixed(3)} < ${MIN_MRR}\n${report}`);
});

test("the eval dataset has no duplicate queries", () => {
  const queries = RETRIEVAL_CASES.map((c) => c.query.toLowerCase());
  assert.equal(new Set(queries).size, queries.length);
});
