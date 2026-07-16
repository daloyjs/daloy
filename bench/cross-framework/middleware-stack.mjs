#!/usr/bin/env node
// Middleware-stack benchmark: same three scenarios as run.mjs but with a
// realistic production middleware stack enabled (CORS + secure headers +
// request-id + rate-limit + JWT verify).
//
// Why: bare-router numbers are a vibe. Real apps add several layers between
// the socket and the handler. This script measures the cost with those
// layers ON — the configuration most users actually ship.
//
// Usage:
//   node middleware-stack.mjs
//   node middleware-stack.mjs --only=daloy

import { writeFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import autocannon from "autocannon";
import {
  resultsPath, orderTargets, machineInfo, parseArgs,
  startServer, killServer, waitForHealthy, stats, fmt, parityTiers, warnBenchEnvironment,
} from "./lib/common.mjs";
import { c, section, summary, fail, metric, metricsLine, sym, renderTiers } from "./lib/format.mjs";

const FRAMEWORKS = [
  { name: "daloy",    file: "servers/secured/daloy.ts" },
  { name: "hono",     file: "servers/secured/hono.ts" },
  { name: "fastify",  file: "servers/secured/fastify.ts" },
  { name: "express",  file: "servers/secured/express.ts" },
  { name: "koa",      file: "servers/secured/koa.ts" },
  { name: "nest",     file: "servers/secured/nest.ts" },
  { name: "elysia",   file: "servers/secured/elysia.ts" },
  { name: "feathers", file: "servers/secured/feathers.ts" },
];

const args = parseArgs(process.argv);
const ONLY = args.only ? new Set(args.only.split(",")) : null;
const DURATION = Number(process.env.DURATION ?? 10);
const WARMUP = Number(process.env.WARMUP ?? 15);
const ITERATIONS = Number(process.env.ITERATIONS ?? 5);
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 100);
const PORT = 3590;

// Mint a real HS256 token signed with the same key the server uses.
// Server key is the UTF-8 encoding of "bench-secret-key-do-not-use-in-prod".
function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function mintToken() {
  const key = Buffer.from("bench-secret-key-do-not-use-in-prod", "utf8");
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ sub: "bench", iat: now, exp: now + 3600 }));
  const sig = b64url(createHmac("sha256", key).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}
const AUTH = `Bearer ${mintToken()}`;

const SCENARIOS = [
  { id: "static",  title: "GET /static",    method: "GET",  path: "/static" },
  { id: "dynamic", title: "GET /users/:id", method: "GET",  path: "/users/42" },
  { id: "echo",    title: "POST /echo",     method: "POST", path: "/echo",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "alice" }) },
];

function runAutocannon(sc, duration) {
  return new Promise((resolve, reject) => {
    const instance = autocannon({
      url: `http://127.0.0.1:${PORT}${sc.path}`,
      method: sc.method,
      headers: { ...(sc.headers ?? {}), authorization: AUTH },
      body: sc.body,
      connections: CONNECTIONS,
      pipelining: 1,
      duration,
    }, (err, result) => err ? reject(err) : resolve(result));
    autocannon.track(instance, { renderProgressBar: false, renderResultsTable: false, renderLatencyTable: false });
  });
}

async function benchOne(fw) {
  console.error(section(fw.name, "secured stack"));
  const child = await startServer(fw.file, { port: PORT });
  await waitForHealthy(PORT, "/static", { headers: { authorization: AUTH } });
  try {
    const out = {};
    for (const sc of SCENARIOS) {
      await runAutocannon(sc, WARMUP);
      const samples = [];
      for (let i = 0; i < ITERATIONS; i++) {
        const r = await runAutocannon(sc, DURATION);
        samples.push({
          reqPerSec: r.requests.average,
          p50: r.latency.p50,
          p99: r.latency.p99,
          p999: r.latency.p99_9 ?? r.latency.p99,
          non2xx: r.non2xx ?? 0,
        });
      }
      const rps = stats(samples.map((s) => s.reqPerSec));
      // Median, not mean — averaging noisy tail percentiles lets one bad
      // iteration drag the headline number (see run.mjs summarize()).
      const medianOf = (k) => stats(samples.map((s) => s[k])).median;
      out[sc.id] = {
        reqPerSec: rps,
        latency: { p50: medianOf("p50"), p99: medianOf("p99"), p999: medianOf("p999") },
        non2xx: samples.reduce((a, s) => a + s.non2xx, 0),
        samples,
      };
      console.error(metricsLine(sc.title, [
        c.green(c.bold(fmt(rps.median))) + c.dim(" req/s"),
        metric("p50", out[sc.id].latency.p50.toFixed(2), { unit: "ms" }),
        metric("p99", out[sc.id].latency.p99.toFixed(2), { unit: "ms" }),
        out[sc.id].non2xx ? c.red(`${sym.warn} ${out[sc.id].non2xx} non-2xx`) : "",
      ].filter(Boolean), { labelWidth: 16 }));
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

  const ok = rows.filter((r) => r.results);
  // Parity tiers first — the primary output; the ranked table is detail.
  const tierBlocks = SCENARIOS.map((sc) => renderTiers(
    parityTiers(ok.map((r) => {
      const rps = r.results[sc.id].reqPerSec;
      return { name: r.framework, value: rps.median, mean: rps.mean, ci95: rps.ci95 };
    })),
    { title: `${sc.title}, secured stack (req/s)`, fmtValue: fmt, highlight: (name) => name.includes("daloy") },
  ));
  console.log("\n" + tierBlocks.join("\n\n") + "\n");

  const cell = (rps) => rps.ci95 != null ? `${fmt(rps.median)} ±${fmt(rps.ci95)}` : fmt(rps.median);
  const tableRows = [];
  for (const r of ok) {
    tableRows.push([
      r.framework,
      cell(r.results.static.reqPerSec),
      cell(r.results.dynamic.reqPerSec),
      cell(r.results.echo.reqPerSec),
      r.results.static.latency.p99.toFixed(2),
    ]);
  }
  console.log(summary({
    head: ["Framework", "GET /static (req/s ±95% CI)", "GET /users/:id (req/s ±95% CI)", "POST /echo (req/s ±95% CI)", "p99 /static (ms)"],
    rows: tableRows,
    highlight: (row) => row[0].includes("daloy"),
  }) + "\n");

  writeFileSync(
    resultsPath("results.middleware-stack.json"),
    JSON.stringify({
      ranAt: new Date().toISOString(),
      machine: machineInfo(),
      config: { duration: DURATION, warmup: WARMUP, iterations: ITERATIONS, connections: CONNECTIONS },
      rows,
    }, null, 2),
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
