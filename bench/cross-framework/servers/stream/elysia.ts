// Elysia on @elysiajs/node — large streaming response via web ReadableStream.
import { Elysia } from "elysia";
import { node } from "@elysiajs/node";

const CHUNK = new Uint8Array(64 * 1024).fill(0x61);
const TOTAL_CHUNKS = 160;

const port = Number(process.env.PORT ?? 3000);

new Elysia({ adapter: node() })
  .get("/health", () => ({ ok: true }))
  .get("/stream", ({ set }) => {
    let sent = 0;
    set.headers["content-type"] = "application/octet-stream";
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= TOTAL_CHUNKS) {
          controller.close();
          return;
        }
        controller.enqueue(CHUNK);
        sent++;
      },
    });
  })
  .listen({ port, hostname: "127.0.0.1" }, () => {
    process.stdout.write(`READY ${port}\n`);
  });
