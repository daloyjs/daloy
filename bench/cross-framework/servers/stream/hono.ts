// Hono — large streaming response. GET /stream returns ~10 MiB chunked.
import { Hono } from "hono";
import { serve } from "@hono/node-server";

const app = new Hono();

const CHUNK = new Uint8Array(64 * 1024).fill(0x61);
const TOTAL_CHUNKS = 160;

app.get("/health", (c) => c.json({ ok: true }));

app.get("/stream", (c) => {
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
  c.header("content-type", "application/octet-stream");
  return c.body(body);
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
  process.stdout.write(`READY ${port}\n`);
});
