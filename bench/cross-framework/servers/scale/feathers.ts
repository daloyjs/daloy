// FeathersJS (Koa transport) — route-scale harness: registers ROUTE_COUNT routes.
import { feathers } from "@feathersjs/feathers";
import { koa, rest, errorHandler } from "@feathersjs/koa";
import Router from "@koa/router";

const app = koa(feathers());
app.use(errorHandler());
app.configure(rest());

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
