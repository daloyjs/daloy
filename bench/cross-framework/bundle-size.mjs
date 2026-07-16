#!/usr/bin/env node
// Bundle size: produces a minimal "hello world" app per framework, bundles
// it with esbuild for the neutral platform, and reports raw + gzipped size.
// Useful for edge/serverless deployment targets where bundle size dominates
// cold-start time and may hit a platform cap (e.g. 1 MiB on free tiers).
//
// Usage:
//   node bundle-size.mjs
//   node bundle-size.mjs --only=daloy

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import os from "node:os";
import { build } from "esbuild";
import { resultsPath, ROOT, machineInfo, parseArgs, fmt } from "./lib/common.mjs";
import { c, summary, fail, metric, metricsLine } from "./lib/format.mjs";

// Each entry is a minimal source string. Keep them comparable: one route
// each, no extras. We let esbuild resolve from this folder's node_modules.
//
// IMPORTANT — what "minimal" vs "secure parity" means here:
//   - "minimal"        = the framework's hello-world as documented upstream,
//                        with whatever it ships in core (no extra middleware).
//   - "secure parity"  = the same hello-world, plus the middleware needed to
//                        match Daloy's secure-by-default posture: request-id,
//                        secure response headers, CORS allowlist, a rate-limit
//                        hook, and HS256 JWT verification.
// Daloy ships those guards as part of `@daloyjs/core`, so its minimal and
// secure variants are both reported — minimal shows what tree-shakes out
// when you don't `app.use(...)` them; secure shows what lands when you do.
// For frameworks like Hono that don't ship those guards in core, the
// minimal row is the bare router and the secure-parity row is the honest
// edge/serverless number to compare Daloy against.
const FRAMEWORKS = [
  {
    name: "daloy",
    variant: "minimal",
    src: `
import { App } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
const app = new App();
app.route({
  method: "GET", path: "/", operationId: "h",
  responses: { 200: { description: "ok", body: undefined as any } },
  handler: async () => ({ status: 200, body: { ok: true } }),
});
serve(app, { port: 3000 });
`,
  },
  {
    name: "daloy",
    variant: "secure parity",
    src: `
import { App, secureHeaders, requestId, cors, rateLimit, createJwtVerifier } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
const key = new TextEncoder().encode("bench-secret-key-do-not-use-in-prod");
const verifier = createJwtVerifier({ algorithms: ["HS256"], key });
const app = new App();
app.use(requestId());
app.use(secureHeaders());
app.use(cors({ origin: ["http://127.0.0.1"], credentials: false }));
app.use(rateLimit({ max: Number.MAX_SAFE_INTEGER, windowMs: 60_000 }));
app.use({
  beforeHandle: async ({ request }) => {
    const auth = request.headers.get("authorization");
    if (!auth?.startsWith("Bearer ")) {
      return new Response("{}", { status: 401, headers: { "content-type": "application/json" } });
    }
    try { await verifier.verify(auth.slice(7)); } catch {
      return new Response("{}", { status: 401, headers: { "content-type": "application/json" } });
    }
  },
});
app.route({
  method: "GET", path: "/", operationId: "h",
  responses: { 200: { description: "ok", body: undefined as any } },
  handler: async () => ({ status: 200, body: { ok: true } }),
});
serve(app, { port: 3000 });
`,
  },
  {
    name: "hono",
    variant: "minimal",
    src: `
      import { Hono } from "hono";
      import { serve } from "@hono/node-server";
      const app = new Hono();
      app.get("/", (c) => c.json({ ok: true }));
      serve({ fetch: app.fetch, port: 3000 });
    `,
  },
  {
    name: "hono",
    variant: "secure parity",
    src: `
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { secureHeaders } from "hono/secure-headers";
import { requestId } from "hono/request-id";
import { cors } from "hono/cors";
import { jwt } from "hono/jwt";
const app = new Hono();
app.use("*", requestId());
app.use("*", secureHeaders());
app.use("*", cors({ origin: ["http://127.0.0.1"], credentials: false }));
const counters = new Map<string, { count: number; reset: number }>();
const WINDOW_MS = 60_000;
const MAX = Number.MAX_SAFE_INTEGER;
app.use("*", async (c, next) => {
  const key = c.req.header("x-forwarded-for") ?? "local";
  const now = Date.now();
  let entry = counters.get(key);
  if (!entry || entry.reset <= now) { entry = { count: 0, reset: now + WINDOW_MS }; counters.set(key, entry); }
  entry.count++;
  if (entry.count > MAX) return c.json({ error: "rate limited" }, 429);
  await next();
});
app.use("*", jwt({ secret: "bench-secret-key-do-not-use-in-prod", alg: "HS256" }));
app.get("/", (c) => c.json({ ok: true }));
serve({ fetch: app.fetch, port: 3000 });
`,
  },
  {
    name: "fastify",
    variant: "minimal",
    src: `
import Fastify from "fastify";
const app = Fastify({ logger: false });
app.get("/", async () => ({ ok: true }));
app.listen({ port: 3000, host: "127.0.0.1" });
`,
  },
  {
    name: "fastify",
    variant: "secure parity",
    src: `
import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import { randomUUID } from "node:crypto";
const app = Fastify({ logger: false, genReqId: () => randomUUID() });
await app.register(helmet);
await app.register(cors, { origin: ["http://127.0.0.1"] });
await app.register(rateLimit, { max: Number.MAX_SAFE_INTEGER, timeWindow: 60_000 });
await app.register(jwt, { secret: "bench-secret-key-do-not-use-in-prod" });
app.addHook("onRequest", async (req) => { await req.jwtVerify(); });
app.get("/", async () => ({ ok: true }));
await app.listen({ port: 3000, host: "127.0.0.1" });
`,
  },
  {
    name: "express",
    variant: "minimal",
    src: `
import express from "express";
const app = express();
app.get("/", (_, res) => { res.json({ ok: true }); });
app.listen(3000, "127.0.0.1");
`,
  },
  {
    name: "express",
    variant: "secure parity",
    src: `
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
const app = express();
app.use((req, res, next) => {
  const id = (req.headers["x-request-id"] as string | undefined) ?? randomUUID();
  res.setHeader("x-request-id", id);
  next();
});
app.use(helmet());
app.use(cors({ origin: ["http://127.0.0.1"], credentials: false }));
app.use(rateLimit({ max: Number.MAX_SAFE_INTEGER, windowMs: 60_000 }));
app.use((req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({}); return; }
  try { jwt.verify(auth.slice(7), "bench-secret-key-do-not-use-in-prod"); next(); }
  catch { res.status(401).json({}); }
});
app.get("/", (_, res) => { res.json({ ok: true }); });
app.listen(3000, "127.0.0.1");
`,
  },
  {
    name: "koa",
    variant: "minimal",
    src: `
import Koa from "koa";
import Router from "@koa/router";
const app = new Koa();
const router = new Router();
router.get("/", (ctx) => { ctx.body = { ok: true }; });
app.use(router.routes()).use(router.allowedMethods());
app.listen(3000, "127.0.0.1");
`,
  },
  {
    name: "koa",
    variant: "secure parity",
    src: `
import Koa from "koa";
import Router from "@koa/router";
import helmet from "koa-helmet";
import cors from "@koa/cors";
import ratelimit from "koa-ratelimit";
import jwt from "koa-jwt";
import { randomUUID } from "node:crypto";
const app = new Koa();
app.use(async (ctx, next) => { ctx.set("x-request-id", randomUUID()); await next(); });
app.use(helmet());
app.use(cors({ origin: "http://127.0.0.1" }));
app.use(ratelimit({ driver: "memory", db: new Map(), duration: 60_000, max: Number.MAX_SAFE_INTEGER, id: (ctx) => ctx.ip }));
app.use(jwt({ secret: "bench-secret-key-do-not-use-in-prod", algorithms: ["HS256"] }));
const router = new Router();
router.get("/", (ctx) => { ctx.body = { ok: true }; });
app.use(router.routes()).use(router.allowedMethods());
app.listen(3000, "127.0.0.1");
`,
  },
  {
    name: "nest",
    variant: "minimal",
    src: `
import "reflect-metadata";
import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
@Controller()
class AppController {
  @Get("/") root() { return { ok: true }; }
}
@Module({ controllers: [AppController] })
class AppModule {}
async function bootstrap() {
  const adapter = new FastifyAdapter({ logger: false });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, { logger: false });
  await app.listen(3000, "127.0.0.1");
}
bootstrap();
`,
  },
  {
    name: "nest",
    variant: "secure parity",
    src: `
import "reflect-metadata";
import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerModule } from "@nestjs/throttler";
@Controller()
class AppController {
  @Get("/") root() { return { ok: true }; }
}
@Module({
  imports: [
    JwtModule.register({ secret: "bench-secret-key-do-not-use-in-prod", signOptions: { algorithm: "HS256" } }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number.MAX_SAFE_INTEGER }]),
  ],
  controllers: [AppController],
})
class AppModule {}
async function bootstrap() {
  const adapter = new FastifyAdapter({ logger: false });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, { logger: false });
  await app.register(helmet as any);
  await app.register(cors as any, { origin: ["http://127.0.0.1"] });
  await app.register(rateLimit as any, { max: Number.MAX_SAFE_INTEGER, timeWindow: 60_000 });
  await app.listen(3000, "127.0.0.1");
}
bootstrap();
`,
  },
  {
    name: "elysia",
    variant: "minimal",
    src: `
import { Elysia } from "elysia";
import { node } from "@elysiajs/node";
new Elysia({ adapter: node() })
  .get("/", () => ({ ok: true }))
  .listen({ port: 3000, hostname: "127.0.0.1" });
`,
  },
  {
    name: "elysia",
    variant: "secure parity",
    src: `
import { Elysia } from "elysia";
import { node } from "@elysiajs/node";
import { cors } from "@elysiajs/cors";
import { jwt } from "@elysiajs/jwt";
import { randomUUID } from "node:crypto";
const SEC_HEADERS: Record<string, string> = {
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "referrer-policy": "no-referrer",
};
const counters = new Map<string, { count: number; reset: number }>();
const WINDOW_MS = 60_000;
const MAX = Number.MAX_SAFE_INTEGER;
new Elysia({ adapter: node() })
  .use(cors({ origin: ["http://127.0.0.1"], credentials: false }))
  .use(jwt({ name: "jwt", secret: "bench-secret-key-do-not-use-in-prod" }))
  .onRequest(({ set, request }) => {
    set.headers["x-request-id"] = randomUUID();
    Object.assign(set.headers, SEC_HEADERS);
    const key = request.headers.get("x-forwarded-for") ?? "local";
    const now = Date.now();
    let e = counters.get(key);
    if (!e || e.reset <= now) { e = { count: 0, reset: now + WINDOW_MS }; counters.set(key, e); }
    e.count++;
    if (e.count > MAX) { set.status = 429; return { error: "rate limited" }; }
  })
  .derive(async ({ jwt, request, set }) => {
    const auth = request.headers.get("authorization");
    if (!auth?.startsWith("Bearer ")) { set.status = 401; return { user: null }; }
    try { await jwt.verify(auth.slice(7)); return { user: "ok" as const }; }
    catch { set.status = 401; return { user: null }; }
  })
  .get("/", () => ({ ok: true }))
  .listen({ port: 3000, hostname: "127.0.0.1" });
`,
  },
];

const args = parseArgs(process.argv);
const ONLY = args.only ? new Set(args.only.split(",")) : null;

function label(fw) {
  return fw.variant ? `${fw.name} (${fw.variant})` : fw.name;
}

async function bundleOne(fw) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), `bench-bundle-${fw.name}-${(fw.variant ?? "default").replace(/\s+/g, "-")}-`));
  try {
    const entry = path.join(tmp, "entry.ts");
    const outfile = path.join(tmp, "out.mjs");
    writeFileSync(entry, fw.src.trim());
    await build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      minify: true,
      platform: "node",
      format: "esm",
      target: ["es2022"],
      // Bundle everything that isn't a Node built-in. node:* modules ship
      // with the runtime and shouldn't be counted in the framework's size.
      // NestJS dynamically requires several optional peer deps
      // (class-validator, class-transformer, websockets, microservices) that
      // a minimal HTTP app never installs — mark them external so the bundle
      // reflects what actually ships, not a hypothetical maximal install.
      external: [
        "node:*",
        "class-validator",
        "class-transformer",
        "@nestjs/websockets/socket-module",
        "@nestjs/microservices",
        "@nestjs/microservices/microservices-module",
        "@nestjs/platform-express",
        "@fastify/view",
        "@fastify/static",
        "@fastify/secure-session",
      ],
      logLevel: "silent",
      nodePaths: [path.join(ROOT, "node_modules")],
      absWorkingDir: ROOT,
    });
    const bytes = readFileSync(outfile);
    return {
      raw: bytes.length,
      gzipped: gzipSync(bytes, { level: 9 }).length,
    };
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

async function main() {
  const targets = FRAMEWORKS.filter((f) => !ONLY || ONLY.has(f.name));
  const rows = [];
  for (const fw of targets) {
    try {
      const r = await bundleOne(fw);
      rows.push({ framework: fw.name, variant: fw.variant ?? null, ...r });
      console.error(metricsLine(label(fw), [
        metric("raw", (r.raw / 1024).toFixed(1), { unit: " KiB" }),
        metric("gz", (r.gzipped / 1024).toFixed(1), { unit: " KiB", color: c.cyan }),
      ], { labelWidth: 24 }));
    } catch (err) {
      console.error("  " + fail(`${label(fw)}: ${err.message}`));
      rows.push({ framework: fw.name, variant: fw.variant ?? null, error: err.message });
    }
  }

  const tableRows = [];
  for (const r of rows) {
    if (!r.raw) continue;
    const name = r.variant ? `${r.framework} (${r.variant})` : r.framework;
    tableRows.push([name, fmt(r.raw / 1024), fmt(r.gzipped / 1024)]);
  }
  const notes = [
    "",
    "Notes:",
    "  - \"minimal\"       = framework's documented hello-world (bare router).",
    "  - \"secure parity\" = same hello-world + request-id, secure headers,",
    "                       CORS allowlist, rate-limit hook, HS256 JWT verify.",
    "    Daloy ships those guards in core; every other framework here requires",
    "    opt-in middleware (helmet/secure-headers, cors, a rate limiter, JWT).",
    "    For an apples-to-apples edge/serverless number, compare the secure-parity",
    "    rows to each other. The minimal rows are router-only baselines and are",
    "    NOT production-ready bundles.",
    "  - NestJS optional peer deps (class-validator, class-transformer, websockets,",
    "    microservices, platform-express) are marked external — they aren't installed",
    "    by a minimal nest app and shouldn't be counted in its bundle.",
  ];
  console.log("\n" + summary({
    head: ["Framework", "raw (KiB)", "gzipped (KiB)"],
    rows: tableRows,
    highlight: (row) => row[0].includes("daloy"),
  }) + "\n" + c.dim(notes.join("\n")) + "\n");

  writeFileSync(
    resultsPath("results.bundle-size.json"),
    JSON.stringify({ ranAt: new Date().toISOString(), machine: machineInfo(), rows }, null, 2),
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
