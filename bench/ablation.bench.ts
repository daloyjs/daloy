/**
 * In-process dispatch ablation benchmark.
 * Run with: pnpm bench:ablation   (node --import tsx bench/ablation.bench.ts)
 *
 * Reproduces the "In-process dispatch ablation" tables in
 * PERFORMANCE_IMPROVEMENTS_STORY.md with a checked-in harness instead of
 * throwaway scripts. Each config builds a real `App`, warms it, then drives
 * `app.fetch(new Request("GET /static"))` in-process (no HTTP, no sockets) so
 * the numbers isolate dispatch + contract + security-default cost from the
 * network stack.
 *
 * The config matrix IS the ablation — none of these weaken a security default
 * to "make numbers comparable"; they measure exactly what each documented
 * posture costs:
 *
 *   full-defaults           Zod response schema + every secure default
 *   no-response-validation  same, with `validateResponses: false`
 *   internal-service        same schema, `preset: "internal-service"`
 *   secure-defaults-off     same schema, `secureDefaults: false`
 *   bare-async              no Zod, internal-service preset, async handler
 *   bare-sync               as bare-async with a sync handler
 *
 * Methodology follows the repo's other benches:
 *   - configs are interleaved per round and summarized by the median across
 *     rounds (same pattern as bench/json-body-e2e.bench.ts) — a single
 *     round's delta swings several points with JIT/GC noise;
 *   - provenance (Node version, git SHA + dirty flag, machine info) is
 *     recorded verbatim into the results file, following
 *     bench/cross-framework/lib/common.mjs conventions;
 *   - a fresh `Request` is created per iteration, matching what a real
 *     adapter does per request.
 *
 * Prefers the compiled `dist/` build when present (the story's tables were
 * measured against dist; run `pnpm build` first for comparable numbers) and
 * falls back to `src/` via tsx — whichever ran is recorded as
 * `moduleSource` in the results.
 *
 * Tunables (env): ROUNDS (default 5), ITERS (default 50_000 per round),
 * WARMUP (default 5_000 per config per round).
 *
 * Results: prints a table, and writes raw samples + provenance to
 * bench/results.ablation.json (gitignored, like all bench results).
 */
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { App as AppClass } from "../src/app.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

// ---------------------------------------------------------------------------
// Module source: dist (matches the story tables) when built, else src via tsx.
// ---------------------------------------------------------------------------
type AppCtor = typeof AppClass;
const distApp = path.join(ROOT, "dist", "app.js");
const useDist = existsSync(distApp) && process.env.ABLATION_SRC !== "1";
const moduleSource = useDist ? "dist" : "src (tsx)";
const { App } = (await import(
  useDist ? new URL("../dist/app.js", import.meta.url).href : "../src/app.js"
)) as { App: AppCtor };

// ---------------------------------------------------------------------------
// Config matrix — mirrors the story's ablation rows. Do not add rows that
// weaken a guard outside its documented knob; the knobs are the experiment.
// ---------------------------------------------------------------------------
const responseSchema = z.object({ ok: z.boolean() });

type BenchConfig = {
  name: string;
  description: string;
  makeApp: () => AppClass;
};

/** Registers the schema-full GET /static used by the non-bare configs. */
function withContractRoute(app: AppClass): AppClass {
  app.route({
    method: "GET",
    path: "/static",
    operationId: "getStatic",
    responses: { 200: { description: "ok", body: responseSchema } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  return app;
}

/** Registers the schema-less GET /static used by the bare configs. */
function withBareRoute(app: AppClass, sync: boolean): AppClass {
  app.route({
    method: "GET",
    path: "/static",
    operationId: "getStatic",
    responses: { 200: { description: "ok" } },
    handler: sync
      ? () => ({ status: 200 as const, body: { ok: true } })
      : async () => ({ status: 200 as const, body: { ok: true } }),
  });
  return app;
}

const CONFIGS: BenchConfig[] = [
  {
    name: "full-defaults",
    description: "Full defaults + response schema",
    makeApp: () => withContractRoute(new App({ logger: false })),
  },
  {
    name: "no-response-validation",
    description: "validateResponses: false",
    makeApp: () => withContractRoute(new App({ logger: false, validateResponses: false })),
  },
  {
    name: "internal-service",
    description: 'preset: "internal-service"',
    makeApp: () => withContractRoute(new App({ logger: false, preset: "internal-service" })),
  },
  {
    name: "secure-defaults-off",
    description: "secureDefaults: false",
    makeApp: () => withContractRoute(new App({ logger: false, secureDefaults: false })),
  },
  {
    name: "bare-async",
    description: "Bare (no Zod, internal-service), async handler",
    makeApp: () => withBareRoute(new App({ logger: false, preset: "internal-service" }), false),
  },
  {
    name: "bare-sync",
    description: "Bare (no Zod, internal-service), sync handler",
    makeApp: () => withBareRoute(new App({ logger: false, preset: "internal-service" }), true),
  },
];

// ---------------------------------------------------------------------------
// Provenance — same fields the cross-framework harness records, so results
// files are judgeable later (commit, dirty tree, machine, background load).
// Never throws: failed probes record "unknown".
// ---------------------------------------------------------------------------
function tryExec(cmd: string, args: string[]): string | undefined {
  try {
    return execFileSync(cmd, args, {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function provenance() {
  const gitSha = tryExec("git", ["rev-parse", "HEAD"]) ?? "unknown";
  const gitStatus = tryExec("git", ["status", "--porcelain"]);
  const gitDirty: boolean | "unknown" = gitStatus === undefined ? "unknown" : gitStatus.length > 0;
  const cpus = os.cpus();
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuModel: cpus[0]?.model ?? "unknown",
    cpuCount: cpus.length,
    totalMemGiB: +(os.totalmem() / 1024 ** 3).toFixed(2),
    loadAvg: os.loadavg(),
    gitSha,
    gitDirty,
    moduleSource,
  };
}

// ---------------------------------------------------------------------------
// Bench loop — interleave configs per round, median across rounds.
// ---------------------------------------------------------------------------
const ROUNDS = Number(process.env.ROUNDS ?? 5);
const ITERS = Number(process.env.ITERS ?? 50_000);
const WARMUP = Number(process.env.WARMUP ?? 5_000);

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

async function benchOnce(app: AppClass): Promise<number> {
  const url = "http://bench.local/static";
  for (let i = 0; i < WARMUP; i++) {
    const res = await app.fetch(new Request(url));
    if (res.status !== 200) {
      throw new Error(`preflight failed: GET /static returned ${res.status}`);
    }
  }
  const t0 = performance.now();
  for (let i = 0; i < ITERS; i++) {
    await app.fetch(new Request(url));
  }
  const dt = performance.now() - t0;
  return (ITERS / dt) * 1000;
}

const info = provenance();
if (info.loadAvg[0] > info.cpuCount) {
  console.error(
    `⚠ loadAvg ${info.loadAvg[0].toFixed(1)} exceeds cpuCount ${info.cpuCount} — ` +
      `machine is busy; expect noisy numbers.`
  );
}
if (info.gitDirty === true) {
  console.error(
    "⚠ git worktree is dirty — record these numbers as indicative, not publication-grade."
  );
}

console.log(`In-process dispatch ablation — GET /static via app.fetch (${moduleSource})`);
console.log(
  `${ROUNDS} rounds x ${ITERS.toLocaleString("en-US")} iters (warmup ${WARMUP.toLocaleString("en-US")}/config/round), Node ${info.node}, ${info.gitSha.slice(0, 12)}${info.gitDirty === true ? "-dirty" : ""}\n`
);

const samples: Record<string, number[]> = Object.fromEntries(CONFIGS.map((c) => [c.name, []]));
for (let round = 0; round < ROUNDS; round++) {
  for (const config of CONFIGS) {
    const ops = await benchOnce(config.makeApp());
    samples[config.name].push(ops);
    console.log(
      `round ${round + 1}/${ROUNDS}  ${config.name.padEnd(24)} ${ops
        .toLocaleString("en-US", { maximumFractionDigits: 0 })
        .padStart(10)} ops/s`
    );
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// Summary + results file
// ---------------------------------------------------------------------------
const fullMedian = median(samples["full-defaults"]);
const results = CONFIGS.map((config) => {
  const runs = samples[config.name];
  return {
    name: config.name,
    description: config.description,
    medianOpsPerSec: Math.round(median(runs)),
    minOpsPerSec: Math.round(Math.min(...runs)),
    maxOpsPerSec: Math.round(Math.max(...runs)),
    samples: runs.map((r) => Math.round(r)),
  };
});

console.log(`Median of ${ROUNDS} rounds (vs full-defaults):\n`);
for (const row of results) {
  const rel = ((row.medianOpsPerSec / fullMedian - 1) * 100).toFixed(1);
  const relLabel =
    row.name === "full-defaults" ? "baseline" : `${Number(rel) >= 0 ? "+" : ""}${rel}%`;
  console.log(
    `${row.description.padEnd(46)} ${row.medianOpsPerSec
      .toLocaleString("en-US")
      .padStart(10)} ops/s  ${relLabel}`
  );
}

const out = {
  bench: "ablation",
  target: "GET /static (in-process app.fetch, no HTTP)",
  ranAt: new Date().toISOString(),
  rounds: ROUNDS,
  itersPerRound: ITERS,
  warmupPerConfigPerRound: WARMUP,
  machine: info,
  results,
};
const outPath = path.join(HERE, "results.ablation.json");
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(`\nRaw samples + provenance written to ${path.relative(ROOT, outPath)}`);
