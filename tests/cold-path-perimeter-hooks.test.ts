import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  rateLimit,
  ipRestriction,
  _resetSharedRateLimitStoresForTests,
} from "../src/index.js";
import { z } from "zod";

// Regression coverage for issue #44: perimeter `beforeHandle` guards registered
// via `app.use()` (rateLimit, ipRestriction, csrf, …) must also run on the cold
// dispatch path — 404 (no route) and 405 (wrong method) — not only on matched
// routes. Otherwise an attacker can flood unmatched paths to bypass the rate
// limiter (a defense-in-depth / DoS footgun). The OPTIONS preflight branch
// already ran these; these tests pin the 404/405 paths and the no-perimeter
// fast path.

const okRoute = {
  method: "GET" as const,
  path: "/ok" as const,
  responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) } },
  handler: async () => ({ status: 200 as const, body: { ok: true } }),
};

test("app.use(rateLimit) throttles 404 (no-match) requests", async () => {
  _resetSharedRateLimitStoresForTests();
  const app = new App({ env: "test" }).use(rateLimit({ windowMs: 60_000, max: 5 })).route(okRoute);

  const statuses: number[] = [];
  for (let i = 0; i < 10; i++) {
    statuses.push((await app.request(`/missing-${i}`)).status);
  }
  // First 5 within the window are honest 404s; the rest are rejected by the
  // perimeter limiter before the NotFound is thrown.
  assert.deepEqual(statuses.slice(0, 5), [404, 404, 404, 404, 404]);
  assert.ok(
    statuses.slice(5).every((s) => s === 429),
    `expected 429 once the window is exhausted, got ${statuses.join(",")}`
  );
});

test("app.use(rateLimit) throttles 405 (wrong-method) requests", async () => {
  _resetSharedRateLimitStoresForTests();
  const app = new App({ env: "test" }).use(rateLimit({ windowMs: 60_000, max: 3 })).route(okRoute);

  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) {
    statuses.push((await app.request("/ok", { method: "POST" })).status);
  }
  assert.deepEqual(statuses.slice(0, 3), [405, 405, 405]);
  assert.ok(
    statuses.slice(3).every((s) => s === 429),
    `expected 429 after the window is exhausted, got ${statuses.join(",")}`
  );
});

test("app.use(rateLimit) emits a 429 problem+json on the cold path", async () => {
  _resetSharedRateLimitStoresForTests();
  const app = new App({ env: "test" }).use(rateLimit({ windowMs: 60_000, max: 1 })).route(okRoute);

  await app.request("/missing"); // consume the single allowance
  const blocked = await app.request("/missing");
  assert.equal(blocked.status, 429);
  assert.match(blocked.headers.get("content-type") ?? "", /application\/problem\+json/);
  // Rate-limit metadata set by the guard must survive onto the cold-path error.
  assert.equal(blocked.headers.get("x-ratelimit-limit"), "1");
  assert.ok(blocked.headers.get("x-request-id"));
});

test("app.use(ipRestriction) blocks disallowed IPs on 404 paths", async () => {
  const app = new App({ env: "development", trustProxy: true })
    .use(ipRestriction({ allow: ["10.0.0.0/8"], trustProxyHeaders: true }))
    .route(okRoute);

  // Allowed IP hitting an unmatched path still gets a clean 404 (guard passes).
  const allowed404 = await app.request("/missing", {
    headers: { "x-forwarded-for": "10.1.2.3" },
  });
  assert.equal(allowed404.status, 404);

  // Disallowed IP is fenced off before the 404 is reached.
  const blocked = await app.request("/missing", {
    headers: { "x-forwarded-for": "203.0.113.5" },
  });
  assert.equal(blocked.status, 403);
});

test("cold path stays a clean 404/405 when no perimeter guard is registered", async () => {
  const app = new App({ env: "test" }).route(okRoute);

  const notFound = await app.request("/nope");
  assert.equal(notFound.status, 404);

  const wrongMethod = await app.request("/ok", { method: "DELETE" });
  assert.equal(wrongMethod.status, 405);

  // Matched route is unaffected.
  const ok = await app.request("/ok");
  assert.equal(ok.status, 200);
});

test("perimeter guard does not run twice / break the OPTIONS preflight", async () => {
  _resetSharedRateLimitStoresForTests();
  let calls = 0;
  const app = new App({ env: "test" })
    .use({
      beforeHandle(ctx) {
        calls++;
        ctx.set.headers.set("x-perimeter", "1");
        return undefined;
      },
    })
    .route(okRoute);

  calls = 0;
  const preflight = await app.request("/ok", { method: "OPTIONS" });
  // OPTIONS yields its 204 preflight and runs the guard exactly once.
  assert.equal(preflight.status, 204);
  assert.equal(calls, 1);
  assert.equal(preflight.headers.get("x-perimeter"), "1");

  calls = 0;
  await app.request("/missing"); // 404 path
  assert.equal(calls, 1);
});
