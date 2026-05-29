// DaloyJS without zod — for cold-start measurement only. This is a fair
// like-for-like comparison with Hono, which also ships no validator.
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
  handler: async ({ body }: { body: { name: string } }) =>
    ({ status: 200, body: { name: body.name } }),
});

const port = Number(process.env.PORT ?? 3000);
const handle = serve(app, { port, hostname: "127.0.0.1" });
handle.server.once("listening", () => {
  process.stdout.write(`READY ${port}\n`);
});
