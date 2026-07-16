#!/usr/bin/env node
// Production access-log benchmark: same three scenarios as run.mjs, with one
// structured Pino access log emitted per completed response.
//
// Logs go to /dev/null by default so the measured cost is framework hook +
// structured log serialization/write overhead, not terminal rendering or a log
// collector's backpressure. Override with LOG_DEST=/path/to/file.
//
// Usage:
//   node logging.mjs
//   node logging.mjs --only=daloy,hono
//   LOG_DEST=./access.log node logging.mjs --only=fastify

import { writeFileSync } from "node:fs";
import autocannon from "autocannon";
import {
  resultsPath,
  orderTargets,
  machineInfo,
  parseArgs,
  startServer,
  killServer,
  waitForHealthy,
  httpRequest,
  stats,
  fmt,
  warnBenchEnvironment,
} from "./lib/common.mjs";
import { c, section, summary, fail, info, metric, metricsLine, sym } from "./lib/format.mjs";

const FRAMEWORKS = [
  { name: "daloy", file: "servers/logging/daloy.ts" },
  { name: "daloy-nozod", file: "servers/logging/daloy-nozod.ts" },
  { name: "hono", file: "servers/logging/hono.ts" },
  { name: "hono-validated", file: "servers/logging/hono-validated.ts" },
  { name: "fastify", file: "servers/logging/fastify.ts" },
  { name: "express", file: "servers/logging/express.ts" },
  { name: "koa", file: "servers/logging/koa.ts" },
  { name: "nest", file: "servers/logging/nest.ts" },
  { name: "elysia", file: "servers/logging/elysia.ts" },
  { name: "feathers", file: "servers/logging/feathers.ts" },
];

const args = parseArgs(process.argv);
const ONLY = args.only ? new Set(args.only.split(",")) : null;
const DURATION = Number(process.env.DURATION ?? 10);
const WARMUP = Number(process.env.WARMUP ?? 15);
const ITERATIONS = Number(process.env.ITERATIONS ?? 5);
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 100);
const PORT = 3595;
const DEFAULT_LOG_DEST = process.platform === "win32" ? "NUL" : "/dev/null";
const LOG_DEST = process.env.LOG_DEST ?? DEFAULT_LOG_DEST;

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

function runAutocannon(scenario, duration) {
  return new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url: `http://127.0.0.1:${PORT}${scenario.path}`,
        method: scenario.method,
        headers: scenario.headers,
        body: scenario.body,
        connections: CONNECTIONS,
        pipelining: 1,
        duration,
      },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    autocannon.track(instance, {
      renderProgressBar: false,
      renderResultsTable: false,
      renderLatencyTable: false,
    });
  });
}

async function preflight(scenario) {
  const r = await httpRequest(`http://127.0.0.1:${PORT}${scenario.path}`, {
    method: scenario.method,
    headers: scenario.headers,
    body: scenario.body,
  });
  if (r.status !== 200) {
    throw new Error(`preflight ${scenario.id}: status ${r.status} (expected 200)`);
  }
  let ok = false;
  try {
    ok = scenario.expect(r.body);
  } catch {
    /* ok stays false */
  }
  if (!ok) {
    throw new Error(`preflight ${scenario.id}: body did not match. Got: ${r.body.slice(0, 200)}`);
  }
}

function summarize(samples) {
  const rps = stats(samples.map((s) => s.reqPerSec));
  const mean = (k) => samples.reduce((a, s) => a + s[k], 0) / samples.length;
  return {
    reqPerSec: rps,
    logLinesPerSec: rps,
    latency: {
      p50: mean("p50"),
      p99: mean("p99"),
      p999: mean("p999"),
    },
    errors: {
      non2xx: samples.reduce((a, s) => a + s.non2xx, 0),
      errors: samples.reduce((a, s) => a + s.errors, 0),
      timeouts: samples.reduce((a, s) => a + s.timeouts, 0),
      resets: samples.reduce((a, s) => a + s.resets, 0),
    },
    samples,
  };
}

async function benchOne(fw) {
  console.error(section(fw.name, "access logs"));
  const child = await startServer(fw.file, { port: PORT, extraEnv: { LOG_DEST } });
  await waitForHealthy(PORT);
  try {
    for (const scenario of SCENARIOS) await preflight(scenario);

    const results = {};
    for (const scenario of SCENARIOS) {
      await runAutocannon(scenario, WARMUP);
      if (global.gc) global.gc();

      const samples = [];
      for (let i = 0; i < ITERATIONS; i++) {
        const r = await runAutocannon(scenario, DURATION);
        samples.push({
          reqPerSec: r.requests.average,
          p50: r.latency.p50,
          p99: r.latency.p99,
          p999: r.latency.p99_9 ?? r.latency.p99,
          non2xx: r.non2xx ?? 0,
          errors: r.errors ?? 0,
          timeouts: r.timeouts ?? 0,
          resets: r.resets ?? 0,
        });
        if (global.gc) global.gc();
      }

      const summary = summarize(samples);
      results[scenario.id] = summary;
      const totalErr = summary.errors.non2xx + summary.errors.errors + summary.errors.timeouts;
      const errBadge =
        totalErr > 0
          ? c.red(`${sym.warn} non2xx=${summary.errors.non2xx} err=${summary.errors.errors} to=${summary.errors.timeouts}`)
          : "";
      console.error(metricsLine(scenario.title, [
        c.green(c.bold(fmt(summary.reqPerSec.median))) + c.dim(" req/s"),
        metric("p50", summary.latency.p50.toFixed(2), { unit: "ms" }),
        metric("p99", summary.latency.p99.toFixed(2), { unit: "ms" }),
        metric("p99.9", summary.latency.p999.toFixed(2), { unit: "ms" }),
        errBadge,
      ].filter(Boolean), { labelWidth: 16 }));
    }
    return results;
  } finally {
    await killServer(child);
  }
}

function renderSummary(rows) {
  const tableRows = [];
  for (const row of rows) {
    if (!row.results) continue;
    tableRows.push([
      row.framework,
      fmt(row.results.static.reqPerSec.median),
      fmt(row.results.dynamic.reqPerSec.median),
      fmt(row.results.echo.reqPerSec.median),
      row.results.static.latency.p99.toFixed(2),
    ]);
  }
  return summary({
    head: [
      "Framework", "GET /static logged req/s", "GET /users/:id logged req/s",
      "POST /echo logged req/s", "p99 /static (ms)",
    ],
    rows: tableRows,
    highlight: (row) => row[0].includes("daloy"),
  });
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

  const ok = rows.filter((r) => r.results);
  console.log("\n" + renderSummary(ok) + "\n");

  writeFileSync(
    resultsPath("results.logging.json"),
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        machine: machineInfo(),
        config: {
          duration: DURATION,
          warmup: WARMUP,
          iterations: ITERATIONS,
          connections: CONNECTIONS,
          logDest: LOG_DEST,
        },
        rows,
      },
      null,
      2
    )
  );
  console.error(info(`Wrote ${c.bold("results.logging.json")} ${c.dim(`(${ok.length}/${rows.length} frameworks OK)`)}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
