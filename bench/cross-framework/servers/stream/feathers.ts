// FeathersJS (Koa transport) — large streaming response via Node Readable.
import { feathers } from "@feathersjs/feathers";
import { koa, rest, bodyParser, errorHandler } from "@feathersjs/koa";
import Router from "@koa/router";
import { Readable } from "node:stream";

const app = koa(feathers());
app.use(errorHandler());
app.use(bodyParser());
app.configure(rest());

const router = new Router();
const CHUNK = Buffer.alloc(64 * 1024, 0x61);
const TOTAL_CHUNKS = 160;

router.get("/health", (ctx) => {
  ctx.body = { ok: true };
});

router.get("/stream", (ctx) => {
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
  ctx.type = "application/octet-stream";
  ctx.body = stream;
});

app.use(router.routes()).use(router.allowedMethods());

const port = Number(process.env.PORT ?? 3000);
app.listen(port, "127.0.0.1", () => {
  process.stdout.write(`READY ${port}\n`);
});
