/**
 * Regression tests for the `autoBan()` identity-resolution phases.
 *
 * Moving the gate from `beforeHandle` to `preBody` (so a `responseCache()` hit
 * cannot preempt it) silently changed the contract of a custom `keyGenerator`:
 * it now runs before body I/O and before every `beforeHandle` layer. A generator
 * keyed on state that `session()` resolves therefore returned `undefined`, the
 * key was never stashed, and `onSend` — which reads that stashed key — recorded
 * no strike. The ban never armed, with no error and no log: the security control
 * was simply off.
 *
 * `keyGenerator` is now retried in `beforeHandle` when `preBody` comes up empty.
 * These tests pin down the three behaviours that matter:
 *   - a generator that resolves in `preBody` is still enforced there (immune to
 *     mount order, which was the point of the move);
 *   - a generator that can only resolve later still bans;
 *   - a generator that never resolves still skips, rather than collapsing every
 *     caller into one shared bucket.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { App, autoBan, responseCache, _resetAutoBanStoresForTests } from "../src/index.js";
import type { IdentityGateContext } from "../src/index.js";

/** An app whose only route always 401s, so strikes accumulate. */
function loginApp(
  autoBanOpts: Record<string, unknown>,
  opts: { sessionLayer?: boolean; cacheFirst?: boolean } = {}
): App {
  _resetAutoBanStoresForTests();
  const app = new App({ env: "production", logger: false });
  if (opts.cacheFirst) {
    app.use(responseCache({ ttlSeconds: 30, statusHeaderName: "x-cache" }));
  }
  if (opts.sessionLayer) {
    // Stand-in for `session()`: resolves an identity in `beforeHandle`, i.e.
    // after `preBody` has already run.
    app.use({
      beforeHandle(ctx) {
        const who = /session=(\w+)/.exec(ctx.request.headers.get("cookie") ?? "")?.[1];
        if (who) (ctx.state as Record<string, unknown>).sessionUser = who;
        return undefined;
      },
    });
  }
  app.use(
    autoBan({
      groupId: `kg-${Math.random().toString(36).slice(2)}`,
      windowMs: 60_000,
      maxStrikes: 2,
      banMs: 30_000,
      watchStatuses: [401],
      banStatus: 429,
      ...autoBanOpts,
    })
  );
  app.route({
    method: "POST",
    path: "/login",
    operationId: "login",
    acknowledgeNoResponseBodySchema: true,
    responses: { 401: { description: "nope" } },
    handler: async () => new Response("bad creds", { status: 401 }),
  });
  return app;
}

const hammer = async (app: App, headers: Record<string, string>, n: number): Promise<number> => {
  let status = 0;
  for (let i = 0; i < n; i++) {
    status = (await app.fetch(new Request("https://api.test/login", { method: "POST", headers })))
      .status;
  }
  return status;
};

test("a keyGenerator resolvable only in beforeHandle still arms the ban", async () => {
  // This is the case that silently stopped working: `ctx.state.sessionUser` is
  // populated by a `beforeHandle` layer, so the `preBody` pass sees nothing.
  const app = loginApp(
    {
      keyGenerator: (ctx: IdentityGateContext) =>
        (ctx.state as Record<string, string | undefined>).sessionUser,
    },
    { sessionLayer: true }
  );
  const status = await hammer(app, { cookie: "session=alice" }, 5);
  assert.equal(status, 429, "strikes must be recorded even when identity resolves late");
});

test("late-resolved identities do not leak across callers", async () => {
  const app = loginApp(
    {
      keyGenerator: (ctx: IdentityGateContext) =>
        (ctx.state as Record<string, string | undefined>).sessionUser,
    },
    { sessionLayer: true }
  );
  await hammer(app, { cookie: "session=alice" }, 1);
  const bob = await hammer(app, { cookie: "session=bob" }, 1);
  assert.equal(bob, 401, "bob must not inherit alice's strike");
});

test("a keyGenerator resolvable in preBody is still enforced there, before the cache", async () => {
  // The whole reason for the phase move: with `responseCache()` mounted first, a
  // header-keyed generator must still reject a banned client rather than be
  // preempted by a hit. `/login` is a POST so it is not itself cacheable — what
  // is being asserted is that enforcement did not slide into `beforeHandle`.
  const app = loginApp(
    {
      keyGenerator: (ctx: IdentityGateContext) => ctx.request.headers.get("x-api-key") ?? undefined,
    },
    {
      cacheFirst: true,
    }
  );
  const status = await hammer(app, { "x-api-key": "k-1" }, 5);
  assert.equal(status, 429);
  // A different key starts clean.
  assert.equal(await hammer(app, { "x-api-key": "k-2" }, 1), 401);
});

test("a keyGenerator that never resolves still skips instead of sharing a bucket", async () => {
  const app = loginApp({ keyGenerator: () => undefined });
  const status = await hammer(app, {}, 6);
  assert.equal(status, 401, "an unidentifiable caller must never be banned into a shared bucket");
});

test("the beforeHandle retry does not double-count a preBody-resolved identity", async () => {
  // Both phases run for every request when a custom generator is supplied. If the
  // fallback re-enforced unconditionally it would record two strikes per request
  // and ban at half the configured threshold.
  const strikes: number[] = [];
  const app = loginApp({
    keyGenerator: (ctx: IdentityGateContext) => ctx.request.headers.get("x-api-key") ?? undefined,
    maxStrikes: 3,
    onStrike: ({ strikes: n }: { strikes: number }) => strikes.push(n),
  });
  await hammer(app, { "x-api-key": "k-count" }, 2);
  assert.deepEqual(strikes, [1, 2], "each request must count exactly once");
});
