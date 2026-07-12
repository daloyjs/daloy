// TODO:
// 1. Wire the standard production middleware stack: requestId, secureHeaders,
//    cors, and rateLimit (60s window, 60 requests).
// 2. Tighten the App config: bodyLimitBytes = 64 KB, requestTimeoutMs = 5_000.
// 3. Verify each guardrail by hand:
//      - large body  → 413 Payload Too Large
//      - slow handler → 408 Request Timeout
//      - >60 requests in 60s → 429 Too Many Requests
//      - response has the secureHeaders defaults + an `x-request-id` header
// 4. Do NOT loosen any default to make a test pass.
//
// Docs: https://daloyjs.dev/docs/security

import { App, NotFoundError } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { z } from "zod";

const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: { info: { title: "Workshop API", version: "0.1.0" } },
  docs: true,
  // TODO: tighten body limit and request timeout
});

// TODO: app.use(requestId());
// TODO: app.use(secureHeaders());
// TODO: app.use(cors({ origin: "https://app.example.com", credentials: false }));
// TODO: app.use(rateLimit({ windowMs: 60_000, max: 60 }));

app.get(
  "/slow",
  {
    operationId: "slow",
    tags: ["Demo"],
    responses: { 200: { description: "Slow OK", body: z.object({ ok: z.literal(true) }) } },
  },
  async () => {
    await new Promise((r) => setTimeout(r, 10_000)); // exceeds requestTimeoutMs once you set it
    return { status: 200 as const, body: { ok: true as const } };
  },
);

app.post(
  "/echo",
  {
    operationId: "echo",
    tags: ["Demo"],
    request: { body: z.object({ payload: z.string() }).strict() },
    responses: { 200: { description: "Echoed", body: z.object({ payload: z.string() }) } },
  },
  async ({ body }) => ({ status: 200 as const, body }),
);

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/docs");
