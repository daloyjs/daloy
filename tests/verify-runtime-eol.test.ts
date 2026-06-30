import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateFindings,
  groupBySource,
  parseEnginesNodeMajor,
  parseEnginesNodeMajors,
  parseWorkflowNodeMajors,
  type NodeEolCycle,
} from "../scripts/verify-runtime-eol.ts";

test("parseEnginesNodeMajors extracts majors from >=, ^, x, bare, and disjoint forms", () => {
  assert.deepEqual(parseEnginesNodeMajors(">=24.0.0"), [24]);
  assert.deepEqual(parseEnginesNodeMajors("^24.1.0"), [24]);
  assert.deepEqual(parseEnginesNodeMajors("24.x"), [24]);
  assert.deepEqual(parseEnginesNodeMajors("24"), [24]);
  assert.deepEqual(parseEnginesNodeMajors("^24.0.0 || >=26.0.0"), [24, 26]);
  assert.deepEqual(parseEnginesNodeMajors(">=24.0.0 <25.0.0 || >=26.0.0"), [24, 26]);
});

test("parseEnginesNodeMajor extracts first major from >=, ^, x, bare, and disjoint forms", () => {
  assert.equal(parseEnginesNodeMajor(">=24.0.0"), 24);
  assert.equal(parseEnginesNodeMajor("^24.1.0"), 24);
  assert.equal(parseEnginesNodeMajor("24.x"), 24);
  assert.equal(parseEnginesNodeMajor("24"), 24);
  assert.equal(parseEnginesNodeMajor("^24.0.0 || >=26.0.0"), 24);
});

test("parseEnginesNodeMajor helpers return empty/null for missing/garbage", () => {
  assert.deepEqual(parseEnginesNodeMajors(undefined), []);
  assert.deepEqual(parseEnginesNodeMajors(""), []);
  assert.deepEqual(parseEnginesNodeMajors("latest"), []);
  assert.equal(parseEnginesNodeMajor(undefined), null);
  assert.equal(parseEnginesNodeMajor(""), null);
  assert.equal(parseEnginesNodeMajor("latest"), null);
});

test("parseWorkflowNodeMajors handles quoted, unquoted, and dotted forms", () => {
  const yaml = [
    "      - uses: actions/setup-node@v6",
    "        with:",
    "          node-version: 24",
    "      - uses: actions/setup-node@v6",
    "        with:",
    "          node-version: '22.5'",
    "      - uses: actions/setup-node@v6",
    "        with:",
    '          node-version: "20"',
    "          # node-version: 18  (comments still match — script de-dups by source)",
  ].join("\n");
  assert.deepEqual(parseWorkflowNodeMajors(yaml), [24, 22, 20, 18]);
});

test("parseWorkflowNodeMajors returns empty when nothing matches", () => {
  assert.deepEqual(parseWorkflowNodeMajors("name: foo\n"), []);
});

test("groupBySource de-duplicates per-major source list", () => {
  const grouped = groupBySource([
    { source: "package.json", major: 24 },
    { source: "package.json", major: 24 },
    { source: ".github/workflows/ci.yml", major: 24 },
    { source: "package.json", major: 22 },
  ]);
  assert.deepEqual([...grouped.keys()].sort(), [22, 24]);
  assert.deepEqual(grouped.get(24), ["package.json", ".github/workflows/ci.yml"]);
  assert.deepEqual(grouped.get(22), ["package.json"]);
});

const FEED: NodeEolCycle[] = [
  { cycle: "24", eol: "2027-04-01", lts: "Active LTS" },
  { cycle: "22", eol: "2026-08-01", lts: "Maintenance" },
  { cycle: "20", eol: "2025-04-30", lts: false },
  { cycle: "18", eol: "2024-04-30", lts: false },
  { cycle: "29", eol: false }, // hypothetical "never" cycle
];

test("evaluateFindings flags already-EOL majors", () => {
  const grouped = new Map<number, readonly string[]>([
    [24, ["package.json"]],
    [18, [".github/workflows/legacy.yml"]],
  ]);
  const findings = evaluateFindings(grouped, FEED, new Date("2026-05-24T00:00:00Z"));
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.major, 18);
  assert.equal(findings[0]!.severity, "eol");
  assert.deepEqual(findings[0]!.sources, [".github/workflows/legacy.yml"]);
});

test("evaluateFindings emits a warning when within warnDays of EOL", () => {
  // Node 22 EOL = 2026-08-01. From 2026-05-24, that is ~69 days out — within 90.
  const grouped = new Map<number, readonly string[]>([[22, ["package.json"]]]);
  const findings = evaluateFindings(grouped, FEED, new Date("2026-05-24T00:00:00Z"));
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.severity, "warn");
  assert.ok(findings[0]!.daysUntilEol > 0 && findings[0]!.daysUntilEol <= 90);
});

test("evaluateFindings ignores supported majors and unknown majors", () => {
  // Node 24 EOL is well over 90 days out; Node 99 is not in the feed.
  const grouped = new Map<number, readonly string[]>([
    [24, ["package.json"]],
    [99, ["package.json"]],
  ]);
  const findings = evaluateFindings(grouped, FEED, new Date("2026-05-24T00:00:00Z"));
  assert.equal(findings.length, 0);
});

test("evaluateFindings skips cycles whose EOL field is false (never)", () => {
  const grouped = new Map<number, readonly string[]>([[29, ["package.json"]]]);
  const findings = evaluateFindings(grouped, FEED, new Date("2026-05-24T00:00:00Z"));
  assert.equal(findings.length, 0);
});

test("evaluateFindings tolerates malformed eol strings", () => {
  const malformed: NodeEolCycle[] = [{ cycle: "24", eol: "not-a-date" }];
  const grouped = new Map<number, readonly string[]>([[24, ["package.json"]]]);
  const findings = evaluateFindings(grouped, malformed, new Date("2026-05-24T00:00:00Z"));
  assert.equal(findings.length, 0);
});

test("evaluateFindings respects a custom warnDays threshold", () => {
  // Node 22 EOL is ~69 days out on 2026-05-24. With warnDays=30, no warning.
  const grouped = new Map<number, readonly string[]>([[22, ["package.json"]]]);
  const findings = evaluateFindings(
    grouped,
    FEED,
    new Date("2026-05-24T00:00:00Z"),
    30,
  );
  assert.equal(findings.length, 0);
});
