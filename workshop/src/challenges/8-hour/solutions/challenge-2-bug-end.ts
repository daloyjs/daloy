import {
  App,
  requestId,
  secureHeaders,
  cors,
  rateLimit,
  createJwtVerifier,
  fetchGuard,
  UnauthorizedError,
  BadRequestError,
  type Hooks,
} from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

const JWT_KEY = new TextEncoder().encode("workshop-secret-must-be-at-least-32-bytes");
const ADMIN_TOKEN = "admin";
function eq(a: string, b: string) {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
const verifier = createJwtVerifier({ algorithms: ["HS256"], key: JWT_KEY });
const safeFetch = fetchGuard({ allowProtocols: ["https:"] });

const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: { info: { title: "Workshop API", version: "0.1.0" } },
  docs: true,
  bodyLimitBytes: 64 * 1024,            // ✅ 1: back to a reasonable cap
  requestTimeoutMs: 5_000,
});

app.use(requestId());
app.use(secureHeaders());                // ✅ 2: reinstated
app.use(
  cors({
    origin: ["https://app.example.com", "http://localhost:5173"], // ✅ 3: explicit
    credentials: true,
  }),
);
app.use(rateLimit({ windowMs: 60_000, max: 60 }));

const jwtAuth: Hooks = {
  async beforeHandle(ctx) {
    const header = ctx.request.headers.get("authorization");
    if (!header || !header.startsWith("Bearer ")) {
      throw new UnauthorizedError("Missing bearer token");
    }
    const token = header.slice("Bearer ".length);
    try {
      await verifier.verify(token); // ✅ 4
    } catch {
      throw new UnauthorizedError("Invalid token"); // ✅ 7 (no leak)
    }
  },
};

app.post(
  "/admin/exec",
  {
    operationId: "adminExec",
    tags: ["Admin"],
    hooks: jwtAuth,
    request: { body: z.object({ token: z.string(), command: z.string() }).strict() }, // ✅ 5
    responses: {
      200: { description: "OK", body: z.object({ ok: z.literal(true) }) },
      401: { description: "Unauthorized" },
    },
  },
  async ({ body }) => {
    if (!eq(body.token, ADMIN_TOKEN)) {                                 // ✅ 6
      throw new UnauthorizedError("Unauthorized");
    }
    return { status: 200 as const, body: { ok: true as const } };
  },
);

app.post(
  "/proxy",
  {
    operationId: "proxy",
    tags: ["Demo"],
    request: { body: z.object({ url: z.string().url() }).strict() },
    responses: {
      200: { description: "OK", body: z.object({ status: z.number() }) },
      400: { description: "URL refused" },
    },
  },
  async ({ body }) => {
    try {
      const res = await safeFetch(body.url, { signal: AbortSignal.timeout(5_000) }); // ✅ bonus
      return { status: 200 as const, body: { status: res.status } };
    } catch (e) {
      throw new BadRequestError((e as Error).message);
    }
  },
);

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/docs");
