/**
 * Daloy serverless cold-path benchmark.
 * Run with: pnpm bench:serverless
 *
 * Measures the pieces that matter for Worker/Lambda-style cold starts:
 * module import, App construction + route registration, first dispatch, and
 * warm dispatch. This intentionally keeps secure defaults active; it sets an
 * explicit trustProxy posture only so the production proxy guard is satisfied.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { App } from "../src/app.js";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const routeCounts = [1, 10, 100, 500, 2_000];
const importIterations = 5;
const warmRequests = 1_000;

const responseSchema = z.object({
  ok: z.boolean(),
  id: z.number(),
});

type Row = {
  label: string;
  routes: number;
  registerMs: number;
  firstFetchMs: number;
  warmAvgUs: number;
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

function measureImport(spec: string): number {
  const samples: number[] = [];
  for (let i = 0; i < importIterations; i++) {
    const code = [
      "const t0 = performance.now();",
      `await import(${JSON.stringify(spec)});`,
      "const t1 = performance.now();",
      "process.stdout.write(String(t1 - t0));",
    ].join("");
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", code],
      { cwd: root, encoding: "utf8" },
    );
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || `import failed for ${spec}`);
    }
    samples.push(Number(result.stdout));
  }
  return median(samples);
}

function buildApp(routeCount: number, withSchemas: boolean): App {
  const app = new App({
    env: "production",
    logger: false,
    trustProxy: false,
  });

  for (let i = 0; i < routeCount; i++) {
    app.route({
      method: "GET",
      path: `/r/${i}`,
      operationId: `getRoute${i}`,
      responses: withSchemas
        ? { 200: { description: "ok", body: responseSchema } }
        : { 200: { description: "ok" } },
      handler: () => ({ status: 200 as const, body: { ok: true, id: i } }),
    });
  }

  return app;
}

async function checkedFetch(app: App, routeCount: number): Promise<void> {
  const res = await app.fetch(
    new Request(`https://benchmark.local/r/${routeCount - 1}`),
  );
  if (res.status !== 200) {
    throw new Error(`expected 200, got ${res.status}`);
  }
  await res.text();
}

async function measureScenario(
  label: string,
  routeCount: number,
  withSchemas: boolean,
): Promise<Row> {
  const registerStart = performance.now();
  const app = buildApp(routeCount, withSchemas);
  const registerMs = performance.now() - registerStart;

  const firstStart = performance.now();
  await checkedFetch(app, routeCount);
  const firstFetchMs = performance.now() - firstStart;

  const warmStart = performance.now();
  for (let i = 0; i < warmRequests; i++) {
    await checkedFetch(app, routeCount);
  }
  const warmAvgUs = ((performance.now() - warmStart) * 1_000) / warmRequests;

  return { label, routes: routeCount, registerMs, firstFetchMs, warmAvgUs };
}

function printRows(rows: Row[]): void {
  const header = [
    "scenario",
    "routes",
    "register ms",
    "first fetch ms",
    "warm fetch avg us",
  ];
  const rendered = rows.map((row) => [
    row.label,
    String(row.routes),
    formatNumber(row.registerMs),
    formatNumber(row.firstFetchMs),
    formatNumber(row.warmAvgUs),
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rendered.map((r) => r[i]!.length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, i) => cell.padStart(widths[i]!)).join("  ");

  console.log(line(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rendered) console.log(line(row));
}

console.log("Daloy serverless cold-path benchmark");
console.log("secure defaults: on; trustProxy: false; logger: false");
console.log("");
console.log(
  `median import ./src/app.ts: ${formatNumber(measureImport("./src/app.ts"))} ms`,
);
console.log(`median import zod: ${formatNumber(measureImport("zod"))} ms`);
console.log("");

const rows: Row[] = [];
for (const count of routeCounts) {
  rows.push(await measureScenario("full-contract", count, true));
  rows.push(await measureScenario("no-response-schema", count, false));
}
printRows(rows);
