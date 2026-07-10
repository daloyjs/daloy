/**
 * End-to-end JSON-body request benchmark.
 * Run with: node --import tsx bench/json-body-e2e.bench.ts
 *
 * Measures the real per-request cost of the jsonMaxKeys / jsonMaxDepth
 * structural limits by comparing an App with the defaults active against an
 * identical App with the limits disabled (jsonMaxKeys: 0, jsonMaxDepth: 0).
 * Both drive the full pipeline: routing, body read, parse, zod request-body
 * validation, handler, response validation, serialization.
 */
import { App } from "../src/app.js";
import { z } from "zod";

const bodySchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  age: z.number(),
  active: z.boolean(),
  tags: z.array(z.string()),
  address: z.object({ street: z.string(), city: z.string(), zip: z.string() }),
});

function makeApp(limited: boolean): App {
  const app = new App(
    limited ? { logger: false } : { logger: false, jsonMaxKeys: 0, jsonMaxDepth: 0 },
  );
  app.route({
    method: "POST",
    path: "/users",
    operationId: "createUser",
    request: { body: bodySchema },
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  return app;
}

const payload = JSON.stringify({
  id: "018f-abc",
  name: "Ada Lovelace",
  email: "ada@example.com",
  age: 36,
  active: true,
  tags: ["math", "engines", "notes"],
  address: { street: "12 King St", city: "London", zip: "SW1A" },
});

async function bench(label: string, app: App, iters: number): Promise<number> {
  const req = () =>
    app.request("/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    });
  for (let i = 0; i < 2000; i++) await req(); // warm
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) await req();
  const dt = performance.now() - t0;
  const opsPerSec = (iters / dt) * 1000;
  console.log(
    `${label.padEnd(28)} ${opsPerSec.toLocaleString("en-US", { maximumFractionDigits: 0 }).padStart(10)} ops/sec  (${dt.toFixed(0)}ms / ${iters})`,
  );
  return opsPerSec;
}

console.log("End-to-end POST /users (typical body, zod-validated)\n");
const ITERS = 100_000;
// Interleave a couple of rounds to smooth out JIT/GC noise.
let onA = 0;
let offA = 0;
for (let round = 0; round < 3; round++) {
  onA = await bench(`limits ON  (default)`, makeApp(true), ITERS);
  offA = await bench(`limits OFF (0/0)`, makeApp(false), ITERS);
  console.log("");
}
const deltaPct = ((offA - onA) / offA) * 100;
console.log(`overhead of limits vs disabled (last round): ${deltaPct.toFixed(1)}%`);
