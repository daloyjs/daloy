import { test } from "node:test";
import assert from "node:assert/strict";
import { App, bearerAuth, cors, rateLimit, requestId, secureHeaders, timing } from "../src/index.js";

test("requestId can trust a valid incoming id and rejects invalid incoming ids", async () => {
  const app = new App({ logger: false });
  let generated = 0;
  app.use(requestId({ trustIncoming: true, generator: () => `gen-${++generated}` }));
  app.route({
    method: "GET",
    path: "/id",
    operationId: "id",
    responses: { 200: { description: "ok" } },
    handler: async ({ state }) => ({ status: 200 as const, body: { requestId: state.requestId } }),
  });

  const trusted = await app.request("/id", { headers: { "x-request-id": "abc_123-OK" } });
  assert.equal(trusted.headers.get("x-request-id"), "abc_123-OK");
  assert.deepEqual(await trusted.json(), { requestId: "abc_123-OK" });

  const rejectedRequest = new Request("http://test.local/id");
  Object.defineProperty(rejectedRequest, "headers", {
    value: {
      get: (name: string) => (name.toLowerCase() === "x-request-id" ? "bad value with spaces" : null),
      forEach: (fn: (value: string, key: string) => void) => fn("bad value with spaces", "x-request-id"),
    },
  });
  const rejected = await app.fetch(rejectedRequest);
  assert.equal(rejected.headers.get("x-request-id"), "gen-1");
});

test("cors rejects disallowed origins and never emits credentials with wildcard unless configured", async () => {
  const app = new App({ logger: false });
  app.use(cors({ origin: (origin) => origin.endsWith(".example.com"), credentials: true, exposedHeaders: ["x-total"] }));
  app.route({
    method: "GET",
    path: "/cors",
    operationId: "cors",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  const allowed = await app.request("/cors", { headers: { origin: "https://app.example.com" } });
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://app.example.com");
  assert.equal(allowed.headers.get("access-control-allow-credentials"), "true");
  assert.equal(allowed.headers.get("access-control-expose-headers"), "x-total");

  const denied = await app.request("/cors", { headers: { origin: "https://evil.test" } });
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
});

test("rateLimit supports custom stores and can suppress Retry-After", async () => {
  const hits: string[] = [];
  const app = new App({ logger: false });
  app.use(rateLimit({
    windowMs: 1000,
    max: 0,
    retryAfter: false,
    keyGenerator: () => "custom-key",
    store: {
      async hit(key, windowMs) {
        hits.push(`${key}:${windowMs}`);
        return { count: 1, resetMs: Date.now() + windowMs };
      },
    },
  }));
  app.route({
    method: "GET",
    path: "/limited",
    operationId: "limited",
    responses: { 200: { description: "ok" }, 429: { description: "limited" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });

  const res = await app.request("/limited");
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("retry-after"), null);
  assert.deepEqual(hits, ["custom-key:1000"]);
});

test("secureHeaders respects disabled and overridden options", async () => {
  const app = new App({ logger: false });
  app.use(secureHeaders({
    contentSecurityPolicy: "default-src 'none'",
    hsts: false,
    frameOptions: "SAMEORIGIN",
    referrerPolicy: false,
    permissionsPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
    noSniff: false,
    xssProtection: true,
  }));
  app.route({
    method: "GET",
    path: "/headers",
    operationId: "headers",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });

  const res = await app.request("/headers");
  assert.equal(res.headers.get("content-security-policy"), "default-src 'none'");
  assert.equal(res.headers.get("strict-transport-security"), null);
  assert.equal(res.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(res.headers.get("referrer-policy"), null);
  assert.equal(res.headers.get("x-content-type-options"), null);
  assert.equal(res.headers.get("x-xss-protection"), "0");
});

test("timing middleware adds server-timing header", async () => {
  const app = new App({ logger: false });
  app.use(timing());
  app.route({
    method: "GET",
    path: "/timed",
    operationId: "timed",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });

  const res = await app.request("/timed");
  assert.match(res.headers.get("server-timing") ?? "", /^app;dur=\d+\.\d{2}$/);
});

test("bearerAuth rejects invalid tokens with 403", async () => {
  const app = new App({ logger: false });
  app.use(bearerAuth({ validate: (token) => token === "good", realm: "tests" }));
  app.route({
    method: "GET",
    path: "/protected",
    operationId: "protected",
    responses: { 200: { description: "ok" }, 403: { description: "forbidden" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });

  const res = await app.request("/protected", { headers: { authorization: "Bearer bad" } });
  assert.equal(res.status, 403);
});
