// Koa (@koa/router) — route-scale harness: registers ROUTE_COUNT distinct routes.
import Koa from "koa";
import Router from "@koa/router";

const app = new Koa();
const router = new Router();
const COUNT = Number(process.env.ROUTE_COUNT ?? 100);
for (let i = 0; i < COUNT; i++) {
  router.get(`/r/${i}`, (ctx) => {
    ctx.body = { i };
  });
}
app.use(router.routes()).use(router.allowedMethods());

const port = Number(process.env.PORT ?? 3000);
app.listen(port, "127.0.0.1", () => {
  process.stdout.write(`READY ${port}\n`);
});
