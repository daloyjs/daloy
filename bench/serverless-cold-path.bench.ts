/**
 * Daloy serverless cold-path benchmark.
 * Run with: pnpm bench:serverless
 *
 * Measures shipped-JavaScript import time plus route registration, first
 * dispatch, and warm dispatch. Every scenario sample runs in a fresh Node
 * process so one scenario's JIT and singleton initialization cannot make a
 * later scenario look artificially cold or fast.
 */
import { spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const distAppPath = resolve(root, "dist/app.js");
const routeCounts = [1, 10, 100, 500, 2_000];
const importSamples = 7;
const scenarioSamples = 5;
const warmRequests = 1_000;

if (!existsSync(distAppPath)) {
  throw new Error("dist/app.js is missing; run `pnpm build` before the serverless benchmark");
}

const appSpecifier = pathToFileURL(distAppPath).href;

type Sample = {
  registerMs: number;
  firstFetchMs: number;
  warmAvgUs: number;
};

type Row = {
  label: string;
  routes: number;
  registerMs: number;
  firstFetchMs: number;
  warmAvgUs: number;
  samples: Sample[];
};

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function formatNumber(n: number, digits = 2): string {
  return n.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function runChild(code: string): string {
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", code], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "benchmark child process failed");
  }
  return result.stdout.trim();
}

function measureImport(specifier: string): number[] {
  const samples: number[] = [];
  for (let i = 0; i < importSamples; i++) {
    const code = [
      "const t0 = performance.now();",
      `await import(${JSON.stringify(specifier)});`,
      "process.stdout.write(String(performance.now() - t0));",
    ].join("");
    samples.push(Number(runChild(code)));
  }
  return samples;
}

function measureScenario(routeCount: number, withSchemas: boolean): Sample {
  const code = `
    const { App } = await import(${JSON.stringify(appSpecifier)});
    const { z } = await import("zod");
    const routeCount = ${routeCount};
    const withSchemas = ${JSON.stringify(withSchemas)};
    const responseSchema = z.object({ ok: z.boolean(), id: z.number() });
    const registerStart = performance.now();
    const app = new App({
      env: "production",
      logger: false,
      trustProxy: false,
    });
    for (let i = 0; i < routeCount; i++) {
      app.route({
        method: "GET",
        path: \`/r/\${i}\`,
        operationId: \`getRoute\${i}\`,
        responses: withSchemas
          ? { 200: { description: "ok", body: responseSchema } }
          : { 200: { description: "ok" } },
        handler: () => ({ status: 200, body: { ok: true, id: i } }),
      });
    }
    const registerMs = performance.now() - registerStart;
    const request = () => new Request(\`https://benchmark.local/r/\${routeCount - 1}\`);
    const checkedFetch = async () => {
      const response = await app.fetch(request());
      if (response.status !== 200) throw new Error(\`expected 200, got \${response.status}\`);
      await response.text();
    };
    const firstStart = performance.now();
    await checkedFetch();
    const firstFetchMs = performance.now() - firstStart;
    const warmStart = performance.now();
    for (let i = 0; i < ${warmRequests}; i++) await checkedFetch();
    const warmAvgUs = ((performance.now() - warmStart) * 1_000) / ${warmRequests};
    process.stdout.write(JSON.stringify({ registerMs, firstFetchMs, warmAvgUs }));
  `;
  return JSON.parse(runChild(code)) as Sample;
}

function shuffled<T>(values: T[]): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

function printRows(rows: Row[]): void {
  const header = [
    "scenario",
    "routes",
    "register median ms",
    "first fetch median ms",
    "warm median us",
  ];
  const rendered = rows.map((row) => [
    row.label,
    String(row.routes),
    formatNumber(row.registerMs),
    formatNumber(row.firstFetchMs),
    formatNumber(row.warmAvgUs),
  ]);
  const widths = header.map((heading, index) =>
    Math.max(heading.length, ...rendered.map((row) => row[index]!.length))
  );
  const line = (cells: string[]) =>
    cells.map((cell, index) => cell.padStart(widths[index]!)).join("  ");

  console.log(line(header));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rendered) console.log(line(row));
}

const importApp = measureImport(appSpecifier);
const importZod = measureImport("zod");
const scenarios = routeCounts.flatMap((routes) => [
  { label: "full-contract", routes, withSchemas: true },
  { label: "no-response-schema", routes, withSchemas: false },
]);
const collected = new Map(
  scenarios.map((scenario) => [`${scenario.label}:${scenario.routes}`, [] as Sample[]])
);

for (let round = 0; round < scenarioSamples; round++) {
  for (const scenario of shuffled(scenarios)) {
    collected
      .get(`${scenario.label}:${scenario.routes}`)!
      .push(measureScenario(scenario.routes, scenario.withSchemas));
  }
}

const rows: Row[] = scenarios.map((scenario) => {
  const samples = collected.get(`${scenario.label}:${scenario.routes}`)!;
  return {
    label: scenario.label,
    routes: scenario.routes,
    registerMs: median(samples.map((sample) => sample.registerMs)),
    firstFetchMs: median(samples.map((sample) => sample.firstFetchMs)),
    warmAvgUs: median(samples.map((sample) => sample.warmAvgUs)),
    samples,
  };
});

console.log("Daloy serverless cold-path benchmark");
console.log(`compiled dist; secure defaults on; ${scenarioSamples} fresh-process samples/scenario`);
console.log("");
console.log(
  `median import dist/app.js: ${formatNumber(median(importApp))} ms ` +
    `(range ${formatNumber(Math.min(...importApp))}–${formatNumber(Math.max(...importApp))})`
);
console.log(
  `median import zod: ${formatNumber(median(importZod))} ms ` +
    `(range ${formatNumber(Math.min(...importZod))}–${formatNumber(Math.max(...importZod))})`
);
console.log("");
printRows(rows);

const git = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
});
const gitStatus = spawnSync("git", ["status", "--porcelain"], {
  cwd: root,
  encoding: "utf8",
});
writeFileSync(
  resolve(__dirname, "results.serverless.json"),
  `${JSON.stringify(
    {
      ranAt: new Date().toISOString(),
      machine: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpuModel: os.cpus()[0]?.model ?? "unknown",
        cpuCount: os.cpus().length,
        gitSha: git.status === 0 ? git.stdout.trim() : "unknown",
        gitDirty: gitStatus.status === 0 ? gitStatus.stdout.trim().length > 0 : "unknown",
      },
      config: { importSamples, scenarioSamples, warmRequests },
      imports: { app: importApp, zod: importZod },
      rows,
    },
    null,
    2
  )}\n`
);
