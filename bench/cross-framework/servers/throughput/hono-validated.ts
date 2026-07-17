// Hono on @hono/node-server, with the same request and response Zod schemas
// as throughput/daloy.ts.
// This exists so memory-load.mjs (and any other per-request-allocation bench)
// can compare daloy-with-validation against hono-with-validation, instead of
// daloy-with-validation against hono-without. Zod parses allocate result
// objects, issues arrays, and walk the schema tree on every call; counting
// that cost on one side and not the other is the same fairness bug Rounds
// 12/13 fixed for bundle-size and install-size.
//
// Validation is done inline (no @hono/zod-validator dep) so the comparison
// is strictly Zod cost vs Zod cost, not middleware-stack cost vs hand-rolled.
import { z } from "zod";
import { Hono } from "hono";
import { serve } from "@hono/node-server";

const staticSchema = z.object({ ok: z.boolean() });
const paramsSchema = z.object({ id: z.string() });
const userSchema = z.object({ id: z.string() });
const echoSchema = z.object({ name: z.string() });

const app = new Hono();

app.get("/static", (c) => c.json(staticSchema.parse({ ok: true })));

app.get("/users/:id", (c) => {
  const parsed = paramsSchema.safeParse({ id: c.req.param("id") });
  if (!parsed.success) return c.json({ error: "bad" }, 400);
  return c.json(userSchema.parse({ id: parsed.data.id }));
});

app.post("/echo", async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "bad" }, 400);
  }
  const parsed = echoSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: "bad" }, 400);
  return c.json(echoSchema.parse({ name: parsed.data.name }));
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => {
  process.stdout.write(`READY ${port}\n`);
});
