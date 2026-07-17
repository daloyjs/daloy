// DaloyJS graceful-degradation variant — same routes/validation as daloy.ts,
// but with admission control tuned to fail fast under overload instead of
// queuing requests into multi-second tail latencies.
//
// This does NOT weaken any guardrail — it *adds* protections:
//
//   1. server.maxConnections (connection-layer admission control). This is
//      the lever that actually fixes the cliff: the c=500/1000 tail latency
//      is dominated by requests WAITING IN THE CONNECTION/EVENT-LOOP QUEUE,
//      not by handler time. Capping concurrent sockets keeps the loop in its
//      measured sweet spot (~c=100, where daloy's p99.9 is tens of ms) and
//      rejects the overflow at accept time instead of queuing it for seconds.
//
//   2. loadShedding() on event-loop DELAY only. NOTE: event-loop UTILIZATION
//      is the wrong signal for an always-busy server — a saturated CPU sits
//      near 100% ELU even when it is healthy, so an ELU threshold sheds good
//      traffic. Event-loop *delay* (queue backlog) is the honest overload
//      signal, so we disable the ELU check and trip on delay instead.
//
// Compare against daloy.ts (default, lax shedding, unbounded connections):
//   node run.mjs --sweep=connections --only=daloy,daloy-shed
import { z } from "zod";
import { App } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

// Keep concurrency near daloy's measured sweet spot. Above this, the loop
// queues work into multi-second tails; below it, p99.9 stays in the tens of ms.
const MAX_CONNECTIONS = Number(process.env.MAX_CONNECTIONS ?? 200);

const app = new App({
  logger: false,
  loadShedding: {
    maxEventLoopDelayMs: 100, // shed when the loop falls 100ms behind
    maxEventLoopUtilization: 0, // DISABLED — wrong signal for a busy server
    sampleIntervalMs: 100, // react in 100ms, not the default 1s
    retryAfterSeconds: 1,
  },
});

app.route({
  method: "GET",
  path: "/static",
  operationId: "getStatic",
  responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) } },
  handler: () => ({ status: 200, body: { ok: true } }),
});

app.route({
  method: "GET",
  path: "/users/:id",
  operationId: "getUser",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: "ok", body: z.object({ id: z.string() }) } },
  handler: ({ params }) => ({ status: 200, body: { id: params.id } }),
});

app.route({
  method: "POST",
  path: "/echo",
  operationId: "echo",
  request: { body: z.object({ name: z.string() }) },
  responses: { 200: { description: "ok", body: z.object({ name: z.string() }) } },
  handler: ({ body }) => ({ status: 200, body: { name: body.name } }),
});

const port = Number(process.env.PORT ?? 3000);
const handle = serve(app, {
  port,
  hostname: "127.0.0.1",
  // Connection-layer admission control: reject the overflow at accept time
  // instead of letting it queue into multi-second tail latencies.
  maxConnections: MAX_CONNECTIONS,
});
handle.server.once("listening", () => {
  process.stdout.write(`READY ${port}\n`);
});
