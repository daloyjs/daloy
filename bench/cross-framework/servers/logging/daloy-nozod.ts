// DaloyJS without zod, with one structured access log per completed response.
// Pairs with servers/logging/daloy.ts (which validates with Zod) so the
// logging suite can separate "framework + access-log" cost from "Zod
// validation" cost — the same fairness split daloy-nozod provides elsewhere.
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
      "daloy-nozod",
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
  responses: { 200: { description: "ok" } },
  handler: () => ({ status: 200, body: { ok: true } }),
});

app.route({
  method: "GET",
  path: "/users/:id",
  operationId: "getUser",
  responses: { 200: { description: "ok" } },
  handler: ({ params }: { params: Record<string, string> }) => ({
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
