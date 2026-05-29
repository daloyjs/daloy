// DaloyJS — raw-bytes echo server for the body-size sweep.
// POST /echo-bytes accepts application/octet-stream and returns
// { received: N } where N is the body length.
import { z } from "zod";
import { App, readBodyLimited } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const BODY_LIMIT = 8 * 1024 * 1024;

const app = new App({
  // Allow up to 8 MiB so the 4 MiB sweep point fits with headroom.
  bodyLimitBytes: BODY_LIMIT,
});

app.route({
  method: "GET",
  path: "/health",
  operationId: "health",
  responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) } },
  handler: async () => ({ status: 200, body: { ok: true } }),
});

app.route({
  method: "POST",
  path: "/echo-bytes",
  operationId: "echoBytes",
  // No schema body — we want raw bytes. Use readBodyLimited so the Node
  // adapter's pre-buffered-bytes fast path is hit (skips the WHATWG
  // ReadableStream reader loop that request.arrayBuffer() forces).
  responses: { 200: { description: "ok", body: z.object({ received: z.number() }) } },
  handler: async ({ request }) => {
    const bytes = await readBodyLimited(request, BODY_LIMIT);
    return { status: 200, body: { received: bytes.byteLength } };
  },
});

const port = Number(process.env.PORT ?? 3000);
const handle = serve(app, { port, hostname: "127.0.0.1" });
handle.server.once("listening", () => {
  process.stdout.write(`READY ${port}\n`);
});
