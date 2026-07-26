// Per-module import-cost profiler. Run each candidate in its OWN cold node
// process so previous imports don't warm the loader cache. We measure the
// wall-clock cost of importing only that module from a fresh start.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { banner, summary } from "./lib/format.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const TARGETS = [
  "@daloyjs/core",
  "@daloyjs/core/node",
  "zod",
  "@daloyjs/core/openapi",
  "@daloyjs/core/docs",
];

// Modules imported (transitively) by src/app.ts that we suspect are heavy.
const INTERNAL = [
  "../../dist/router.js",
  "../../dist/openapi.js",
  "../../dist/docs.js",
  "../../dist/security.js",
  "../../dist/middleware.js",
  "../../dist/security-schemes.js",
  "../../dist/compression.js",
  "../../dist/etag.js",
  "../../dist/load-shedding.js",
  "../../dist/schema.js",
  "../../dist/errors.js",
  "../../dist/logger.js",
  "../../dist/conn-info.js",
  "../../dist/subdomains.js",
  "../../dist/jwk.js",
  "../../dist/jwt.js",
  "../../dist/multipart.js",
  "../../dist/websocket.js",
  "../../dist/streaming.js",
];

async function timeImport(spec) {
  const code = `const t0=process.hrtime.bigint();await import(${JSON.stringify(spec)});const t1=process.hrtime.bigint();process.stdout.write(String(Number(t1-t0)/1e6));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (r.status !== 0) return { spec, error: r.stderr.trim().split("\n").pop() };
  return { spec, ms: Number(r.stdout) };
}

const ITER = 5;
async function median(spec) {
  const samples = [];
  for (let i = 0; i < ITER; i++) {
    const r = await timeImport(spec);
    if (r.error) return r;
    samples.push(r.ms);
  }
  samples.sort((a, b) => a - b);
  return { spec, ms: samples[Math.floor(samples.length / 2)], samples };
}

const all = [...TARGETS, ...INTERNAL.map((p) => path.resolve(__dirname, p))];
const rows = [];
for (const spec of all) rows.push(await median(spec));

rows.sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0));
console.error(banner("Per-module import cost", `${ITER} cold-process samples · median reported`));
console.log(
  "\n" +
    summary({
      head: ["module", "median (ms)"],
      rows: rows.map((r) => [
        r.spec.replace(ROOT, "."),
        r.error ? `ERR: ${r.error}` : r.ms.toFixed(1),
      ]),
      align: ["l", "r"],
      highlight: (row) => row[0].includes("@daloyjs/core"),
    }) +
    "\n"
);
