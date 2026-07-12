// 8-HOUR · Exercise 4 — Middleware Plugins & Encapsulation
//
// TODO:
// 1. Write a tiny request-timing middleware that adds `server-timing` header.
// 2. Apply the full production middleware stack on the App, but ONLY apply
//    `bearerAuth` on routes that need it (scoped via `hooks:`).
// 3. Verify the response carries x-request-id, secureHeaders defaults,
//    and the new server-timing header.
//
// Docs: https://daloyjs.dev/docs/security  ·  https://daloyjs.dev/docs/routing

import { App, requestId, secureHeaders, cors, rateLimit, type Hooks } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { z } from "zod";

const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: { info: { title: "Workshop API", version: "0.1.0" } },
  docs: true,
  bodyLimitBytes: 64 * 1024,
  requestTimeoutMs: 5_000,
});

// TODO: const timing: Hooks = { beforeHandle(ctx) { ... }, onSend(res, ctx) { ... } };

app.use(requestId());
app.use(secureHeaders());
// TODO: app.use(timing);
app.use(cors({ origin: "https://app.example.com", credentials: false }));
app.use(rateLimit({ windowMs: 60_000, max: 60 }));

app.get(
  "/health",
  {
    operationId: "getHealth",
    tags: ["Meta"],
    responses: { 200: { description: "OK", body: z.object({ ok: z.literal(true) }) } },
  },
  async () => ({ status: 200 as const, body: { ok: true as const } }),
);

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/health");
