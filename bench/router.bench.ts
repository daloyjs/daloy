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

function bench(label: string, iters: number, fn: () => void) {
  // warm
  for (let i = 0; i < 1000; i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const t1 = performance.now();
  const opsPerSec = ((iters / (t1 - t0)) * 1000).toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
  console.log(`${label.padEnd(40)} ${opsPerSec} ops/sec  (${(t1 - t0).toFixed(1)}ms / ${iters} iters)`);
}

bench("static route lookup", 1_000_000, () => {
  r.find("GET", "/static/250/items");
});
bench("dynamic 4-segment lookup", 500_000, () => {
  r.find("GET", "/users/abc/posts/250/comments/xyz");
});
bench("miss", 1_000_000, () => {
  r.find("GET", "/no/such/path");
});
