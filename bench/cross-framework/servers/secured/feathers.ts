// FeathersJS (Koa transport) — production middleware parity with
// secured/daloy.ts: request-id, helmet, CORS allowlist, rate-limit, HS256 JWT.
// Feathers' Koa transport means the secure stack is the same Koa middleware
// used by secured/koa.ts, layered before the plain routes.
import { feathers } from "@feathersjs/feathers";
import { koa, rest, bodyParser, errorHandler } from "@feathersjs/koa";
import Router from "@koa/router";
import helmet from "koa-helmet";
import cors from "@koa/cors";
import ratelimit from "koa-ratelimit";
import jwt from "koa-jwt";
import { randomUUID } from "node:crypto";

const SECRET = "bench-secret-key-do-not-use-in-prod";

const app = koa(feathers());

app.use(errorHandler());
app.use(async (ctx, next) => {
  ctx.set("x-request-id", randomUUID());
  await next();
});
app.use(helmet());
app.use(cors({ origin: "http://127.0.0.1" }));
app.use(
  ratelimit({
    driver: "memory",
    db: new Map(),
    duration: 60_000,
    max: Number.MAX_SAFE_INTEGER,
    id: (ctx) => ctx.ip,
  }),
);
app.use(jwt({ secret: SECRET, algorithms: ["HS256"] }));
app.use(bodyParser());
app.configure(rest());

const router = new Router();
router.get("/static", (ctx) => {
  ctx.body = { ok: true };
});
router.get("/users/:id", (ctx) => {
  ctx.body = { id: ctx.params.id };
});
router.post("/echo", (ctx) => {
  const name = (ctx.request.body as { name?: unknown } | undefined)?.name;
  if (typeof name !== "string") {
    ctx.status = 400;
    ctx.body = { error: "bad" };
    return;
  }
  ctx.body = { name };
});

app.use(router.routes()).use(router.allowedMethods());

const port = Number(process.env.PORT ?? 3000);
app.listen(port, "127.0.0.1", () => {
  process.stdout.write(`READY ${port}\n`);
});
