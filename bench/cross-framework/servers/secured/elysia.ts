// Elysia (@elysiajs/node) — production middleware parity with secured/daloy.ts:
// request-id, secure headers, CORS allowlist, rate-limit shim, HS256 JWT.
import { Elysia, t } from "elysia";
import { node } from "@elysiajs/node";
import { cors } from "@elysiajs/cors";
import { jwt } from "@elysiajs/jwt";
import { randomUUID } from "node:crypto";

const SECRET = "bench-secret-key-do-not-use-in-prod";
const SEC_HEADERS: Record<string, string> = {
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "referrer-policy": "no-referrer",
};

// Effectively-unlimited rate-limit shim with the same per-request bookkeeping
// shape as daloy's rateLimit — exercises the Map lookup / counter increment.
const counters = new Map<string, { count: number; reset: number }>();
const WINDOW_MS = 60_000;
const MAX = Number.MAX_SAFE_INTEGER;
const port = Number(process.env.PORT ?? 3000);

new Elysia({ adapter: node() })
  .use(cors({ origin: ["http://127.0.0.1"], credentials: false }))
  .use(jwt({ name: "jwt", secret: SECRET }))
  .onRequest(({ set, request }) => {
    set.headers["x-request-id"] = randomUUID();
    Object.assign(set.headers, SEC_HEADERS);
    const key = request.headers.get("x-forwarded-for") ?? "local";
    const now = Date.now();
    let entry = counters.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + WINDOW_MS };
      counters.set(key, entry);
    }
    entry.count++;
    if (entry.count > MAX) {
      set.status = 429;
      return { error: "rate limited" };
    }
  })
  .derive(async ({ jwt, request, set }) => {
    const auth = request.headers.get("authorization");
    if (!auth?.startsWith("Bearer ")) {
      set.status = 401;
      return { user: null };
    }
    try {
      const payload = await jwt.verify(auth.slice("Bearer ".length));
      return { user: payload || null };
    } catch {
      set.status = 401;
      return { user: null };
    }
  })
  .get("/static", () => ({ ok: true }))
  .get("/users/:id", ({ params }) => ({ id: params.id }))
  .post("/echo", ({ body }) => ({ name: body.name }), { body: t.Object({ name: t.String() }) })
  .listen({ port, hostname: "127.0.0.1" }, () => {
    process.stdout.write(`READY ${port}\n`);
  });
