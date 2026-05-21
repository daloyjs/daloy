/**
 * Wave 11 - multi-runtime web-standard ergonomic-framework parity bake-ins
 * regression coverage.
 *
 * Exercises the static gates exported from
 * `scripts/verify-wave11-audits.ts` against the live source tree, and the
 * runtime behavior of the focused-slice changes:
 *
 *   - `UnauthorizedError`, `ForbiddenError`, `TooManyRequestsError`
 *     responses ship `Cache-Control: no-store` so auth-failure responses
 *     are never cached (item 4).
 *   - `cspReportRoute()` refuses `application/json`, refuses
 *     `maxBodyBytes > 64 KiB` at construction, and the default logger
 *     sink omits the report body in production (item 7).
 *   - `cors()` default `allowMethods` is the read-only set and
 *     `methods: ["*"]` is refused at construction (item 9).
 *
 * @since 0.30.0
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { App } from "../src/app.js";
import {
  cors,
  bearerAuth,
  csrf,
  rateLimit,
} from "../src/middleware.js";
import {
  UnauthorizedError,
  ForbiddenError,
  TooManyRequestsError,
  HttpError,
  MessageLeakError,
  httpError,
  checkCustomErrorResponseHeaders,
  SAFE_CUSTOM_ERROR_RESPONSE_HEADERS,
} from "../src/errors.js";

import { runWave11Audits } from "../scripts/verify-wave11-audits.js";
import { topoSortExtensions, type PluginExtension } from "../src/app.js";
import { secureHeaders } from "../src/middleware.js";

// ---------- live tree: every static audit passes ----------

test("wave11: all static audits pass on the live source tree", async () => {
  const findings = await runWave11Audits();
  const errors = findings.filter((f) => f.level !== "warn");
  if (errors.length > 0) {
    const summary = errors
      .map(
        (f) =>
          `[${f.audit}] ${f.file}${f.line > 0 ? `:${f.line}` : ""} - ${f.text}: ${f.message}`,
      )
      .join("\n");
    assert.fail(`Wave 11 audit gates flagged ${errors.length} error(s):\n${summary}`);
  }
});

// ---------- item 4: auth-failure responses carry cache-control: no-store ----------

test("wave11: UnauthorizedError.toResponse() carries cache-control: no-store", () => {
  const res = new UnauthorizedError("login required").toResponse();
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("wave11: ForbiddenError.toResponse() carries cache-control: no-store", () => {
  const res = new ForbiddenError("denied").toResponse();
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("wave11: TooManyRequestsError.toResponse() carries cache-control: no-store + retry-after", () => {
  const res = new TooManyRequestsError(15).toResponse();
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("retry-after"), "15");
});

test("wave11: TooManyRequestsError without retry carries cache-control only", () => {
  const res = new TooManyRequestsError().toResponse();
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("retry-after"), null);
});

test("wave11: CSRF helper 403 response carries cache-control: no-store", async () => {
  const app = new App({
    secureDefaults: false,
    production: false,
  });
  app.use(
    csrf({
      cookieName: "daloy.csrf",
      cookieOptions: { secure: false },
    }),
  );
  app.route({
    method: "POST",
    path: "/submit",
    operationId: "submit",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/submit", { method: "POST" });
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("wave11: rateLimit 429 response carries cache-control: no-store", async () => {
  const app = new App({ secureDefaults: false, production: false });
  app.use(rateLimit({ windowMs: 60_000, max: 1 }));
  app.route({
    method: "GET",
    path: "/ping",
    operationId: "ping",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  await app.request("/ping", { method: "GET" });
  const second = await app.request("/ping", { method: "GET" });
  assert.equal(second.status, 429);
  assert.equal(second.headers.get("cache-control"), "no-store");
});

test("wave11: bearerAuth invalid token 403 carries cache-control: no-store", async () => {
  const app = new App({ secureDefaults: false, production: false });
  app.use(
    bearerAuth({
      validate: (token) =>
        token === "correct-token-with-sufficient-entropy-1234567890abcdef",
    }),
  );
  app.route({
    method: "GET",
    path: "/data",
    operationId: "data",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/data", {
    method: "GET",
    headers: { authorization: "Bearer wrong-token-also-long-enough-1234567890ab" },
  });
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

// ---------- item 7: CSP report receiver hardening ----------

test("wave11: cspReportRoute refuses application/json with 415", async () => {
  const app = new App({ secureDefaults: false, production: false });
  app.cspReportRoute();
  const res = await app.request("/__csp-report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ "csp-report": { "violated-directive": "img-src" } }),
  });
  assert.equal(res.status, 415);
});

test("wave11: cspReportRoute still accepts application/reports+json", async () => {
  const app = new App({ secureDefaults: false, production: false });
  app.cspReportRoute();
  const res = await app.request("/__csp-report", {
    method: "POST",
    headers: { "content-type": "application/reports+json" },
    body: JSON.stringify([
      { type: "csp-violation", body: { effectiveDirective: "img-src" } },
    ]),
  });
  assert.equal(res.status, 204);
});

test("wave11: cspReportRoute refuses maxBodyBytes > 64 KiB at construction", () => {
  const app = new App({ secureDefaults: false, production: false });
  assert.throws(
    () => app.cspReportRoute({ maxBodyBytes: 1024 * 1024 }),
    /maxBodyBytes/,
  );
});

test("wave11: cspReportRoute refuses non-integer maxBodyBytes at construction", () => {
  const app = new App({ secureDefaults: false, production: false });
  assert.throws(() => app.cspReportRoute({ maxBodyBytes: 0 }), /maxBodyBytes/);
});

test("wave11: cspReportRoute omits report body when logCspReportBodies: false", async () => {
  const lines: Array<{ args: unknown[] }> = [];
  const app = new App({
    secureDefaults: false,
    production: false,
    logger: {
      info: () => {},
      warn: (...args: unknown[]) => {
        lines.push({ args });
      },
      error: () => {},
      debug: () => {},
      child: () => app.log,
    } as any,
  });
  app.cspReportRoute({ logCspReportBodies: false });
  const res = await app.request("/__csp-report", {
    method: "POST",
    headers: { "content-type": "application/csp-report" },
    body: JSON.stringify({
      "csp-report": { "document-uri": "https://example.com/?token=secret" },
    }),
  });
  assert.equal(res.status, 204);
  const csp = lines.find((l) => {
    const [first] = l.args;
    return (
      first &&
      typeof first === "object" &&
      (first as Record<string, unknown>).event === "csp.report"
    );
  });
  assert.ok(csp, "expected csp.report log line");
  const payload = csp.args[0] as Record<string, unknown>;
  assert.equal(
    payload.report,
    undefined,
    "report body must be omitted when logCspReportBodies: false",
  );
});

test("wave11: cspReportRoute production default omits report body", async () => {
  const lines: Array<{ args: unknown[] }> = [];
  const app = new App({
    production: true,
    secureHeaders: false,
    crashOnUnhandledRejection: false,
    logger: {
      info: () => {},
      warn: (...args: unknown[]) => {
        lines.push({ args });
      },
      error: () => {},
      debug: () => {},
      child: () => app.log,
    } as any,
  });
  app.cspReportRoute();
  const res = await app.request("/__csp-report", {
    method: "POST",
    headers: { "content-type": "application/csp-report" },
    body: JSON.stringify({
      "csp-report": { "document-uri": "https://example.com/?token=secret" },
    }),
  });
  assert.equal(res.status, 204);
  const csp = lines.find((l) => {
    const [first] = l.args;
    return (
      first &&
      typeof first === "object" &&
      (first as Record<string, unknown>).event === "csp.report"
    );
  });
  assert.ok(csp, "expected csp.report log line");
  const payload = csp.args[0] as Record<string, unknown>;
  assert.equal(payload.report, undefined);
});

test("wave11: cspReportRoute logs body when logCspReportBodies: true", async () => {
  const lines: Array<{ args: unknown[] }> = [];
  const app = new App({
    secureDefaults: false,
    production: false,
    logger: {
      info: () => {},
      warn: (...args: unknown[]) => {
        lines.push({ args });
      },
      error: () => {},
      debug: () => {},
      child: () => app.log,
    } as any,
  });
  app.cspReportRoute({ logCspReportBodies: true });
  await app.request("/__csp-report", {
    method: "POST",
    headers: { "content-type": "application/csp-report" },
    body: JSON.stringify({ "csp-report": { "document-uri": "https://x/" } }),
  });
  const csp = lines.find(
    (l) =>
      l.args[0] &&
      typeof l.args[0] === "object" &&
      (l.args[0] as Record<string, unknown>).event === "csp.report",
  );
  assert.ok(csp);
  const payload = csp.args[0] as Record<string, unknown>;
  assert.ok(
    payload.report !== undefined,
    "report body must be present when logCspReportBodies: true",
  );
});

// ---------- item 9: cors() allowMethods default narrowed ----------

test("wave11: cors() default allowMethods is [GET, HEAD, POST]", async () => {
  const app = new App({ secureDefaults: false, production: false });
  app.use(cors({ origin: ["https://known.test"] }));
  app.route({
    method: "GET",
    path: "/r",
    operationId: "r",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/r", {
    method: "OPTIONS",
    headers: { origin: "https://known.test" },
  });
  assert.equal(res.status, 204);
  assert.equal(
    res.headers.get("access-control-allow-methods"),
    "GET, HEAD, POST",
  );
});

test("wave11: cors() refuses methods: ['*'] at construction", () => {
  assert.throws(
    () => cors({ origin: "https://known.test", methods: ["*"] }),
    /methods cannot include/,
  );
});

test("wave11: cors() allows explicit PUT/PATCH/DELETE opt-in", async () => {
  const app = new App({ secureDefaults: false, production: false });
  app.use(
    cors({
      origin: ["https://known.test"],
      methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
    }),
  );
  app.route({
    method: "PUT",
    path: "/r",
    operationId: "rPut",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });
  const res = await app.request("/r", {
    method: "OPTIONS",
    headers: { origin: "https://known.test" },
  });
  assert.equal(res.status, 204);
  assert.equal(
    res.headers.get("access-control-allow-methods"),
    "GET, HEAD, POST, PUT, PATCH, DELETE",
  );
});

// ---------- Wave 11 leftover slice (0.32.0) ----------

// Item 2: WebSocket post-upgrade header immutability — refuse-at-registration.

test("wave11: app.ws() refuses when secureHeaders() is mounted on a matching path", () => {
  const app = new App();
  app.use(secureHeaders());
  assert.throws(
    () =>
      app.ws("/ws", {
        open() {},
      }),
    /secureHeaders\(\).*WebSocket route/,
  );
});

test("wave11: app.ws() accepts the route when acknowledgeHeaderMutatingMiddleware is set", () => {
  const app = new App();
  app.use(secureHeaders());
  // Should not throw.
  app.ws("/ws", {
    acknowledgeHeaderMutatingMiddleware: true,
    open() {},
  });
});

test("wave11: app.ws() refuses when cors() is mounted on a matching path", () => {
  const app = new App();
  app.use(cors({ origin: ["https://known.test"] }));
  assert.throws(
    () =>
      app.ws("/ws", {
        open() {},
      }),
    /cors\(\).*WebSocket route/,
  );
});

test("wave11: app.ws() refuses unauthenticated production routes without acknowledgement", () => {
  const app = new App({ env: "production" });
  assert.throws(
    () =>
      app.ws("/ws", {
        open() {},
      }),
    /beforeUpgrade.*acknowledgeUnauthenticated/s,
  );
});

test("wave11: app.ws() accepts production routes with a beforeUpgrade decision", () => {
  const app = new App({ env: "production" });
  app.ws("/ws", {
    allowedOrigins: "same-origin",
    beforeUpgrade() {
      return undefined;
    },
    open() {},
  });
});

test("wave11: app.ws() accepts explicitly public production routes", () => {
  const app = new App({ env: "production" });
  app.ws("/public", {
    acknowledgeUnauthenticated: true,
    acknowledgeCrossOriginUpgrade: true,
    open() {},
  });
});

// Item 5: httpError({ res }) refuse-at-construction + contextHeaders merge.

test("wave11: httpError({ res }) refuses Set-Cookie in production", () => {
  const res = new Response(null, {
    status: 401,
    headers: { "set-cookie": "leak=1", "www-authenticate": "Bearer" },
  });
  assert.throws(
    () =>
      httpError({
        status: 401,
        problem: { title: "Unauthorized" },
        res,
        production: true,
        secureDefaults: true,
      }),
    MessageLeakError,
  );
});

test("wave11: httpError({ res }) accepts a bare WWW-Authenticate challenge", () => {
  const res = new Response(null, {
    status: 401,
    headers: { "www-authenticate": 'Bearer realm="api"' },
  });
  const err = httpError({
    status: 401,
    problem: { title: "Unauthorized" },
    res,
    production: true,
    secureDefaults: true,
  });
  assert.ok(err instanceof HttpError);
  const rendered = err.toResponse();
  assert.equal(rendered.headers.get("www-authenticate"), 'Bearer realm="api"');
});

test("wave11: httpError({ res }) does not duplicate caller headers by case", () => {
  const res = new Response(null, {
    status: 401,
    headers: { "www-authenticate": 'Bearer realm="res"' },
  });
  const err = httpError({
    status: 401,
    problem: { title: "Unauthorized" },
    headers: { "WWW-Authenticate": 'Bearer realm="caller"' },
    res,
    production: true,
    secureDefaults: true,
  });
  assert.equal(err.toResponse().headers.get("www-authenticate"), 'Bearer realm="caller"');
});

test("wave11: httpError({ res }) ignores custom Response content-length", () => {
  const res = new Response(null, {
    status: 401,
    headers: { "content-length": "0", "www-authenticate": "Bearer" },
  });
  const err = httpError({
    status: 401,
    problem: { title: "Unauthorized" },
    res,
    production: true,
    secureDefaults: true,
  });
  const rendered = err.toResponse();
  assert.equal(rendered.headers.get("www-authenticate"), "Bearer");
  assert.equal(rendered.headers.get("content-length"), null);
});

test("wave11: httpError({ res }) refuses cache-control: public", () => {
  const res = new Response(null, {
    status: 429,
    headers: { "cache-control": "public, max-age=60" },
  });
  assert.throws(
    () =>
      httpError({
        status: 429,
        problem: { title: "Too Many Requests" },
        res,
        production: true,
        secureDefaults: true,
      }),
    MessageLeakError,
  );
});

test("wave11: httpError({ res }) accepts cache-control: no-store", () => {
  const res = new Response(null, {
    status: 401,
    headers: { "cache-control": "no-store" },
  });
  const err = httpError({
    status: 401,
    problem: { title: "Unauthorized" },
    res,
    production: true,
    secureDefaults: true,
  });
  assert.equal(err.toResponse().headers.get("cache-control"), "no-store");
});

test("wave11: httpError({ res }) drops non-safe headers in dev without throwing", () => {
  const res = new Response(null, {
    status: 401,
    headers: { "x-debug-token": "leak", "www-authenticate": "Bearer" },
  });
  const err = httpError({
    status: 401,
    problem: { title: "Unauthorized" },
    res,
    production: false,
  });
  const rendered = err.toResponse();
  assert.equal(rendered.headers.get("www-authenticate"), "Bearer");
  assert.equal(rendered.headers.get("x-debug-token"), null);
});

test("wave11: checkCustomErrorResponseHeaders flags Server-Timing", () => {
  const offending = checkCustomErrorResponseHeaders(
    new Headers({ "server-timing": "db;dur=12" }),
  );
  assert.equal(offending.length, 1);
  assert.match(offending[0]!.reason, /Server-Timing/);
});

test("wave11: SAFE_CUSTOM_ERROR_RESPONSE_HEADERS exposes the allowlist", () => {
  assert.ok(SAFE_CUSTOM_ERROR_RESPONSE_HEADERS.has("www-authenticate"));
  assert.ok(!SAFE_CUSTOM_ERROR_RESPONSE_HEADERS.has("set-cookie"));
});

test("wave11: toResponse({ contextHeaders }) merges without overwriting baked headers", () => {
  const err = new UnauthorizedError("login required");
  const res = err.toResponse({
    contextHeaders: new Headers({
      "x-request-id": "req-1",
      // Must NOT overwrite the baked `cache-control: no-store`:
      "cache-control": "public, max-age=60",
    }),
  });
  assert.equal(res.headers.get("x-request-id"), "req-1");
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("wave11: toResponse({ contextHeaders }) accepts HeadersInit as plain object", () => {
  const err = new HttpError(500, { title: "Internal" });
  const res = err.toResponse({
    contextHeaders: { "x-trace-id": "abc" },
  });
  assert.equal(res.headers.get("x-trace-id"), "abc");
});

test("wave11: toResponse({ contextHeaders }) does not overwrite baked headers by case", () => {
  const err = new HttpError(
    401,
    { title: "Unauthorized" },
    { "Cache-Control": "no-store" },
  );
  const res = err.toResponse({
    contextHeaders: { "cache-control": "public, max-age=60" },
  });
  assert.equal(res.headers.get("cache-control"), "no-store");
});

// Item 8: plugin extensions header-conflict refusal.

test("wave11: topoSortExtensions throws when two extensions mutate the same header without ordering", () => {
  const exts: PluginExtension[] = [
    {
      name: "A",
      event: "onSend",
      handler: () => {},
      responseHeaders: ["x-foo"],
    },
    {
      name: "B",
      event: "onSend",
      handler: () => {},
      responseHeaders: ["X-Foo"],
    },
  ];
  assert.throws(
    () => topoSortExtensions(exts),
    /Plugin extension header conflict.*"A".*"B".*"x-foo"/,
  );
});

test("wave11: topoSortExtensions accepts conflicting headers when before is declared", () => {
  const exts: PluginExtension[] = [
    {
      name: "A",
      event: "onSend",
      handler: () => {},
      responseHeaders: ["x-foo"],
      before: ["B"],
    },
    {
      name: "B",
      event: "onSend",
      handler: () => {},
      responseHeaders: ["x-foo"],
    },
  ];
  const out = topoSortExtensions(exts);
  assert.deepEqual(out.map((e) => e.name), ["A", "B"]);
});

test("wave11: topoSortExtensions accepts non-overlapping responseHeaders without ordering", () => {
  const exts: PluginExtension[] = [
    {
      name: "A",
      event: "onSend",
      handler: () => {},
      responseHeaders: ["x-foo"],
    },
    {
      name: "B",
      event: "onSend",
      handler: () => {},
      responseHeaders: ["x-bar"],
    },
  ];
  const out = topoSortExtensions(exts);
  assert.equal(out.length, 2);
});
