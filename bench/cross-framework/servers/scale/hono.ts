// Hono — N dynamic routes registered, all hitting the same shape.
// ROUTE_COUNT env var controls how many. Used by route-scale.mjs.
import { Hono } from "hono";
import { serve } from "@hono/node-server";

const app = new Hono();
const COUNT = Number(process.env.ROUTE_COUNT ?? 100);

for (let i = 0; i < COUNT; i++) {
  app.get(`/r/${i}`, (c) => c.json({ i }));
}

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
  process.stdout.write(`READY ${port}\n`);
});
