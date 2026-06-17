#!/usr/bin/env node
// Cross-framework HTTP benchmark runner.
//
// What this measures (per scenario per framework):
//   - throughput (req/s): mean, median, stddev, min, max across iterations
//   - latency (ms): p50, p75, p90, p99, p99.9 averaged across iterations
//   - error rate: non-2xx, socket errors, timeouts, resets
//
// Methodology hardening vs. the prior runner:
//   - longer warmup (default 15s) so V8 has tiered up before measurement
//   - correctness preflight: every endpoint must return the expected body
//     before benchmarking starts. Mismatches abort that framework.
//   - optional connection-count sweep: --sweep=connections runs every scenario
//     at {10, 100, 500, 1000} connections so you can see saturation curves.
//   - optional pipelining sweep: --sweep=pipelining runs at {1, 4, 10}.
//   - per-iteration samples kept; results.json carries the full histogram.
//   - machine info captured (CPU model, core count, RAM, Node version).
//
// Usage:
//   node run.mjs
//   node run.mjs --only=daloy
//   node run.mjs --sweep=connections
//   node run.mjs --sweep=pipelining
//   DURATION=20 WARMUP=30 ITERATIONS=5 node run.mjs

import { writeFileSync } from "node:fs";
import path from "node:path";
import autocannon from "autocannon";
import {
  __dirname, machineInfo, parseArgs,
  startServer, killServer,
  waitForHealthy, httpRequest,
  stats, fmt, warnBenchEnvironment,
} from "./lib/common.mjs";
import {
  c, section, summary, fail, info, metric, metricsLine, sym, banner,
} from "./lib/format.mjs";

const FRAMEWORKS = [
  { name: "daloy",      file: "servers/throughput/daloy.ts" },
  { name: "daloy-bare", file: "servers/throughput/daloy-bare.ts" },
  { name: "daloy-shed", file: "servers/throughput/daloy-shed.ts" },
  { name: "hono",       file: "servers/throughput/hono.ts" },
  // { name: "fastify",  file: "servers/throughput/fastify.ts" },
  // { name: "express",  file: "servers/throughput/express.ts" },
  // { name: "koa",      file: "servers/throughput/koa.ts" },
  // { name: "nest",     file: "servers/throughput/nest.ts" },
  // { name: "elysia",   file: "servers/throughput/elysia.ts" },
  // { name: "feathers", file: "servers/throughput/feathers.ts" },
];

const args = parseArgs(process.argv);
const ONLY = args.only ? new Set(args.only.split(",")) : null;
const DURATION = Number(process.env.DURATION ?? 10);
const WARMUP_SECONDS = Number(process.env.WARMUP ?? 15);
const ITERATIONS = Number(process.env.ITERATIONS ?? 3);
const PORT = 3456;

const SWEEP = args.sweep ?? null;
const CONNECTION_POINTS = SWEEP === "connections" ? [10, 100, 500, 1000] : [Number(process.env.CONNECTIONS ?? 100)];
const PIPELINING_POINTS = SWEEP === "pipelining" ? [1, 4, 10] : [Number(process.env.PIPELINING ?? 1)];

const SCENARIOS = [
  {
    id: "static",
    title: "GET /static",
    method: "GET",
    path: "/static",
    expect: (body) => JSON.parse(body).ok === true,
  },
  {
    id: "dynamic",
    title: "GET /users/:id",
    method: "GET",
    path: "/users/42",
    expect: (body) => JSON.parse(body).id === "42",
  },
  {
    id: "echo",
    title: "POST /echo",
    method: "POST",
    path: "/echo",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "alice" }),
    expect: (body) => JSON.parse(body).name === "alice",
  },
];

function runAutocannon(scenario, { duration, connections, pipelining }) {
  return new Promise((resolve, reject) => {
    const instance = autocannon({
      url: `http://127.0.0.1:${PORT}${scenario.path}`,
      method: scenario.method,
      headers: scenario.headers,
      body: scenario.body,
      connections,
      pipelining,
      duration,
    }, (err, result) => err ? reject(err) : resolve(result));
    autocannon.track(instance, { renderProgressBar: false, renderResultsTable: false, renderLatencyTable: false });
  });
}

async function preflight(scenario) {
  const url = `http://127.0.0.1:${PORT}${scenario.path}`;
  const r = await httpRequest(url, {
    method: scenario.method,
    headers: scenario.headers,
    body: scenario.body,
  });
  if (r.status !== 200) {
    throw new Error(`preflight ${scenario.id}: status ${r.status} (expected 200)`);
  }
  let ok = false;
  try { ok = scenario.expect(r.body); } catch { /* ok stays false */ }
  if (!ok) {
    throw new Error(`preflight ${scenario.id}: body did not match. Got: ${r.body.slice(0, 200)}`);
  }
}

function summarize(samples) {
  const rps = stats(samples.map((s) => s.reqPerSec));
  const meanOf = (k) => samples.reduce((a, s) => a + s[k], 0) / samples.length;
  return {
    reqPerSec: rps,
    latency: {
      p50:  meanOf("p50"),
      p75:  meanOf("p75"),
      p90:  meanOf("p90"),
      p99:  meanOf("p99"),
      p999: meanOf("p999"),
    },
    errors: {
      non2xx:   samples.reduce((a, s) => a + s.non2xx, 0),
      errors:   samples.reduce((a, s) => a + s.errors, 0),
      timeouts: samples.reduce((a, s) => a + s.timeouts, 0),
      resets:   samples.reduce((a, s) => a + s.resets, 0),
    },
    samples,
  };
}

async function benchOne(fw) {
  console.error(section(fw.name));
  const child = await startServer(fw.file, { port: PORT });
  await waitForHealthy(PORT);
  try {
    for (const sc of SCENARIOS) await preflight(sc);

    const results = {};
    for (const connections of CONNECTION_POINTS) {
      for (const pipelining of PIPELINING_POINTS) {
        const pointKey = `c${connections}_p${pipelining}`;
        results[pointKey] = {};
        for (const sc of SCENARIOS) {
          await runAutocannon(sc, { duration: WARMUP_SECONDS, connections, pipelining });
          if (global.gc) global.gc();

          const samples = [];
          for (let i = 0; i < ITERATIONS; i++) {
            const r = await runAutocannon(sc, { duration: DURATION, connections, pipelining });
            samples.push({
              reqPerSec: r.requests.average,
              p50:  r.latency.p50,
              p75:  r.latency.p75,
              p90:  r.latency.p90,
              p99:  r.latency.p99,
              p999: r.latency.p99_9 ?? r.latency.p99,
              non2xx:   r.non2xx ?? 0,
              errors:   r.errors ?? 0,
              timeouts: r.timeouts ?? 0,
              resets:   r.resets ?? 0,
            });
            if (global.gc) global.gc();
          }
          const summary = summarize(samples);
          results[pointKey][sc.id] = summary;
          const totalErr = summary.errors.non2xx + summary.errors.errors + summary.errors.timeouts;
          const errBadge = totalErr > 0
            ? c.red(`${sym.warn} non2xx=${summary.errors.non2xx} err=${summary.errors.errors} to=${summary.errors.timeouts}`)
            : "";
          const label = (CONNECTION_POINTS.length > 1 || PIPELINING_POINTS.length > 1)
            ? `${sc.title} ${c.dim(`[c=${connections} p=${pipelining}]`)}` : sc.title;
          console.error(metricsLine(label, [
            c.green(c.bold(fmt(summary.reqPerSec.median))) + c.dim(" req/s") + c.dim(` ±${fmt(summary.reqPerSec.stddev)}`),
            metric("p50", summary.latency.p50.toFixed(2), { unit: "ms" }),
            metric("p99", summary.latency.p99.toFixed(2), { unit: "ms" }),
            metric("p99.9", summary.latency.p999.toFixed(2), { unit: "ms" }),
            errBadge,
          ].filter(Boolean), { labelWidth: 28 }));
        }
      }
    }
    return results;
  } finally {
    await killServer(child);
  }
}

function renderSummary(rows) {
  const pointKey = `c${CONNECTION_POINTS[0]}_p${PIPELINING_POINTS[0]}`;
  const head = [
    "Framework", "GET /static (req/s)", "GET /users/:id (req/s)",
    "POST /echo (req/s)", "p50 (ms)", "p99 (ms)", "p99.9 (ms)",
  ];
  const tableRows = [];
  for (const r of rows) {
    const p = r.results?.[pointKey];
    if (!p) continue;
    tableRows.push([
      r.framework,
      fmt(p.static.reqPerSec.median),
      fmt(p.dynamic.reqPerSec.median),
      fmt(p.echo.reqPerSec.median),
      p.static.latency.p50.toFixed(2),
      p.static.latency.p99.toFixed(2),
      p.static.latency.p999.toFixed(2),
    ]);
  }
  return summary({
    head,
    rows: tableRows,
    highlight: (row) => row[0].includes("daloy"),
  });
}

async function main() {
  warnBenchEnvironment({ maxConnections: Math.max(...CONNECTION_POINTS) });
  const targets = FRAMEWORKS.filter((f) => !ONLY || ONLY.has(f.name));
  console.error(banner(
    "Cross-framework HTTP benchmark",
    `${targets.length} framework(s) · ${SCENARIOS.length} scenarios · ` +
    `${WARMUP_SECONDS}s warmup · ${ITERATIONS}×${DURATION}s · ` +
    `c=${CONNECTION_POINTS.join(",")} p=${PIPELINING_POINTS.join(",")}`,
  ));
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

  const ok = rows.filter((r) => r.results);
  console.log("\n" + renderSummary(ok) + "\n");
  console.log(
    c.dim(
      "Note: orange-to-apple. daloy validates request + response against Zod\n" +
      "schemas on every route; the others validate little to nothing. See\n" +
      "README.md \u2192 \"Honest caveats\" and the *-nozod / *-validated variants.\n",
    ),
  );

  writeFileSync(
    path.join(__dirname, "results.json"),
    JSON.stringify({
      ranAt: new Date().toISOString(),
      machine: machineInfo(),
      config: {
        duration: DURATION,
        warmup: WARMUP_SECONDS,
        iterations: ITERATIONS,
        connectionPoints: CONNECTION_POINTS,
        pipeliningPoints: PIPELINING_POINTS,
        sweep: SWEEP,
      },
      rows,
    }, null, 2),
  );
  console.error(info(`Wrote ${c.bold("results.json")} ${c.dim(`(${ok.length}/${rows.length} frameworks OK)`)}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
