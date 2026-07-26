import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  bearerAuth,
  cors,
  fetchMetadata,
  rateLimit,
  requestId,
  secureHeaders,
  timing,
} from "../src/index.js";

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
      get: (name: string) =>
        name.toLowerCase() === "x-request-id" ? "bad value with spaces" : null,
      forEach: (fn: (value: string, key: string) => void) =>
        fn("bad value with spaces", "x-request-id"),
    },
  });
  const rejected = await app.fetch(rejectedRequest);
  assert.equal(rejected.headers.get("x-request-id"), "gen-1");
});

test("cors rejects disallowed origins and never emits credentials with wildcard unless configured", async () => {
  const app = new App({ logger: false });
  app.use(
    cors({
      origin: (origin) => origin.endsWith(".example.com"),
      credentials: true,
      exposedHeaders: ["x-total"],
    })
  );
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

test("cors emits Vary: Origin even when the origin is rejected (cache poisoning defense)", async () => {
  // Aikido "CORS Security: Beyond Basic Configuration" §6: a shared cache
  // (CDN / reverse proxy) that doesn't vary on Origin can serve a
  // CORS-bearing response generated for an allowed origin to a different,
  // disallowed origin. The framework must therefore set Vary: Origin
  // whenever the response decision *depends on* the Origin header, even
  // when the answer is "no".
  const app = new App({ logger: false, secureDefaults: false });
  app.use(cors({ origin: "https://app.example.com" }));
  app.route({
    method: "GET",
    path: "/v",
    operationId: "v",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  const allowed = await app.request("/v", { headers: { origin: "https://app.example.com" } });
  assert.match(allowed.headers.get("vary") ?? "", /Origin/);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://app.example.com");

  const denied = await app.request("/v", { headers: { origin: "https://evil.test" } });
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  assert.match(denied.headers.get("vary") ?? "", /Origin/);
});

test("cors preflight varies on Origin + Access-Control-Request-* and hides policy from disallowed origins", async () => {
  const app = new App({ logger: false, secureDefaults: false });
  app.use(cors({ origin: "https://app.example.com" }));
  app.route({
    method: "GET",
    path: "/p",
    operationId: "p",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });

  const allowed = await app.request("/p", {
    method: "OPTIONS",
    headers: { origin: "https://app.example.com", "access-control-request-method": "GET" },
  });
  assert.equal(allowed.status, 204);
  const allowedVary = allowed.headers.get("vary") ?? "";
  assert.match(allowedVary, /Origin/);
  assert.match(allowedVary, /Access-Control-Request-Method/);
  assert.match(allowedVary, /Access-Control-Request-Headers/);
  assert.equal(allowed.headers.get("access-control-allow-methods"), "GET, HEAD, POST");

  const denied = await app.request("/p", {
    method: "OPTIONS",
    headers: { origin: "https://evil.test", "access-control-request-method": "GET" },
  });
  assert.equal(denied.status, 204);
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  // Policy disclosure is the unhappy path: a disallowed origin must not
  // see the configured method/header allowlist or the cache TTL.
  assert.equal(denied.headers.get("access-control-allow-methods"), null);
  assert.equal(denied.headers.get("access-control-allow-headers"), null);
  assert.equal(denied.headers.get("access-control-max-age"), null);
  assert.match(denied.headers.get("vary") ?? "", /Origin/);
});

test("cors appends Vary: Origin without clobbering an upstream Vary header", async () => {
  // Regression: previously `set("vary", "Origin")` overwrote any Vary
  // header set by an earlier middleware (e.g. `compression()` writes
  // `Vary: Accept-Encoding`). The result was that compressed responses
  // could be cached without varying on Accept-Encoding, breaking older
  // clients. The append helper must preserve all prior tokens.
  const app = new App({ logger: false, secureDefaults: false });
  app.use({
    beforeHandle(ctx) {
      ctx.set.headers.set("vary", "Accept-Encoding");
      return undefined;
    },
  });
  app.use(cors({ origin: "https://app.example.com" }));
  app.route({
    method: "GET",
    path: "/m",
    operationId: "m",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.request("/m", { headers: { origin: "https://app.example.com" } });
  const vary = res.headers.get("vary") ?? "";
  assert.match(vary, /Accept-Encoding/);
  assert.match(vary, /Origin/);
});

test("cors does not set Vary: Origin when no Origin header is present", async () => {
  // Same-origin requests (no Origin header) must not advertise that the
  // response varies on Origin — otherwise the cache key gets needlessly
  // partitioned and CDN hit rates suffer for plain server-rendered
  // traffic. Only requests where Origin actually drove the decision pay
  // the cache-fragmentation cost.
  const app = new App({ logger: false, secureDefaults: false });
  app.use(cors({ origin: "https://app.example.com" }));
  app.route({
    method: "GET",
    path: "/n",
    operationId: "n",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.request("/n");
  assert.equal(res.headers.get("vary"), null);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("cors throws when origin '*' is combined with credentials: true", () => {
  // Browsers refuse this combination per the CORS spec; failing closed at
  // construction prevents silently broken auth in production.
  assert.throws(
    () => cors({ origin: "*", credentials: true }),
    /origin: "\*" cannot be combined with credentials: true/
  );
  assert.throws(
    () => cors({ origin: ["*", "https://app.example.com"], credentials: true }),
    /origin: "\*" cannot be combined with credentials: true/
  );
  // Wildcard alone is still allowed.
  assert.doesNotThrow(() => cors({ origin: "*" }));
  // Wildcard in array without credentials is still allowed.
  assert.doesNotThrow(() => cors({ origin: ["*"] }));
});

test("rateLimit supports custom stores and can suppress Retry-After", async () => {
  const hits: string[] = [];
  const app = new App({ logger: false });
  app.use(
    rateLimit({
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
    })
  );
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

test("rateLimit ignores spoofable proxy headers unless trustProxyHeaders is enabled", async () => {
  const app = new App({ logger: false });
  app.use(rateLimit({ windowMs: 1000, max: 1 }));
  app.route({
    method: "GET",
    path: "/global-limit",
    operationId: "globalLimit",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });

  const first = await app.request("/global-limit", { headers: { "x-forwarded-for": "1.1.1.1" } });
  const second = await app.request("/global-limit", { headers: { "x-forwarded-for": "2.2.2.2" } });
  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
});

test("secureHeaders respects disabled and overridden options", async () => {
  const app = new App({ logger: false });
  app.use(
    secureHeaders({
      contentSecurityPolicy: "default-src 'none'",
      hsts: false,
      frameOptions: "SAMEORIGIN",
      referrerPolicy: false,
      permissionsPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
      noSniff: false,
      xssProtection: true,
    })
  );
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

test("secureHeaders emits Cross-Origin-Embedder-Policy when opted in (XS-Leaks)", async () => {
  const app = new App({ logger: false });
  app.use(secureHeaders({ crossOriginEmbedderPolicy: "require-corp" }));
  app.route({
    method: "GET",
    path: "/coep",
    operationId: "coep",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });

  const res = await app.request("/coep");
  assert.equal(res.headers.get("cross-origin-embedder-policy"), "require-corp");
});

test("secureHeaders omits Cross-Origin-Embedder-Policy by default", async () => {
  const app = new App({ logger: false });
  app.use(secureHeaders());
  app.route({
    method: "GET",
    path: "/no-coep",
    operationId: "noCoep",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });

  const res = await app.request("/no-coep");
  assert.equal(res.headers.get("cross-origin-embedder-policy"), null);
});

test("fetchMetadata allows same-origin and rejects cross-site no-cors", async () => {
  const app = new App({ logger: false, secureDefaults: false });
  app.use(fetchMetadata());
  app.route({
    method: "GET",
    path: "/api/data",
    operationId: "apiData",
    responses: { 200: { description: "ok" }, 403: { description: "forbidden" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });

  // No Sec-Fetch-* (non-browser) — allowed (other layers handle it).
  const bare = await app.request("/api/data");
  assert.equal(bare.status, 200);

  // Same-origin browser request — allowed.
  const same = await app.request("/api/data", {
    headers: {
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
    },
  });
  assert.equal(same.status, 200);

  // Cross-site no-cors fetch to a non-embed destination — rejected.
  const cross = await app.request("/api/data", {
    headers: {
      "sec-fetch-site": "cross-site",
      "sec-fetch-mode": "no-cors",
      "sec-fetch-dest": "empty",
    },
  });
  assert.equal(cross.status, 403);
});

test("fetchMetadata allows cross-site top-level GET navigation but rejects cross-site POST navigation", async () => {
  const app = new App({ logger: false, secureDefaults: false });
  app.use(fetchMetadata());
  app.route({
    method: "GET",
    path: "/page",
    operationId: "page",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  app.route({
    method: "POST",
    path: "/page",
    operationId: "pagePost",
    responses: { 200: { description: "ok" }, 403: { description: "forbidden" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });

  const nav = await app.request("/page", {
    headers: {
      "sec-fetch-site": "cross-site",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
    },
  });
  assert.equal(nav.status, 200);

  const formPost = await app.request("/page", {
    method: "POST",
    headers: {
      "sec-fetch-site": "cross-site",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
    },
  });
  assert.equal(formPost.status, 403);
});

test("fetchMetadata honors allowedOrigins for cross-site requests", async () => {
  const app = new App({ logger: false, secureDefaults: false });
  app.use(fetchMetadata({ allowedOrigins: ["https://trusted.example"] }));
  app.route({
    method: "GET",
    path: "/api/data",
    operationId: "apiData",
    responses: { 200: { description: "ok" }, 403: { description: "forbidden" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });

  const allowed = await app.request("/api/data", {
    headers: {
      "sec-fetch-site": "cross-site",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
      origin: "https://trusted.example",
    },
  });
  assert.equal(allowed.status, 200);

  const blocked = await app.request("/api/data", {
    headers: {
      "sec-fetch-site": "cross-site",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
      origin: "https://evil.example",
    },
  });
  assert.equal(blocked.status, 403);
});
