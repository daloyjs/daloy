// Elysia (@elysiajs/node) — route-scale harness: registers ROUTE_COUNT routes.
import { Elysia } from "elysia";
import { node } from "@elysiajs/node";

const app = new Elysia({ adapter: node() });
const COUNT = Number(process.env.ROUTE_COUNT ?? 100);
for (let i = 0; i < COUNT; i++) {
  app.get(`/r/${i}`, () => ({ i }));
}

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, hostname: "127.0.0.1" }, () => {
  process.stdout.write(`READY ${port}\n`);
});
