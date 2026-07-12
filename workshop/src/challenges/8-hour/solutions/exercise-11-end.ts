import { App, fetchGuard, UnauthorizedError, BadRequestError } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const SESSION_SECRET = "workshop-do-not-reuse";
const users = new Map([["alice", "wonderland"]]);

const safeFetch = fetchGuard({
  // fetchGuard's defaults already block: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
  // 127.0.0.0/8, 169.254.0.0/16 (link-local + AWS metadata), and IPv6 equivalents.
  // We only need to add per-app policy.
  allowProtocols: ["https:"],
  maxRedirects: 3,
});

function signSession(username: string): string {
  const payload = Buffer.from(JSON.stringify({ sub: username, iat: Date.now() })).toString("base64url");
  const sig = createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifySession(cookie: string | undefined | null): { sub: string } | null {
  if (!cookie) return null;
  const [payload, sig] = cookie.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return null;
  }
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((c) => {
      const [k, ...rest] = c.trim().split("=");
      return [k, decodeURIComponent(rest.join("="))];
    }),
  );
}

const app = new App({
  title: "Workshop API",
  version: "0.1.0",
  openapi: { info: { title: "Workshop API", version: "0.1.0" } },
  docs: true,
});

app.post(
  "/login",
  {
    operationId: "login",
    tags: ["Auth"],
    request: { body: z.object({ username: z.string(), password: z.string() }).strict() },
    responses: { 200: { description: "OK", body: z.object({ ok: z.literal(true) }) }, 401: { description: "Bad credentials" } },
  },
  async ({ body }) => {
    if (users.get(body.username) !== body.password) throw new UnauthorizedError("Bad credentials");
    const token = signSession(body.username);
    return {
      status: 200 as const,
      body: { ok: true as const },
      headers: {
        "set-cookie": `session=${token}; Path=/; HttpOnly; SameSite=Strict; Secure`,
      },
    };
  },
);

app.post(
  "/preview",
  {
    operationId: "previewLink",
    tags: ["Demo"],
    request: { body: z.object({ url: z.string().url() }).strict() },
    responses: {
      200: { description: "OK", body: z.object({ status: z.number(), title: z.string().nullable() }) },
      400: { description: "URL rejected by fetchGuard" },
    },
  },
  async ({ body }) => {
    let res: Response;
    try {
      res = await safeFetch(body.url, { signal: AbortSignal.timeout(5_000) });
    } catch (e) {
      throw new BadRequestError(`Refusing to fetch: ${(e as Error).message}`);
    }
    const text = await res.text();
    const m = text.match(/<title[^>]*>([^<]+)<\/title>/i);
    return { status: 200 as const, body: { status: res.status, title: m?.[1] ?? null } };
  },
);

app.ws("/ws", {
  allowedOrigins: "same-origin",
  beforeUpgrade(request, ctx) {
    const session = parseCookies(request.headers.get("cookie")).session;
    const claims = verifySession(session);
    if (!claims) return new Response("Unauthorized", { status: 401 });
    ctx.state.sub = claims.sub;
    return undefined;
  },
  open(conn, ctx) {
    const sub = typeof ctx.state.sub === "string" ? ctx.state.sub : "member";
    conn.send(`hello ${sub}`);
  },
  message(conn, data) {
    conn.send(`echo: ${typeof data === "string" ? data : "[binary]"}`);
  },
});

serve(app, { port: 3000 });
console.log("→ http://localhost:3000/docs");
console.log("→ ws://localhost:3000/ws  (after POST /login)");
