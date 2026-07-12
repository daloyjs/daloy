// 8-HOUR · Challenge 2 (Bug Hunt) — Security Regression
//
// This file has ~7 security regressions wired in. Your job is to find and fix
// them all. The solution file shows the fixed version; only consult it after
// you've taken at least one pass yourself.
//
// Hints (intentionally vague — don't auto-grep for them):
//   • The JWT verifier was made "more flexible"…
//   • The CORS config has a special case…
//   • Headers used to be sanitized…
//   • One route exposes more than it should in error responses…
//   • The body limit was raised…
//   • One credential comparison is short-circuiting…
//   • An outbound fetch call helps an attacker…
//
// Docs: https://daloyjs.dev/docs/security  ·  https://daloyjs.dev/docs/security/secure-defaults

import { App, requestId, cors, rateLimit, createJwtVerifier, UnauthorizedError, HttpError, type Hooks } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { z } from "zod";

const JWT_KEY = new TextEncoder().encode("workshop-secret-must-be-at-least-32-bytes");
const ADMIN_TOKEN = "admin";

const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: { info: { title: "Workshop API", version: "0.1.0" } },
  docs: true,
  bodyLimitBytes: 50 * 1024 * 1024,                                  // 🐛 1
  requestTimeoutMs: 5_000,
});

app.use(requestId());
// 🐛 2: no secureHeaders middleware at all.
app.use(cors({ origin: () => true, credentials: true }));            // 🐛 3 (reflects ANY origin + credentials)
app.use(rateLimit({ windowMs: 60_000, max: 60 }));

const jwtAuth: Hooks = {
  async beforeHandle(ctx) {
    const header = ctx.request.headers.get("authorization") ?? "";
    const token = header.replace("Bearer ", "");
    try {
      const verifier = createJwtVerifier({ algorithms: ["HS256", "HS384", "HS512"], key: JWT_KEY }); // 🐛 4
      await verifier.verify(token);
    } catch (e) {
      throw new UnauthorizedError((e as Error).message);
    }
  },
};

app.post(
  "/admin/exec",
  {
    operationId: "adminExec",
    tags: ["Admin"],
    hooks: jwtAuth,
    request: { body: z.object({ token: z.string(), command: z.string() }) }, // 🐛 5 (no .strict)
    responses: { 200: { description: "OK", body: z.object({ ok: z.literal(true) }) } },
  },
  async ({ body }) => {
    if (body.token === ADMIN_TOKEN) {                                 // 🐛 6
      return { status: 200 as const, body: { ok: true as const } };
    }
    throw new HttpError(401, {
      type: "about:blank",
      title: "Unauthorized",
      detail: `Bad token ${body.token}; expected ${ADMIN_TOKEN}`,    // 🐛 7
    });
  },
);

app.post(
  "/proxy",
  {
    operationId: "proxy",
    tags: ["Demo"],
    request: { body: z.object({ url: z.string() }).strict() },
    responses: { 200: { description: "OK", body: z.object({ status: z.number() }) } },
  },
  async ({ body }) => {
    const res = await fetch(body.url);                                // 🐛 (bonus) — no SSRF guard
    return { status: 200 as const, body: { status: res.status } };
  },
);

serve(app, { port: 3000 });
