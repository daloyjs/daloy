// 8-HOUR · Exercise 10 — Rate Limits, Body Limits, Timeouts
//
// TODO:
// 1. Tune App-level defaults: bodyLimitBytes (64 KB) + requestTimeoutMs (5s).
// 2. Apply rateLimit globally (60/min) AND a STRICTER per-route limit
//    (5/min) on POST /password-reset.
// 3. Verify each guard produces the right RFC 9457 problem:
//      - 408 Request Timeout when handler exceeds the timeout
//      - 413 Payload Too Large when body exceeds the limit
//      - 429 Too Many Requests when rate limit is hit
//
// Docs: https://daloyjs.dev/docs/security

import { App, rateLimit, requestId, secureHeaders } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { z } from "zod";

const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: { info: { title: "Workshop API", version: "0.1.0" } },
  docs: true,
  // TODO: bodyLimitBytes
  // TODO: requestTimeoutMs
});

app.use(requestId());
app.use(secureHeaders());
// TODO: app.use(rateLimit({ windowMs: 60_000, max: 60 }));

app.get(
  "/slow",
  {
    operationId: "slow",
    tags: ["Demo"],
    responses: { 200: { description: "OK", body: z.object({ ok: z.literal(true) }) } },
  },
  async () => {
    await new Promise((r) => setTimeout(r, 10_000)); // will hit 5s timeout
    return { status: 200 as const, body: { ok: true as const } };
  },
);

app.post(
  "/echo",
  {
    operationId: "echo",
    tags: ["Demo"],
    request: { body: z.object({ blob: z.string() }).strict() },
    responses: { 200: { description: "OK", body: z.object({ length: z.number() }) } },
  },
  async ({ body }) => ({ status: 200 as const, body: { length: body.blob.length } }),
);

// TODO: POST /password-reset with hooks: rateLimit({ windowMs: 60_000, max: 5 }).

serve(app, { port: 3000 });
