// DaloyJS with one structured access log per completed response.
import { z } from "zod";
import { App } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { accessLogStart, writeAccessLog } from "./access-log";

const app = new App({ logger: false });

app.use({
  beforeHandle: (ctx) => {
    ctx.state.accessLogStartedAt = accessLogStart();
  },
  onSend: (res, ctx) => {
    writeAccessLog(
      "daloy",
      ctx?.request.method ?? "UNKNOWN",
      ctx?.request.url ?? "",
      res.status,
      Number(ctx?.state.accessLogStartedAt) || accessLogStart()
    );
  },
});

app.route({
  method: "GET",
  path: "/static",
  operationId: "getStatic",
  responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) } },
  handler: () => ({ status: 200, body: { ok: true } }),
});

app.route({
  method: "GET",
  path: "/users/:id",
  operationId: "getUser",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: "ok", body: z.object({ id: z.string() }) } },
  handler: ({ params }) => ({ status: 200, body: { id: params.id } }),
});

app.route({
  method: "POST",
  path: "/echo",
  operationId: "echo",
  request: { body: z.object({ name: z.string() }) },
  responses: { 200: { description: "ok", body: z.object({ name: z.string() }) } },
  handler: ({ body }) => ({ status: 200, body: { name: body.name } }),
});

const port = Number(process.env.PORT ?? 3000);
const handle = serve(app, { port, hostname: "127.0.0.1" });
handle.server.once("listening", () => {
  process.stdout.write(`READY ${port}\n`);
});
