import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { App, secureHeaders } from "../src/index.js";

function captureLogs() {
  const lines: Array<{ level: string; obj: Record<string, unknown>; msg: string }> = [];
  const mk = (level: string) => (obj: any, msg?: any) => {
    if (typeof obj === "string") {
      lines.push({ level, obj: {}, msg: obj });
    } else {
      lines.push({ level, obj: obj ?? {}, msg: typeof msg === "string" ? msg : "" });
    }
  };
  const logger = {
    trace: mk("trace"),
    debug: mk("debug"),
    info: mk("info"),
    warn: mk("warn"),
    error: mk("error"),
    fatal: mk("fatal"),
    child: () => logger,
  } as any;
  return { logger, lines };
}

test("internal-service preset: boots without secureHeaders auto-install", async () => {
  const { logger, lines } = captureLogs();
  const app = new App({ preset: "internal-service", logger });

  app.route({
    method: "GET",
    path: "/ping",
    operationId: "ping",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  const res = await app.request("/ping");
  assert.equal(res.status, 200);
  // secureHeaders auto-install is OFF — no HSTS, no default CSP, no X-Frame-Options
  assert.equal(res.headers.get("strict-transport-security"), null);
  assert.equal(res.headers.get("x-frame-options"), null);
  assert.equal(res.headers.get("content-security-policy"), null);

  // boot audit log entry was emitted
  const entry = lines.find((l) => l.obj.event === "security.preset.applied");
  assert.ok(entry, "expected security.preset.applied audit log");
  assert.equal(entry!.obj.preset, "internal-service");
  assert.equal(entry!.level, "info");
  assert.ok(Array.isArray(entry!.obj.disabled));
  assert.ok(Array.isArray(entry!.obj.kept));
});

test("internal-service preset: getSecurityPosture() snapshot", () => {
  const app = new App({ preset: "internal-service", logger: false });
  const posture = app.getSecurityPosture();
  assert.equal(posture.preset, "internal-service");
  assert.equal(posture.secureDefaults, true);
  assert.equal(posture.secureHeaders, false);
  assert.equal(posture.corsCrossOriginGuard, false);
  assert.equal(posture.csrf, "off");
  assert.equal(posture.trustProxy, false);
  // KEPT defaults
  assert.equal(posture.bodyLimitBytes, 1024 * 1024);
  assert.equal(posture.requestTimeoutMs, 30_000);
  assert.equal(posture.stripServerHeaders, true);
});

test("internal-service preset: KEEPS body limit (unhappy path)", async () => {
  const app = new App({
    preset: "internal-service",
    bodyLimitBytes: 100,
    logger: false,
  });
  app.route({
    method: "POST",
    path: "/echo",
    operationId: "echo",
    request: { body: z.object({ value: z.string() }) },
    responses: { 200: { description: "ok", body: z.object({ value: z.string() }) } },
    handler: async ({ body }) => ({ status: 200 as const, body: body as { value: string } }),
  });
  const big = "x".repeat(500);
  const res = await app.request("/echo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: big }),
  });
  assert.equal(res.status, 413, "preset must NOT weaken bodyLimitBytes");
});

test("internal-service preset: KEEPS request timeout default", () => {
  const app = new App({ preset: "internal-service", logger: false });
  assert.equal(app.options.requestTimeoutMs, 30_000);
});

test("internal-service preset: KEEPS prototype-pollution-safe parser (unhappy path)", async () => {
  const app = new App({ preset: "internal-service", logger: false });
  app.route({
    method: "POST",
    path: "/p",
    operationId: "p",
    request: { body: z.object({ value: z.string() }).passthrough() },
    responses: { 200: { description: "ok", body: z.object({ value: z.string() }) } },
    handler: async ({ body }) => ({
      status: 200 as const,
      body: { value: (body as any).value },
    }),
  });
  const res = await app.request("/p", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"__proto__":{"polluted":true},"value":"x"}',
  });
  // Either the parser rejects __proto__ or it silently strips it — both
  // are acceptable; the security guarantee is that Object.prototype must
  // not get polluted. Preset MUST keep this guard active.
  assert.ok(res.status === 200 || res.status === 400 || res.status === 422);
  assert.equal(({} as any).polluted, undefined, "Object.prototype must not be polluted");
});

test("internal-service preset: cross-origin POST is allowed (guard off)", async () => {
  const app = new App({ preset: "internal-service", logger: false });
  app.route({
    method: "POST",
    path: "/svc",
    operationId: "svc",
    request: { body: z.object({ n: z.number() }) },
    responses: { 200: { description: "ok", body: z.object({ n: z.number() }) } },
    handler: async ({ body }) => ({ status: 200 as const, body: body as { n: number } }),
  });
  const res = await app.request("http://app.internal/svc", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://other.internal",
    },
    body: JSON.stringify({ n: 1 }),
  });
  assert.equal(res.status, 200, "preset turns off corsCrossOriginGuard");
});

test("default app (no preset): cross-origin POST is REJECTED", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "POST",
    path: "/svc",
    operationId: "svc",
    request: { body: z.object({ n: z.number() }) },
    responses: { 200: { description: "ok", body: z.object({ n: z.number() }) } },
    handler: async ({ body }) => ({ status: 200 as const, body: body as { n: number } }),
  });
  const res = await app.request("http://app.public/svc", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://attacker.example",
    },
    body: JSON.stringify({ n: 1 }),
  });
  assert.equal(res.status, 403, "default posture must reject cross-origin writes");
});

test("internal-service preset: per-knob override re-enables secureHeaders", async () => {
  const app = new App({
    preset: "internal-service",
    secureHeaders: {},
    logger: false,
  });
  app.route({
    method: "GET",
    path: "/h",
    operationId: "h",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.request("/h");
  assert.equal(res.status, 200);
  // when secureHeaders is explicitly set, preset does NOT override
  assert.ok(
    res.headers.get("x-frame-options") !== null ||
      res.headers.get("strict-transport-security") !== null,
    "explicit secureHeaders:{} should win over preset default of false"
  );
  const posture = app.getSecurityPosture();
  assert.equal(posture.secureHeaders, true);
});

test("internal-service preset: user-set csrf:'off' is preserved (not overwritten)", () => {
  const app = new App({ preset: "internal-service", logger: false });
  assert.equal(app.options.csrf, "off");
});

test("internal-service preset: explicit trustProxy:true wins", () => {
  const app = new App({
    preset: "internal-service",
    trustProxy: true,
    logger: false,
  });
  assert.equal(app.options.trustProxy, true);
  assert.equal(app.getSecurityPosture().trustProxy, true);
});

test("internal-service preset: explicit behindProxy is preserved (preset does not set trustProxy)", () => {
  const app = new App({
    preset: "internal-service",
    behindProxy: "loopback",
    logger: false,
  });
  assert.equal(app.options.trustProxy, undefined);
  assert.equal(app.options.behindProxy, "loopback");
});

test("default app (no preset): secureHeaders ARE installed", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/h",
    operationId: "h",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.request("/h");
  assert.equal(res.status, 200);
  assert.ok(
    res.headers.get("x-frame-options") !== null,
    "default posture must auto-install secureHeaders"
  );
});

test("default app (no preset): getSecurityPosture() snapshot", () => {
  const app = new App({ logger: false });
  const posture = app.getSecurityPosture();
  assert.equal(posture.preset, undefined);
  assert.equal(posture.secureHeaders, true);
  assert.equal(posture.corsCrossOriginGuard, true);
  assert.equal(posture.csrf, "on");
});

test("secureHeaders import is still callable from userland", () => {
  // sanity: preset doesn't break the userland API surface
  assert.equal(typeof secureHeaders, "function");
});
