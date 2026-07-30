/**
 * Boot guard: a stored-response middleware mounted ahead of a request budget.
 *
 * `responseCache()` and `idempotency()` both answer from `beforeHandle` and end
 * the hook chain when they do. `rateLimit()` / `loginThrottle()` enforce from
 * that same phase, so a limiter mounted *behind* either one never counts the
 * requests it serves. Measured before the guard existed: `rateLimit({ max: 2 })`
 * admitted six of six requests behind a cache and behind a replay, i.e. the
 * declared budget was silently unlimited for exactly the repeat traffic the limit
 * was written for.
 *
 * Same shape as the `responseCache`-ahead-of-gates finding. That one was fixed by
 * moving the five network-identity gates to `preBody`; `rateLimit` cannot follow
 * them there, because its `keyGenerator` is caller-supplied and may read
 * `ctx.state`, which `session()` / auth populate later. So the unsafe order is
 * refused at boot instead, mirroring the existing cache-ahead-of-`tenancy()`
 * guard.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  App,
  rateLimit,
  loginThrottle,
  _resetSharedRateLimitStoresForTests,
} from "../src/index.js";
import { idempotency } from "../src/idempotency.js";
import { responseCache, MemoryResponseCacheStore } from "../src/response-cache.js";

function appWith(layers: unknown[], method: "GET" | "POST" = "GET", env = "production"): App {
  const app = new App({ env, logger: false } as never);
  for (const layer of layers) app.use(layer as never);
  app.route({
    method,
    path: "/x",
    operationId: `op_${method}_${Math.abs(layers.length)}`,
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  return app;
}

const hit = (app: App, method: "GET" | "POST" = "GET") =>
  app.request("/x", {
    method,
    ...(method === "POST"
      ? { body: "{}", headers: { "content-type": "application/json", "idempotency-key": "k-1" } }
      : {}),
  });

const cache = () => responseCache({ ttlSeconds: 60, store: new MemoryResponseCacheStore() });
const limiter = () => rateLimit({ windowMs: 60_000, max: 2 });

test("[unhappy] responseCache ahead of rateLimit refuses to boot in production", async () => {
  _resetSharedRateLimitStoresForTests();
  const res = await hit(appWith([cache(), limiter()]));
  assert.equal(res.status, 500, "the boot guard must refuse to serve this app");
});

test("[unhappy] idempotency ahead of rateLimit refuses to boot in production", async () => {
  _resetSharedRateLimitStoresForTests();
  const res = await hit(appWith([idempotency({}), limiter()], "POST"), "POST");
  assert.equal(res.status, 500, "the boot guard must refuse to serve this app");
});

test("[unhappy] responseCache ahead of loginThrottle refuses to boot in production", async () => {
  // loginThrottle wraps rateLimit, so it carries the same request-budget marker
  // and is preemptable the same way — on the credential-entry surface, where an
  // unlimited budget matters most.
  _resetSharedRateLimitStoresForTests();
  const res = await hit(appWith([cache(), loginThrottle({ max: 2 })]));
  assert.equal(res.status, 500);
});

test("rateLimit ahead of responseCache boots and still enforces the budget", async () => {
  _resetSharedRateLimitStoresForTests();
  const app = appWith([limiter(), cache()]);
  const seq: number[] = [];
  for (let i = 0; i < 4; i++) seq.push((await hit(app)).status);
  assert.deepEqual(seq, [200, 200, 429, 429], "the limiter must count cache hits too");
});

test("rateLimit ahead of idempotency boots and still enforces the budget", async () => {
  _resetSharedRateLimitStoresForTests();
  const app = appWith([limiter(), idempotency({})], "POST");
  const seq: number[] = [];
  for (let i = 0; i < 4; i++) seq.push((await hit(app, "POST")).status);
  assert.deepEqual(seq, [200, 200, 429, 429], "the limiter must count replays too");
});

test("either middleware alone boots — the guard needs both to be present", async () => {
  _resetSharedRateLimitStoresForTests();
  assert.equal((await hit(appWith([cache()]))).status, 200, "cache with no limiter is fine");
  _resetSharedRateLimitStoresForTests();
  assert.equal((await hit(appWith([limiter()]))).status, 200, "limiter with no cache is fine");
  _resetSharedRateLimitStoresForTests();
  assert.equal(
    (await hit(appWith([idempotency({})], "POST"), "POST")).status,
    200,
    "idempotency with no limiter is fine"
  );
});

test("the guard is production-only, matching every other boot guard", async () => {
  // Per the risk register, refuse-to-boot guards stay out of dev/CI so an
  // iterating surface does not pay the cost. The bypass is still real in dev —
  // this asserts the documented gating, not that the order is safe there.
  _resetSharedRateLimitStoresForTests();
  const res = await hit(appWith([cache(), limiter()], "GET", "development"));
  assert.equal(res.status, 200, "development must still boot");
});

test("secureDefaults: false opts out, like the other boot guards", async () => {
  // `secureDefaults: false` is itself refused in production unless the operator
  // also passes `acknowledgeInsecureDefaults`, so opting out of this guard takes
  // two deliberate steps rather than one.
  _resetSharedRateLimitStoresForTests();
  const app = new App({
    env: "production",
    logger: false,
    secureDefaults: false,
    acknowledgeInsecureDefaults: true,
  } as never);
  app.use(cache());
  app.use(limiter());
  app.route({
    method: "GET",
    path: "/x",
    operationId: "opOptOut",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  assert.equal((await app.request("/x")).status, 200);
});
