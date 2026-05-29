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
import path from "node:path";
import autocannon from "autocannon";
import {
  __dirname, machineInfo, parseArgs,
  startServer, killServer, waitForHealthy, stats, fmt, warnBenchEnvironment,
} from "./lib/common.mjs";

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
const ITERATIONS = Number(process.env.ITERATIONS ?? 3);
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
  console.error(`\n=== ${fw.name} (secured stack) ===`);
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
      const mean = (k) => samples.reduce((a, s) => a + s[k], 0) / samples.length;
      out[sc.id] = {
        reqPerSec: rps,
        latency: { p50: mean("p50"), p99: mean("p99"), p999: mean("p999") },
        non2xx: samples.reduce((a, s) => a + s.non2xx, 0),
        samples,
      };
      console.error(
        `  ${sc.title.padEnd(18)} ${fmt(rps.median).padStart(8)} req/s  ` +
        `p50 ${out[sc.id].latency.p50.toFixed(2)}ms  ` +
        `p99 ${out[sc.id].latency.p99.toFixed(2)}ms` +
        (out[sc.id].non2xx ? `  ⚠ ${out[sc.id].non2xx} non-2xx` : ""),
      );
    }
    return out;
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
      const results = await benchOne(fw);
      rows.push({ framework: fw.name, results });
    } catch (err) {
      console.error(`  ✗ ${fw.name} failed: ${err.message}`);
      rows.push({ framework: fw.name, error: err.message });
    }
  }

  const lines = [
    "| Framework  | GET /static (req/s) | GET /users/:id (req/s) | POST /echo (req/s) | p99 /static (ms) |",
    "| ---------- | ------------------: | ---------------------: | -----------------: | ---------------: |",
  ];
  for (const r of rows) {
    if (!r.results) continue;
    lines.push(
      `| ${r.framework.padEnd(10)} `
      + `| ${fmt(r.results.static.reqPerSec.median).padStart(19)} `
      + `| ${fmt(r.results.dynamic.reqPerSec.median).padStart(22)} `
      + `| ${fmt(r.results.echo.reqPerSec.median).padStart(18)} `
      + `| ${r.results.static.latency.p99.toFixed(2).padStart(16)} |`,
    );
  }
  console.log("\n" + lines.join("\n") + "\n");

  writeFileSync(
    path.join(__dirname, "results.middleware-stack.json"),
    JSON.stringify({
      ranAt: new Date().toISOString(),
      machine: machineInfo(),
      config: { duration: DURATION, warmup: WARMUP, iterations: ITERATIONS, connections: CONNECTIONS },
      rows,
    }, null, 2),
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
