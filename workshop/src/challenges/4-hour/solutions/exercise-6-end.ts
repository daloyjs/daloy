import { App } from "@daloyjs/core";
import { z } from "zod";

export function buildApp(): App {
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
      responses: { 200: { description: "OK", body: z.object({ runtime: z.string() }) } },
    },
    async () => ({
      status: 200 as const,
      body: { runtime: detectRuntime() },
    }),
  );

  return app;
}

function detectRuntime(): string {
  // @ts-expect-error Bun-only global
  if (typeof Bun !== "undefined") return "Bun";
  // @ts-expect-error Deno-only global
  if (typeof Deno !== "undefined") return "Deno";
  if (typeof process !== "undefined" && process.versions?.node) return "Node.js";
  return "Unknown";
}

// Entry: pick the adapter at boot. Each runtime imports the same `buildApp()`.
const app = buildApp();

// @ts-expect-error Bun-only global
if (typeof Bun !== "undefined") {
  const { serve } = await import("@daloyjs/core/bun");
  serve(app, { port: 3000 });
  console.log("→ http://localhost:3000/health (Bun)");
} else {
  const { serve } = await import("@daloyjs/core/node");
  serve(app, { port: 3000 });
  console.log("→ http://localhost:3000/health (Node.js)");
}
