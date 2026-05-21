import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  cors,
  csrf,
  session,
  assertStrongSecret,
  MIN_PROD_SECRET_BYTES,
  WEAK_SECRET_STRINGS,
  CORS_WILDCARD_ORIGIN_MARKER,
  CSRF_HOOK_MARKER,
  SESSION_HOOK_MARKER,
  SESSION_SECRETS_MARKER,
} from "../src/index.js";

const STRONG = "a-very-strong-32-byte-test-secret-xyz";

// ---------- assertStrongSecret unit checks ----------

test("assertStrongSecret accepts a 32+ byte non-trivial secret", () => {
  assert.doesNotThrow(() => assertStrongSecret(STRONG, "test"));
});

test("assertStrongSecret rejects non-string", () => {
  assert.throws(() => assertStrongSecret(123 as unknown, "test"), /missing or not a string/);
});

test("assertStrongSecret rejects empty string", () => {
  assert.throws(() => assertStrongSecret("", "test"), /missing or not a string/);
});

test("assertStrongSecret rejects short secret", () => {
  assert.throws(() => assertStrongSecret("too-short", "test"), /too short/);
});

test("assertStrongSecret rejects single-char repeats", () => {
  assert.throws(
    () => assertStrongSecret("a".repeat(64), "test"),
    /single repeated character/,
  );
});

test("assertStrongSecret rejects known-weak strings case-insensitively", () => {
  for (const w of WEAK_SECRET_STRINGS) {
    assert.throws(() => assertStrongSecret(w, "test"), /well-known placeholder/);
    assert.throws(() => assertStrongSecret(w.toUpperCase(), "test"), /well-known placeholder/);
  }
});

test("assertStrongSecret allows non-placeholder secrets that contain weak words", () => {
  const padded = "changeme" + "x".repeat(MIN_PROD_SECRET_BYTES);
  assert.doesNotThrow(() => assertStrongSecret(padded, "test"));
});

test("WEAK_SECRET_STRINGS is non-empty and frozen", () => {
  assert.ok(WEAK_SECRET_STRINGS.length > 0);
  assert.throws(() => (WEAK_SECRET_STRINGS as unknown as string[]).push("x"));
});

// ---------- markers ----------

test("session() stamps SESSION_HOOK_MARKER and SESSION_SECRETS_MARKER", () => {
  const hooks = session({ secret: STRONG }) as unknown as Record<PropertyKey, unknown>;
  assert.equal(hooks[SESSION_HOOK_MARKER], true);
  assert.deepEqual(hooks[SESSION_SECRETS_MARKER], [STRONG]);
});

test("csrf() stamps CSRF_HOOK_MARKER", () => {
  const hooks = csrf({ strategy: "fetch-metadata" }) as unknown as Record<PropertyKey, unknown>;
  assert.equal(hooks[CSRF_HOOK_MARKER], true);
});

test('cors({ origin: "*" }) stamps CORS_WILDCARD_ORIGIN_MARKER', () => {
  const hooks = cors({ origin: "*" }) as unknown as Record<PropertyKey, unknown>;
  assert.equal(hooks[CORS_WILDCARD_ORIGIN_MARKER], true);
});

test("cors({ origin: [...] }) without wildcard does not stamp the marker", () => {
  const hooks = cors({ origin: ["https://a.example"] }) as unknown as Record<PropertyKey, unknown>;
  assert.equal(hooks[CORS_WILDCARD_ORIGIN_MARKER], undefined);
});

test("cors with wildcard inside an array still stamps the marker", () => {
  const hooks = cors({ origin: ["https://a.example", "*"] }) as unknown as Record<
    PropertyKey,
    unknown
  >;
  assert.equal(hooks[CORS_WILDCARD_ORIGIN_MARKER], true);
});

// ---------- App.use sync guards (production-only) ----------

test('App.use(cors({ origin: "*" })) throws in production', () => {
  const app = new App({ logger: false, env: "production" });
  assert.throws(() => app.use(cors({ origin: "*" })), /wildcard CORS origin/);
});

test('App.use(cors({ origin: "*" })) is allowed in development', () => {
  const app = new App({ logger: false, env: "development" });
  assert.doesNotThrow(() => app.use(cors({ origin: "*" })));
});

test('App.use(cors({ origin: "*" })) with secureDefaults: false is allowed in production', () => {
  const app = new App({
    logger: false,
    env: "production",
    secureDefaults: false,
    acknowledgeInsecureDefaults: true,
  });
  assert.doesNotThrow(() => app.use(cors({ origin: "*" })));
});

test('new App({ hooks: cors({ origin: "*" }) }) throws in production', () => {
  assert.throws(
    () => new App({ logger: false, env: "production", hooks: cors({ origin: "*" }) }),
    /wildcard CORS origin/,
  );
});

test('route-level cors({ origin: "*" }) throws in production', () => {
  const app = new App({ logger: false, env: "production" });
  assert.throws(
    () =>
      app.route({
        method: "GET",
        path: "/items",
        operationId: "items",
        hooks: cors({ origin: "*" }),
        responses: { 200: { description: "ok" } },
        handler: () => ({ status: 200 as const, body: undefined }),
      }),
    /wildcard CORS origin/,
  );
});

test('group-level cors({ origin: "*" }) throws in production', () => {
  const app = new App({ logger: false, env: "production" });
  assert.throws(
    () => app.group("/api", { hooks: cors({ origin: "*" }) }, () => undefined),
    /wildcard CORS origin/,
  );
});

test("App.use(session({ secret: weak })) throws in production", () => {
  const app = new App({ logger: false, env: "production" });
  // session() itself enforces a >=16-char minimum at construction, so use a 16+ char weak secret
  // long enough to pass that check but short enough to fail assertStrongSecret's 32-byte gate.
  assert.throws(
    () => app.use(session({ secret: "sixteen-chars-ok" })),
    /too short/,
  );
});

test("group-level session({ secret: weak }) throws in production", () => {
  const app = new App({ logger: false, env: "production" });
  assert.throws(
    () => app.group("/api", { hooks: session({ secret: "sixteen-chars-ok" }) }, () => undefined),
    /too short/,
  );
});

test("App.use(session({ secret: weak })) is allowed in development", () => {
  const app = new App({ logger: false, env: "development" });
  assert.doesNotThrow(() => app.use(session({ secret: "sixteen-chars-ok" })));
});

test("App.use(session({ secret })) with strong secret is allowed in production", () => {
  const app = new App({ logger: false, env: "production" });
  assert.doesNotThrow(() => app.use(session({ secret: STRONG })));
});

test("App.use(session({ secret })) with secureDefaults: false skips the check", () => {
  const app = new App({
    logger: false,
    env: "production",
    secureDefaults: false,
    acknowledgeInsecureDefaults: true,
  });
  assert.doesNotThrow(() => app.use(session({ secret: "sixteen-chars-ok" })));
});

// ---------- Session + state-changing route + missing CSRF deferred guard ----------

function makeStateChangingApp(opts: { env?: "production" | "development" } = {}) {
  const app = new App({ logger: false, env: opts.env ?? "production" });
  app.use(session({ secret: STRONG }));
  app.route({
    method: "POST",
    path: "/items",
    operationId: "create",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });
  return app;
}

test("session + state-changing route without csrf returns 500 in production", async () => {
  const app = makeStateChangingApp();
  const res = await app.request("/items", { method: "POST" });
  assert.equal(res.status, 500);
});

test("group-scoped session + state-changing route without csrf returns 500 in production", async () => {
  const app = new App({ logger: false, env: "production" });
  app.group("/api", { hooks: session({ secret: STRONG }) }, (api) => {
    api.route({
      method: "POST",
      path: "/items",
      operationId: "createGrouped",
      responses: { 200: { description: "ok" } },
      handler: () => ({ status: 200 as const, body: undefined }),
    });
  });
  const res = await app.request("/api/items", { method: "POST" });
  assert.equal(res.status, 500);
});

test("route-scoped session + state-changing route without csrf returns 500 in production", async () => {
  const app = new App({ logger: false, env: "production" });
  app.route({
    method: "POST",
    path: "/items",
    operationId: "createRouteScopedSession",
    hooks: session({ secret: STRONG }),
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/items", { method: "POST" });
  assert.equal(res.status, 500);
});

test("route-scoped csrf satisfies group-scoped session guard", async () => {
  const app = new App({ logger: false, env: "production" });
  app.group("/api", { hooks: session({ secret: STRONG }) }, (api) => {
    api.route({
      method: "POST",
      path: "/items",
      operationId: "createGroupedWithRouteCsrf",
      hooks: csrf({ strategy: "fetch-metadata" }),
      responses: { 200: { description: "ok" } },
      handler: () => ({ status: 200 as const, body: undefined }),
    });
  });
  const res = await app.request("/api/items", {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin" },
  });
  assert.equal(res.status, 200);
});

test("session + state-changing route without csrf is allowed in development", async () => {
  const app = makeStateChangingApp({ env: "development" });
  const res = await app.request("/items", { method: "POST" });
  assert.equal(res.status, 200);
});

test("session + state-changing route with csrf installed is allowed in production", async () => {
  const app = new App({ logger: false, env: "production" });
  app.use(session({ secret: STRONG }));
  app.use(csrf({ strategy: "fetch-metadata" }));
  app.route({
    method: "POST",
    path: "/items",
    operationId: "create",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });
  // Add fetch-metadata friendly header so csrf() itself does not block.
  const res = await app.request("/items", {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin" },
  });
  assert.equal(res.status, 200);
});

test('app({ csrf: "off" }) acknowledges non-browser apps in production', async () => {
  const app = new App({ logger: false, env: "production", csrf: "off" });
  app.use(session({ secret: STRONG }));
  app.route({
    method: "POST",
    path: "/items",
    operationId: "create",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/items", { method: "POST" });
  assert.equal(res.status, 200);
});

test("session-without-csrf boot error is cached and re-thrown on subsequent requests", async () => {
  const app = makeStateChangingApp();
  const r1 = await app.request("/items", { method: "POST" });
  assert.equal(r1.status, 500);
  const r2 = await app.request("/items", { method: "POST" });
  assert.equal(r2.status, 500);
});

test("session-without-csrf guard rechecks when a mutating route is registered after an early request", async () => {
  const app = new App({ logger: false, env: "production" });
  app.use(session({ secret: STRONG }));
  app.route({
    method: "GET",
    path: "/me",
    operationId: "meBeforePost",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });

  const before = await app.request("/me");
  assert.equal(before.status, 200);

  app.route({
    method: "POST",
    path: "/items",
    operationId: "lateCreate",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });
  const after = await app.request("/items", { method: "POST" });
  assert.equal(after.status, 500);
});

test("session-only app without state-changing routes does not trip the guard", async () => {
  const app = new App({ logger: false, env: "production" });
  app.use(session({ secret: STRONG }));
  app.route({
    method: "GET",
    path: "/me",
    operationId: "me",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/me");
  assert.equal(res.status, 200);
});

test("session + state-changing route + secureDefaults:false skips the boot guard", async () => {
  const app = new App({
    logger: false,
    env: "production",
    secureDefaults: false,
    acknowledgeInsecureDefaults: true,
  });
  app.use(session({ secret: STRONG }));
  app.route({
    method: "DELETE",
    path: "/items/:id",
    operationId: "del",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/items/1", { method: "DELETE" });
  assert.equal(res.status, 200);
});

// ---------- trustProxy unconfigured guard ----------

function makeTrustProxyApp(opts: {
  env?: "production" | "development";
  trustProxy?: boolean;
  secureDefaults?: boolean;
  acknowledgeInsecureDefaults?: boolean;
  csrf?: "off";
} = {}) {
  const app = new App({
    logger: false,
    env: opts.env ?? "production",
    ...(opts.trustProxy !== undefined ? { trustProxy: opts.trustProxy } : {}),
    ...(opts.secureDefaults !== undefined ? { secureDefaults: opts.secureDefaults } : {}),
    ...(opts.acknowledgeInsecureDefaults !== undefined
      ? { acknowledgeInsecureDefaults: opts.acknowledgeInsecureDefaults }
      : {}),
    ...(opts.csrf !== undefined ? { csrf: opts.csrf } : {}),
  });
  app.route({
    method: "GET",
    path: "/ip",
    operationId: "ip",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });
  return app;
}

test("request with X-Forwarded-For returns 500 when trustProxy is unset in production", async () => {
  const app = makeTrustProxyApp();
  const res = await app.request("/ip", { headers: { "x-forwarded-for": "1.2.3.4" } });
  assert.equal(res.status, 500);
});

test("request with X-Forwarded-For is allowed in development without trustProxy", async () => {
  const app = makeTrustProxyApp({ env: "development" });
  const res = await app.request("/ip", { headers: { "x-forwarded-for": "1.2.3.4" } });
  assert.equal(res.status, 200);
});

test("request without forwarded headers is allowed even when trustProxy is unset in production", async () => {
  const app = makeTrustProxyApp();
  const res = await app.request("/ip");
  assert.equal(res.status, 200);
});

test("trustProxy: true allows forwarded headers in production", async () => {
  const app = makeTrustProxyApp({ trustProxy: true });
  const res = await app.request("/ip", { headers: { "x-forwarded-for": "1.2.3.4" } });
  assert.equal(res.status, 200);
});

test("trustProxy: false explicitly ignores forwarded headers in production", async () => {
  const app = makeTrustProxyApp({ trustProxy: false });
  const res = await app.request("/ip", { headers: { "x-forwarded-for": "1.2.3.4" } });
  assert.equal(res.status, 200);
});

test("trustProxy unconfigured guard fires for x-real-ip too", async () => {
  const app = makeTrustProxyApp();
  const res = await app.request("/ip", { headers: { "x-real-ip": "5.6.7.8" } });
  assert.equal(res.status, 500);
});

test("trustProxy unconfigured guard fires for x-forwarded-host", async () => {
  const app = makeTrustProxyApp();
  const res = await app.request("/ip", { headers: { "x-forwarded-host": "evil.example" } });
  assert.equal(res.status, 500);
});

test("trustProxy unconfigured guard fires for x-forwarded-proto", async () => {
  const app = makeTrustProxyApp();
  const res = await app.request("/ip", { headers: { "x-forwarded-proto": "https" } });
  assert.equal(res.status, 500);
});

test("trustProxy unconfigured guard fires for x-forwarded-port", async () => {
  const app = makeTrustProxyApp();
  const res = await app.request("/ip", { headers: { "x-forwarded-port": "443" } });
  assert.equal(res.status, 500);
});

test("trustProxy unconfigured guard logs a warn exactly once across many requests", async () => {
  const warns: unknown[] = [];
  const log = {
    level: "info" as const,
    info: () => undefined,
    warn: (obj: unknown) => warns.push(obj),
    error: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
    child: () => log,
  };
  const app = new App({ logger: log, env: "production" });
  app.route({
    method: "GET",
    path: "/ip",
    operationId: "ip",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });
  await app.request("/ip", { headers: { "x-forwarded-for": "1.2.3.4" } });
  await app.request("/ip", { headers: { "x-forwarded-for": "1.2.3.4" } });
  await app.request("/ip", { headers: { "x-forwarded-for": "1.2.3.4" } });
  assert.equal(warns.length, 1);
});

test("trustProxy unconfigured + secureDefaults: false is allowed", async () => {
  const app = makeTrustProxyApp({ secureDefaults: false, acknowledgeInsecureDefaults: true });
  const res = await app.request("/ip", { headers: { "x-forwarded-for": "1.2.3.4" } });
  assert.equal(res.status, 200);
});
