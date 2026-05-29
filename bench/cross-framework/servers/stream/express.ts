// Express v5 — large streaming response via Node Readable piped to res.
import express from "express";
import { Readable } from "node:stream";

const app = express();

const CHUNK = Buffer.alloc(64 * 1024, 0x61);
const TOTAL_CHUNKS = 160;

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/stream", (_req, res) => {
  let sent = 0;
  const stream = new Readable({
    read() {
      if (sent >= TOTAL_CHUNKS) {
        this.push(null);
        return;
      }
      this.push(CHUNK);
      sent++;
    },
  });
  res.setHeader("content-type", "application/octet-stream");
  stream.pipe(res);
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, "127.0.0.1", () => {
  process.stdout.write(`READY ${port}\n`);
});
