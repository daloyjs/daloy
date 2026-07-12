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

const timing: Hooks = {
  beforeHandle(ctx) {
    ctx.state.startedAt = performance.now();
  },
  onSend(res, ctx) {
    const startedAt = ctx?.state.startedAt;
    if (typeof startedAt === "number") {
      const ms = (performance.now() - startedAt).toFixed(1);
      res.headers.set("server-timing", `total;dur=${ms}`);
    }
  },
};

app.use(requestId());
app.use(secureHeaders());
app.use(timing);
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
