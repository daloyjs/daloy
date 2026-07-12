// 8-HOUR · Exercise 7 — OpenAPI Auto-Docs & Tuning
//
// TODO:
// 1. Populate the full `openapi.info` block (description, contact, license).
// 2. Add `servers`, `tags` (with descriptions), and `externalDocs`.
// 3. Expose /openapi.yaml in addition to /openapi.json (if your project needs YAML).
// 4. Confirm /docs shows the branded title, tag descriptions, and contact.
//
// Docs: https://daloyjs.dev/docs/openapi

import { App } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { z } from "zod";

const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  // TODO: rich openapi block
  openapi: { info: { title: "Workshop API", version: "0.1.0" } },
  docs: true,
});

app.get(
  "/health",
  {
    operationId: "getHealth",
    tags: ["Meta"],
    summary: "Health check",
    responses: { 200: { description: "OK", body: z.object({ ok: z.literal(true) }) } },
  },
  async () => ({ status: 200 as const, body: { ok: true as const } }),
);

serve(app, { port: 3000 });
