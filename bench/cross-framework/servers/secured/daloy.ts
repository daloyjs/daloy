// DaloyJS — same three endpoints as daloy.ts but with a realistic
// production middleware stack enabled: CORS, secure headers, request-id,
// rate-limit, JWT verification.
//
// The bench client sends a Bearer token signed with the same HS256 key.
// We don't enforce scopes on these routes so the middleware just verifies
// the signature — that's the cost we want to measure.
import { z } from "zod";
import { App, secureHeaders, requestId, cors, rateLimit, createJwtVerifier } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const HS256_KEY = new TextEncoder().encode("bench-secret-key-do-not-use-in-prod");

const app = new App();

app.use(requestId());
app.use(secureHeaders());
// Explicit allowlist — the secure-by-default guard refuses wildcard origins
// in production. Use a realistic single-origin allowlist for the bench.
app.use(cors({ origin: ["http://127.0.0.1"], credentials: false }));
app.use(rateLimit({ max: Number.MAX_SAFE_INTEGER, windowMs: 60_000 })); // effectively unlimited; we want the hook cost, not the deny path

const verifier = createJwtVerifier({
  algorithms: ["HS256"],
  key: HS256_KEY,
});

app.use({
  beforeHandle: async ({ request }) => {
    const auth = request.headers.get("authorization");
    if (!auth?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "missing bearer token" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    try {
      await verifier.verify(auth.slice("Bearer ".length));
    } catch {
      return new Response(JSON.stringify({ error: "invalid token" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
  },
});

app.route({
  method: "GET",
  path: "/static",
  operationId: "getStatic",
  responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) } },
  handler: async () => ({ status: 200, body: { ok: true } }),
});

app.route({
  method: "GET",
  path: "/users/:id",
  operationId: "getUser",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: "ok", body: z.object({ id: z.string() }) } },
  handler: async ({ params }) => ({ status: 200, body: { id: params.id } }),
});

app.route({
  method: "POST",
  path: "/echo",
  operationId: "echo",
  request: { body: z.object({ name: z.string() }) },
  responses: { 200: { description: "ok", body: z.object({ name: z.string() }) } },
  handler: async ({ body }) => ({ status: 200, body: { name: body.name } }),
});

const port = Number(process.env.PORT ?? 3000);
const handle = serve(app, { port, hostname: "127.0.0.1" });
handle.server.once("listening", () => {
  process.stdout.write(`READY ${port}\n`);
});
