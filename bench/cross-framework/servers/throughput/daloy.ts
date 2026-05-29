// DaloyJS — uses @daloyjs/core via the file:../.. devDep.
import { z } from "zod";
import { App } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

// Parity with Hono's bench server, which has no built-in logger.
const app = new App({ logger: false });

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
