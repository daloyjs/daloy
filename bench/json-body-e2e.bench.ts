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
    limited ? { logger: false } : { logger: false, jsonMaxKeys: 0, jsonMaxDepth: 0 }
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
    `${label.padEnd(28)} ${opsPerSec.toLocaleString("en-US", { maximumFractionDigits: 0 }).padStart(10)} ops/sec  (${dt.toFixed(0)}ms / ${iters})`
  );
  return opsPerSec;
}

console.log("End-to-end POST /users (typical body, zod-validated)\n");
const ITERS = 100_000;
const ROUNDS = 5;
// Interleave rounds to smooth out JIT/GC noise, then summarize with the
// median across rounds — a single round's delta swings several points.
const onRounds: number[] = [];
const offRounds: number[] = [];
for (let round = 0; round < ROUNDS; round++) {
  if (round % 2 === 0) {
    onRounds.push(await bench(`limits ON  (default)`, makeApp(true), ITERS));
    offRounds.push(await bench(`limits OFF (0/0)`, makeApp(false), ITERS));
  } else {
    offRounds.push(await bench(`limits OFF (0/0)`, makeApp(false), ITERS));
    onRounds.push(await bench(`limits ON  (default)`, makeApp(true), ITERS));
  }
  console.log("");
}
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const onMed = median(onRounds);
const offMed = median(offRounds);
const perRound = onRounds
  .map((on, i) => (((offRounds[i] - on) / offRounds[i]) * 100).toFixed(1) + "%")
  .join(", ");
console.log(`per-round overhead of limits vs disabled: ${perRound}`);
console.log(
  `overhead of limits vs disabled (median of ${ROUNDS} rounds): ${(((offMed - onMed) / offMed) * 100).toFixed(1)}%`
);
