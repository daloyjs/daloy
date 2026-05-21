import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  App,
  cors,
  secureHeaders,
  CORS_HOOK_MARKER,
  CORS_ORIGIN_ALLOW_MARKER,
  SECURE_HEADERS_MARKER,
} from "../src/index.js";

// ---------- Auto-applied secureHeaders ----------

test("App auto-applies secureHeaders by default", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/hi",
    operationId: "hi",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/hi");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.ok(res.headers.get("strict-transport-security"));
  assert.ok(res.headers.get("content-security-policy"));
});

test("App({ secureDefaults: false }) skips auto secureHeaders", async () => {
  const app = new App({ logger: false, secureDefaults: false });
  app.route({
    method: "GET",
    path: "/hi",
    operationId: "hi",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/hi");
  assert.equal(res.headers.get("x-frame-options"), null);
  assert.equal(res.headers.get("strict-transport-security"), null);
});

test("App({ secureHeaders: false }) skips auto secureHeaders only", async () => {
  const app = new App({ logger: false, secureHeaders: false });
  app.route({
    method: "GET",
    path: "/hi",
    operationId: "hi",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/hi");
  assert.equal(res.headers.get("x-frame-options"), null);
});

test("App({ secureHeaders: { ... } }) overrides defaults of auto-installed", async () => {
  const app = new App({
    logger: false,
    secureHeaders: { frameOptions: "SAMEORIGIN" },
  });
  app.route({
    method: "GET",
    path: "/hi",
    operationId: "hi",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/hi");
  assert.equal(res.headers.get("x-frame-options"), "SAMEORIGIN");
});

test("User-installed secureHeaders replaces the auto-installed instance", async () => {
  const app = new App({ logger: false });
  app.use(
    secureHeaders({
      contentSecurityPolicy: "default-src 'none'",
      hsts: false,
      frameOptions: "SAMEORIGIN",
      noSniff: false,
    }),
  );
  app.route({
    method: "GET",
    path: "/hi",
    operationId: "hi",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/hi");
  assert.equal(res.headers.get("content-security-policy"), "default-src 'none'");
  assert.equal(res.headers.get("strict-transport-security"), null);
  assert.equal(res.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(res.headers.get("x-content-type-options"), null);
});

test("secureHeaders() and cors() hooks carry their markers", () => {
  const sh = secureHeaders();
  assert.equal(
    (sh as Record<PropertyKey, unknown>)[SECURE_HEADERS_MARKER],
    true,
  );
  const c = cors({ origin: "*" });
  assert.equal((c as Record<PropertyKey, unknown>)[CORS_HOOK_MARKER], true);
  const allows = (c as Record<PropertyKey, unknown>)[CORS_ORIGIN_ALLOW_MARKER];
  assert.equal(typeof allows, "function");
  assert.equal((allows as (origin: string) => boolean)("https://any.test"), true);
});

// ---------- CORS cross-origin guard ----------

function newApp(
  opts?: ConstructorParameters<typeof App>[0],
  beforeRoutes?: ReturnType<typeof cors>,
) {
  const app = new App({ logger: false, secureHeaders: false, ...opts });
  if (beforeRoutes) app.use(beforeRoutes);
  app.route({
    method: "POST",
    path: "/write",
    operationId: "write",
    request: { body: z.object({ x: z.number() }) },
    responses: { 200: { description: "ok" } },
    handler: ({ body }) => ({ status: 200 as const, body: { ok: true, body } }),
  });
  app.route({
    method: "GET",
    path: "/read",
    operationId: "read",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: undefined }),
  });
  return app;
}

test("cross-origin POST without cors() is rejected with 403", async () => {
  const app = newApp();
  const res = await app.request("/write", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://evil.test",
    },
    body: JSON.stringify({ x: 1 }),
  });
  assert.equal(res.status, 403);
  const body = (await res.json()) as { detail?: string };
  assert.match(body.detail ?? "", /cors\(\)/);
});

test("same-origin POST without cors() is allowed", async () => {
  const app = newApp();
  const res = await app.request("/write", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://test.local",
    },
    body: JSON.stringify({ x: 1 }),
  });
  assert.equal(res.status, 200);
});

test("cross-origin GET without cors() is allowed (read-only)", async () => {
  const app = newApp();
  const res = await app.request("/read", {
    headers: { origin: "https://evil.test" },
  });
  assert.equal(res.status, 200);
});

test("cross-origin POST without Origin header is allowed", async () => {
  const app = newApp();
  const res = await app.request("/write", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ x: 1 }),
  });
  assert.equal(res.status, 200);
});

test("Origin: null is treated as opaque (allowed) by the guard", async () => {
  const app = newApp();
  const res = await app.request("/write", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "null" },
    body: JSON.stringify({ x: 1 }),
  });
  assert.equal(res.status, 200);
});

test("Malformed Origin header is rejected with 403", async () => {
  const app = newApp();
  const res = await app.request("/write", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "not a url" },
    body: JSON.stringify({ x: 1 }),
  });
  assert.equal(res.status, 403);
});

test("same-origin POST with malformed JSON is rejected after the guard passes", async () => {
  const app = newApp();
  const res = await app.request("/write", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://test.local",
    },
    body: "{not-json",
  });
  assert.equal(res.status, 400);
});

test("cors() registered before a route allows allowlisted cross-origin POST", async () => {
  const app = newApp(undefined, cors({ origin: "https://app.example.com" }));
  const res = await app.request("/write", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.com",
    },
    body: JSON.stringify({ x: 1 }),
  });
  assert.equal(res.status, 200);
});

test("cors() allowlist rejects disallowed cross-origin POST before handler", async () => {
  const app = newApp(undefined, cors({ origin: "https://app.example.com" }));
  const res = await app.request("/write", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://evil.test",
    },
    body: JSON.stringify({ x: 1 }),
  });
  assert.equal(res.status, 403);
});

test("cors() registered after a route does not retroactively loosen it", async () => {
  const app = newApp();
  app.use(cors({ origin: "https://app.example.com" }));
  const res = await app.request("/write", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.com",
    },
    body: JSON.stringify({ x: 1 }),
  });
  assert.equal(res.status, 403);
});

test("App({ hooks: cors(...) }) participates in the cross-origin guard", async () => {
  const app = newApp({ hooks: cors({ origin: "https://app.example.com" }) });
  const allowed = await app.request("/write", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.com",
    },
    body: JSON.stringify({ x: 1 }),
  });
  assert.equal(allowed.status, 200);

  const rejected = await app.request("/write", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://evil.test",
    },
    body: JSON.stringify({ x: 1 }),
  });
  assert.equal(rejected.status, 403);
});

test("third-party CORS marker without predicate remains a trusted escape hatch", async () => {
  const thirdPartyCors = {} as ReturnType<typeof cors>;
  (thirdPartyCors as Record<PropertyKey, unknown>)[CORS_HOOK_MARKER] = true;

  const app = newApp(undefined, thirdPartyCors);
  const res = await app.request("/write", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://third-party.example.com",
    },
    body: JSON.stringify({ x: 1 }),
  });
  assert.equal(res.status, 200);
});

test("corsCrossOriginGuard: false disables the guard", async () => {
  const app = newApp({ corsCrossOriginGuard: false });
  const res = await app.request("/write", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://evil.test",
    },
    body: JSON.stringify({ x: 1 }),
  });
  assert.equal(res.status, 200);
});

test("secureDefaults: false also disables the guard", async () => {
  const app = newApp({ secureDefaults: false });
  const res = await app.request("/write", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://evil.test",
    },
    body: JSON.stringify({ x: 1 }),
  });
  assert.equal(res.status, 200);
});

test("guard fires on PUT / PATCH / DELETE too", async () => {
  const app = new App({ logger: false, secureHeaders: false });
  for (const method of ["PUT", "PATCH", "DELETE"] as const) {
    app.route({
      method,
      path: `/r-${method.toLowerCase()}`,
      operationId: `r${method}`,
      responses: { 200: { description: "ok" } },
      handler: () => ({ status: 200 as const, body: undefined }),
    });
    const res = await app.request(`/r-${method.toLowerCase()}`, {
      method,
      headers: { origin: "https://evil.test" },
    });
    assert.equal(res.status, 403, `${method} should be rejected`);
  }
});

test("guard does not fire on unmatched routes when same-origin", async () => {
  const app = newApp();
  const res = await app.request("/missing", { method: "POST" });
  assert.equal(res.status, 404);
});

test("guard fires before 404 lookup for cross-origin state-changing", async () => {
  const app = newApp();
  const res = await app.request("/missing", {
    method: "POST",
    headers: { origin: "https://evil.test" },
  });
  assert.equal(res.status, 403);
});

// ---------- Per-route accepts ----------

test("per-route accepts opts in to form-urlencoded without loosening globally", async () => {
  const app = new App({
    logger: false,
    secureHeaders: false,
    allowedContentTypes: ["application/json"],
  });
  app.route({
    method: "POST",
    path: "/legacy",
    operationId: "legacy",
    accepts: ["application/x-www-form-urlencoded"],
    request: { body: z.object({ x: z.string() }) },
    responses: { 200: { description: "ok" } },
    handler: ({ body }) => ({ status: 200 as const, body: { ok: true, body } }),
  });
  app.route({
    method: "POST",
    path: "/strict",
    operationId: "strict",
    request: { body: z.object({ x: z.string() }) },
    responses: { 200: { description: "ok" } },
    handler: ({ body }) => ({ status: 200 as const, body: { ok: true, body } }),
  });

  const ok = await app.request("/legacy", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "x=hello",
  });
  assert.equal(ok.status, 200);

  const rejected = await app.request("/strict", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "x=hello",
  });
  assert.equal(rejected.status, 415);
});

test("per-route accepts rejects unlisted text content types", async () => {
  const app = new App({
    logger: false,
    secureHeaders: false,
    allowedContentTypes: ["application/json"],
  });
  app.route({
    method: "POST",
    path: "/legacy",
    operationId: "legacyTextReject",
    accepts: ["application/x-www-form-urlencoded"],
    request: { body: z.object({ x: z.string() }) },
    responses: { 200: { description: "ok" } },
    handler: ({ body }) => ({ status: 200 as const, body: { ok: true, body } }),
  });

  const res = await app.request("/legacy", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "x=hello",
  });
  assert.equal(res.status, 415);
});
