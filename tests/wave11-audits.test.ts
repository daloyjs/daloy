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
} from "../src/errors.js";

import { runWave11Audits } from "../scripts/verify-wave11-audits.js";

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
