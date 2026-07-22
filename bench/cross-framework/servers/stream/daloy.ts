// DaloyJS — large streaming response. GET /stream returns a ~10 MiB body
// chunked through a Web ReadableStream — the body type Daloy's response
// contract actually supports for streaming. (A Node Readable is NOT a valid
// handler body: it fails the `instanceof ReadableStream` check and falls
// through to JSON serialization, which silently turned this fixture into a
// ~130-byte JSON response and invalidated earlier streaming numbers.)
import { z } from "zod";
import { App } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

// Parity with throughput/daloy.ts — default info logger is not part of the
// streaming cost story and allocates a per-request child.
const app = new App({ logger: false });

const CHUNK = new Uint8Array(64 * 1024).fill(0x61);
const TOTAL_CHUNKS = 160;

app.route({
  method: "GET",
  path: "/health",
  operationId: "health",
  responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) } },
  handler: async () => ({ status: 200, body: { ok: true } }),
});

app.route({
  method: "GET",
  path: "/stream",
  operationId: "stream",
  responses: {
    200: {
      description: "ok",
      body: undefined as never,
    },
  },
  handler: async () => {
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= TOTAL_CHUNKS) {
          controller.close();
          return;
        }
        controller.enqueue(CHUNK);
        sent++;
      },
    });
    return {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
      body,
    };
  },
});

const port = Number(process.env.PORT ?? 3000);
const handle = serve(app, { port, hostname: "127.0.0.1" });
handle.server.once("listening", () => {
  process.stdout.write(`READY ${port}\n`);
});
