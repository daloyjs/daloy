// Koa with one structured access log per completed response.
import Koa from "koa";
import Router from "@koa/router";
import bodyParser from "koa-bodyparser";
import { accessLogStart, writeAccessLog } from "./access-log";

const app = new Koa();
const router = new Router();

app.use(async (ctx, next) => {
  const startedAt = accessLogStart();
  try {
    await next();
  } finally {
    writeAccessLog("koa", ctx.method, ctx.path, ctx.status, startedAt);
  }
});

router.get("/static", (ctx) => {
  ctx.body = { ok: true };
});
router.get("/users/:id", (ctx) => {
  ctx.body = { id: ctx.params.id };
});
router.post("/echo", (ctx) => {
  const name = (ctx.request.body as { name?: unknown } | undefined)?.name;
  if (typeof name !== "string") {
    ctx.status = 400;
    ctx.body = { error: "bad" };
    return;
  }
  ctx.body = { name };
});

app.use(bodyParser());
app.use(router.routes()).use(router.allowedMethods());

const port = Number(process.env.PORT ?? 3000);
app.listen(port, "127.0.0.1", () => {
  process.stdout.write(`READY ${port}\n`);
});
