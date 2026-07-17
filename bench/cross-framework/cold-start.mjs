#!/usr/bin/env node
// Cold-start benchmark: wall-clock from process spawn() to first 200 OK.
// Repeats N times and reports min / median / mean / max / ±95% CI.
//
// By default each server is precompiled to plain JS (esbuild, local imports
// bundled, npm packages external) and spawned with bare `node` — the number
// a deployed, compiled app actually pays. Compile time is NOT counted; it
// happens once, before the measurement loop. Pass --mode=tsx to instead
// measure the dev-workflow path (spawn via the tsx loader, transpile on
// boot), which is what this script measured before the compiled mode
// existed. The two modes are not comparable; results record which one ran.
//
// Usage:
//   node cold-start.mjs
//   node cold-start.mjs --only=daloy --iterations=10
//   node cold-start.mjs --mode=tsx
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import {
  resultsPath,
  orderTargets,
  ROOT,
  machineInfo,
  parseArgs,
  stats,
  fmt,
  httpRequest,
  compileServer,
  parityTiers,
} from "./lib/common.mjs";
import { c, section, summary, fail, info, metricsLine, renderTiers } from "./lib/format.mjs";

const FRAMEWORKS = [
  { name: "daloy", file: "servers/throughput/daloy.ts" },
  { name: "daloy-nozod", file: "servers/throughput/daloy-nozod.ts" },
  { name: "hono", file: "servers/throughput/hono.ts" },
  { name: "fastify", file: "servers/throughput/fastify.ts" },
  { name: "express", file: "servers/throughput/express.ts" },
  { name: "koa", file: "servers/throughput/koa.ts" },
  { name: "nest", file: "servers/throughput/nest.ts" },
  { name: "elysia", file: "servers/throughput/elysia.ts" },
  { name: "feathers", file: "servers/throughput/feathers.ts" },
];

const args = parseArgs(process.argv);
const ONLY = args.only ? new Set(args.only.split(",")) : null;
const ITERATIONS = Number(args.iterations ?? 10);
const MODE = args.mode ?? "compiled"; // "compiled" (deploy path) | "tsx" (dev path)
if (MODE !== "compiled" && MODE !== "tsx") {
  console.error(fail(`Unknown --mode=${MODE}; expected "compiled" or "tsx".`));
  process.exit(1);
}
const PORT_BASE = 3500;

async function measureColdStart(entry, port) {
  const t0 = process.hrtime.bigint();
  const nodeArgs =
    MODE === "compiled"
      ? ["--no-warnings", entry]
      : ["--no-warnings", "--import", "tsx", path.join(ROOT, entry)];
  const child = spawn(process.execPath, nodeArgs, {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), NODE_ENV: "production" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderrBuf = "";
  child.stderr.on("data", (b) => {
    if (stderrBuf.length < 16 * 1024) stderrBuf += b.toString();
  });

  let firstResponseAt;
  try {
    // Poll aggressively for the first successful response. Bail out early if
    // the server crashed on boot — no point polling a dead process for 30s.
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && child.exitCode == null && child.signalCode == null) {
      try {
        const r = await httpRequest(`http://127.0.0.1:${port}/static`, { timeoutMs: 250 });
        if (r.status === 200) {
          firstResponseAt = process.hrtime.bigint();
          break;
        }
      } catch {
        /* not ready yet */
      }
      // ~5ms granularity is plenty for spawn-to-first-200 timing and avoids
      // hot-spinning the CPU which would skew the measurement.
      await new Promise((r) => setTimeout(r, 5));
    }
    if (!firstResponseAt) {
      const why =
        child.exitCode != null || child.signalCode != null
          ? `server exited (code ${child.exitCode}, signal ${child.signalCode}) before first 200`
          : "server never responded with 200 within 30s";
      throw new Error(`${why}${stderrBuf ? `\nstderr: ${stderrBuf.trim()}` : ""}`);
    }
  } finally {
    // Only await "exit" if the child is still alive: for a child that already
    // exited the event fired long ago and will never fire again — awaiting it
    // would drain the event loop and silently exit the whole bench process.
    if (child.exitCode == null && child.signalCode == null) {
      try {
        child.kill("SIGKILL");
      } catch {}
      await new Promise((r) => child.once("exit", r));
    }
  }
  return Number(firstResponseAt - t0) / 1e6; // ms
}

async function benchOne(fw, port, buildDir) {
  console.error(section(fw.name, MODE === "compiled" ? "compiled JS" : "tsx loader"));
  let entry = fw.file;
  if (MODE === "compiled") {
    const t0 = Date.now();
    entry = await compileServer(fw.file, buildDir);
    console.error("  " + info(c.dim(`compiled in ${Date.now() - t0}ms (not counted)`)));
  }
  const samples = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const ms = await measureColdStart(entry, port);
    samples.push(ms);
    console.error(
      metricsLine(`iter ${i + 1}/${ITERATIONS}`, [c.green(c.bold(ms.toFixed(1))) + c.dim(" ms")], {
        labelWidth: 14,
      })
    );
    await new Promise((r) => setTimeout(r, 250));
  }
  return { samples, stats: stats(samples) };
}

async function main() {
  const targets = orderTargets(
    FRAMEWORKS.filter((f) => !ONLY || ONLY.has(f.name)),
    args.order
  );
  // The compiled entries must live under the bench root: Node resolves their
  // bare imports relative to the importing FILE, so a build dir in the OS
  // tmpdir would never find this folder's node_modules. node_modules/.cache
  // is the conventional (and already-gitignored) place for build output.
  let buildDir = null;
  if (MODE === "compiled") {
    const cacheRoot = path.join(ROOT, "node_modules", ".cache");
    mkdirSync(cacheRoot, { recursive: true });
    buildDir = mkdtempSync(path.join(cacheRoot, "coldstart-"));
  }
  const rows = [];
  let port = PORT_BASE;
  try {
    for (const fw of targets) {
      try {
        const r = await benchOne(fw, port++, buildDir);
        rows.push({ framework: fw.name, ...r });
      } catch (err) {
        console.error("  " + fail(`${fw.name} failed: ${err.message}`));
        rows.push({ framework: fw.name, error: err.message });
      }
    }
  } finally {
    if (buildDir) rmSync(buildDir, { recursive: true, force: true });
  }

  const ok = rows.filter((r) => r.stats);
  const tiers = parityTiers(
    ok.map((r) => ({
      name: r.framework,
      value: r.stats.mean,
      mean: r.stats.mean,
      ci95: r.stats.ci95,
    })),
    { better: "lower" }
  );
  console.log(
    "\n" +
      renderTiers(tiers, {
        title: `cold start, ${MODE} (ms)`,
        better: "lower",
        fmtValue: (v) => v.toFixed(1),
        highlight: (name) => name.includes("daloy"),
      }) +
      "\n"
  );

  const tableRows = [];
  for (const r of ok) {
    tableRows.push([
      r.framework,
      r.stats.min.toFixed(1),
      r.stats.median.toFixed(1),
      r.stats.mean.toFixed(1),
      r.stats.ci95 != null ? r.stats.ci95.toFixed(1) : "—",
      r.stats.stddev.toFixed(1),
      r.stats.max.toFixed(1),
    ]);
  }
  console.log(
    summary({
      head: ["Framework", "min (ms)", "median (ms)", "mean (ms)", "±95% CI", "stddev", "max (ms)"],
      rows: tableRows,
      highlight: (row) => row[0].includes("daloy"),
    }) + "\n"
  );

  writeFileSync(
    resultsPath("results.cold-start.json"),
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        machine: machineInfo(),
        mode: MODE,
        iterations: ITERATIONS,
        rows,
      },
      null,
      2
    )
  );
  console.error(
    info(
      `Wrote ${c.bold("results.cold-start.json")} ${c.dim(`(mode=${MODE}, ${ok.length}/${rows.length} OK)`)}`
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
