/**
 * Tiny router micro-benchmark.
 * Run with: pnpm bench
 *
 * Compares static-route fast path vs deep dynamic path under load. Each
 * scenario verifies its result before timing and keeps the final lookup
 * observable so a broken or optimized-away lookup cannot produce a plausible
 * benchmark result. Raw samples and provenance are written to
 * `bench/results.router.json`.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "../src/router.js";
import type { RouteMatch } from "../src/router.js";

const r = new Router<{ id: number }>();
for (let i = 0; i < 500; i++) {
  r.add("GET", `/static/${i}/items`, { id: i });
  r.add("GET", `/users/:userId/posts/${i}/comments/:commentId`, { id: i + 10000 });
}

type Scenario = {
  label: string;
  iters: number;
  fn: () => RouteMatch<{ id: number }> | undefined;
  verify: (result: RouteMatch<{ id: number }> | undefined) => boolean;
};

const rounds = 7;
const warmupIterations = 2_000;

function bench(scenario: Scenario): number {
  let observed: RouteMatch<{ id: number }> | undefined;
  for (let i = 0; i < warmupIterations; i++) observed = scenario.fn();
  const t0 = performance.now();
  for (let i = 0; i < scenario.iters; i++) observed = scenario.fn();
  const t1 = performance.now();
  if (!scenario.verify(observed)) {
    throw new Error(`${scenario.label}: lookup result failed correctness verification`);
  }
  return (scenario.iters / (t1 - t0)) * 1_000;
}

const scenarios: Scenario[] = [
  {
    label: "static route lookup",
    iters: 1_000_000,
    fn: () => r.find("GET", "/static/250/items"),
    verify: (result) => result?.handler.id === 250 && Object.keys(result.params).length === 0,
  },
  {
    label: "dynamic 4-segment lookup",
    iters: 500_000,
    fn: () => r.find("GET", "/users/abc/posts/250/comments/xyz"),
    verify: (result) =>
      result?.handler.id === 10_250 &&
      result.params.userId === "abc" &&
      result.params.commentId === "xyz",
  },
  {
    label: "miss",
    iters: 1_000_000,
    fn: () => r.find("GET", "/no/such/path"),
    verify: (result) => result === undefined,
  },
];

const samples = new Map(scenarios.map((scenario) => [scenario.label, [] as number[]]));
for (let round = 0; round < rounds; round++) {
  const offset = round % scenarios.length;
  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[(i + offset) % scenarios.length]!;
    samples.get(scenario.label)!.push(bench(scenario));
  }
}

const format = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 0 });
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

console.log(`Router lookup benchmark — median of ${rounds} rotated rounds`);
for (const scenario of scenarios) {
  const values = samples.get(scenario.label)!;
  console.log(
    `${scenario.label.padEnd(30)} ${format(median(values)).padStart(12)} ops/sec` +
      `  (range ${format(Math.min(...values))}–${format(Math.max(...values))})`
  );
}

function tryExec(command: string, args: string[]): string | undefined {
  try {
    return execFileSync(command, args, {
      cwd: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    }).trim();
  } catch {
    return undefined;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const gitStatus = tryExec("git", ["status", "--porcelain"]);
writeFileSync(
  resolve(here, "results.router.json"),
  `${JSON.stringify(
    {
      bench: "router",
      ranAt: new Date().toISOString(),
      machine: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpuModel: os.cpus()[0]?.model ?? "unknown",
        cpuCount: os.cpus().length,
        totalMemGiB: Number((os.totalmem() / 1024 ** 3).toFixed(2)),
        loadAvg: os.loadavg(),
        gitSha: tryExec("git", ["rev-parse", "HEAD"]) ?? "unknown",
        gitDirty: gitStatus === undefined ? "unknown" : gitStatus.length > 0,
      },
      config: { rounds, warmupIterations },
      results: scenarios.map((scenario) => {
        const values = samples.get(scenario.label)!;
        return {
          label: scenario.label,
          iterationsPerRound: scenario.iters,
          medianOpsPerSec: median(values),
          minOpsPerSec: Math.min(...values),
          maxOpsPerSec: Math.max(...values),
          samples: values,
        };
      }),
    },
    null,
    2
  )}\n`
);
