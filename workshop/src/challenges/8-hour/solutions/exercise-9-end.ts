import { App, secureHeaders, cors, ForbiddenError, type Hooks } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: { info: { title: "Workshop API", version: "0.1.0" } },
  docs: true,
});

app.use(
  secureHeaders({
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'"],
        "frame-ancestors": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
      },
    },
  }),
);
app.use(
  cors({
    origin: ["https://app.example.com", "http://localhost:5173"],
    credentials: true,
  }),
);

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((c) => {
      const [k, ...rest] = c.trim().split("=");
      return [k, decodeURIComponent(rest.join("="))];
    }),
  );
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const csrf: Hooks = {
  beforeHandle(ctx) {
    const cookies = parseCookies(ctx.request.headers.get("cookie"));
    const headerToken = ctx.request.headers.get("x-csrf-token");
    if (!cookies.csrf || !headerToken || !safeEqual(cookies.csrf, headerToken)) {
      throw new ForbiddenError("CSRF token missing or mismatched");
    }
  },
};

app.get(
  "/csrf",
  {
    operationId: "issueCsrf",
    tags: ["Auth"],
    responses: { 200: { description: "OK", body: z.object({ token: z.string() }) } },
  },
  async () => {
    const token = randomBytes(32).toString("base64url");
    return {
      status: 200 as const,
      body: { token },
      headers: {
        "set-cookie": `csrf=${token}; Path=/; SameSite=Strict`,
      },
    };
  },
);

app.post(
  "/actions",
  {
    operationId: "doAction",
    tags: ["Auth"],
    hooks: csrf,
    request: { body: z.object({ name: z.string().min(1) }).strict() },
    responses: { 200: { description: "OK", body: z.object({ ok: z.literal(true) }) } },
  },
  async () => ({ status: 200 as const, body: { ok: true as const } }),
);

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/docs");
