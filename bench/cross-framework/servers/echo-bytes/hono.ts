// Hono — raw-bytes echo server for the body-size sweep.
// POST /echo-bytes accepts application/octet-stream and returns
// { received: N } where N is the body length.
import { Hono } from "hono";
import { serve } from "@hono/node-server";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

app.post("/echo-bytes", async (c) => {
  const buf = await c.req.arrayBuffer();
  return c.json({ received: buf.byteLength });
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => {
  process.stdout.write(`READY ${port}\n`);
});
