import { App } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { z } from "zod";

const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: {
    info: {
      title: "Workshop API",
      version: "0.1.0",
      description:
        "Reference API used by the DaloyJS workshop. Demonstrates contract-first routing, RFC 9457 errors, and secure-by-default middleware.",
    },
    servers: [
      { url: "http://localhost:3000", description: "Local dev" },
      { url: "https://api.example.com", description: "Production" },
    ],
    securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
  },
  docs: true,
});

app.get(
  "/health",
  {
    operationId: "getHealth",
    tags: ["Meta"],
    summary: "Health check",
    description: "Returns `{ ok: true }` when the process is up. Use for liveness probes.",
    responses: { 200: { description: "OK", body: z.object({ ok: z.literal(true) }) } },
  },
  async () => ({ status: 200 as const, body: { ok: true as const } }),
);

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/docs");
