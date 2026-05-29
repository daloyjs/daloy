// Hono on @hono/node-server.
import { Hono } from "hono";
import { serve } from "@hono/node-server";

const app = new Hono();

app.get("/static", (c) => c.json({ ok: true }));
app.get("/users/:id", (c) => c.json({ id: c.req.param("id") }));
app.post("/echo", async (c) => {
  const body = await c.req.json();
  if (typeof body?.name !== "string") return c.json({ error: "bad" }, 400);
  return c.json({ name: body.name });
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => {
  process.stdout.write(`READY ${port}\n`);
});
