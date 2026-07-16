#!/usr/bin/env node
// Error-path benchmark: how fast does the framework reject a bad request?
// We send POST /echo with malformed JSON and measure 400-response throughput.
//
// Why: many frameworks are 5-10x slower on errors because they synthesize
// stack traces, allocate problem documents, or run extra middleware.
//
// Usage:
//   node error-path.mjs
//   node error-path.mjs --only=daloy

import { writeFileSync } from "node:fs";
import autocannon from "autocannon";
import {
  resultsPath, orderTargets, machineInfo, parseArgs,
  startServer, killServer, waitForHealthy, stats, fmt, warnBenchEnvironment,
} from "./lib/common.mjs";
import { c, section, summary, fail, metric, metricsLine } from "./lib/format.mjs";

const FRAMEWORKS = [
  { name: "daloy",     file: "servers/throughput/daloy.ts" },
  { name: "daloy-min", file: "servers/throughput/daloy-minimal.ts" },
  { name: "hono",      file: "servers/throughput/hono.ts" },
  { name: "fastify",   file: "servers/throughput/fastify.ts" },
  { name: "express",   file: "servers/throughput/express.ts" },
  { name: "koa",       file: "servers/throughput/koa.ts" },
  { name: "nest",      file: "servers/throughput/nest.ts" },
  { name: "elysia",    file: "servers/throughput/elysia.ts" },
  { name: "feathers",  file: "servers/throughput/feathers.ts" },
];

const args = parseArgs(process.argv);
const ONLY = args.only ? new Set(args.only.split(",")) : null;
const DURATION = Number(process.env.DURATION ?? 10);
const WARMUP = Number(process.env.WARMUP ?? 10);
const ITERATIONS = Number(process.env.ITERATIONS ?? 3);
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 100);
const PORT = 3570;

const SCENARIOS = [
  {
    id: "malformed-json",
    title: "POST /echo malformed JSON",
    body: "{not json",
    expectStatus: 400,
  },
  {
    id: "schema-fail",
    title: "POST /echo schema fail (wrong type)",
    body: JSON.stringify({ name: 42 }),
    expectStatus: 400,
  },
  {
    id: "not-found",
    title: "GET /does-not-exist",
    method: "GET",
    urlPath: "/does-not-exist",
    expectStatus: 404,
  },
];

function runAutocannon(sc, duration) {
  return new Promise((resolve, reject) => {
    const instance = autocannon({
      url: `http://127.0.0.1:${PORT}${sc.urlPath ?? "/echo"}`,
      method: sc.method ?? "POST",
      headers: sc.method === "GET" ? undefined : { "content-type": "application/json" },
      body: sc.body,
      connections: CONNECTIONS,
      pipelining: 1,
      duration,
      // autocannon counts any non-2xx as "non2xx" by default.
      // We're EXPECTING non-2xx here, so we treat them as success.
      expectBody: undefined,
    }, (err, result) => err ? reject(err) : resolve(result));
    autocannon.track(instance, { renderProgressBar: false, renderResultsTable: false, renderLatencyTable: false });
  });
}

async function benchOne(fw) {
  console.error(section(fw.name));
  const child = await startServer(fw.file, { port: PORT });
  await waitForHealthy(PORT);
  try {
    const out = {};
    for (const sc of SCENARIOS) {
      await runAutocannon(sc, WARMUP);
      const samples = [];
      for (let i = 0; i < ITERATIONS; i++) {
        const r = await runAutocannon(sc, DURATION);
        samples.push({
          reqPerSec: r.requests.average,
          p99: r.latency.p99,
          status2xx: r["2xx"] ?? 0,
          nonExpected: r.non2xx ?? 0,
        });
      }
      const rps = stats(samples.map((s) => s.reqPerSec));
      const p99 = samples.reduce((a, s) => a + s.p99, 0) / samples.length;
      out[sc.id] = { reqPerSec: rps, p99, samples };
      console.error(metricsLine(sc.title, [
        c.green(c.bold(fmt(rps.median))) + c.dim(" req/s"),
        metric("p99", p99.toFixed(2), { unit: "ms" }),
      ], { labelWidth: 38 }));
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

  const tableRows = [];
  for (const r of rows) {
    if (!r.results) continue;
    for (const sc of SCENARIOS) {
      const s = r.results[sc.id];
      if (!s) continue;
      tableRows.push([
        r.framework,
        sc.title,
        fmt(s.reqPerSec.median),
        s.p99.toFixed(2),
      ]);
    }
  }
  console.log("\n" + summary({
    head: ["Framework", "scenario", "req/s (median)", "p99 (ms)"],
    rows: tableRows,
    align: ["l", "l", "r", "r"],
    highlight: (row) => row[0].includes("daloy"),
  }) + "\n");

  writeFileSync(
    resultsPath("results.error-path.json"),
    JSON.stringify({
      ranAt: new Date().toISOString(),
      machine: machineInfo(),
      config: { duration: DURATION, warmup: WARMUP, iterations: ITERATIONS, connections: CONNECTIONS },
      rows,
    }, null, 2),
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
