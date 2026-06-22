#!/usr/bin/env node
// Memory under load: measure RSS at idle, then while a sustained autocannon
// session hits the server, then after a forced settle window.
//
// Why: pure throughput numbers can mask memory leaks. A framework that grows
// RSS unbounded under load is not "tied" with one whose RSS stays flat.
//
// Usage:
//   node memory-load.mjs
//   node memory-load.mjs --only=daloy --duration=60

import { writeFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import autocannon from "autocannon";
import {
  __dirname, machineInfo, parseArgs,
  startServer, killServer, waitForHealthy, httpRequest, fmt, warnBenchEnvironment,
} from "./lib/common.mjs";
import { c, section, summary, fail, metric, metricsLine } from "./lib/format.mjs";

const FRAMEWORKS = [
  { name: "daloy",          file: "servers/throughput/daloy.ts" },
  { name: "daloy-nozod",    file: "servers/throughput/daloy-nozod.ts" },
  { name: "hono",           file: "servers/throughput/hono.ts" },
  { name: "hono-validated", file: "servers/throughput/hono-validated.ts" },
  { name: "fastify",        file: "servers/throughput/fastify.ts" },
  { name: "express",        file: "servers/throughput/express.ts" },
  { name: "koa",            file: "servers/throughput/koa.ts" },
  { name: "nest",           file: "servers/throughput/nest.ts" },
  { name: "elysia",         file: "servers/throughput/elysia.ts" },
  { name: "feathers",       file: "servers/throughput/feathers.ts" },
];

const args = parseArgs(process.argv);
const ONLY = args.only ? new Set(args.only.split(",")) : null;
const DURATION = Number(args.duration ?? 60);
const CONNECTIONS = Number(args.connections ?? 200);
const SAMPLE_INTERVAL_MS = 1_000;
const PORT = 3540;

function rssOfPid(pid) {
  // Windows: tasklist /FI "PID eq <pid>" /FO CSV /NH
  // POSIX:   ps -o rss= -p <pid>
  return new Promise((resolve) => {
    let cmd, argv;
    if (process.platform === "win32") {
      cmd = "tasklist";
      argv = ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"];
    } else {
      cmd = "ps";
      argv = ["-o", "rss=", "-p", String(pid)];
    }
    const ch = spawn(cmd, argv, { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    ch.stdout.on("data", (b) => { out += b.toString(); });
    ch.once("exit", () => {
      if (process.platform === "win32") {
        // CSV: "name","pid","sessionName","sessionNo","memUsage". The memUsage
        // cell itself can contain a locale thousands separator (e.g. "1,234 K"
        // on en-US, "1.234 K" on de-DE), so a naive split on "," cuts inside
        // the quoted value and yields ~1/1000 of the real RSS. Parse the
        // quoted fields properly.
        const fields = [];
        const re = /"((?:[^"]|"")*)"/g;
        let m;
        while ((m = re.exec(out)) !== null) fields.push(m[1]);
        const mem = fields[fields.length - 1];
        if (!mem) return resolve(NaN);
        const kib = Number(mem.replace(/[^\d]/g, ""));
        resolve(Number.isFinite(kib) ? kib * 1024 : NaN);
      } else {
        const kib = Number(out.trim());
        resolve(Number.isFinite(kib) ? kib * 1024 : NaN);
      }
    });
  });
}

async function sampleSeries(pid, durationMs) {
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < durationMs) {
    const rss = await rssOfPid(pid);
    samples.push({ t: Date.now() - t0, rss });
    await wait(SAMPLE_INTERVAL_MS);
  }
  return samples;
}

const ECHO_BODY = JSON.stringify({ name: "alice" });

function startLoad() {
  const instance = autocannon({
    url: `http://127.0.0.1:${PORT}/echo`,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: ECHO_BODY,
    connections: CONNECTIONS,
    duration: DURATION + 5, // a touch longer than our sampling window
  }, () => { /* swallow */ });
  autocannon.track(instance, { renderProgressBar: false, renderResultsTable: false, renderLatencyTable: false });
  return instance;
}

// Correctness preflight for the /echo path the load driver hammers. autocannon
// swallows all responses, so without this a server that 500s on every request
// (e.g. a schema-less route that reads an unparsed body) would be measured on
// an all-error path and reported as a valid memory number. Abort instead.
async function preflightEcho() {
  const r = await httpRequest(`http://127.0.0.1:${PORT}/echo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: ECHO_BODY,
  });
  if (r.status !== 200) {
    throw new Error(`preflight POST /echo: status ${r.status} (expected 200). Body: ${r.body.slice(0, 200)}`);
  }
  let ok = false;
  try { ok = JSON.parse(r.body).name === "alice"; } catch { /* ok stays false */ }
  if (!ok) {
    throw new Error(`preflight POST /echo: body did not echo {"name":"alice"}. Got: ${r.body.slice(0, 200)}`);
  }
}

async function benchOne(fw) {
  console.error(section(fw.name));
  const child = await startServer(fw.file, { port: PORT });
  await waitForHealthy(PORT);
  try {
    // 0) Correctness preflight — the load driver POSTs to /echo and swallows
    // every response, so verify the endpoint actually works before measuring.
    await preflightEcho();

    // 1) Idle baseline.
    await wait(2_000);
    const idleSamples = await sampleSeries(child.pid, 5_000);
    const idleRss = idleSamples.reduce((a, s) => a + s.rss, 0) / idleSamples.length;

    // 2) Under load.
    const load = startLoad();
    const loadSamples = await sampleSeries(child.pid, DURATION * 1_000);
    try { load.stop(); } catch {}

    // 3) Settle.
    await wait(5_000);
    const settleSamples = await sampleSeries(child.pid, 5_000);
    const settleRss = settleSamples.reduce((a, s) => a + s.rss, 0) / settleSamples.length;
    const peakRss = Math.max(...loadSamples.map((s) => s.rss));
    const loadAvgRss = loadSamples.reduce((a, s) => a + s.rss, 0) / loadSamples.length;
    const growth = settleRss - idleRss;

    const MiB = (b) => (b / 1024 / 1024).toFixed(1);
    console.error(metricsLine("RSS", [
      metric("idle", MiB(idleRss), { unit: " MiB" }),
      metric("load-avg", MiB(loadAvgRss), { unit: " MiB" }),
      metric("peak", MiB(peakRss), { unit: " MiB", color: c.yellow }),
      metric("settle", MiB(settleRss), { unit: " MiB" }),
      metric("growth", MiB(growth), { unit: " MiB", color: growth > 0 ? c.yellow : c.green }),
    ], { labelWidth: 6 }));

    return { idleRss, loadAvgRss, peakRss, settleRss, growth, idleSamples, loadSamples, settleSamples };
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
      console.error("  " + fail(`${fw.name} failed: ${err.message}`));
      rows.push({ framework: fw.name, error: err.message });
    }
  }

  const tableRows = [];
  for (const r of rows) {
    if (!r.idleRss) continue;
    const MiB = (b) => (b / 1024 / 1024).toFixed(1);
    tableRows.push([
      r.framework,
      MiB(r.idleRss),
      MiB(r.loadAvgRss),
      MiB(r.peakRss),
      MiB(r.settleRss),
      MiB(r.growth),
    ]);
  }
  console.log("\n" + summary({
    head: ["Framework", "idle (MiB)", "load avg (MiB)", "peak (MiB)", "settle (MiB)", "growth (MiB)"],
    rows: tableRows,
    highlight: (row) => row[0].includes("daloy"),
  }) + "\n");

  writeFileSync(
    path.join(__dirname, "results.memory-load.json"),
    JSON.stringify({
      ranAt: new Date().toISOString(),
      machine: machineInfo(),
      config: { duration: DURATION, connections: CONNECTIONS, sampleIntervalMs: SAMPLE_INTERVAL_MS },
      rows,
    }, null, 2),
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
