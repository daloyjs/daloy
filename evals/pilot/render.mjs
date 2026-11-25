import { readFile, readdir } from "node:fs/promises";
import { text } from "node:stream/consumers";
import { evaluate } from "deepeval";
import { BaseMetric } from "deepeval/metrics";
import { LLMTestCase } from "deepeval/test-case";

class RecordedCheck extends BaseMetric {
  constructor(id) {
    super(1, { showIndicator: false });
    this.id = id;
  }
  get name() {
    return this.id;
  }
  async measure(testCase) {
    const row = testCase.additionalMetadata;
    const grade = row.grades.find((g) => g.id === this.id);
    if (grade?.unverified) {
      // DeepEval 0.9.26 counts a skipped metric as a pass in its aggregate.
      // A metric without a verdict is excluded from its pass-rate denominator.
      this.reason = "Unverified: " + (grade.reason || "unavailable evidence");
      return;
    }
    // The harness can grade work left by a timeout. Preserve its trial verdict
    // even when one or more of the individual checks had no evidence.
    this.success = grade ? grade.pass : row.pass;
    this.score = Number(this.success);
    this.reason =
      grade?.reason ||
      (grade ? "Recorded executable check" : "Recorded trial outcome");
    return this.score;
  }
}

const { ids, rows, revision } = JSON.parse(await text(process.stdin));
const verified = rows.filter((row) => !row.unverified);
const unknown = rows.filter((row) => row.unverified);
const passed = verified.filter((row) => row.pass).length;
const parts = [
  `Grader revision ${revision}. Trials: ${passed} passed, ${verified.length - passed} failed, ${unknown.length} unverified. Success rate denominator: ${verified.length} verified trials.\n`,
];
if (verified.length) {
  const cases = verified.map(
    (row) =>
      new LLMTestCase({
        name: row.name,
        input: `GET /books; agent time ${row.durationMs} ms; timed out: ${row.timedOut}`,
        actualOutput: row.pass ? "pass" : "fail",
        additionalMetadata: row,
      }),
  );
  // Keep SDK progress on stderr and native Markdown on stdout.
  console.log = console.error;
  const report = await evaluate(
    cases,
    ["trial outcome", ...ids].map((id) => new RecordedCheck(id)),
    {
      displayConfig: {
        printResults: false,
        showIndicator: false,
        fileOutputDir: "/tmp/report",
      },
      cacheConfig: { useCache: false, writeCache: false },
    },
  );
  for (const [i, result] of report.testResults.entries()) {
    if (result.success !== verified[i].pass)
      throw new Error("DeepEval trial verdict mismatch");
    for (const grade of verified[i].grades) {
      const metric = result.metricsData.find((m) => m.name === grade.id);
      if (
        !metric ||
        (grade.unverified
          ? metric.success !== undefined || metric.score !== undefined
          : metric.score !== Number(grade.pass))
      ) {
        throw new Error(`DeepEval grade mismatch: ${grade.id}`);
      }
    }
  }
  const [file] = await readdir("/tmp/report");
  parts.push(await readFile(`/tmp/report/${file}`, "utf8"));
}
if (unknown.length) {
  parts.push("## Unverified trials (excluded from success rate)\n");
  for (const row of unknown) {
    parts.push(`- ${row.name}: ${row.reason || "Incomplete grader evidence"}`);
    for (const g of row.grades)
      parts.push(
        `  - ${g.id}: ${g.unverified ? "unverified" : g.pass ? "pass" : "fail"} ${g.reason}`,
      );
  }
}
process.stdout.write(parts.join("\n") + "\n");
