/**
 * Netlify adapter: delegates to `app.fetch`, attaches `context.ip` as the
 * peer address (never a spoofable header), flushes telemetry through
 * `context.waitUntil`, and refuses an insecure configuration at cold start.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { App } from "../src/index.js";
import { toNetlifyHandler, type NetlifyContext } from "../src/adapters/netlify.js";
import { getConnInfo, readRemoteAddress } from "../src/conn-info.js";
import { rateLimit } from "../src/middleware.js";

function okApp(opts: ConstructorParameters<typeof App>[0] = {}): App {
  const app = new App({ logger: false, ...opts });
  app.route({
    method: "GET",
    path: "/ok",
    operationId: "ok",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  return app;
}

test("toNetlifyHandler delegates to app.fetch with and without a context", async () => {
  const handler = toNetlifyHandler(okApp());
  const bare = await handler(new Request("http://test.local/ok"));
  assert.equal(bare.status, 200);
  assert.deepEqual(await bare.json(), { ok: true });
  const withCtx = await handler(new Request("http://test.local/ok"), {});
  assert.equal(withCtx.status, 200);
  const missing = await handler(new Request("http://test.local/nope"), { ip: "198.51.100.7" });
  assert.equal(missing.status, 404);
});

test("toNetlifyHandler attaches context.ip as the connection peer, marked TLS", async () => {
  let seen: ReturnType<typeof getConnInfo>;
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/ip",
    operationId: "ip",
    responses: { 200: { description: "ok" } },
    handler: async (ctx) => {
      seen = getConnInfo(ctx.request);
      return { status: 200 as const, body: { ip: readRemoteAddress(ctx) } };
    },
  });
  const res = await toNetlifyHandler(app)(new Request("http://test.local/ip"), { ip: "198.51.100.7" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ip: "198.51.100.7" });
  assert.equal(seen?.remoteAddress, "198.51.100.7");
  assert.equal(seen?.tls, true);
});

test("toNetlifyHandler ignores a context.ip that is not an IP literal and never reads headers for it", async () => {
  const app = new App({ logger: false, env: "test" });
  app.route({
    method: "GET",
    path: "/ip",
    operationId: "ip",
    responses: { 200: { description: "ok" } },
    handler: async (ctx) => ({ status: 200 as const, body: { ip: readRemoteAddress(ctx) ?? null } }),
  });
  const handler = toNetlifyHandler(app);
  for (const bad of ["", "not-an-ip", "999.1.1.1", "1.2.3.4; DROP", 42 as unknown as string]) {
    const res = await handler(
      new Request("http://test.local/ip", { headers: { "x-forwarded-for": "203.0.113.9" } }),
      { ip: bad }
    );
    assert.deepEqual(await res.json(), { ip: null }, `accepted ${JSON.stringify(bad)}`);
  }
});

test("behindProxy: 'none' + context.ip keys rateLimit() per real client (no shared bucket)", async () => {
  const app = new App({ logger: false, env: "test", behindProxy: "none" });
  app.use(rateLimit({ windowMs: 60_000, max: 1 }));
  app.route({
    method: "GET",
    path: "/",
    operationId: "root",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const handler = toNetlifyHandler(app);
  const hit = (ip: string, xff?: string) =>
    handler(new Request("http://test.local/", xff ? { headers: { "x-forwarded-for": xff } } : {}), { ip });
  assert.equal((await hit("198.51.100.1")).status, 200);
  assert.equal((await hit("198.51.100.1")).status, 429);
  assert.equal((await hit("198.51.100.2")).status, 200);
  // A spoofed X-Forwarded-For does not rotate the throttled client's identity.
  assert.equal((await hit("198.51.100.1", "203.0.113.77")).status, 429);
});

test("toNetlifyHandler flushes telemetry through context.waitUntil, bound to the context", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ partialSuccess: {} }), { status: 200 });
  }) as typeof fetch;
  const app = okApp({
    env: "development",
    telemetry: {
      exporter: { endpoint: "http://collector.local:4317", flushIntervalMs: 0, fetch: fetchImpl },
    },
  });
  const waited: Promise<unknown>[] = [];
  let thisArg: unknown;
  const context: NetlifyContext = {
    ip: "198.51.100.7",
    waitUntil(p) {
      thisArg = this;
      waited.push(p);
    },
  };
  const res = await toNetlifyHandler(app)(new Request("http://test.local/ok"), context);
  assert.equal(res.status, 200);
  assert.equal(waited.length, 1);
  assert.equal(thisArg, context);
  await waited[0];
  assert.ok(calls.some((u) => u.endsWith("/v1/metrics")));
});

test("toNetlifyHandler refuses an insecure production configuration at cold start", () => {
  const app = new App({ logger: false, env: "production", behindProxy: "none" });
  // A route that declares bearer auth in its contract but has no auth hook:
  // assertSecureConfig() must throw when the handler is built, not on the
  // first request.
  app.route({
    method: "GET",
    path: "/admin",
    operationId: "admin",
    auth: { scheme: "bearer" },
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  } as never);
  assert.throws(() => toNetlifyHandler(app), /auth/);
});
