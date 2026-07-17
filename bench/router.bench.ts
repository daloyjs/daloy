/**
 * Tiny router micro-benchmark.
 * Run with: pnpm bench
 *
 * Compares static-route fast path vs deep dynamic path under load.
 */
import { Router } from "../src/router.js";

const r = new Router<{ id: number }>();
for (let i = 0; i < 500; i++) {
  r.add("GET", `/static/${i}/items`, { id: i });
  r.add("GET", `/users/:userId/posts/${i}/comments/:commentId`, { id: i + 10000 });
}

type Scenario = {
  label: string;
  iters: number;
  fn: () => void;
};

const rounds = 7;

function bench(scenario: Scenario): number {
  for (let i = 0; i < 2_000; i++) scenario.fn();
  const t0 = performance.now();
  for (let i = 0; i < scenario.iters; i++) scenario.fn();
  const t1 = performance.now();
  return (scenario.iters / (t1 - t0)) * 1_000;
}

const scenarios: Scenario[] = [
  {
    label: "static route lookup",
    iters: 1_000_000,
    fn: () => void r.find("GET", "/static/250/items"),
  },
  {
    label: "dynamic 4-segment lookup",
    iters: 500_000,
    fn: () => void r.find("GET", "/users/abc/posts/250/comments/xyz"),
  },
  {
    label: "miss",
    iters: 1_000_000,
    fn: () => void r.find("GET", "/no/such/path"),
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
