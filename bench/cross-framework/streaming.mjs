#!/usr/bin/env node
// Streaming response throughput: how fast can the framework push a large
// streamed body out the socket? Useful for SSE-like patterns and chunked
// JSON / NDJSON APIs.
//
// Methodology: GET /stream returns a 10 MiB body produced via ReadableStream.
// We measure (a) requests/sec at 50 concurrent connections, and (b) bytes/sec
// throughput.
//
// Usage:
//   node streaming.mjs
//   node streaming.mjs --only=daloy

import { writeFileSync } from "node:fs";
import path from "node:path";
import autocannon from "autocannon";
import {
  __dirname, machineInfo, parseArgs,
  startServer, killServer, waitForHealthy, stats, fmt, warnBenchEnvironment,
} from "./lib/common.mjs";

const FRAMEWORKS = [
  { name: "daloy",    file: "servers/stream/daloy.ts" },
  { name: "hono",     file: "servers/stream/hono.ts" },
  { name: "fastify",  file: "servers/stream/fastify.ts" },
  { name: "express",  file: "servers/stream/express.ts" },
  { name: "koa",      file: "servers/stream/koa.ts" },
  { name: "nest",     file: "servers/stream/nest.ts" },
  { name: "elysia",   file: "servers/stream/elysia.ts" },
  { name: "feathers", file: "servers/stream/feathers.ts" },
];

const args = parseArgs(process.argv);
const ONLY = args.only ? new Set(args.only.split(",")) : null;
const DURATION = Number(process.env.DURATION ?? 15);
const WARMUP = Number(process.env.WARMUP ?? 10);
const ITERATIONS = Number(process.env.ITERATIONS ?? 3);
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 50);
const PORT = 3580;

function runAutocannon(duration) {
  return new Promise((resolve, reject) => {
    const instance = autocannon({
      url: `http://127.0.0.1:${PORT}/stream`,
      method: "GET",
      connections: CONNECTIONS,
      pipelining: 1,
      duration,
    }, (err, result) => err ? reject(err) : resolve(result));
    autocannon.track(instance, { renderProgressBar: false, renderResultsTable: false, renderLatencyTable: false });
  });
}

async function benchOne(fw) {
  console.error(`\n=== ${fw.name} ===`);
  const child = await startServer(fw.file, { port: PORT });
  try {
    await waitForHealthy(PORT, "/health");
    await runAutocannon(WARMUP);
    const samples = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const r = await runAutocannon(DURATION);
      samples.push({
        reqPerSec: r.requests.average,
        throughputMBps: r.throughput.average / 1024 / 1024,
        p99: r.latency.p99,
        non2xx: r.non2xx ?? 0,
      });
    }
    const rps = stats(samples.map((s) => s.reqPerSec));
    const tput = stats(samples.map((s) => s.throughputMBps));
    const p99 = samples.reduce((a, s) => a + s.p99, 0) / samples.length;
    console.error(
      `  ${fmt(rps.median).padStart(6)} req/s  ` +
      `${tput.median.toFixed(1).padStart(7)} MiB/s  ` +
      `p99 ${p99.toFixed(2)}ms`,
    );
    return { reqPerSec: rps, throughputMBps: tput, p99, samples };
  } finally {
    await killServer(child);
  }
}

async function main() {
  warnBenchEnvironment({ maxConnections: CONNECTIONS });
  const targets = FRAMEWORKS.filter((f) => !ONLY || ONLY.has(f.name));
  const rows = [];
  for (const fw of targets) {
    try {
      const r = await benchOne(fw);
      rows.push({ framework: fw.name, ...r });
    } catch (err) {
      console.error(`  ✗ ${fw.name} failed: ${err.message}`);
      rows.push({ framework: fw.name, error: err.message });
    }
  }

  const lines = [
    "| Framework  | req/s (median) | MiB/s (median) | p99 (ms) |",
    "| ---------- | -------------: | -------------: | -------: |",
  ];
  for (const r of rows) {
    if (!r.reqPerSec) continue;
    lines.push(
      `| ${r.framework.padEnd(10)} `
      + `| ${fmt(r.reqPerSec.median).padStart(14)} `
      + `| ${r.throughputMBps.median.toFixed(1).padStart(14)} `
      + `| ${r.p99.toFixed(2).padStart(8)} |`,
    );
  }
  console.log("\n" + lines.join("\n") + "\n");

  writeFileSync(
    path.join(__dirname, "results.streaming.json"),
    JSON.stringify({
      ranAt: new Date().toISOString(),
      machine: machineInfo(),
      config: { duration: DURATION, warmup: WARMUP, iterations: ITERATIONS, connections: CONNECTIONS },
      rows,
    }, null, 2),
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
