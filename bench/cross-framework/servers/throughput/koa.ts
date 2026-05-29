// Koa + @koa/router + koa-bodyparser.
import Koa from "koa";
import Router from "@koa/router";
import bodyParser from "koa-bodyparser";

const app = new Koa();
const router = new Router();

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
