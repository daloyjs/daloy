// Fastify — large streaming response via Node Readable.
import Fastify from "fastify";
import { Readable } from "node:stream";

const app = Fastify({ logger: false });

const CHUNK = Buffer.alloc(64 * 1024, 0x61);
const TOTAL_CHUNKS = 160;

app.get("/health", async () => ({ ok: true }));

app.get("/stream", async (_req, reply) => {
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
  reply.header("content-type", "application/octet-stream");
  return reply.send(stream);
});

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: "127.0.0.1" }).then(() => {
  process.stdout.write(`READY ${port}\n`);
});
