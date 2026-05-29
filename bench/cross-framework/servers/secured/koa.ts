// Koa — production middleware parity with secured/daloy.ts:
// request-id, helmet secure headers, CORS allowlist, rate-limit, HS256 JWT.
import Koa from "koa";
import Router from "@koa/router";
import bodyParser from "koa-bodyparser";
import helmet from "koa-helmet";
import cors from "@koa/cors";
import ratelimit from "koa-ratelimit";
import jwt from "koa-jwt";
import { randomUUID } from "node:crypto";

const SECRET = "bench-secret-key-do-not-use-in-prod";

const app = new Koa();
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
