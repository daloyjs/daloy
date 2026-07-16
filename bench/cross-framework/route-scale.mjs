#!/usr/bin/env node
// Route-scale benchmark: register N routes and hit one of them.
// Exposes how router lookup cost scales with the routing table size.
//
// Usage:
//   node route-scale.mjs
//   node route-scale.mjs --only=daloy --routes=500

import { writeFileSync } from "node:fs";
import autocannon from "autocannon";
import {
  resultsPath, orderTargets, machineInfo, parseArgs,
  startServer, killServer, waitForHealthy, stats, fmt, warnBenchEnvironment,
} from "./lib/common.mjs";
import { c, section, summary, fail, metric, metricsLine } from "./lib/format.mjs";

// Only servers that honor the ROUTE_COUNT env var and expose /r/:i routes
// belong here. The plain `daloy` / `hono` servers expose only /static,
// /users/:id, /echo, so route-scale (which probes /r/<lastIdx>) would fail
// the readiness check for them.
// Four-way comparison:
//   *-scale            = router + framework defaults (Daloy validates response body; Hono does not)
//   daloy-scale-nozod  = Daloy without response-body schema (router + middleware only)
//   hono-scale-validated = Hono with zod response validation (matches daloy-scale's work)
const FRAMEWORKS = [
  { name: "daloy-scale",          file: "servers/scale/daloy.ts" },
  { name: "daloy-scale-nozod",    file: "servers/scale/daloy-nozod.ts" },
  { name: "hono-scale",           file: "servers/scale/hono.ts" },
  { name: "hono-scale-validated", file: "servers/scale/hono-validated.ts" },
  { name: "fastify-scale",        file: "servers/scale/fastify.ts" },
  { name: "express-scale",        file: "servers/scale/express.ts" },
  { name: "koa-scale",            file: "servers/scale/koa.ts" },
  { name: "nest-scale",           file: "servers/scale/nest.ts" },
  { name: "elysia-scale",         file: "servers/scale/elysia.ts" },
  { name: "feathers-scale",       file: "servers/scale/feathers.ts" },
];

const args = parseArgs(process.argv);
const ONLY = args.only ? new Set(args.only.split(",")) : null;
const DURATION = Number(process.env.DURATION ?? 10);
const WARMUP = Number(process.env.WARMUP ?? 10);
const ITERATIONS = Number(process.env.ITERATIONS ?? 3);
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 100);
const PORT = 3560;
const ROUTE_COUNTS = (args.routes ? args.routes.split(",") : ["10", "100", "500", "2000"]).map(Number);

function runAutocannon({ duration, urlPath }) {
  return new Promise((resolve, reject) => {
    const instance = autocannon({
      url: `http://127.0.0.1:${PORT}${urlPath}`,
      connections: CONNECTIONS,
      pipelining: 1,
      duration,
    }, (err, result) => err ? reject(err) : resolve(result));
    autocannon.track(instance, { renderProgressBar: false, renderResultsTable: false, renderLatencyTable: false });
  });
}

async function benchOneCount(fw, routeCount) {
  console.error(section(fw.name, `${routeCount} routes`));
  const child = await startServer(fw.file, { port: PORT, extraEnv: { ROUTE_COUNT: String(routeCount) } });
  await waitForHealthy(PORT, "/r/0");
  try {
    // Hit the *last* registered route so trie/list traversal pays its full cost.
    const lastIdx = routeCount - 1;
    const urlPath = `/r/${lastIdx}`;
    await runAutocannon({ duration: WARMUP, urlPath });
    const samples = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const r = await runAutocannon({ duration: DURATION, urlPath });
      samples.push({
        reqPerSec: r.requests.average,
        p99: r.latency.p99,
        non2xx:   r.non2xx ?? 0,
        errors:   r.errors ?? 0,
        timeouts: r.timeouts ?? 0,
        resets:   r.resets ?? 0,
      });
    }
    const rps = stats(samples.map((s) => s.reqPerSec));
    // Median, not mean — see run.mjs summarize().
    const p99 = stats(samples.map((s) => s.p99)).median;
    const errors = {
      non2xx:   samples.reduce((a, s) => a + s.non2xx, 0),
      errors:   samples.reduce((a, s) => a + s.errors, 0),
      timeouts: samples.reduce((a, s) => a + s.timeouts, 0),
      resets:   samples.reduce((a, s) => a + s.resets, 0),
    };
    const totalErr = errors.non2xx + errors.errors + errors.timeouts;
    console.error(metricsLine(`${routeCount} routes`, [
      c.green(c.bold(fmt(rps.median))) + c.dim(" req/s"),
      metric("p99", p99.toFixed(2), { unit: "ms" }),
      totalErr > 0 ? c.red(`non2xx=${errors.non2xx} err=${errors.errors} to=${errors.timeouts}`) : "",
    ].filter(Boolean), { labelWidth: 14 }));
    return { routeCount, reqPerSec: rps, p99, errors, samples };
  } finally {
    await killServer(child);
  }
}

async function main() {
  warnBenchEnvironment({ maxConnections: CONNECTIONS });
  const targets = orderTargets(FRAMEWORKS.filter((f) => !ONLY || ONLY.has(f.name)), args.order);
  const rows = [];
  for (const fw of targets) {
    const series = [];
    for (const rc of ROUTE_COUNTS) {
      try {
        series.push(await benchOneCount(fw, rc));
      } catch (err) {
        console.error("  " + fail(`${fw.name} @ ${rc} routes: ${err.message}`));
        series.push({ routeCount: rc, error: err.message });
      }
    }
    rows.push({ framework: fw.name, series });
  }

  const tableRows = [];
  for (const r of rows) {
    for (const s of r.series) {
      if (s.error) {
        tableRows.push([r.framework, String(s.routeCount), "ERR", "—"]);
      } else {
        tableRows.push([
          r.framework,
          String(s.routeCount),
          fmt(s.reqPerSec.median),
          s.p99.toFixed(2),
        ]);
      }
    }
  }
  console.log("\n" + summary({
    head: ["Framework", "routes", "req/s (median)", "p99 (ms)"],
    rows: tableRows,
    highlight: (row) => row[0].includes("daloy"),
  }) + "\n");

  writeFileSync(
    resultsPath("results.route-scale.json"),
    JSON.stringify({
      ranAt: new Date().toISOString(),
      machine: machineInfo(),
      config: { duration: DURATION, warmup: WARMUP, iterations: ITERATIONS, connections: CONNECTIONS, routeCounts: ROUTE_COUNTS },
      rows,
    }, null, 2),
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
