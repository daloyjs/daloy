/**
 * Regression tests: when the `requestTimeoutMs` deadline answers while the
 * handler is still running, request leases (concurrencyLimit slot, idempotency
 * reservation, graceful-shutdown drain count) stay held until that handler
 * settles, bounded by a grace window for a handler that never settles.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { App, concurrencyLimit, idempotency } from "../src/index.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const UA = { "user-agent": "deadline-test/1" } as const;

function limitedApp(handler: () => Promise<void>, requestTimeoutMs = 50) {
  const app = new App({ logger: false, requestTimeoutMs });
  app.use(concurrencyLimit({ maxConcurrent: 1, maxQueue: 0 }));
  app.route({
    method: "GET",
    path: "/slow",
    operationId: "slow",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) } },
    handler: async () => {
      await handler();
      return { status: 200 as const, body: { ok: true } };
    },
  });
  return app;
}

const get = (app: App) => app.fetch(new Request("http://localhost/slow", { headers: UA }));

test("concurrencyLimit: a timed-out handler keeps its slot until it settles (408 then 503)", async () => {
  let running = 0;
  let peak = 0;
  const app = limitedApp(async () => {
    running++;
    peak = Math.max(peak, running);
    await sleep(400); // ignores ctx.request.signal
    running--;
  });
  const first = await get(app);
  assert.equal(first.status, 408);
  const second = await get(app);
  assert.equal(second.status, 503, "slot must stay held while the abandoned handler runs");
  assert.equal(peak, 1);
  await sleep(450);
  assert.equal(running, 0);
  const third = await get(app);
  assert.equal(third.status, 408, "slot must be free again once the handler settled");
  await sleep(450);
});

test("concurrencyLimit: a handler that settles before the deadline releases at once", async () => {
  const app = limitedApp(async () => sleep(5), 200);
  assert.equal((await get(app)).status, 200);
  assert.equal((await get(app)).status, 200);
});

test("concurrencyLimit: a thrown error still releases the slot once", async () => {
  let fail = true;
  const app = limitedApp(async () => {
    await sleep(1);
    if (fail) throw new Error("boom");
  }, 200);
  assert.equal((await get(app)).status, 500);
  fail = false;
  assert.equal((await get(app)).status, 200);
  assert.equal((await get(app)).status, 200);
});

test("concurrencyLimit: a handler that never settles frees its slot after the grace window", async () => {
  const app = limitedApp(() => new Promise<void>(() => {}), 20);
  assert.equal((await get(app)).status, 408);
  assert.equal((await get(app)).status, 503, "slot held while still inside the grace window");
  // Grace window is 10 x requestTimeoutMs = 200ms.
  await sleep(260);
  assert.equal((await get(app)).status, 408, "slot reclaimed after the grace window");
  await sleep(260);
});

test("idempotency: with a 504 deadline a same-key retry gets 409 and the handler runs once", async () => {
  const app = new App({ logger: false, requestTimeoutMs: 50, requestTimeoutStatus: 504 });
  app.use(idempotency());
  let entered = 0;
  app.route({
    method: "POST",
    path: "/pay",
    operationId: "pay",
    request: { body: z.object({ amount: z.number() }) },
    responses: { 200: { description: "ok", body: z.object({ n: z.number() }) } },
    handler: async () => {
      entered++;
      await sleep(300);
      return { status: 200 as const, body: { n: entered } };
    },
  });
  const send = () =>
    app.fetch(
      new Request("http://localhost/pay", {
        method: "POST",
        headers: {
          ...UA,
          "content-type": "application/json",
          authorization: "Bearer alice",
          "idempotency-key": "k-1",
        },
        body: JSON.stringify({ amount: 10 }),
      }),
    );
  assert.equal((await send()).status, 504);
  assert.equal((await send()).status, 409, "reservation must survive until the handler settles");
  assert.equal(entered, 1);
  await sleep(350);
  // Non-cacheable outcome: once the handler settled the key is released and a
  // retry runs again (unchanged semantics for a 5xx outcome).
  assert.equal((await send()).status, 504);
  assert.equal(entered, 2);
  await sleep(350);
});

test("graceful shutdown waits for a handler the deadline abandoned", async () => {
  let settled = false;
  const app = limitedApp(async () => {
    await sleep(200);
    settled = true;
  });
  assert.equal((await get(app)).status, 408);
  await app.shutdown(2_000);
  assert.equal(settled, true, "drain must not finish before the abandoned handler settles");
});
