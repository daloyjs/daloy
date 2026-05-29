// FeathersJS — Koa transport, plain routes (no service layer) so we benchmark
// transport overhead, not service-CRUD generation.
import { feathers } from "@feathersjs/feathers";
import { koa, rest, bodyParser, errorHandler } from "@feathersjs/koa";
import Router from "@koa/router";

const app = koa(feathers());

app.use(errorHandler());
app.use(bodyParser());
app.configure(rest());

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

app.use(router.routes()).use(router.allowedMethods());

const port = Number(process.env.PORT ?? 3000);
app.listen(port, "127.0.0.1", () => {
  process.stdout.write(`READY ${port}\n`);
});
