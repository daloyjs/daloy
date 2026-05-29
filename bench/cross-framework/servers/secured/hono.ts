// Hono parity server for the secured-stack benchmark.
//
// Mirrors the posture of secured/daloy.ts so the comparison is
// apples-to-apples: request-id, secure-headers, CORS allowlist, a
// no-op-cost rate-limit shim, HS256 JWT verification, and zod validation
// of params/body on each route.
import { z } from "zod";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { secureHeaders } from "hono/secure-headers";
import { requestId } from "hono/request-id";
import { cors } from "hono/cors";
import { jwt } from "hono/jwt";

const SECRET = "bench-secret-key-do-not-use-in-prod";

const app = new Hono();

app.use("*", requestId());
app.use("*", secureHeaders());
app.use("*", cors({ origin: ["http://127.0.0.1"], credentials: false }));

// Trivial rate-limit shim with the same per-request bookkeeping shape as
// daloy's rateLimit({ max: 1_000_000, windowMs: 60_000 }) — effectively
// unlimited, but exercises the Map lookup / counter increment so the cost
// is comparable.
const counters = new Map<string, { count: number; reset: number }>();
const WINDOW_MS = 60_000;
const MAX = Number.MAX_SAFE_INTEGER;
app.use("*", async (c, next) => {
  const key = c.req.header("x-forwarded-for") ?? "local";
  const now = Date.now();
  let entry = counters.get(key);
  if (!entry || entry.reset <= now) {
    entry = { count: 0, reset: now + WINDOW_MS };
    counters.set(key, entry);
  }
  entry.count++;
  if (entry.count > MAX) return c.json({ error: "rate limited" }, 429);
  await next();
});

app.use("*", jwt({ secret: SECRET, alg: "HS256" }));

const StaticResp = z.object({ ok: z.boolean() });
const UserParams = z.object({ id: z.string() });
const UserResp = z.object({ id: z.string() });
const EchoBody = z.object({ name: z.string() });
const EchoResp = z.object({ name: z.string() });

app.get("/static", (c) => {
  const body = StaticResp.parse({ ok: true });
  return c.json(body);
});

app.get("/users/:id", (c) => {
  const params = UserParams.parse({ id: c.req.param("id") });
  const body = UserResp.parse({ id: params.id });
  return c.json(body);
});

app.post("/echo", async (c) => {
  const raw = await c.req.json();
  const parsed = EchoBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: "bad body" }, 400);
  const body = EchoResp.parse({ name: parsed.data.name });
  return c.json(body);
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
  process.stdout.write(`READY ${port}\n`);
});
