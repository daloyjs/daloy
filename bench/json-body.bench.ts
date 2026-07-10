/**
 * JSON body-parse micro-benchmark.
 * Run with: node --import tsx bench/json-body.bench.ts
 *
 * Compares the plain prototype-pollution-safe parser (`safeJsonParse`) against
 * the structural-limit parser (`safeJsonParseLimited`, which additionally
 * bounds total keys and nesting depth) on payloads that resemble real request
 * bodies. This is the hot path exercised by every JSON request, so any
 * regression here matters (see AGENTS.md performance rule).
 */
import { safeJsonParse, safeJsonParseLimited } from "../src/security.js";

function bench(label: string, iters: number, fn: () => void): void {
  for (let i = 0; i < 2000; i++) fn(); // warm
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const t1 = performance.now();
  const opsPerSec = ((iters / (t1 - t0)) * 1000).toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
  console.log(
    `${label.padEnd(44)} ${opsPerSec.padStart(12)} ops/sec  (${(t1 - t0).toFixed(1)}ms / ${iters} iters)`,
  );
}

// A typical REST body: a handful of scalar fields plus a small nested object
// and array. Representative of the overwhelming majority of real requests.
const typical = JSON.stringify({
  id: "018f...",
  name: "Ada Lovelace",
  email: "ada@example.com",
  age: 36,
  active: true,
  tags: ["math", "engines", "notes"],
  address: { street: "12 King St", city: "London", zip: "SW1A" },
  meta: { createdAt: "2026-07-09T00:00:00Z", source: "api", retries: 0 },
});

// A larger-but-legitimate body: ~500 keys, still well under the 10k default.
const wideLegit = JSON.stringify(
  Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`field_${i}`, `value_${i}`])),
);

// A moderately nested legitimate body (depth ~15, under the 50 default).
let nestedLegit: any = { leaf: 1 };
for (let i = 0; i < 15; i++) nestedLegit = { level: i, child: nestedLegit };
const nestedLegitStr = JSON.stringify(nestedLegit);

console.log("JSON body-parse micro-benchmark\n");

bench("typical body — safeJsonParse", 500_000, () => void safeJsonParse(typical));
bench("typical body — safeJsonParseLimited", 500_000, () => void safeJsonParseLimited(typical));
console.log("");
bench("500-key body — safeJsonParse", 100_000, () => void safeJsonParse(wideLegit));
bench("500-key body — safeJsonParseLimited", 100_000, () => void safeJsonParseLimited(wideLegit));
console.log("");
bench("nested body — safeJsonParse", 500_000, () => void safeJsonParse(nestedLegitStr));
bench("nested body — safeJsonParseLimited", 500_000, () => void safeJsonParseLimited(nestedLegitStr));
