#!/usr/bin/env node
// Smoke test for every bench script: runs each one with minimum duration /
// iteration settings so the harness wiring is exercised end-to-end without
// burning the wall-clock cost of a real bench run.
//
// Exit code is non-zero if any script fails. Suitable for CI.
//
// Usage:
//   node smoke.mjs
//   node smoke.mjs --only=daloy

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { c, banner, ok, fail, sym } from "./lib/format.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ONLY = process.argv.includes("--only=daloy") ? "--only=daloy" : null;

// Smoke runs exercise the real scripts end-to-end, and the real scripts
// write results.*.json. Redirect those writes to a throwaway directory so a
// smoke run can never overwrite the results of a real benchmark session.
const SMOKE_RESULTS_DIR = mkdtempSync(path.join(os.tmpdir(), "daloy-bench-smoke-"));

// Minimal env: short warmup, single iteration, 2-3s duration.
const SMOKE_ENV = {
  ...process.env,
  WARMUP: "2",
  ITERATIONS: "1",
  DURATION: "2",
  CONNECTIONS: "10",
  BENCH_RESULTS_DIR: SMOKE_RESULTS_DIR,
};

// (script, extraArgs)
const SCRIPTS = [
  ["run.mjs", []],
  ["cold-start.mjs", ["--iterations=2"]],
  ["install-size.mjs", []],
  ["bundle-size.mjs", []],
  ["body-size-sweep.mjs", []],
  // memory-load.mjs honours --duration directly (not env).
  ["memory-load.mjs", ["--duration=4"]],
  // route-scale.mjs sweeps multiple route counts; cap to 10 for smoke.
  ["route-scale.mjs", ["--routes=10"]],
  ["error-path.mjs", []],
  ["streaming.mjs", []],
  ["middleware-stack.mjs", []],
];

function runOne(file, extraArgs) {
  return new Promise((resolve) => {
    const args = [file, ...extraArgs];
    if (ONLY) args.push(ONLY);
    const t0 = Date.now();
    const child = spawn(process.execPath, args, {
      cwd: __dirname,
      env: SMOKE_ENV,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.stdout.on("data", () => { /* swallow */ });
    child.once("exit", (code) => {
      resolve({ file, code, ms: Date.now() - t0, stderr });
    });
  });
}

async function main() {
  process.stderr.write(banner("Bench smoke test", "runs every script with minimal settings") + "\n\n");
  const results = [];
  for (const [file, extraArgs] of SCRIPTS) {
    process.stderr.write(`${c.gray(sym.bullet)} ${c.white(file.padEnd(22))} ${c.dim("…")} `);
    const r = await runOne(file, extraArgs);
    results.push(r);
    const status = r.code === 0 ? c.green("OK") : c.red("FAIL");
    process.stderr.write(`${status}  ${c.dim(`(${(r.ms / 1000).toFixed(1)}s)`)}\n`);
    if (r.code !== 0) {
      process.stderr.write(c.red(r.stderr.split("\n").slice(-20).map((l) => `    ${l}`).join("\n")) + "\n");
    }
  }
  const failed = results.filter((r) => r.code !== 0);
  if (failed.length > 0) {
    // Keep the smoke output around for debugging a failed run.
    process.stderr.write("\n" + fail(`${failed.length}/${results.length} smoke runs FAILED.`) + "\n");
    process.stderr.write(c.dim(`Smoke results kept at ${SMOKE_RESULTS_DIR}\n`));
    process.exit(1);
  }
  rmSync(SMOKE_RESULTS_DIR, { recursive: true, force: true });
  process.stderr.write("\n" + ok(`All ${results.length} bench scripts smoked OK.`) + "\n");
}

main().catch((err) => { console.error(err); process.exit(1); });
