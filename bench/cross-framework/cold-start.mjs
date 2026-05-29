#!/usr/bin/env node
// Cold-start benchmark: wall-clock from process spawn() to first 200 OK.
// Repeats N times and reports min / median / mean / max.
//
// Usage:
//   node cold-start.mjs
//   node cold-start.mjs --only=daloy --iterations=10

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  __dirname, ROOT, machineInfo, parseArgs, stats, fmt, httpRequest,
} from "./lib/common.mjs";

const FRAMEWORKS = [
  { name: "daloy",        file: "servers/throughput/daloy.ts" },
  { name: "daloy-nozod",  file: "servers/throughput/daloy-nozod.ts" },
  { name: "hono",         file: "servers/throughput/hono.ts" },
  // { name: "fastify",  file: "servers/throughput/fastify.ts" },
  // { name: "express",  file: "servers/throughput/express.ts" },
  // { name: "koa",      file: "servers/throughput/koa.ts" },
  // { name: "nest",     file: "servers/throughput/nest.ts" },
  // { name: "elysia",   file: "servers/throughput/elysia.ts" },
  // { name: "feathers", file: "servers/throughput/feathers.ts" },
];

const args = parseArgs(process.argv);
const ONLY = args.only ? new Set(args.only.split(",")) : null;
const ITERATIONS = Number(args.iterations ?? 10);
const PORT_BASE = 3500;

async function measureColdStart(file, port) {
  const t0 = process.hrtime.bigint();
  const child = spawn(
    process.execPath,
    ["--no-warnings", "--import", "tsx", path.join(ROOT, file)],
    {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), NODE_ENV: "production" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let firstResponseAt;
  let killed = false;
  try {
    // Poll aggressively for the first successful response.
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        const r = await httpRequest(`http://127.0.0.1:${port}/static`, { timeoutMs: 250 });
        if (r.status === 200) {
          firstResponseAt = process.hrtime.bigint();
          break;
        }
      } catch { /* not ready yet */ }
      // ~5ms granularity is plenty for spawn-to-first-200 timing and avoids
      // hot-spinning the CPU which would skew the measurement.
      await new Promise((r) => setTimeout(r, 5));
    }
    if (!firstResponseAt) throw new Error("server never responded with 200 within 30s");
  } finally {
    killed = true;
    try { child.kill("SIGKILL"); } catch {}
    await new Promise((r) => child.once("exit", r));
  }
  void killed;
  return Number(firstResponseAt - t0) / 1e6; // ms
}

async function benchOne(fw, port) {
  console.error(`\n=== ${fw.name} ===`);
  const samples = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const ms = await measureColdStart(fw.file, port);
    samples.push(ms);
    console.error(`  iter ${i + 1}/${ITERATIONS}: ${ms.toFixed(1)} ms`);
    await new Promise((r) => setTimeout(r, 250));
  }
  return { samples, stats: stats(samples) };
}

async function main() {
  const targets = FRAMEWORKS.filter((f) => !ONLY || ONLY.has(f.name));
  const rows = [];
  let port = PORT_BASE;
  for (const fw of targets) {
    try {
      const r = await benchOne(fw, port++);
      rows.push({ framework: fw.name, ...r });
    } catch (err) {
      console.error(`  ✗ ${fw.name} failed: ${err.message}`);
      rows.push({ framework: fw.name, error: err.message });
    }
  }

  const lines = [
    "| Framework  | min (ms) | median (ms) | mean (ms) | stddev | max (ms) |",
    "| ---------- | -------: | ----------: | --------: | -----: | -------: |",
  ];
  for (const r of rows) {
    if (!r.stats) continue;
    lines.push(
      `| ${r.framework.padEnd(10)} `
      + `| ${r.stats.min.toFixed(1).padStart(8)} `
      + `| ${r.stats.median.toFixed(1).padStart(11)} `
      + `| ${r.stats.mean.toFixed(1).padStart(9)} `
      + `| ${r.stats.stddev.toFixed(1).padStart(6)} `
      + `| ${r.stats.max.toFixed(1).padStart(8)} |`,
    );
  }
  console.log("\n" + lines.join("\n") + "\n");

  writeFileSync(
    path.join(__dirname, "results.cold-start.json"),
    JSON.stringify({
      ranAt: new Date().toISOString(),
      machine: machineInfo(),
      iterations: ITERATIONS,
      rows,
    }, null, 2),
  );
  console.error(`Wrote results.cold-start.json (${rows.filter((r) => r.stats).length}/${rows.length} OK).`);
}

main().catch((err) => { console.error(err); process.exit(1); });
