/**
 * Metrics demo — DaloyJS Prometheus/Grafana integration example.
 *
 * Starts a server on port 3001 that exposes:
 *   GET /metrics   — Prometheus text-format scrape endpoint (no auth for demo)
 *   GET /orders    — simulated order listing (increments a business counter)
 *   POST /orders   — simulated order creation
 *   GET /health    — liveness probe (excluded from RED metrics)
 *
 * Pair with the Docker Compose stack in examples/observability/:
 *
 *   # Terminal 1 — run the app
 *   node --import tsx examples/metrics-demo.ts
 *
 *   # Terminal 2 — start Prometheus + Grafana
 *   docker compose -f examples/observability/docker-compose.yml up
 *
 * Then open:
 *   http://localhost:9090   — Prometheus
 *   http://localhost:3000   — Grafana  (admin / admin)
 */

import { serve } from "../src/adapters/node.ts";
import { App, MetricsRegistry } from "../src/index.ts";
import { z } from "zod";

const registry = new MetricsRegistry({ prefix: "demo_" });

const ordersCreated = registry.counter("orders_created_total", "Total orders created.");
const orderValue = registry.histogram(
  "order_value_usd",
  "Distribution of order values in USD.",
  [1, 5, 10, 25, 50, 100, 250, 500],
);

const app = new App({ env: "development" });

// Mount the /metrics endpoint first so subsequent routes are instrumented.
// In production replace acknowledgeUnauthenticated with a real token.
app.metrics({
  registry,
  acknowledgeUnauthenticated: true,
  exclude: (p) => p === "/health",
});

app.get(
  "/health",
  {
    operationId: "healthCheck",
    summary: "Liveness probe",
    responses: { 200: { description: "OK", body: z.object({ status: z.string() }) } },
  },
  () => ({ status: 200 as const, body: { status: "ok" } }),
);

app.get(
  "/orders",
  {
    operationId: "listOrders",
    summary: "List orders",
    responses: {
      200: {
        description: "Order list",
        body: z.object({ orders: z.array(z.object({ id: z.string(), total: z.number() })) }),
      },
    },
  },
  () => ({
    status: 200 as const,
    body: {
      orders: [
        { id: "ord-1", total: 49.99 },
        { id: "ord-2", total: 129.0 },
      ],
    },
  }),
);

app.post(
  "/orders",
  {
    operationId: "createOrder",
    summary: "Create an order",
    request: {
      body: z.object({ item: z.string(), total: z.number().positive() }),
    },
    responses: {
      201: {
        description: "Order created",
        body: z.object({ id: z.string(), item: z.string(), total: z.number() }),
      },
    },
  },
  ({ body }) => {
    ordersCreated.inc({ item: body.item });
    orderValue.observe({}, body.total);
    return {
      status: 201 as const,
      body: { id: `ord-${Date.now()}`, item: body.item, total: body.total },
    };
  },
);

const PORT = 3001;
const { port } = serve(app, { port: PORT });
console.log(`DaloyJS metrics demo running at http://localhost:${port}`);
console.log(`Prometheus scrape target: http://localhost:${port}/metrics`);
console.log(`Grafana (after docker compose up): http://localhost:3000  (admin/admin)`);
