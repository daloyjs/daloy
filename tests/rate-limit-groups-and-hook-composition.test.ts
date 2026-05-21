import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  rateLimit,
  loginThrottle,
  every,
  some,
  except,
  ipRestriction,
  bearerAuth,
  httpBearerScheme,
  _resetSharedRateLimitStoresForTests,
} from "../src/index.js";
import type { Hooks } from "../src/index.js";
import { generateOpenAPI } from "../src/openapi.js";

// ---------- Wave 5: rateLimit({ groupId }) shared bucket ----------

test("rateLimit({ groupId }) shares a single bucket across calls", async () => {
  _resetSharedRateLimitStoresForTests();
  const app = new App({ env: "development" });
  const limit = () => rateLimit({ windowMs: 60_000, max: 2, groupId: "auth" });
  app.route({
    method: "POST",
    path: "/login",
    hooks: limit(),
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  app.route({
    method: "POST",
    path: "/login/otp",
    hooks: limit(),
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const r1 = await app.fetch(new Request("http://x/login", { method: "POST" }));
  assert.equal(r1.status, 200);
  const r2 = await app.fetch(new Request("http://x/login/otp", { method: "POST" }));
  assert.equal(r2.status, 200);
  // Third request should be rate-limited across the shared bucket.
  const r3 = await app.fetch(new Request("http://x/login", { method: "POST" }));
  assert.equal(r3.status, 429);
  assert.ok(r3.headers.get("retry-after"));
});

test("rateLimit() without groupId uses an independent bucket per call", async () => {
  _resetSharedRateLimitStoresForTests();
  const app = new App({ env: "development" });
  app.route({
    method: "GET",
    path: "/a",
    hooks: rateLimit({ windowMs: 60_000, max: 1 }),
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  app.route({
    method: "GET",
    path: "/b",
    hooks: rateLimit({ windowMs: 60_000, max: 1 }),
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  assert.equal((await app.fetch(new Request("http://x/a"))).status, 200);
  assert.equal((await app.fetch(new Request("http://x/b"))).status, 200);
  // Each route has its own bucket — second hit on /a is the one that 429s.
  assert.equal((await app.fetch(new Request("http://x/a"))).status, 429);
});

test("rateLimit({ groupId }) namespaces keys so groups don't collide in a custom store", async () => {
  _resetSharedRateLimitStoresForTests();
  const seen: string[] = [];
  const store = {
    async hit(key: string, _windowMs: number) {
      seen.push(key);
      return { count: 1, resetMs: Date.now() + 60_000 };
    },
  };
  const app = new App({ env: "development" });
  app.route({
    method: "GET",
    path: "/x",
    hooks: rateLimit({ windowMs: 60_000, max: 5, groupId: "g1", store }),
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  await app.fetch(new Request("http://x/x"));
  assert.equal(seen[0], "g1:global");
});

test("loginThrottle() shares one login bucket across related routes", async () => {
  _resetSharedRateLimitStoresForTests();
  const options = {
    windowMs: 60_000,
    max: 2,
    delayAfter: 0,
    delayMs: 1,
    maxDelayMs: 1,
    keyGenerator: () => "alice",
  };
  const app = new App({ env: "development" });
  app.route({
    method: "POST",
    path: "/login",
    hooks: loginThrottle(options),
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  app.route({
    method: "POST",
    path: "/password-reset",
    hooks: loginThrottle(options),
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });

  assert.equal((await app.fetch(new Request("http://x/login", { method: "POST" }))).status, 200);
  assert.equal((await app.fetch(new Request("http://x/password-reset", { method: "POST" }))).status, 200);
  const limited = await app.fetch(new Request("http://x/login", { method: "POST" }));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("x-ratelimit-limit"), "2");
  assert.ok(limited.headers.get("retry-after"));
});

test("loginThrottle() validates its timing options", () => {
  assert.throws(() => loginThrottle({ windowMs: 0 }), /windowMs/);
  assert.throws(() => loginThrottle({ max: 0 }), /max/);
  assert.throws(() => loginThrottle({ delayAfter: -1 }), /delayAfter/);
  assert.throws(() => loginThrottle({ delayMs: -1 }), /delayMs/);
  assert.throws(() => loginThrottle({ maxDelayMs: -1 }), /maxDelayMs/);
});

test("loginThrottle() does not trust proxy IP headers until opted in", async () => {
  _resetSharedRateLimitStoresForTests();
  const app = new App({ env: "development" });
  app.route({
    method: "POST",
    path: "/login",
    hooks: loginThrottle({ windowMs: 60_000, max: 1, delayAfter: 0, delayMs: 0 }),
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });

  assert.equal(
    (await app.fetch(new Request("http://x/login", {
      method: "POST",
      headers: { "x-real-ip": "10.0.0.1" },
    }))).status,
    200,
  );
  assert.equal(
    (await app.fetch(new Request("http://x/login", {
      method: "POST",
      headers: { "x-real-ip": "10.0.0.2" },
    }))).status,
    429,
  );
});

test("loginThrottle() can key by trusted proxy headers", async () => {
  _resetSharedRateLimitStoresForTests();
  const app = new App({ env: "development" });
  app.route({
    method: "POST",
    path: "/login",
    hooks: loginThrottle({
      windowMs: 60_000,
      max: 1,
      delayAfter: 0,
      delayMs: 0,
      trustProxyHeaders: true,
    }),
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });

  assert.equal(
    (await app.fetch(new Request("http://x/login", {
      method: "POST",
      headers: { "x-forwarded-for": "10.0.0.1" },
    }))).status,
    200,
  );
  assert.equal(
    (await app.fetch(new Request("http://x/login", {
      method: "POST",
      headers: { "x-forwarded-for": "10.0.0.2" },
    }))).status,
    200,
  );
});

test("auth schemes can require payload auth and refuse route-level opt-out", () => {
  const app = new App({
    env: "development",
    openapi: {
      securitySchemes: {
        webhook: httpBearerScheme({ requirePayloadAuth: true }),
      },
    },
  });
  assert.throws(
    () =>
      app.route({
        method: "POST",
        path: "/webhook",
        auth: { scheme: "webhook", payload: false },
        responses: { 204: { description: "ok" } },
        handler: () => ({ status: 204 as const, body: undefined }),
      }),
    /requires payload authentication/,
  );
});

test("requirePayloadAuth emits an OpenAPI-safe extension", () => {
  const app = new App({ env: "development" });
  app.route({
    method: "GET",
    path: "/me",
    auth: { scheme: "bearer" },
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const doc = generateOpenAPI(app, {
    info: { title: "t", version: "1" },
    securitySchemes: {
      bearer: { type: "http", scheme: "bearer", requirePayloadAuth: true },
    },
  }) as any;
  const scheme = doc.components.securitySchemes.bearer;
  assert.equal(scheme.requirePayloadAuth, undefined);
  assert.equal(scheme["x-daloy-require-payload-auth"], true);
});

// ---------- Wave 5: combine() primitives ----------

test("every() composes onRequest / beforeHandle / afterHandle / onSend in order", async () => {
  const order: string[] = [];
  const a: Hooks = {
    onRequest: () => {
      order.push("a:req");
    },
    beforeHandle: () => {
      order.push("a:before");
    },
    afterHandle: (_c, v) => {
      order.push("a:after");
      return v;
    },
  };
  const b: Hooks = {
    onRequest: () => {
      order.push("b:req");
    },
    beforeHandle: () => {
      order.push("b:before");
    },
  };
  const app = new App({ env: "development" });
  app.route({
    method: "GET",
    path: "/",
    hooks: every(a, b),
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  await app.fetch(new Request("http://x/"));
  assert.deepEqual(order, ["a:req", "b:req", "a:before", "b:before", "a:after"]);
});

test("every() with no layers is a no-op", async () => {
  const app = new App({ env: "development" });
  app.route({
    method: "GET",
    path: "/",
    hooks: every(),
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  assert.equal((await app.fetch(new Request("http://x/"))).status, 200);
});

test("every() short-circuits beforeHandle on first Response", async () => {
  const app = new App({ env: "development" });
  let bRan = false;
  app.route({
    method: "GET",
    path: "/",
    hooks: every(
      { beforeHandle: () => new Response("stop", { status: 418 }) },
      {
        beforeHandle: () => {
          bRan = true;
        },
      },
    ),
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.fetch(new Request("http://x/"));
  assert.equal(res.status, 418);
  assert.equal(bRan, false);
});

test("some() passes if any beforeHandle succeeds", async () => {
  const app = new App({ env: "development" });
  app.route({
    method: "GET",
    path: "/",
    hooks: some(
      bearerAuth({ validate: () => false }),
      // Always-pass dummy
      { beforeHandle: () => {} },
    ),
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.fetch(new Request("http://x/"));
  assert.equal(res.status, 200);
});

test("some() rethrows the first error when every layer fails", async () => {
  const app = new App({ env: "development" });
  app.route({
    method: "GET",
    path: "/",
    hooks: some(
      bearerAuth({ validate: () => false }),
      {
        beforeHandle: () => {
          throw new Error("nope");
        },
      },
    ),
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.fetch(new Request("http://x/"));
  // First layer (bearerAuth) wins => 401
  assert.equal(res.status, 401);
});

test("some() with no layers is a no-op", async () => {
  const app = new App({ env: "development" });
  app.route({
    method: "GET",
    path: "/",
    hooks: some(),
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  assert.equal((await app.fetch(new Request("http://x/"))).status, 200);
});

test("some() with no beforeHandle layers is still a merge", async () => {
  let ran = 0;
  const app = new App({ env: "development" });
  app.route({
    method: "GET",
    path: "/",
    hooks: some(
      {
        onRequest: () => {
          ran++;
        },
      },
      {
        onRequest: () => {
          ran++;
        },
      },
    ),
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  await app.fetch(new Request("http://x/"));
  assert.equal(ran, 2);
});

test("some() returns a Response denial when no layer passes", async () => {
  const app = new App({ env: "development" });
  app.route({
    method: "GET",
    path: "/",
    hooks: some({ beforeHandle: () => new Response("teapot", { status: 418 }) }),
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  assert.equal((await app.fetch(new Request("http://x/"))).status, 418);
});

test("some() tries next layer when an earlier one returns a Response", async () => {
  const app = new App({ env: "development" });
  let bRan = 0;
  app.route({
    method: "GET",
    path: "/",
    hooks: some(
      { beforeHandle: () => new Response("nope", { status: 401 }) },
      {
        beforeHandle: () => {
          bRan++;
        },
      },
    ),
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.fetch(new Request("http://x/"));
  assert.equal(res.status, 200);
  assert.equal(bRan, 1);
});

test("some() preserves the first Response when every layer denies", async () => {
  const app = new App({ env: "development" });
  app.route({
    method: "GET",
    path: "/",
    hooks: some(
      { beforeHandle: () => new Response("first", { status: 401 }) },
      { beforeHandle: () => new Response("second", { status: 403 }) },
    ),
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.fetch(new Request("http://x/"));
  assert.equal(res.status, 401);
});

test("every() / merge composes onError + onResponse + onSend", async () => {
  const events: string[] = [];
  const app = new App({ env: "development" });
  app.use(
    every(
      {
        onError: () => {
          events.push("a:err");
        },
        onResponse: () => {
          events.push("a:res");
        },
        onSend: (res) => {
          events.push("a:send");
          return res;
        },
      },
      {
        onError: () => {
          events.push("b:err");
        },
        onResponse: () => {
          events.push("b:res");
        },
        onSend: () => {
          events.push("b:send");
          return undefined;
        },
      },
    ),
  );
  app.route({
    method: "GET",
    path: "/ok",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  app.route({
    method: "GET",
    path: "/boom",
    responses: { 200: { description: "ok" } },
    handler: () => {
      throw new Error("kaboom");
    },
  });
  await app.fetch(new Request("http://x/ok"));
  assert.ok(events.includes("a:send"));
  assert.ok(events.includes("b:send"));
  assert.ok(events.includes("a:res"));
  await app.fetch(new Request("http://x/boom"));
  assert.ok(events.includes("a:err"));
  assert.ok(events.includes("b:err"));
});

test("every() onError can short-circuit with a Response", async () => {
  const app = new App({ env: "development" });
  app.use(
    every({
      onError: () => new Response("custom", { status: 599 }),
    }),
  );
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => {
      throw new Error("nope");
    },
  });
  const res = await app.fetch(new Request("http://x/"));
  assert.equal(res.status, 599);
});

test("except() skips beforeHandle for matching paths", async () => {
  const app = new App({ env: "development" });
  app.use(
    except(
      ["/health", "/public/**", "/v1/*/meta"],
      bearerAuth({ validate: () => false }),
    ),
  );
  app.route({
    method: "GET",
    path: "/health",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  app.route({
    method: "GET",
    path: "/public/css/app.css",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  app.route({
    method: "GET",
    path: "/v1/things/meta",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  app.route({
    method: "GET",
    path: "/private",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  assert.equal((await app.fetch(new Request("http://x/health"))).status, 200);
  assert.equal((await app.fetch(new Request("http://x/public/css/app.css"))).status, 200);
  assert.equal((await app.fetch(new Request("http://x/v1/things/meta"))).status, 200);
  assert.equal((await app.fetch(new Request("http://x/private"))).status, 401);
});

test("except() accepts a predicate function", async () => {
  const app = new App({ env: "development" });
  app.use(
    except(
      (ctx) => ctx.request.headers.get("x-skip") === "1",
      bearerAuth({ validate: () => false }),
    ),
  );
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  assert.equal(
    (await app.fetch(new Request("http://x/", { headers: { "x-skip": "1" } }))).status,
    200,
  );
  assert.equal((await app.fetch(new Request("http://x/"))).status, 401);
});

test("except() rejects path patterns that don't start with /", () => {
  assert.throws(
    () => except("health", { beforeHandle: () => {} }),
    /must start with/,
  );
});

test("except() is a no-op when wrapped hooks have no beforeHandle", () => {
  const passthrough: Hooks = { onResponse: () => {} };
  const wrapped = except("/health", passthrough);
  assert.equal(wrapped, passthrough);
});

// ---------- Wave 5: ipRestriction() ----------

test("ipRestriction() allow-list permits matching IPv4 and rejects others", async () => {
  const app = new App({ env: "development", trustProxy: true });
  app.use(
    ipRestriction({
      allow: ["10.0.0.0/8", "192.168.1.42"],
      trustProxyHeaders: true,
    }),
  );
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const ok = await app.fetch(
    new Request("http://x/", { headers: { "x-forwarded-for": "10.1.2.3" } }),
  );
  assert.equal(ok.status, 200);
  const okExact = await app.fetch(
    new Request("http://x/", { headers: { "x-forwarded-for": "192.168.1.42" } }),
  );
  assert.equal(okExact.status, 200);
  const blocked = await app.fetch(
    new Request("http://x/", { headers: { "x-forwarded-for": "203.0.113.5" } }),
  );
  assert.equal(blocked.status, 403);
});

test("ipRestriction() deny-list wins over allow", async () => {
  const app = new App({ env: "development", trustProxy: true });
  app.use(
    ipRestriction({
      allow: ["10.0.0.0/8"],
      deny: ["10.6.6.0/24"],
      trustProxyHeaders: true,
    }),
  );
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  assert.equal(
    (await app.fetch(new Request("http://x/", { headers: { "x-forwarded-for": "10.1.2.3" } }))).status,
    200,
  );
  assert.equal(
    (await app.fetch(new Request("http://x/", { headers: { "x-forwarded-for": "10.6.6.7" } }))).status,
    403,
  );
});

test("ipRestriction() supports IPv6 + IPv4-mapped IPv6", async () => {
  const app = new App({ env: "development", trustProxy: true });
  app.use(ipRestriction({ allow: ["::1", "10.0.0.0/8"], trustProxyHeaders: true }));
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  // ::1 loopback
  assert.equal(
    (await app.fetch(new Request("http://x/", { headers: { "x-forwarded-for": "::1" } }))).status,
    200,
  );
  // IPv4-mapped IPv6 matching the 10/8 IPv4 allow
  assert.equal(
    (await app.fetch(new Request("http://x/", { headers: { "x-forwarded-for": "::ffff:10.0.0.5" } }))).status,
    200,
  );
  // Random IPv6 not on the list
  assert.equal(
    (await app.fetch(new Request("http://x/", { headers: { "x-forwarded-for": "2001:db8::1" } }))).status,
    403,
  );
});

test("ipRestriction() rejects requests with no resolvable IP", async () => {
  const app = new App({ env: "development", trustProxy: true });
  app.use(ipRestriction({ allow: ["10.0.0.0/8"], trustProxyHeaders: true }));
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  assert.equal((await app.fetch(new Request("http://x/"))).status, 403);
});

test("ipRestriction() rejects unparseable IP header content", async () => {
  const app = new App({ env: "development", trustProxy: true });
  app.use(ipRestriction({ allow: ["10.0.0.0/8"], trustProxyHeaders: true }));
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  assert.equal(
    (await app.fetch(new Request("http://x/", { headers: { "x-forwarded-for": "not-an-ip" } }))).status,
    403,
  );
});

test("ipRestriction() accepts a custom resolveIp", async () => {
  const app = new App({ env: "development" });
  app.use(
    ipRestriction({
      allow: ["10.0.0.0/8"],
      resolveIp: (ctx) => ctx.request.headers.get("cf-connecting-ip") ?? undefined,
    }),
  );
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  assert.equal(
    (await app.fetch(new Request("http://x/", { headers: { "cf-connecting-ip": "10.0.0.1" } }))).status,
    200,
  );
  assert.equal(
    (await app.fetch(new Request("http://x/", { headers: { "cf-connecting-ip": "1.2.3.4" } }))).status,
    403,
  );
});

test("ipRestriction() falls back to x-real-ip when x-forwarded-for absent", async () => {
  const app = new App({ env: "development", trustProxy: true });
  app.use(ipRestriction({ allow: ["10.0.0.0/8"], trustProxyHeaders: true }));
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  assert.equal(
    (await app.fetch(new Request("http://x/", { headers: { "x-real-ip": "10.0.0.9" } }))).status,
    200,
  );
});

test("ipRestriction() throws when neither allow nor deny is configured", () => {
  assert.throws(() => ipRestriction({}), /at least one/);
});

test("ipRestriction() throws on invalid IP literal in allow", () => {
  assert.throws(() => ipRestriction({ allow: ["bogus"] }), /invalid IP/);
});

test("ipRestriction() throws on invalid CIDR prefix", () => {
  assert.throws(() => ipRestriction({ allow: ["10.0.0.0/40"] }), /invalid CIDR/);
  assert.throws(() => ipRestriction({ allow: ["10.0.0.0/abc"] }), /invalid CIDR/);
  assert.throws(() => ipRestriction({ allow: ["10.0.0.0/24abc"] }), /invalid CIDR/);
  assert.throws(() => ipRestriction({ allow: ["10.0.0.0/24.5"] }), /invalid CIDR/);
  assert.throws(() => ipRestriction({ allow: ["::1/200"] }), /invalid CIDR/);
});

test("ipRestriction() does not trust proxy headers unless opted in", async () => {
  const app = new App({ env: "development", trustProxy: false });
  app.use(ipRestriction({ allow: ["10.0.0.0/8"] }));
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  assert.equal(
    (await app.fetch(new Request("http://x/", { headers: { "x-forwarded-for": "10.0.0.1" } }))).status,
    403,
  );
});

test("ipRestriction() rejects malformed IPv6", () => {
  assert.throws(() => ipRestriction({ allow: ["2001:::1"] }), /invalid IP/);
  assert.throws(() => ipRestriction({ allow: ["xyzg::1"] }), /invalid IP/);
});

test("ipRestriction() honours custom message", async () => {
  const app = new App({ env: "development", trustProxy: true });
  app.use(
    ipRestriction({
      allow: ["10.0.0.0/8"],
      trustProxyHeaders: true,
      message: "denied",
    }),
  );
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.fetch(
    new Request("http://x/", { headers: { "x-forwarded-for": "1.2.3.4" } }),
  );
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.detail ?? body.title ?? body.message, "denied");
});

// ---------- Wave 5: internal: true + app.inject() ----------

test("internal: true returns 404 via public fetch and works via inject", async () => {
  const app = new App({ env: "development" });
  let ran = 0;
  app.route({
    method: "POST",
    path: "/__admin/reindex",
    internal: true,
    responses: { 204: { description: "started" } },
    handler: () => {
      ran++;
      return { status: 204 as const };
    },
  });
  const publicRes = await app.fetch(
    new Request("http://x/__admin/reindex", { method: "POST" }),
  );
  assert.equal(publicRes.status, 404);
  assert.equal(ran, 0);
  const injectRes = await app.inject(
    new Request("http://x/__admin/reindex", { method: "POST" }),
  );
  assert.equal(injectRes.status, 204);
  assert.equal(ran, 1);
});

test("internal: true does not leak via 405 / Allow header", async () => {
  const app = new App({ env: "development" });
  app.route({
    method: "POST",
    path: "/__admin/reindex",
    internal: true,
    responses: { 204: { description: "started" } },
    handler: () => ({ status: 204 as const }),
  });
  const res = await app.fetch(
    new Request("http://x/__admin/reindex", { method: "DELETE" }),
  );
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("allow"), null);
});

test("inject() runs ordinary public routes normally", async () => {
  const app = new App({ env: "development" });
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.inject(new Request("http://x/"));
  assert.equal(res.status, 200);
});

test("internal: true is excluded from OpenAPI unless explicitly included", () => {
  const app = new App({ env: "development" });
  app.route({
    method: "GET",
    path: "/public",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  app.route({
    method: "POST",
    path: "/__admin/reindex",
    internal: true,
    responses: { 204: { description: "started" } },
    handler: () => ({ status: 204 as const }),
  });
  const publicDoc = generateOpenAPI(app, { info: { title: "Test", version: "1.0.0" } });
  assert.deepEqual(Object.keys(publicDoc.paths as Record<string, unknown>), ["/public"]);
  const internalDoc = generateOpenAPI(app, {
    info: { title: "Test", version: "1.0.0" },
    includeInternal: true,
  });
  assert.ok((internalDoc.paths as Record<string, unknown>)["/__admin/reindex"]);
});
