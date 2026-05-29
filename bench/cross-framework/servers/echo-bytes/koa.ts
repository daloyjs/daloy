// Koa (@koa/router) — raw-bytes echo server for the body-size sweep.
// POST /echo-bytes accepts application/octet-stream and returns
// { received: N } where N is the body length. The raw Node request stream is
// counted directly to avoid buffering the whole 4 MiB payload in memory.
import Koa from "koa";
import Router from "@koa/router";

const app = new Koa();
const router = new Router();

router.get("/health", (ctx) => {
  ctx.body = { ok: true };
});

router.post("/echo-bytes", async (ctx) => {
  const received = await new Promise<number>((resolve, reject) => {
    let len = 0;
    ctx.req.on("data", (chunk: Buffer) => {
      len += chunk.length;
    });
    ctx.req.on("end", () => resolve(len));
    ctx.req.on("error", reject);
  });
  ctx.body = { received };
});

app.use(router.routes()).use(router.allowedMethods());

const port = Number(process.env.PORT ?? 3000);
app.listen(port, "127.0.0.1", () => {
  process.stdout.write(`READY ${port}\n`);
});
