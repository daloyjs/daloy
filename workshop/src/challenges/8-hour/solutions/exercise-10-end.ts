import { App, rateLimit, requestId, secureHeaders } from "@daloyjs/core";
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

app.use(requestId());
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 60 }));

app.get(
  "/slow",
  {
    operationId: "slow",
    tags: ["Demo"],
    responses: { 200: { description: "OK", body: z.object({ ok: z.literal(true) }) } },
  },
  async () => {
    await new Promise((r) => setTimeout(r, 10_000));
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

app.post(
  "/password-reset",
  {
    operationId: "passwordReset",
    tags: ["Auth"],
    hooks: rateLimit({ windowMs: 60_000, max: 5 }),
    request: { body: z.object({ email: z.string().email() }).strict() },
    responses: {
      202: { description: "If the email exists, a reset link was sent." },
      429: { description: "Too many requests" },
    },
  },
  async () => ({ status: 202 as const, body: undefined }),
);

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/docs");
