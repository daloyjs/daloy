import { App } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { requestId, secureHeaders, cors, rateLimit } from "@daloyjs/core";
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
app.use(cors({ origin: "https://app.example.com", credentials: false }));
app.use(rateLimit({ windowMs: 60_000, max: 60 }));

app.get(
  "/slow",
  {
    operationId: "slow",
    tags: ["Demo"],
    responses: { 200: { description: "Slow OK", body: z.object({ ok: z.literal(true) }) } },
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
    request: { body: z.object({ payload: z.string() }).strict() },
    responses: { 200: { description: "Echoed", body: z.object({ payload: z.string() }) } },
  },
  async ({ body }) => ({ status: 200 as const, body }),
);

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/docs");
