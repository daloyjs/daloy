/**
 * RED-TEAM ATTACK SUITE — WAVE 7 (three-front offensive simulation)
 * =================================================================
 *
 * A simulated coordinated engagement across three offensive campaigns,
 * each run against THIS framework in the test harness:
 *
 *   Campaign R — penetrate & exfiltrate (steal data / leak internals)
 *   Campaign C — denial of service (exhaust resources / crash the process)
 *   Campaign N — code execution & persistence (RCE / prototype-gadget)
 *
 * Every attack below was confirmed defended during the engagement; this wave
 * locks the defenses in. The SECURE outcome is the PASSING outcome.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { App, createJwtVerifier, JwtError, idempotency, MemoryIdempotencyStore } from "../src/index.js";

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

// ===========================================================================
// CAMPAIGN R — penetrate & exfiltrate
// ===========================================================================

test("[R/recon] docs, OpenAPI, Redoc, and Scalar are not exposed in production", async () => {
  const app = new App({ production: true, crashOnUnhandledRejection: false, logger: false } as any);
  app.route({
    method: "GET",
    path: "/x",
    operationId: "x",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  for (const p of ["/docs", "/openapi.json", "/redoc", "/scalar"]) {
    assert.equal((await app.request(p)).status, 404, `${p} must not leak the API surface in production`);
  }
});

test("[R/exfil] a thrown error never leaks the stack, file paths, or secrets to the client in prod", async () => {
  const app = new App({ production: true, crashOnUnhandledRejection: false, logger: false } as any);
  app.route({
    method: "GET",
    path: "/boom",
    operationId: "boom",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => {
      throw new Error("/srv/app/secret/db.ts:42 connection=postgres://admin:HUNTER2@10.0.0.1 token=SECRET123");
    },
  });
  const res = await app.request("/boom");
  const text = JSON.stringify(await res.json());
  assert.equal(res.status, 500);
  for (const leak of ["SECRET123", "HUNTER2", "/srv/app", "db.ts", "postgres://"]) {
    assert.ok(!text.includes(leak), `error response must not leak "${leak}"`);
  }
});

test("[R/forge] a forged admin JWT is rejected, so privilege escalation fails", async () => {
  const verifier = createJwtVerifier({
    algorithms: ["HS256"],
    key: new TextEncoder().encode("0123456789abcdef0123456789abcdef"),
  });
  // Attacker crafts an "admin" token without the signing secret.
  const forged = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: "victim", role: "admin", exp: 9999999999 })}.AAAA`;
  await assert.rejects(verifier.verify(forged), (e: any) => e instanceof JwtError);
});

// ===========================================================================
// CAMPAIGN C — denial of service
// ===========================================================================

test("[C/slowloris] a handler exceeding requestTimeoutMs is cut off with 408", async () => {
  const app = new App({ env: "development", logger: false, requestTimeoutMs: 50 });
  app.route({
    method: "GET",
    path: "/slow",
    operationId: "slow",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => {
      await new Promise((r) => setTimeout(r, 5000));
      return { status: 200 as const, body: { ok: true } };
    },
  });
  const t0 = performance.now();
  const res = await app.request("/slow");
  const dt = performance.now() - t0;
  assert.equal(res.status, 408);
  assert.ok(dt < 2000, `the request must be cut off near the timeout, not after the full handler delay (${dt.toFixed(0)}ms)`);
});

test("[C/stack-bomb] a deeply-nested JSON body is rejected (400) without hanging or crashing", async () => {
  const app = new App({ env: "development", logger: false });
  app.use(idempotency({ store: new MemoryIdempotencyStore() }));
  app.route({
    method: "POST",
    path: "/sink",
    operationId: "sink",
    request: { body: z.object({ data: z.any() }) as any },
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  const depth = 200_000;
  const body = `{"data":${"[".repeat(depth)}${"]".repeat(depth)}}`;
  const t0 = performance.now();
  const res = await app.request("/sink", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "k1" },
    body,
  });
  const dt = performance.now() - t0;
  assert.equal(res.status, 400, "a stack-bomb body is rejected, not parsed into a crash");
  assert.ok(dt < 2000, `parsing must fail fast (${dt.toFixed(0)}ms)`);
});

test("[C/hash-flood] an excessively wide JSON object (50k keys) is rejected quickly (structural limit)", async () => {
  const app = new App({ env: "development", logger: false });
  app.route({
    method: "POST",
    path: "/wide",
    operationId: "wide",
    request: { body: z.record(z.string(), z.string()) as any },
    responses: { 200: { description: "ok", body: z.object({ n: z.number() }) as any } },
    handler: async ({ body }: any) => ({ status: 200 as const, body: { n: Object.keys(body).length } }),
  });
  const obj: Record<string, string> = {};
  for (let i = 0; i < 50_000; i++) obj["k" + i] = "v";
  const t0 = performance.now();
  const res = await app.request("/wide", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(obj),
  });
  const dt = performance.now() - t0;
  // With the jsonMaxKeys default, an extreme wide object is rejected with 400
  // by the pre-parse structural scan — before the 50k-key object is ever
  // materialized. This is the desired DoS protection, in bounded time.
  assert.equal(res.status, 400);
  assert.ok(dt < 2000, `wide-object rejection must be fast (${dt.toFixed(0)}ms)`);
});

// ===========================================================================
// CAMPAIGN N — code execution & persistence
// ===========================================================================

test("[N/proto-gadget] a __proto__ + constructor.prototype payload pollutes nothing", async () => {
  const app = new App({ env: "development", logger: false });
  app.route({
    method: "POST",
    path: "/pp",
    operationId: "pp",
    request: { body: z.object({ x: z.string() }) as any },
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  await app.request("/pp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"x":"1","__proto__":{"polluted":"yes","isAdmin":true},"constructor":{"prototype":{"rce":"x"}}}',
  });
  // None of the global prototypes may be mutated by the request.
  assert.equal(({} as any).polluted, undefined);
  assert.equal(({} as any).isAdmin, undefined);
  assert.equal(([] as any).rce, undefined);
  assert.equal((Object.prototype as any).polluted, undefined);
  assert.equal((Object.prototype as any).rce, undefined);
  assert.equal((Function.prototype as any).polluted, undefined);
});

test("[N/no-exec] the published entrypoint exposes no dynamic code-execution primitive", async () => {
  // Behavioural backstop for the static verify:no-remote-exec gate: the public
  // API surface must not hand the caller eval / Function / a process spawner.
  const mod: Record<string, unknown> = await import("../src/index.js");
  for (const [name, value] of Object.entries(mod)) {
    if (typeof value !== "function") continue;
    assert.notEqual(value as unknown, eval, `export ${name} must not be eval`);
    assert.notEqual(value as unknown, Function, `export ${name} must not be the Function constructor`);
  }
  // The framework is ESM and ships zero runtime deps, so there is no
  // require()/child_process bridge reachable from a handler's request input.
  assert.ok(!("require" in mod), "no require bridge is exported");
});
