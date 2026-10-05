/**
 * Red-team round 15: configuration values that silently disabled a guard.
 *
 * 1. Numeric App limits set to NaN (`Number(process.env.UNSET)`), Infinity,
 *    negatives or fractions switched the limit off; an explicit `undefined`
 *    erased the default. They are refused at construction now.
 * 2. `rateLimit({ max: NaN })` and friends never limited.
 * 3. `bodyLimitBytes` only covered schema-parsed bodies; a handler reading
 *    `ctx.request` itself received any size.
 * 4. `requestTimeoutMs` only bounded the handler, not hooks or the body read.
 * 5. `cors()` with credentials accepted an allow-everything predicate or "null".
 * 6. `behindProxy.cidrs` / `trustedProxies` accepted a `/0` range.
 * 7. `jwk()` / `createJwtVerifier()` without an audience accepted tokens issued
 *    for any other app, in production.
 * 8. An unrecognized NODE_ENV (`staging`) turned the production refusals off
 *    without a word.
 * 9. Responses that ended a request before cors()'s beforeHandle ran (an auth
 *    401/403 from preBody, a 413/415/422 body error) had no CORS headers, so a
 *    browser reported a "CORS error" instead of an expired token.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import {
  App,
  _resetIndeterminateEnvWarningForTests,
  bearerAuth,
  cors,
  createJwtVerifier,
  except,
  jwk,
  rateLimit,
} from "../src/index.js";

const ok = { 200: { description: "ok" } } as const;

// ---------- 1. numeric App options ----------

test("[options] NaN, Infinity, negative, fractional and string limits are refused", () => {
  for (const name of ["bodyLimitBytes", "requestTimeoutMs", "maxHeaderCount", "jsonMaxKeys", "jsonMaxDepth"]) {
    for (const bad of [Number(undefined), Infinity, -1, 1.5, "1mb"]) {
      assert.throws(
        () => new App({ logger: false, [name]: bad } as never),
        new RegExp(`${name}.*finite, non-negative integer`),
        `${name}=${String(bad)}`,
      );
    }
  }
});

test("[options] explicit undefined uses the default and 0 stays allowed", async () => {
  const app = new App({ logger: false, bodyLimitBytes: undefined, requestTimeoutMs: 0, jsonMaxKeys: 0 });
  assert.equal(app.getSecurityPosture().bodyLimitBytes, 1024 * 1024);
  assert.equal(app.getSecurityPosture().requestTimeoutMs, 0);
});

// ---------- 2. rateLimit ----------

test("[rateLimit] values that would disable the limit are refused", () => {
  for (const [windowMs, max] of [
    [60_000, Number(undefined)],
    [60_000, Infinity],
    [60_000, -1],
    [60_000, 2.5],
    [0, 5],
    [-1, 5],
    [Number(undefined), 5],
  ]) {
    assert.throws(() => rateLimit({ windowMs: windowMs!, max: max! }), /rateLimit\(\)/, `${windowMs}/${max}`);
  }
});

test("[rateLimit] max: 0 is a deliberate refuse-everything limit", async () => {
  const app = new App({ logger: false });
  app.use(rateLimit({ windowMs: 60_000, max: 0 }));
  app.route({ method: "GET", path: "/", responses: ok, handler: () => ({ status: 200 as const, body: {} }) });
  assert.equal((await app.fetch(new Request("http://x/"))).status, 429);
});

// ---------- 3. body limit on every route ----------

function rawApp(read: (request: Request) => Promise<unknown>) {
  const app = new App({ logger: false, bodyLimitBytes: 1024 });
  app.route({
    method: "POST",
    path: "/raw",
    acknowledgeNoResponseBodySchema: true,
    responses: ok,
    handler: async ({ request }: { request: Request }) => {
      const value = await read(request);
      return new Response(JSON.stringify({ size: typeof value === "string" ? value.length : String(value) }));
    },
  } as never);
  return app;
}
const post = (app: App, body: BodyInit, headers: Record<string, string> = {}) =>
  app.fetch(new Request("http://x/raw", { method: "POST", body, headers, duplex: "half" } as RequestInit));
const big = "x".repeat(4096);

test("[body] every way a handler reads the body is capped at bodyLimitBytes", async () => {
  const readers: Array<[string, (r: Request) => Promise<unknown>]> = [
    ["text", (r) => r.text()],
    ["json", (r) => r.json()],
    ["arrayBuffer", (r) => r.arrayBuffer()],
    ["blob", (r) => r.blob()],
    ["clone().text", (r) => r.clone().text()],
    ["body stream", async (r) => new Response(r.body).text()],
  ];
  for (const [label, read] of readers) {
    const res = await post(rawApp(read), JSON.stringify({ pad: big }), { "content-type": "application/json" });
    assert.equal(res.status, 413, label);
  }
});

test("[body] a chunked body with no Content-Length is capped while streaming", async () => {
  const chunks = [new Uint8Array(800), new Uint8Array(800)];
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks.shift();
      if (next) controller.enqueue(next);
      else controller.close();
    },
  });
  assert.equal((await post(rawApp((r) => r.arrayBuffer()), stream)).status, 413);
});

test("[body] bodies within the limit still read normally, including formData", async () => {
  const res = await post(rawApp((r) => r.text()), "hello");
  assert.deepEqual(await res.json(), { size: 5 });
  const form = new FormData();
  form.set("a", "1");
  const app = new App({ logger: false, bodyLimitBytes: 4096 });
  app.route({
    method: "POST",
    path: "/raw",
    acknowledgeNoResponseBodySchema: true,
    responses: ok,
    handler: async ({ request }: { request: Request }) => new Response(String((await request.formData()).get("a"))),
  } as never);
  assert.equal(await (await post(app, form)).text(), "1");
});

test("[body] a route that never reads its body is not refused for it", async () => {
  const app = new App({ logger: false, bodyLimitBytes: 16 });
  app.route({ method: "POST", path: "/raw", responses: ok, handler: () => ({ status: 200 as const, body: {} }) });
  assert.equal((await post(app, big)).status, 200);
});

test("[body] schema routes keep 415 before 413", async () => {
  const app = new App({ logger: false, bodyLimitBytes: 16 });
  app.route({
    method: "POST",
    path: "/raw",
    request: { body: z.object({}).passthrough() },
    responses: ok,
    handler: () => ({ status: 200 as const, body: {} }),
  });
  assert.equal((await post(app, big, { "content-type": "text/plain" })).status, 415);
  assert.equal((await post(app, JSON.stringify({ pad: big }), { "content-type": "application/json" })).status, 413);
});

// ---------- 4. requestTimeoutMs covers hooks and body ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function timedApp(hooks: Record<string, unknown>, handler: () => unknown = () => ({ status: 200 as const, body: {} })) {
  const app = new App({ logger: false, requestTimeoutMs: 100 });
  app.route({ method: "POST", path: "/t", hooks: hooks as never, responses: ok, handler: handler as never });
  return app;
}
const hit = (app: App, init: RequestInit = { method: "POST" }) => app.fetch(new Request("http://x/t", init));

test("[timeout] a slow preBody, beforeHandle or afterHandle hook answers 408", async () => {
  for (const phase of ["preBody", "beforeHandle", "afterHandle"]) {
    const started = Date.now();
    const res = await hit(timedApp({ [phase]: async () => { await sleep(400); } }));
    assert.equal(res.status, 408, phase);
    assert.ok(Date.now() - started < 350, `${phase} took ${Date.now() - started}ms`);
  }
});

test("[timeout] the budget is shared across steps, not per step", async () => {
  const app = timedApp({ preBody: async () => { await sleep(70); } }, async () => {
    await sleep(70);
    return { status: 200 as const, body: {} };
  });
  assert.equal((await hit(app)).status, 408);
});

test("[timeout] a trickled request body is bounded", async () => {
  const app = new App({ logger: false, requestTimeoutMs: 100 });
  app.route({
    method: "POST",
    path: "/t",
    request: { body: z.object({}).passthrough() },
    responses: ok,
    handler: () => ({ status: 200 as const, body: {} }),
  });
  const slow = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await sleep(300);
      controller.enqueue(new TextEncoder().encode("{}"));
      controller.close();
    },
  });
  const res = await hit(app, { method: "POST", body: slow, headers: { "content-type": "application/json" }, duplex: "half" } as RequestInit);
  assert.equal(res.status, 408);
});

test("[timeout] fast requests and requestTimeoutMs: 0 are unaffected", async () => {
  assert.equal((await hit(timedApp({ beforeHandle: async () => { await sleep(10); } }))).status, 200);
  const off = new App({ logger: false, requestTimeoutMs: 0 });
  off.route({ method: "POST", path: "/t", hooks: { beforeHandle: async () => { await sleep(150); } }, responses: ok, handler: () => ({ status: 200 as const, body: {} }) });
  assert.equal((await hit(off)).status, 200);
});

// ---------- 5. CORS ----------

test("[cors] credentials with an allow-everything predicate or 'null' is refused", () => {
  assert.throws(() => cors({ origin: () => true, credentials: true }), /allows any origin/);
  assert.throws(() => cors({ origin: (o) => /.*/.test(o), credentials: true }), /allows any origin/);
  assert.throws(() => cors({ origin: (o) => o === "null", credentials: true }), /allows any origin/);
  assert.throws(() => cors({ origin: ["https://a.test", "null"], credentials: true }), /"null"/);
  assert.throws(() => cors({ origin: "null", credentials: true }), /"null"/);
});

test("[cors] exact credentialed policies and credential-free reflection are accepted", () => {
  cors({ origin: (o) => o === "https://app.test", credentials: true });
  cors({ origin: ["https://app.test"], credentials: true });
  cors({ origin: () => true });
  cors({
    origin: (o) => {
      if (o === "null") throw new Error("unexpected");
      return o.endsWith(".app.test");
    },
    credentials: true,
  });
});

// ---------- 6. /0 proxy ranges ----------

test("[proxy] a /0 range in behindProxy.cidrs or trustedProxies is refused", () => {
  for (const range of ["0.0.0.0/0", "::/0"]) {
    assert.throws(() => new App({ logger: false, behindProxy: { cidrs: [range] } }), /contains every address/, range);
  }
  assert.throws(() => rateLimit({ windowMs: 1000, max: 5, trustedProxies: ["::/0"] }), /contains every address/);
  new App({ logger: false, behindProxy: { cidrs: ["10.0.0.0/8", "fd00::/8"] } });
});

// ---------- 7. JWT audience ----------

const jwks = { keys: [] };

test("[jwt] a production App refuses jwk() without an audience", () => {
  const app = new App({ logger: false, env: "production", behindProxy: "none" });
  assert.throws(() => app.use(jwk({ jwks, algorithms: ["RS256"] })), /no audience is set/);
  assert.throws(
    () => new App({ logger: false, env: "production", behindProxy: "none", hooks: jwk({ jwks, algorithms: ["RS256"] }) }),
    /no audience is set/,
  );
});

test("[jwt] an audience, allowAnyAudience, or a non-production App is accepted", () => {
  new App({ logger: false, env: "production", behindProxy: "none" }).use(jwk({ jwks, algorithms: ["RS256"], audience: "api" }));
  new App({ logger: false, env: "production", behindProxy: "none" }).use(
    jwk({ jwks, algorithms: ["RS256"], allowAnyAudience: true }),
  );
  new App({ logger: false, env: "development" }).use(jwk({ jwks, algorithms: ["RS256"] }));
});

test("[jwt] createJwtVerifier follows its env option and NODE_ENV", () => {
  const key = crypto.getRandomValues(new Uint8Array(32));
  assert.throws(() => createJwtVerifier({ algorithms: ["HS256"], key, env: "production" }), /no audience is set/);
  createJwtVerifier({ algorithms: ["HS256"], key, env: "production", audience: ["api"] });
  createJwtVerifier({ algorithms: ["HS256"], key, env: "development" });
  const saved = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.throws(() => createJwtVerifier({ algorithms: ["HS256"], key }), /no audience is set/);
  } finally {
    if (saved === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved;
  }
});

// ---------- 8. unrecognized NODE_ENV ----------

test("[env] an unrecognized NODE_ENV warns once and logs each skipped refusal", async () => {
  _resetIndeterminateEnvWarningForTests();
  const warns: Array<{ obj: Record<string, unknown>; msg: string }> = [];
  const logger = {
    info: () => {},
    warn: (obj: Record<string, unknown>, msg: string) => warns.push({ obj, msg }),
    error: () => {},
    debug: () => {},
    child: () => logger,
  };
  const saved = process.env.NODE_ENV;
  process.env.NODE_ENV = "staging";
  try {
    const app = new App({ logger: logger as never });
    app.route({ method: "GET", path: "/admin", auth: { scheme: "bearerAuth" }, responses: ok, handler: () => ({ status: 200 as const, body: {} }) });
    new App({ logger: logger as never });
    assert.equal((await app.fetch(new Request("http://x/admin"))).status, 200);
  } finally {
    if (saved === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved;
  }
  const unrecognized = warns.filter((w) => w.obj.event === "env.unrecognized");
  assert.equal(unrecognized.length, 1);
  assert.match(unrecognized[0]!.msg, /NODE_ENV="staging" is not recognized/);
  assert.ok(warns.some((w) => w.obj.guard === "shadow-auth"));
});

test("[env] explicit env silences the unrecognized-NODE_ENV warning", () => {
  _resetIndeterminateEnvWarningForTests();
  const warns: unknown[] = [];
  const saved = process.env.NODE_ENV;
  process.env.NODE_ENV = "staging";
  try {
    new App({ env: "development", logger: { info() {}, warn: (o: unknown) => warns.push(o), error() {}, debug() {}, child() { return this; } } as never });
  } finally {
    if (saved === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved;
  }
  assert.equal(warns.filter((w) => (w as { event?: string }).event === "env.unrecognized").length, 0);
});

// ---------- 9. CORS headers on early rejections ----------
// A browser hides any response without Access-Control-Allow-Origin as a
// generic "CORS error". cors() set its headers in beforeHandle, so an auth
// 401/403 from preBody (jwk/bearerAuth) or a 413/415/422 body error left
// before it, and the client could not tell an expired token from a CORS fault.

const PORTAL = "https://portal.test";

function corsApp(order: "cors-first" | "auth-first") {
  const app = new App({ logger: false, env: "production", behindProxy: "none", bodyLimitBytes: 64 });
  const corsHooks = cors({ origin: [PORTAL], credentials: true, exposedHeaders: ["x-request-id"] });
  const auth = bearerAuth({ validate: (token) => token === "good" });
  if (order === "cors-first") {
    app.use(corsHooks);
    app.use(auth);
  } else {
    app.use(auth);
    app.use(corsHooks);
  }
  app.route({
    method: "POST",
    path: "/ask",
    request: { body: z.object({ q: z.string() }) },
    responses: ok,
    handler: () => ({ status: 200 as const, body: {} }),
  });
  app.route({ method: "GET", path: "/me", responses: ok, handler: () => ({ status: 200 as const, body: {} }) });
  return app;
}

const call = (app: App, path: string, init: RequestInit & { origin?: string | null } = {}) => {
  const headers = new Headers(init.headers);
  if (init.origin !== null) headers.set("origin", init.origin ?? PORTAL);
  return app.fetch(new Request(`https://api.test${path}`, { ...init, headers }));
};

test("[cors] auth rejections carry the CORS policy regardless of hook order", async () => {
  for (const order of ["cors-first", "auth-first"] as const) {
    const app = corsApp(order);
    for (const [label, authorization, status] of [
      ["missing token", undefined, 401],
      ["rejected token", "Bearer expired", 403],
    ] as const) {
      const res = await call(app, "/ask", {
        method: "POST",
        headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
        body: JSON.stringify({ q: "hi" }),
      });
      assert.equal(res.status, status, `${order} ${label}`);
      assert.equal(res.headers.get("access-control-allow-origin"), PORTAL, `${order} ${label}`);
      assert.equal(res.headers.get("access-control-allow-credentials"), "true");
      assert.equal(res.headers.get("access-control-expose-headers"), "x-request-id");
      assert.match(res.headers.get("vary") ?? "", /Origin/);
    }
  }
});

test("[cors] body errors (413, 415, 422) carry the CORS policy", async () => {
  const app = corsApp("cors-first");
  const authed = { authorization: "Bearer good" };
  for (const [status, headers, body] of [
    [413, { ...authed, "content-type": "application/json" }, JSON.stringify({ q: "x".repeat(200) })],
    [415, { ...authed, "content-type": "text/plain" }, "q"],
    [422, { ...authed, "content-type": "application/json" }, "{}"],
  ] as const) {
    const res = await call(app, "/ask", { method: "POST", headers, body });
    assert.equal(res.status, status);
    assert.equal(res.headers.get("access-control-allow-origin"), PORTAL, String(status));
  }
});

test("[cors] a disallowed origin or no Origin still gets no Access-Control-Allow-Origin", async () => {
  const app = corsApp("auth-first");
  const evil = await call(app, "/me", { origin: "https://evil.test" });
  assert.equal(evil.status, 401);
  assert.equal(evil.headers.get("access-control-allow-origin"), null);
  assert.equal(evil.headers.get("access-control-allow-credentials"), null);
  assert.match(evil.headers.get("vary") ?? "", /Origin/, "Vary: Origin keeps caches from mixing origins");
  const noOrigin = await call(app, "/me", { origin: null });
  assert.equal(noOrigin.status, 401);
  assert.equal(noOrigin.headers.get("access-control-allow-origin"), null);
});

test("[cors] preflight is unchanged and needs no credentials", async () => {
  const res = await call(corsApp("auth-first"), "/ask", {
    method: "OPTIONS",
    headers: { "access-control-request-method": "POST", "access-control-request-headers": "authorization" },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), PORTAL);
});

test("[cors] a cors() wrapped in except() stays off the exempted paths", async () => {
  const app = new App({ logger: false, env: "production", behindProxy: "none" });
  app.use(except(["/internal/**"], cors({ origin: [PORTAL] })));
  app.use(bearerAuth({ validate: () => false }));
  for (const path of ["/internal/stats", "/api/stats"] as const) {
    app.route({ method: "GET", path, responses: ok, handler: () => ({ status: 200 as const, body: {} }) });
  }
  assert.equal((await call(app, "/internal/stats")).headers.get("access-control-allow-origin"), null);
  assert.equal((await call(app, "/api/stats")).headers.get("access-control-allow-origin"), PORTAL);
});
