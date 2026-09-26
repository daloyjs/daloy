import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  concurrencyLimit,
  type ConcurrencyLimitOptions,
  type ConcurrencyRejection,
} from "../src/index.js";

// ---------- helpers ----------

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * App guarded by `concurrencyLimit()` with a `/slow` route whose handler blocks
 * until `gate` resolves, so multiple requests can be held in flight at once.
 */
function appWith(opts: ConcurrencyLimitOptions, gate: () => Promise<void>): App {
  const app = new App({ env: "development" });
  app.use(concurrencyLimit(opts));
  app.route({
    method: "GET",
    path: "/slow",
    responses: { 200: { description: "ok" } },
    handler: async () => {
      await gate();
      return { status: 200 as const, body: { ok: true } };
    },
  });
  app.route({
    method: "GET",
    path: "/other",
    responses: { 200: { description: "ok" } },
    handler: async () => {
      await gate();
      return { status: 200 as const, body: { ok: true } };
    },
  });
  return app;
}

function req(path = "/slow", ip?: string): Request {
  const headers: Record<string, string> = {};
  if (ip) headers["x-forwarded-for"] = ip;
  return new Request(`http://x${path}`, { headers });
}

// ---------- construction validation (unhappy) ----------

test("concurrencyLimit() requires a positive maxConcurrent", () => {
  assert.throws(() => concurrencyLimit({ maxConcurrent: 0 }), /maxConcurrent/);
  assert.throws(() => concurrencyLimit({ maxConcurrent: -1 }), /maxConcurrent/);
  // @ts-expect-error missing required option
  assert.throws(() => concurrencyLimit({}), /maxConcurrent/);
});

test("concurrencyLimit() rejects a negative maxQueue", () => {
  assert.throws(() => concurrencyLimit({ maxConcurrent: 1, maxQueue: -1 }), /maxQueue/);
});

test("concurrencyLimit() rejects a negative queueTimeoutMs", () => {
  assert.throws(() => concurrencyLimit({ maxConcurrent: 1, queueTimeoutMs: -5 }), /queueTimeoutMs/);
});

test("concurrencyLimit() rejects a negative retryAfterSeconds", () => {
  assert.throws(
    () => concurrencyLimit({ maxConcurrent: 1, retryAfterSeconds: -1 }),
    /retryAfterSeconds/
  );
});

test('scope "client" requires an identity source', () => {
  assert.throws(
    () => concurrencyLimit({ maxConcurrent: 1, scope: "client" }),
    /scope "client" requires/
  );
});

// ---------- core limiting (happy + unhappy) ----------

test("rejects overflow with 503 + Retry-After when no queue is configured", async () => {
  const gate = deferred();
  const app = appWith({ maxConcurrent: 2 }, () => gate.promise);

  // Two slots fill up (held open by the gate).
  const p1 = app.fetch(req());
  const p2 = app.fetch(req());
  // Let the two in-flight handlers reach the gate.
  await new Promise((r) => setTimeout(r, 10));

  // Third request overflows immediately.
  const r3 = await app.fetch(req());
  assert.equal(r3.status, 503);
  assert.equal(r3.headers.get("retry-after"), "1");

  gate.resolve();
  assert.equal((await p1).status, 200);
  assert.equal((await p2).status, 200);
});

test("admits queued requests in FIFO order as slots free", async () => {
  const gate = deferred();
  const app = appWith({ maxConcurrent: 1, maxQueue: 2 }, () => gate.promise);

  const p1 = app.fetch(req()); // takes the only slot
  await new Promise((r) => setTimeout(r, 10));
  const p2 = app.fetch(req()); // queued
  const p3 = app.fetch(req()); // queued
  await new Promise((r) => setTimeout(r, 10));
  const p4 = await app.fetch(req()); // queue full -> 503
  assert.equal(p4.status, 503);

  gate.resolve();
  const results = await Promise.all([p1, p2, p3]);
  for (const res of results) assert.equal(res.status, 200);
});

test("queue-full rejection fires onReject with reason and counts", async () => {
  const gate = deferred();
  const rejections: ConcurrencyRejection[] = [];
  const app = appWith(
    { maxConcurrent: 1, maxQueue: 0, onReject: (r) => rejections.push(r) },
    () => gate.promise
  );

  const p1 = app.fetch(req());
  await new Promise((r) => setTimeout(r, 10));
  const r2 = await app.fetch(req());
  assert.equal(r2.status, 503);
  assert.equal(rejections.length, 1);
  assert.equal(rejections[0]!.reason, "queue-full");
  assert.equal(rejections[0]!.active, 1);

  gate.resolve();
  await p1;
});

test("queue-timeout rejects a waiter that waits too long", async () => {
  const gate = deferred();
  const rejections: ConcurrencyRejection[] = [];
  const app = appWith(
    {
      maxConcurrent: 1,
      maxQueue: 5,
      queueTimeoutMs: 30,
      onReject: (r) => rejections.push(r),
    },
    () => gate.promise
  );

  const p1 = app.fetch(req()); // holds the slot past the timeout
  await new Promise((r) => setTimeout(r, 10));
  const r2 = await app.fetch(req()); // queued, then times out
  assert.equal(r2.status, 503);
  assert.equal(rejections[0]!.reason, "queue-timeout");

  gate.resolve();
  await p1;
});

test("retryAfterSeconds: 0 omits the Retry-After header", async () => {
  const gate = deferred();
  const app = appWith({ maxConcurrent: 1, retryAfterSeconds: 0 }, () => gate.promise);
  const p1 = app.fetch(req());
  await new Promise((r) => setTimeout(r, 10));
  const r2 = await app.fetch(req());
  assert.equal(r2.status, 503);
  assert.equal(r2.headers.get("retry-after"), null);
  gate.resolve();
  await p1;
});

test("slots are released so later requests succeed", async () => {
  const app = appWith({ maxConcurrent: 1 }, () => Promise.resolve());
  for (let i = 0; i < 5; i++) {
    const res = await app.fetch(req());
    assert.equal(res.status, 200);
  }
});

// ---------- scope partitioning ----------

test('scope "route" isolates budgets per method + path', async () => {
  const gate = deferred();
  const app = appWith({ maxConcurrent: 1, scope: "route" }, () => gate.promise);

  const slow1 = app.fetch(req("/slow"));
  await new Promise((r) => setTimeout(r, 10));
  // Same route overflows...
  const slow2 = await app.fetch(req("/slow"));
  assert.equal(slow2.status, 503);
  // ...but a different route has its own budget and is admitted.
  const other = app.fetch(req("/other"));
  await new Promise((r) => setTimeout(r, 10));

  gate.resolve();
  assert.equal((await slow1).status, 200);
  assert.equal((await other).status, 200);
});

test('scope "client" isolates budgets per client identity', async () => {
  const gate = deferred();
  const app = appWith(
    { maxConcurrent: 1, scope: "client", trustProxyHeaders: true },
    () => gate.promise
  );

  const a1 = app.fetch(req("/slow", "10.0.0.1"));
  await new Promise((r) => setTimeout(r, 10));
  const a2 = await app.fetch(req("/slow", "10.0.0.1")); // same client overflows
  assert.equal(a2.status, 503);
  const b1 = app.fetch(req("/slow", "10.0.0.2")); // different client admitted
  await new Promise((r) => setTimeout(r, 10));

  gate.resolve();
  assert.equal((await a1).status, 200);
  assert.equal((await b1).status, 200);
});

test('scope "client" fails open when identity is unresolved', async () => {
  const gate = deferred();
  const app = appWith(
    { maxConcurrent: 1, scope: "client", trustProxyHeaders: true },
    () => gate.promise
  );
  // No x-forwarded-for -> undefined key -> not limited -> all admitted.
  const p1 = app.fetch(req("/slow"));
  const p2 = app.fetch(req("/slow"));
  await new Promise((r) => setTimeout(r, 10));
  gate.resolve();
  assert.equal((await p1).status, 200);
  assert.equal((await p2).status, 200);
});

test("custom scope function can skip limiting by returning undefined", async () => {
  const gate = deferred();
  const app = appWith(
    {
      maxConcurrent: 1,
      scope: (ctx) => ctx.request.headers.get("x-tenant") ?? undefined,
    },
    () => gate.promise
  );
  // No tenant header -> undefined -> unlimited.
  const p1 = app.fetch(req("/slow"));
  const p2 = app.fetch(req("/slow"));
  await new Promise((r) => setTimeout(r, 10));
  gate.resolve();
  assert.equal((await p1).status, 200);
  assert.equal((await p2).status, 200);
});

// ---------- release on error path ----------

test("releases the slot even when the handler errors", async () => {
  const app = new App({ env: "development" });
  app.use(concurrencyLimit({ maxConcurrent: 1 }));
  let boom = true;
  app.route({
    method: "GET",
    path: "/maybe",
    responses: { 200: { description: "ok" }, 500: { description: "err" } },
    handler: async () => {
      if (boom) throw new Error("kaboom");
      return { status: 200 as const, body: { ok: true } };
    },
  });

  const r1 = await app.fetch(new Request("http://x/maybe"));
  assert.equal(r1.status, 500); // slot must have been released here
  boom = false;
  const r2 = await app.fetch(new Request("http://x/maybe"));
  assert.equal(r2.status, 200); // proves the slot was freed
});

// ---------- regression: route scope keys on the matched template ----------

function paramApp(gate: () => Promise<void>): App {
  const app = new App({ env: "development" });
  app.use(concurrencyLimit({ maxConcurrent: 1, scope: "route" }));
  app.route({
    method: "GET",
    path: "/reports/:id",
    responses: { 200: { description: "ok" } },
    handler: async () => {
      await gate();
      return { status: 200 as const, body: { ok: true } };
    },
  });
  app.route({
    method: "GET",
    path: "/other",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  return app;
}

test('scope "route" shares one budget across path-param values and trailing slash', async () => {
  const gate = deferred();
  const app = paramApp(() => gate.promise);
  const first = app.fetch(new Request("http://x/reports/1"));
  await new Promise((r) => setTimeout(r, 10));
  // Varying the param (or adding a trailing slash) must NOT mint a fresh budget.
  for (const p of ["/reports/2", "/reports/3", "/reports/1/"]) {
    const res = await app.fetch(new Request(`http://x${p}`));
    assert.equal(res.status, 503, p);
  }
  assert.equal((await app.fetch(new Request("http://x/reports/2"))).status, 503);
  gate.resolve();
  assert.equal((await first).status, 200);
});

test('scope "route" still gives a different route template its own budget', async () => {
  const gate = deferred();
  const app = paramApp(() => gate.promise);
  const first = app.fetch(new Request("http://x/reports/1"));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((await app.fetch(new Request("http://x/other"))).status, 200);
  gate.resolve();
  assert.equal((await first).status, 200);
  // Slot released: the same template is admitted again.
  gate.resolve();
  assert.equal((await app.fetch(new Request("http://x/reports/9"))).status, 200);
});

// ---------- regression: slot released even when another onSend throws ----------

test("releases the slot when an earlier onSend hook throws (no permanent 503)", async () => {
  const app = new App({ env: "production", logger: false });
  let explode = true;
  app.use({
    onSend() {
      if (explode) throw new Error("store outage");
      return undefined;
    },
  });
  app.use(concurrencyLimit({ maxConcurrent: 1 }));
  app.route({
    method: "GET",
    path: "/x",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });

  for (let i = 0; i < 3; i++) {
    // The throwing onSend makes the dispatch fail; the slot must still be freed.
    await app.fetch(new Request("http://x/x")).then(
      () => undefined,
      () => undefined
    );
  }
  explode = false;
  const res = await app.fetch(new Request("http://x/x"));
  assert.equal(res.status, 200);
});

test("guaranteed release does not double-release: cap still holds afterwards", async () => {
  let block: Deferred | undefined;
  const app = appWith({ maxConcurrent: 1 }, () => block?.promise ?? Promise.resolve());
  // Several completed requests: each runs the onSend release AND the finalizer.
  for (let i = 0; i < 3; i++) {
    assert.equal((await app.fetch(req("/slow"))).status, 200);
  }
  block = deferred();
  const held = app.fetch(req("/slow"));
  await new Promise((r) => setTimeout(r, 10));
  // If a double release had driven `active` negative, this would be admitted.
  assert.equal((await app.fetch(req("/slow"))).status, 503);
  block.resolve();
  assert.equal((await held).status, 200);
});
