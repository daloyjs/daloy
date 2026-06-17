// DaloyJS bare / apple-to-apple variant — strips DaloyJS down to the same
// posture the other bare routers (hono.ts, fastify.ts) run in, so the
// throughput bench isolates router + dispatch cost from DaloyJS's contract
// work and its browser-facing guards.
//
// Two cost axes are removed vs. daloy.ts:
//
//   1. Validation work (Zod). No request param/body schema and no response
//      schema, so the dispatch loop does zero Zod parsing and zero response
//      validation — exactly like hono.ts. Because a schema-less route never
//      reads the body (ctx.body stays undefined), POST /echo parses the JSON
//      itself via `ctx.request.json()`, mirroring hono's `await c.req.json()`.
//
//   2. Browser-facing guards (preset: "internal-service"). This turns off the
//      secureHeaders auto-install, the cross-origin write guard, the CSRF boot
//      guard, and the X-Forwarded-* guard — all of which only matter at a
//      browser / public-internet boundary. hono.ts and fastify.ts set none of
//      them either.
//
// What this does NOT remove: DaloyJS's input/dependency guards that the preset
// explicitly keeps on (request timeout, crash-on-unhandled-rejection, JWT
// allowlist, prototype-pollution-safe parsers, fetchGuard SSRF defaults,
// stripServerHeaders, RFC 9457 prod redaction). Manually reading the body via
// request.json() does bypass the framework's bodyLimitBytes cap for /echo, the
// same way hono's c.req.json() does — fair for a like-for-like router bench.
//
// Compare against daloy.ts (full contract: Zod request + response validation +
// auto secureHeaders) to see the cost of the contract DaloyJS runs by default.
import { App } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const app = new App({ logger: false, preset: "internal-service" });

app.route({
  method: "GET",
  path: "/static",
  operationId: "getStatic",
  responses: { 200: { description: "ok" } },
  handler: async () => ({ status: 200, body: { ok: true } }),
});

app.route({
  method: "GET",
  path: "/users/:id",
  operationId: "getUser",
  responses: { 200: { description: "ok" } },
  handler: async ({ params }: { params: Record<string, string> }) => ({
    status: 200,
    body: { id: params.id },
  }),
});

app.route({
  method: "POST",
  path: "/echo",
  operationId: "echo",
  responses: { 200: { description: "ok" } },
  handler: async ({ request }: { request: Request }) => {
    const body = (await request.json()) as { name: string };
    return { status: 200, body: { name: body.name } };
  },
});

const port = Number(process.env.PORT ?? 3000);
const handle = serve(app, { port, hostname: "127.0.0.1" });
handle.server.once("listening", () => {
  process.stdout.write(`READY ${port}\n`);
});
