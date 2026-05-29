// Express v5 — raw-bytes echo server for the body-size sweep.
// POST /echo-bytes accepts application/octet-stream and returns
// { received: N } where N is the body length.
import express from "express";

const BODY_LIMIT = 8 * 1024 * 1024;

const app = express();
app.use(express.raw({ type: "*/*", limit: BODY_LIMIT }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/echo-bytes", (req, res) => {
  const body = req.body as Buffer;
  res.json({ received: Buffer.isBuffer(body) ? body.byteLength : 0 });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, "127.0.0.1", () => {
  process.stdout.write(`READY ${port}\n`);
});
