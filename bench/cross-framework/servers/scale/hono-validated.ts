// Hono — N dynamic routes, WITH zod response-body validation.
// Mirrors daloy-scale.ts so the comparison includes the validation cost
// on both sides.
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { z } from "zod";

const app = new Hono();
const COUNT = Number(process.env.ROUTE_COUNT ?? 100);
const schema = z.object({ i: z.number() });

for (let i = 0; i < COUNT; i++) {
  app.get(`/r/${i}`, (c) => {
    const body = schema.parse({ i });
    return c.json(body);
  });
}

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
  process.stdout.write(`READY ${port}\n`);
});
