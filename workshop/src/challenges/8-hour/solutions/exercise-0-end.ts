import { App } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { z } from "zod";

const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: { info: { title: "Workshop API", version: "0.1.0" } },
  docs: true,
});

app.get(
  "/health",
  {
    operationId: "getHealth",
    tags: ["Meta"],
    responses: {
      200: { description: "OK", body: z.object({ status: z.literal("ok") }) },
    },
  },
  async () => ({ status: 200 as const, body: { status: "ok" as const } }),
);

console.log("Registered routes:");
for (const op of app.introspect()) {
  console.log(`  ${op.method.padEnd(6)} ${op.path}  (operationId=${op.operationId})`);
}

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/health");
console.log("→ http://localhost:3000/docs");
