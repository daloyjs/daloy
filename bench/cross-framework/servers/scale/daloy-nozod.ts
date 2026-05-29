// DaloyJS — N dynamic routes, NO response-body schema (raw 200).
// Mirrors scale/hono.ts so the comparison isolates framework/middleware cost
// from the response-validation cost paid by scale/daloy.ts.
import { App } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

// Parity with scale/hono.ts (Hono has no built-in logger).
const app = new App({ logger: false });
const COUNT = Number(process.env.ROUTE_COUNT ?? 100);

for (let i = 0; i < COUNT; i++) {
  app.route({
    method: "GET",
    path: `/r/${i}`,
    operationId: `r${i}`,
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200, body: { i } }),
  });
}

const port = Number(process.env.PORT ?? 3000);
const handle = serve(app, { port, hostname: "127.0.0.1" });
handle.server.once("listening", () => {
  process.stdout.write(`READY ${port}\n`);
});
