/**
 * Tests for the response-body-schema coverage audit (OWASP API3 hardening
 * follow-up R-1): routes that declare a 2xx response with no body schema get
 * NO response-field stripping, so the framework surfaces them via a pure
 * introspection helper, a development-mode boot warning, and a
 * `daloy doctor` finding.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { App, findRoutesMissingResponseBodySchema } from "../src/index.js";
import { runCli, type CliIO } from "../src/cli.js";

// ---------------------------------------------------------------------------
// Pure helper
// ---------------------------------------------------------------------------

test("[helper] flags 2xx responses without a body schema, ignores the rest", () => {
  const routes = [
    // Offending: 200 has no body schema.
    { method: "GET", path: "/leaky", responses: { 200: { description: "ok" } } },
    // Safe: 200 declares a body schema.
    {
      method: "GET",
      path: "/safe",
      responses: { 200: { description: "ok", body: z.object({ id: z.string() }) } },
    },
    // Safe: 204 is body-less by spec, never flagged.
    { method: "DELETE", path: "/item", responses: { 204: { description: "no content" } } },
    // Safe: error responses (non-2xx) are not over-exposure vectors here.
    { method: "GET", path: "/err", responses: { 500: { description: "boom" } } },
    // Offending on the 201 only (200 is schema'd).
    {
      method: "POST",
      path: "/mixed",
      responses: {
        200: { description: "ok", body: z.object({ id: z.string() }) },
        201: { description: "created" },
      },
    },
  ] as any;

  const result = findRoutesMissingResponseBodySchema(routes);
  assert.deepEqual(result, [
    { method: "GET", path: "/leaky", statuses: [200] },
    { method: "POST", path: "/mixed", statuses: [201] },
  ]);
});

test("[helper] skips routes that acknowledge an intentionally schema-less body", () => {
  const routes = [
    {
      method: "POST",
      path: "/proxy",
      acknowledgeNoResponseBodySchema: true,
      responses: { 200: { description: "opaque upstream payload" } },
    },
    // Still flagged: acknowledgement is per-route, not global.
    { method: "GET", path: "/leaky", responses: { 200: { description: "ok" } } },
  ] as any;
  assert.deepEqual(findRoutesMissingResponseBodySchema(routes), [
    { method: "GET", path: "/leaky", statuses: [200] },
  ]);
});

test("[helper] returns empty when every 2xx response declares a body schema", () => {
  const routes = [
    {
      method: "GET",
      path: "/ok",
      responses: { 200: { description: "ok", body: z.object({ id: z.string() }) } },
    },
  ] as any;
  assert.deepEqual(findRoutesMissingResponseBodySchema(routes), []);
});

// ---------------------------------------------------------------------------
// Development-mode boot warning (fires once, on first request)
// ---------------------------------------------------------------------------

function capturingLogger() {
  const warns: Array<{ obj: unknown; msg: string }> = [];
  const noop = () => {};
  const logger = {
    level: "info" as const,
    trace: noop,
    debug: noop,
    info: noop,
    warn: (obj: unknown, msg?: string) => warns.push({ obj, msg: msg ?? "" }),
    error: noop,
    fatal: noop,
    child: () => logger,
  };
  return { logger, warns };
}

test("[boot-warning] dev mode warns once about a schema-less 2xx response", async () => {
  const { logger, warns } = capturingLogger();
  const app = new App({ env: "development", logger: logger as any });
  app.route({
    method: "GET",
    path: "/profile",
    operationId: "profile",
    responses: { 200: { description: "ok" } }, // <-- no body schema
    handler: async () => ({ status: 200 as const, body: { id: "1", secret: "leak" } as any }),
  });

  await app.request("/profile");
  await app.request("/profile"); // second request must NOT re-warn

  const hits = warns.filter((w) =>
    (w.obj as { event?: string } | null)?.event === "security.response.bodySchemaMissing",
  );
  assert.equal(hits.length, 1, "the warning fires exactly once per process");
  assert.match(hits[0]!.msg, /OWASP API3|body schema/i);
});

test("[boot-warning] no warning when every 2xx response declares a body schema", async () => {
  const { logger, warns } = capturingLogger();
  const app = new App({ env: "development", logger: logger as any });
  app.route({
    method: "GET",
    path: "/profile",
    operationId: "profile",
    responses: { 200: { description: "ok", body: z.object({ id: z.string() }) as any } },
    handler: async () => ({ status: 200 as const, body: { id: "1" } }),
  });
  await app.request("/profile");
  assert.equal(
    warns.filter((w) => (w.obj as { event?: string } | null)?.event === "security.response.bodySchemaMissing")
      .length,
    0,
  );
});

test("[boot-warning] acknowledged routes do not warn; unacknowledged ones still do", async () => {
  const { logger, warns } = capturingLogger();
  const app = new App({ env: "development", logger: logger as any });
  app.route({
    method: "POST",
    path: "/mcp",
    operationId: "mcpOpaque",
    acknowledgeNoResponseBodySchema: true,
    responses: { 200: { description: "MCP JSON-RPC response" } },
    handler: async () => new Response("{}", { headers: { "content-type": "application/json" } }),
  });
  await app.request("/mcp", { method: "POST" });
  assert.equal(
    warns.filter(
      (w) => (w.obj as { event?: string } | null)?.event === "security.response.bodySchemaMissing"
    ).length,
    0,
    "an acknowledged opaque route must not trip the warning"
  );
});

test("[boot-warning] framework-mounted docs routes never warn about themselves", async () => {
  const { logger, warns } = capturingLogger();
  // The feedback repro: `docs: true` mounts /openapi.json, /openapi.yaml and
  // /docs — none of them are user-authored, so none may trip the warning.
  const app = new App({ env: "development", docs: true, logger: logger as any });
  await app.request("/openapi.json");
  const hits = warns.filter(
    (w) => (w.obj as { event?: string } | null)?.event === "security.response.bodySchemaMissing"
  );
  assert.equal(hits.length, 0, "framework-owned routes must be pre-acknowledged");
});

test("[boot-warning] framework health and metrics routes never warn about themselves", async () => {
  const { logger, warns } = capturingLogger();
  const app = new App({ env: "development", logger: logger as any });
  app.healthcheck({ acknowledgeUnauthenticated: true });
  app.metrics({ acknowledgeUnauthenticated: true });
  await app.request("/healthz");
  assert.equal(
    warns.filter(
      (w) => (w.obj as { event?: string } | null)?.event === "security.response.bodySchemaMissing"
    ).length,
    0
  );
});

test("[boot-warning] production stays silent (operators run `daloy doctor` in CI instead)", async () => {
  const { logger, warns } = capturingLogger();
  const app = new App({
    production: true,
    crashOnUnhandledRejection: false,
    logger: logger as any,
  });
  app.route({
    method: "GET",
    path: "/profile",
    operationId: "profile",
    responses: { 200: { description: "ok" } }, // schema-less, but prod is silent
    handler: async () => ({ status: 200 as const, body: { id: "1" } as any }),
  });
  await app.request("/profile");
  assert.equal(
    warns.filter((w) => (w.obj as { event?: string } | null)?.event === "security.response.bodySchemaMissing")
      .length,
    0,
    "the dev warning must not fire in production",
  );
});

test("[boot-warning] secureDefaults:false suppresses the warning (the developer opted out)", async () => {
  const { logger, warns } = capturingLogger();
  const app = new App({ env: "development", secureDefaults: false, logger: logger as any });
  app.route({
    method: "GET",
    path: "/profile",
    operationId: "profile",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: { id: "1" } as any }),
  });
  await app.request("/profile");
  assert.equal(
    warns.filter((w) => (w.obj as { event?: string } | null)?.event === "security.response.bodySchemaMissing")
      .length,
    0,
  );
});

// ---------------------------------------------------------------------------
// daloy doctor finding
// ---------------------------------------------------------------------------

function doctorIO(app: App) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIO = {
    stdout: (c) => out.push(c),
    stderr: (c) => err.push(c),
    importEntry: async () => ({ default: app }),
    version: "0.0.0-test",
  };
  return { io, out, err };
}

test("[doctor] reports audit.response.bodySchema for a schema-less 2xx route", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/leaky",
    operationId: "leaky",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: { id: "1" } as any }),
  });
  const { io, out } = doctorIO(app);
  await runCli(["doctor", "--json"], io);
  const report = JSON.parse(out.join(""));
  const finding = report.findings.find((f: { code: string }) => f.code === "audit.response.bodySchema");
  assert.ok(finding, "doctor must surface the response.bodySchema audit");
  assert.equal(finding.level, "warn");
  assert.match(finding.message, /\/leaky/);
});

test("[doctor] clean app (all 2xx have body schemas) produces no bodySchema finding", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/ok",
    operationId: "ok",
    responses: { 200: { description: "ok", body: z.object({ id: z.string() }) as any } },
    handler: async () => ({ status: 200 as const, body: { id: "1" } }),
  });
  const { io, out } = doctorIO(app);
  await runCli(["doctor", "--json"], io);
  const report = JSON.parse(out.join(""));
  assert.ok(!report.findings.some((f: { code: string }) => f.code === "audit.response.bodySchema"));
});
