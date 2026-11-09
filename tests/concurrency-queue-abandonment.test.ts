import assert from "node:assert/strict";
import { test } from "node:test";
import { App } from "../src/app.js";
import { concurrencyLimit } from "../src/concurrency-limit.js";
import { HttpError } from "../src/errors.js";

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const contract = {
  responses: { 200: { description: "ok" } },
  acknowledgeNoResponseBodySchema: true,
};

function setup(queueTimeoutMs = 0) {
  let releaseHolder!: () => void;
  let holderEntered!: () => void;
  let waiterQueued!: () => void;
  const held = new Promise<void>(resolve => { releaseHolder = resolve; });
  const entered = new Promise<void>(resolve => { holderEntered = resolve; });
  const queued = new Promise<void>(resolve => { waiterQueued = resolve; });
  const calls = { waiter: 0, probe: 0 };
  const app = new App({ logger: false, requestTimeoutMs: 2000 });
  const limiter = concurrencyLimit({ maxConcurrent: 1, maxQueue: 1, queueTimeoutMs });
  app.use({
    ...limiter,
    beforeHandle(ctx) {
      const result = limiter.beforeHandle?.(ctx);
      if (ctx.routePath === "/waiter") waiterQueued();
      return result;
    },
  });
  app.route({
    ...contract, method: "GET", path: "/holder", operationId: "holder",
    handler: async () => { holderEntered(); await held; return new Response("holder"); },
  });
  app.route({
    ...contract, method: "GET", path: "/waiter", operationId: "waiter",
    requestTimeoutMs: 20,
    handler: () => { calls.waiter++; return new Response("waiter"); },
  });
  app.route({
    ...contract, method: "GET", path: "/probe", operationId: "probe",
    requestTimeoutMs: 100,
    handler: () => { calls.probe++; return new Response("probe"); },
  });
  return { app, calls, entered, queued, releaseHolder };
}

for (const [delay, queueTimeout] of [[40, 0], [260, 0], [260, 1000]] as const) {
  test(`concurrency queue abandonment: waiter cannot acquire a lease ${delay}ms after its timeout (queue timeout ${queueTimeout})`, async () => {
    const fixture = setup(queueTimeout);
    const holder = fixture.app.request("/holder");
    try {
      await fixture.entered;
      assert.equal((await fixture.app.request("/waiter")).status, 408);
      await sleep(delay);
      fixture.releaseHolder();
      assert.equal((await holder).status, 200);
      await sleep(5);
      assert.equal((await fixture.app.request("/probe")).status, 200);
      assert.equal((await fixture.app.request("/probe")).status, 200);
      assert.deepEqual(fixture.calls, { waiter: 0, probe: 2 });
    } finally {
      fixture.releaseHolder();
    }
  });
}

test("concurrency queue abandonment: a live waiter still acquires and releases its slot", async () => {
  const fixture = setup();
  const holder = fixture.app.request("/holder");
  try {
    await fixture.entered;
    const waiter = fixture.app.request("/waiter");
    await fixture.queued;
    fixture.releaseHolder();
    assert.equal((await holder).status, 200);
    assert.equal((await waiter).status, 200);
    assert.equal((await fixture.app.request("/probe")).status, 200);
    assert.deepEqual(fixture.calls, { waiter: 1, probe: 1 });
  } finally {
    fixture.releaseHolder();
  }
});

test("concurrency queue abandonment: signal cancellation removes the waiter before holder release", async () => {
  const fixture = setup();
  const holder = fixture.app.request("/holder");
  try {
    await fixture.entered;
    const controller = new AbortController();
    const waiter = fixture.app.fetch(new Request("http://localhost/waiter", { signal: controller.signal }));
    await fixture.queued;
    controller.abort(new HttpError(499, { title: "Canceled", status: 499 }));
    assert.equal((await waiter).status, 499);
    const probe = fixture.app.request("/probe");
    fixture.releaseHolder();
    assert.equal((await holder).status, 200);
    assert.equal((await probe).status, 200);
    assert.deepEqual(fixture.calls, { waiter: 0, probe: 1 });
  } finally {
    fixture.releaseHolder();
  }
});

test("concurrency queue abandonment: queue timeout still rejects and capacity recovers", async () => {
  const fixture = setup(5);
  const holder = fixture.app.request("/holder");
  try {
    await fixture.entered;
    const response = await fixture.app.request("/waiter");
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "1");
    fixture.releaseHolder();
    assert.equal((await holder).status, 200);
    assert.equal((await fixture.app.request("/probe")).status, 200);
    assert.deepEqual(fixture.calls, { waiter: 0, probe: 1 });
  } finally {
    fixture.releaseHolder();
  }
});
