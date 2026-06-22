// DaloyJS without zod — a fair like-for-like comparison with Hono, which also
// ships no validator. Used by cold-start, memory-load, and route-scale.
//
// NOTE on POST /echo: with no request body schema, DaloyJS never parses the
// body for you (ctx.body stays undefined), exactly like a schema-less route in
// daloy-bare.ts. So the handler reads the JSON itself via `request.json()`,
// mirroring hono's `await c.req.json()`. Reading `body.name` off the (absent)
// ctx.body instead would throw and turn /echo into an all-error path, which
// would silently corrupt any bench that POSTs to it (memory-load, route-scale).
import { App } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const app = new App();

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
  handler: async ({ params }: { params: Record<string, string> }) =>
    ({ status: 200, body: { id: params.id } }),
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
