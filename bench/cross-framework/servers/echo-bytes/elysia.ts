// Elysia (@elysiajs/node) — raw-bytes echo server for the body-size sweep.
// POST /echo-bytes accepts application/octet-stream and returns
// { received: N } where N is the body length. `type: "arrayBuffer"` makes
// Elysia hand us the raw bytes instead of attempting to parse JSON.
import { Elysia } from "elysia";
import { node } from "@elysiajs/node";

const app = new Elysia({ adapter: node() });

app.get("/health", () => ({ ok: true }));

app.post(
  "/echo-bytes",
  ({ body }) => ({ received: (body as ArrayBuffer)?.byteLength ?? 0 }),
  { type: "arrayBuffer" },
);

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, hostname: "127.0.0.1" }, () => {
  process.stdout.write(`READY ${port}\n`);
});
