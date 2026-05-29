// Hono with one structured access log per completed response.
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { accessLogStart, writeAccessLog } from "./access-log";

const app = new Hono();

app.use("*", async (c, next) => {
  const startedAt = accessLogStart();
  await next();
  writeAccessLog("hono", c.req.method, c.req.path, c.res.status, startedAt);
});

app.get("/static", (c) => c.json({ ok: true }));
app.get("/users/:id", (c) => c.json({ id: c.req.param("id") }));
app.post("/echo", async (c) => {
  const body = await c.req.json();
  if (typeof body?.name !== "string") return c.json({ error: "bad" }, 400);
  return c.json({ name: body.name });
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
  process.stdout.write(`READY ${port}\n`);
});
