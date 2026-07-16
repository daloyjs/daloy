#!/usr/bin/env node
// POST body-size sweep: measures throughput and latency of POST /echo
// across body sizes {100 B, 1 KiB, 16 KiB, 256 KiB, 1 MiB, 4 MiB}.
//
// Why: directly validates whether body-handling fast paths scale, and where
// they fall over (e.g. when streaming kicks in above an adapter buffer cap).
//
// Usage:
//   node body-size-sweep.mjs
//   node body-size-sweep.mjs --only=daloy

import { writeFileSync } from "node:fs";
import autocannon from "autocannon";
import {
  resultsPath, orderTargets, machineInfo, parseArgs,
  startServer, killServer, waitForHealthy, stats, fmt, warnBenchEnvironment,
} from "./lib/common.mjs";
import { c, section, summary, fail, metric, metricsLine, sym } from "./lib/format.mjs";

const FRAMEWORKS = [
  { name: "daloy",    file: "servers/echo-bytes/daloy.ts" },
  { name: "hono",     file: "servers/echo-bytes/hono.ts" },
  { name: "fastify",  file: "servers/echo-bytes/fastify.ts" },
  { name: "express",  file: "servers/echo-bytes/express.ts" },
  { name: "koa",      file: "servers/echo-bytes/koa.ts" },
  { name: "nest",     file: "servers/echo-bytes/nest.ts" },
  { name: "elysia",   file: "servers/echo-bytes/elysia.ts" },
  { name: "feathers", file: "servers/echo-bytes/feathers.ts" },
];

const args = parseArgs(process.argv);
const ONLY = args.only ? new Set(args.only.split(",")) : null;
const DURATION = Number(process.env.DURATION ?? 10);
const WARMUP = Number(process.env.WARMUP ?? 10);
const ITERATIONS = Number(process.env.ITERATIONS ?? 3);
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 100);
const PORT = 3520;

const SIZES = [
  { id: "100B",    bytes: 100 },
  { id: "1KiB",    bytes: 1024 },
  { id: "16KiB",   bytes: 16 * 1024 },
  { id: "256KiB",  bytes: 256 * 1024 },
  { id: "1MiB",    bytes: 1024 * 1024 },
  { id: "4MiB",    bytes: 4 * 1024 * 1024 },
];

function makeBody(bytes) {
  // Use a single 'a' filler. Server-side echo just returns content-length.
  return Buffer.alloc(bytes, 0x61);
}

function runAutocannon({ duration, connections, body }) {
  return new Promise((resolve, reject) => {
    const instance = autocannon({
      url: `http://127.0.0.1:${PORT}/echo-bytes`,
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body,
      connections,
      pipelining: 1,
      duration,
    }, (err, result) => err ? reject(err) : resolve(result));
    autocannon.track(instance, { renderProgressBar: false, renderResultsTable: false, renderLatencyTable: false });
  });
}

async function benchOne(fw) {
  console.error(section(fw.name));
  const child = await startServer(fw.file, { port: PORT });
  await waitForHealthy(PORT, "/health");
  try {
    const out = {};
    for (const sz of SIZES) {
      const body = makeBody(sz.bytes);
      await runAutocannon({ duration: WARMUP, connections: CONNECTIONS, body });
      const samples = [];
      for (let i = 0; i < ITERATIONS; i++) {
        const r = await runAutocannon({ duration: DURATION, connections: CONNECTIONS, body });
        samples.push({
          reqPerSec: r.requests.average,
          throughputMBps: r.throughput.average / 1024 / 1024,
          p50: r.latency.p50,
          p99: r.latency.p99,
          non2xx: r.non2xx ?? 0,
          errors: r.errors ?? 0,
        });
      }
      const rps = stats(samples.map((s) => s.reqPerSec));
      const tput = stats(samples.map((s) => s.throughputMBps));
      out[sz.id] = {
        bytes: sz.bytes,
        reqPerSec: rps,
        throughputMBps: tput,
        p50: samples.reduce((a, s) => a + s.p50, 0) / samples.length,
        p99: samples.reduce((a, s) => a + s.p99, 0) / samples.length,
        errors: samples.reduce((a, s) => a + s.non2xx + s.errors, 0),
        samples,
      };
      console.error(metricsLine(sz.id, [
        c.green(c.bold(fmt(rps.median))) + c.dim(" req/s"),
        c.cyan(tput.median.toFixed(1)) + c.dim(" MiB/s"),
        metric("p99", out[sz.id].p99.toFixed(2), { unit: "ms" }),
        out[sz.id].errors ? c.red(`${sym.warn} ${out[sz.id].errors} errors`) : "",
      ].filter(Boolean), { labelWidth: 8 }));
    }
    return out;
  } finally {
    await killServer(child);
  }
}

async function main() {
  warnBenchEnvironment({ maxConnections: CONNECTIONS });
  const targets = orderTargets(FRAMEWORKS.filter((f) => !ONLY || ONLY.has(f.name)), args.order);
  const rows = [];
  for (const fw of targets) {
    try {
      const results = await benchOne(fw);
      rows.push({ framework: fw.name, results });
    } catch (err) {
      console.error("  " + fail(`${fw.name} failed: ${err.message}`));
      rows.push({ framework: fw.name, error: err.message });
    }
  }

  // One row per (framework, size) so the table is easy to scan.
  const tableRows = [];
  for (const r of rows) {
    if (!r.results) continue;
    for (const sz of SIZES) {
      const s = r.results[sz.id];
      if (!s) continue;
      tableRows.push([
        r.framework,
        sz.id,
        fmt(s.reqPerSec.median),
        s.throughputMBps.median.toFixed(1),
        s.p99.toFixed(2),
        String(s.errors),
      ]);
    }
  }
  console.log("\n" + summary({
    head: ["Framework", "size", "req/s (median)", "MiB/s (median)", "p99 (ms)", "errors"],
    rows: tableRows,
    align: ["l", "l", "r", "r", "r", "r"],
    highlight: (row) => row[0].includes("daloy"),
  }) + "\n");

  writeFileSync(
    resultsPath("results.body-size.json"),
    JSON.stringify({
      ranAt: new Date().toISOString(),
      machine: machineInfo(),
      config: { duration: DURATION, warmup: WARMUP, iterations: ITERATIONS, connections: CONNECTIONS, sizes: SIZES },
      rows,
    }, null, 2),
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
