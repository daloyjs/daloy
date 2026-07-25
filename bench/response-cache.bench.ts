/**
 * Response-cache hot-path micro-benchmark.
 * Run with: node --import tsx bench/response-cache.bench.ts
 *
 * `responseCache()` sits in front of read endpoints, so its `beforeHandle`
 * (cache-key construction + store lookup) runs on every eligible request and its
 * `onSend` (freshness decision + body buffering) runs on every miss. Both are
 * hot paths: a cache HIT is supposed to be the cheapest possible way to answer a
 * request, so overhead added here shows up directly in the numbers that justify
 * using the middleware at all.
 *
 * Scenarios cover the three shapes the key builder can take — plain, partitioned
 * by a resolved tenant, and partitioned by a `principal` — plus the HIT path,
 * the MISS (store) path, and the credential bypass, so a regression in any one
 * of them is visible rather than averaged away. See the performance rule in
 * AGENTS.md.
 */
import { App, responseCache } from "../src/index.js";
import { tenancy, tenantFromHeader } from "../src/tenancy.js";

async function bench(label: string, iters: number, fn: () => Promise<unknown>): Promise<void> {
  for (let i = 0; i < 500; i++) await fn(); // warm
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) await fn();
  const t1 = performance.now();
  const opsPerSec = ((iters / (t1 - t0)) * 1000).toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
  console.log(
    `${label.padEnd(48)} ${opsPerSec.padStart(12)} ops/sec  (${(t1 - t0).toFixed(1)}ms / ${iters} iters)`,
  );
}

/**
 * Minimal route contract. `acknowledgeNoResponseBodySchema` keeps the benchmark
 * free of a schema-validation cost that would mask the cache overhead being
 * measured.
 */
const ROUTE = {
  operationId: "items",
  acknowledgeNoResponseBodySchema: true,
  responses: { 200: { description: "ok" } },
};

/** A representative read payload: small JSON object, the common cached shape. */
const PAYLOAD = { id: "018f", name: "Ada Lovelace", tags: ["math", "engines"] };

/** App with `responseCache()` mounted the ordinary way. */
function plainApp() {
  const app = new App({ logger: false });
  app.use(responseCache({ ttlSeconds: 60 }) as never);
  app.get("/items", ROUTE as never, async () => PAYLOAD as never);
  return app;
}

/** App whose cache partitions on the tenant resolved by `tenancy()`. */
function tenantApp() {
  const app = new App({ logger: false });
  app.use(tenancy({ resolve: tenantFromHeader("x-tenant-id"), require: false }) as never);
  app.use(responseCache({ ttlSeconds: 60 }) as never);
  app.get("/items", ROUTE as never, async () => PAYLOAD as never);
  return app;
}

/** App whose cache partitions on an explicit `principal` callback. */
function principalApp() {
  const app = new App({ logger: false });
  app.use(
    responseCache({
      ttlSeconds: 60,
      principal: (ctx) => ctx.request.headers.get("x-user-id"),
    } as never) as never,
  );
  app.get("/items", ROUTE as never, async () => PAYLOAD as never);
  return app;
}

/** App with a cache that always misses, to isolate the store-write path. */
function missApp() {
  const app = new App({ logger: false });
  app.use(responseCache({ ttlSeconds: 60 }) as never);
  app.get("/items", ROUTE as never, async () => PAYLOAD as never);
  return app;
}

console.log("Response-cache hot-path micro-benchmark\n");

const plain = plainApp();
const tenant = tenantApp();
const principal = principalApp();
const miss = missApp();

// Warm each cache so the HIT benchmarks measure the hit path.
await plain.request(new Request("http://a.example.com/items"));
await tenant.request(new Request("http://a.example.com/items", { headers: { "x-tenant-id": "acme" } }));
await principal.request(new Request("http://a.example.com/items", { headers: { "x-user-id": "u-1" } }));

await bench("HIT — plain key", 200_000, () =>
  plain.request(new Request("http://a.example.com/items")),
);
await bench("HIT — tenant-partitioned key", 200_000, () =>
  tenant.request(new Request("http://a.example.com/items", { headers: { "x-tenant-id": "acme" } })),
);
await bench("HIT — principal-partitioned key", 200_000, () =>
  principal.request(new Request("http://a.example.com/items", { headers: { "x-user-id": "u-1" } })),
);
console.log("");
// A fresh query string every iteration, so every request is a store-write miss.
let n = 0;
await bench("MISS — key build + body buffer + store", 100_000, () =>
  miss.request(new Request(`http://a.example.com/items?q=${n++}`)),
);
console.log("");
await bench("BYPASS — Authorization-bearing request", 200_000, () =>
  plain.request(new Request("http://a.example.com/items", { headers: { authorization: "Bearer t" } })),
);
await bench("BYPASS — Cookie-bearing request", 200_000, () =>
  plain.request(new Request("http://a.example.com/items", { headers: { cookie: "sid=abc" } })),
);
